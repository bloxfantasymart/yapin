import { createServer } from 'node:http';
import { STAFF_TIERS } from '../api/permissions.js';
import { ACTIVE_TRADE_STATES, OPEN_TICKET_STATUSES } from '../database/repositories/index.js';
import { AppError, AuthorizationError, NotFoundError, ValidationError, sanitizeErrorMessage } from '../utils/errors.js';
import { generateCorrelationId } from '../utils/ids.js';
import {
  AssignMiddlemanBodySchema,
  AuditSearchQuerySchema,
  CancelTradeBodySchema,
  CompleteTradeBodySchema,
  ResolveDisputeBodySchema,
  TicketCloseBodySchema,
  TicketNoteBodySchema,
  UpdateServerConfigBodySchema,
  VerifyDepositBodySchema,
} from './schemas.js';
import {
  HttpRateLimiter,
  OAUTH_STATE_COOKIE_NAME,
  PendingOAuthStore,
  SESSION_COOKIE_NAME,
  assertSessionTier,
  generateRandomToken,
  parseCookies,
  serializeCookie,
  sha256Hex,
  signValue,
  unsignValue,
  verifyCsrfToken,
  verifySameOriginRequest,
} from './sessionSecurity.js';
import { renderLoginPage, renderStaffConsolePage } from './ui.js';

const MAX_BODY_BYTES = 32_768;

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' https://files.yapper.website data:; connect-src 'self'; base-uri 'self'; form-action 'self'",
  );
  res.setHeader('Cache-Control', 'no-store');
}

function sendJson(res, status, payload, extraHeaders = {}) {
  applySecurityHeaders(res);
  for (const [k, v] of Object.entries(extraHeaders)) {
    res.setHeader(k, v);
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function sendHtml(res, status, html, extraHeaders = {}) {
  applySecurityHeaders(res);
  for (const [k, v] of Object.entries(extraHeaders)) {
    res.setHeader(k, v);
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new ValidationError('Request body exceeds 32 KB limit.');
    }
    chunks.push(chunk);
  }
  if (total === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    throw new ValidationError('Malformed JSON request body.');
  }
}

/**
 * Creates the optional "Login with Yapin'" OAuth2 Staff Dashboard HTTP server.
 * Never exposes `YAPIN_BOT_TOKEN` or `YAPIN_OAUTH_CLIENT_SECRET` to clients.
 */
export function createDashboardServer({
  oauthClient,
  serverId,
  sessionSecret,
  secureCookies = false,
  permissionsApi,
  repositories,
  services,
  logger,
  sessionTtlSeconds = 8 * 3600,
}) {
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new ValidationError('Dashboard requires a sessionSecret of at least 32 characters.');
  }

  const pendingOAuth = new PendingOAuthStore();
  const readLimiter = new HttpRateLimiter({ maxRequests: 120, windowMs: 60_000 });
  const writeLimiter = new HttpRateLimiter({ maxRequests: 30, windowMs: 60_000 });

  async function resolveAuthenticatedSession(req) {
    const cookies = parseCookies(req.headers.cookie);
    const signedSession = cookies[SESSION_COOKIE_NAME];
    const rawSessionToken = unsignValue(signedSession, sessionSecret);
    if (!rawSessionToken) return null;

    const sessionIdHash = sha256Hex(rawSessionToken);
    const session = await repositories.operational.findValidSession(sessionIdHash);
    if (!session || session.serverId !== serverId) return null;
    return session;
  }

  async function requireStaffSession(req, { minTier = STAFF_TIERS.SUPPORT, requireFreshRbac = false } = {}) {
    const session = await resolveAuthenticatedSession(req);
    if (!session) {
      throw new AuthorizationError('Authentication required. Please log in with Yapin.');
    }

    if (requireFreshRbac) {
      const cfg = await repositories.serverConfigs.getOrCreate(serverId);
      const access = await permissionsApi.resolveMemberAccess(serverId, session.yapinUserId, cfg, {
        forceRefresh: true,
      });
      if (!access.roles.isStaff || access.tier < minTier) {
        await repositories.operational.deleteSession(session.sessionIdHash);
        throw new AuthorizationError('Your server staff permissions were revoked or are insufficient.');
      }
      session.staffTier = access.tier;
    }

    assertSessionTier(session, minTier);
    return session;
  }

  function enforcePostGuard(req, session) {
    verifySameOriginRequest(req);
    verifyCsrfToken(session.csrfToken, req.headers['x-csrf-token']);
    writeLimiter.check(`staff:${session.yapinUserId}`);
  }

  const server = createServer(async (req, res) => {
    const correlationId = generateCorrelationId();
    const clientIp = String(req.socket?.remoteAddress || 'unknown');

    try {
      const url = new URL(req.url || '/', 'http://dashboard.local');
      const pathname = url.pathname;
      const method = (req.method || 'GET').toUpperCase();

      if (method === 'GET' && pathname === '/healthz') {
        return sendJson(res, 200, { status: 'ok', service: 'yapin-middleman-dashboard' });
      }

      if (method === 'GET' && pathname === '/login') {
        readLimiter.check(`ip:${clientIp}`);
        return sendHtml(res, 200, renderLoginPage());
      }

      // 1. OAuth2 Login Initiation (PKCE S256 + signed state cookie)
      if (method === 'GET' && pathname === '/auth/login') {
        writeLimiter.check(`login:${clientIp}`);
        const state = oauthClient.constructor.generateState(24);
        const pkce = oauthClient.constructor.generatePKCE();
        pendingOAuth.create(state, pkce.verifier);

        const authorizeUrl = oauthClient.buildAuthorizeUrl({
          state,
          codeChallenge: pkce.challenge,
        });

        const signedState = signValue(state, sessionSecret);
        res.statusCode = 302;
        applySecurityHeaders(res);
        res.setHeader(
          'Set-Cookie',
          serializeCookie(OAUTH_STATE_COOKIE_NAME, signedState, {
            maxAgeSeconds: 300,
            secure: secureCookies,
            httpOnly: true,
            sameSite: 'Lax',
          }),
        );
        res.setHeader('Location', authorizeUrl);
        return res.end();
      }

      // 2. OAuth2 Callback -> Code Exchange -> /api/oauth/me -> Server-Side Bot API RBAC Check
      if (method === 'GET' && pathname === '/auth/callback') {
        writeLimiter.check(`cb:${clientIp}`);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const cookies = parseCookies(req.headers.cookie);
        const cookieState = unsignValue(cookies[OAUTH_STATE_COOKIE_NAME], sessionSecret);

        if (!code || !state || !cookieState || state !== cookieState) {
          return sendHtml(
            res,
            400,
            renderLoginPage({ errorMsg: 'Invalid or expired OAuth2 state. Please try signing in again.' }),
          );
        }

        const pkceRecord = pendingOAuth.consume(state);
        if (!pkceRecord) {
          return sendHtml(
            res,
            400,
            renderLoginPage({ errorMsg: 'OAuth2 login session expired. Please try again.' }),
          );
        }

        const tokenData = await oauthClient.exchangeCode(code, {
          codeVerifier: pkceRecord.codeVerifier,
        });
        const oauthUser = await oauthClient.fetchCurrentUser(tokenData.accessToken);

        const cfg = await repositories.serverConfigs.getOrCreate(serverId);
        const access = await permissionsApi.resolveMemberAccess(serverId, oauthUser.id, cfg, {
          forceRefresh: true,
        });

        if (!access.roles.isStaff) {
          await services.audit.record({
            serverId,
            actorId: oauthUser.id,
            actorType: 'USER',
            action: 'DASHBOARD_LOGIN_DENIED',
            targetType: 'SYSTEM',
            targetId: 'dashboard',
            correlationId,
            metadata: { reason: 'Authenticated Yapin user lacks server staff roles' },
          });
          return sendHtml(
            res,
            403,
            renderLoginPage({
              errorMsg: 'Access denied: your Yapin account does not hold an authorized staff role on this server.',
            }),
          );
        }

        const rawSessionId = generateRandomToken(32);
        const sessionIdHash = sha256Hex(rawSessionId);
        const csrfToken = generateRandomToken(24);
        const expiresAt = new Date(Date.now() + sessionTtlSeconds * 1000);

        await repositories.operational.createSession({
          sessionIdHash,
          yapinUserId: oauthUser.id,
          username: oauthUser.username || oauthUser.id,
          displayName: oauthUser.displayName,
          serverId,
          staffTier: access.tier,
          csrfToken,
          expiresAt,
        });

        await services.audit.record({
          serverId,
          actorId: oauthUser.id,
          actorType: 'STAFF',
          action: 'DASHBOARD_LOGIN_SUCCESS',
          targetType: 'SYSTEM',
          targetId: 'dashboard',
          correlationId,
          afterState: { staffTier: access.tier },
        });

        const signedCookie = signValue(rawSessionId, sessionSecret);
        res.statusCode = 302;
        applySecurityHeaders(res);
        res.setHeader('Set-Cookie', [
          serializeCookie(SESSION_COOKIE_NAME, signedCookie, {
            maxAgeSeconds: sessionTtlSeconds,
            secure: secureCookies,
            httpOnly: true,
            sameSite: 'Lax',
          }),
          serializeCookie(OAUTH_STATE_COOKIE_NAME, '', {
            maxAgeSeconds: 0,
            secure: secureCookies,
            httpOnly: true,
          }),
        ]);
        res.setHeader('Location', '/');
        return res.end();
      }

      // 3. CSRF-Protected Logout
      if (method === 'POST' && pathname === '/auth/logout') {
        const session = await requireStaffSession(req);
        enforcePostGuard(req, session);
        await repositories.operational.deleteSession(session.sessionIdHash);
        return sendJson(
          res,
          200,
          { ok: true },
          {
            'Set-Cookie': serializeCookie(SESSION_COOKIE_NAME, '', {
              maxAgeSeconds: 0,
              secure: secureCookies,
              httpOnly: true,
            }),
          },
        );
      }

      // 4. Main Staff Console UI
      if (method === 'GET' && pathname === '/') {
        readLimiter.check(`ip:${clientIp}`);
        const session = await resolveAuthenticatedSession(req);
        if (!session) {
          res.statusCode = 302;
          res.setHeader('Location', '/login');
          return res.end();
        }
        return sendHtml(res, 200, renderStaffConsolePage(session));
      }

      // 5. Authenticated JSON API Routes
      if (method === 'GET' && pathname === '/api/me') {
        readLimiter.check(`ip:${clientIp}`);
        const session = await requireStaffSession(req);
        return sendJson(res, 200, {
          yapinUserId: session.yapinUserId,
          username: session.username,
          displayName: session.displayName,
          serverId: session.serverId,
          staffTier: session.staffTier,
          csrfToken: session.csrfToken,
        });
      }

      if (method === 'GET' && pathname === '/api/overview') {
        readLimiter.check(`ip:${clientIp}`);
        const session = await requireStaffSession(req);
        const [tradesOut, ticketsOut, openDisputes, staffStats] = await Promise.all([
          repositories.trades.listTrades({
            serverId,
            state: ACTIVE_TRADE_STATES,
            limit: 50,
          }),
          repositories.tickets.listTickets({
            serverId,
            status: OPEN_TICKET_STATUSES,
            limit: 50,
          }),
          repositories.disputes.listDisputes({
            serverId,
            statuses: ['OPEN', 'UNDER_REVIEW', 'ESCALATED'],
            limit: 50,
          }),
          repositories.users.listStaffLeaderboard({ limit: 20 }),
        ]);

        const visibleTickets = ticketsOut.items.filter(
          (t) => t.type !== 'STAFF_REPORT' || session.staffTier >= STAFF_TIERS.ADMIN,
        );

        const depositQueue = tradesOut.items.filter(
          (t) =>
            t.deposits?.traderA?.status === 'REPORTED_SENT' ||
            t.deposits?.traderB?.status === 'REPORTED_SENT' ||
            t.state === 'DEPOSIT_CONFIRMATION',
        );

        return sendJson(res, 200, {
          activeTrades: tradesOut.items,
          depositQueue,
          openDisputes: openDisputes.items,
          openTickets: visibleTickets,
          staffStats,
        });
      }

      let m;
      if (method === 'GET' && (m = /^\/api\/trades\/([A-Za-z0-9-]+)$/.exec(pathname))) {
        readLimiter.check(`ip:${clientIp}`);
        const session = await requireStaffSession(req, { minTier: STAFF_TIERS.MIDDLEMAN });
        const detail = await services.trade.getTradeForViewer({
          serverId,
          tradeId: m[1].toUpperCase(),
          viewerId: session.yapinUserId,
        });
        return sendJson(res, 200, detail);
      }

      if (method === 'POST' && (m = /^\/api\/trades\/([A-Za-z0-9-]+)\/assign$/.exec(pathname))) {
        const session = await requireStaffSession(req, {
          minTier: STAFF_TIERS.MIDDLEMAN,
          requireFreshRbac: true,
        });
        enforcePostGuard(req, session);

        const body = AssignMiddlemanBodySchema.parse(await readJsonBody(req));
        const tradeId = m[1].toUpperCase();
        const updated = body.reassign
          ? await services.assignment.reassignMiddleman({
              serverId,
              tradeId,
              newMiddlemanId: body.targetMiddlemanId,
              actorId: session.yapinUserId,
              reason: body.reason,
              correlationId,
            })
          : await services.assignment.assignMiddleman({
              serverId,
              tradeId,
              targetMiddlemanId: body.targetMiddlemanId,
              actorId: session.yapinUserId,
              reason: body.reason,
              correlationId,
            });
        return sendJson(res, 200, { trade: updated });
      }

      if (method === 'POST' && (m = /^\/api\/trades\/([A-Za-z0-9-]+)\/verify-deposit$/.exec(pathname))) {
        const session = await requireStaffSession(req, {
          minTier: STAFF_TIERS.MIDDLEMAN,
          requireFreshRbac: true,
        });
        enforcePostGuard(req, session);

        const body = VerifyDepositBodySchema.parse(await readJsonBody(req));
        const updated = await services.deposit.verifyDeposit({
          serverId,
          tradeId: m[1].toUpperCase(),
          traderSideOrUserId: body.traderSideOrUserId,
          decision: body.decision,
          notes: body.notes,
          actorId: session.yapinUserId,
          correlationId,
        });
        return sendJson(res, 200, { trade: updated });
      }

      if (method === 'POST' && (m = /^\/api\/trades\/([A-Za-z0-9-]+)\/complete$/.exec(pathname))) {
        const session = await requireStaffSession(req, {
          minTier: STAFF_TIERS.MIDDLEMAN,
          requireFreshRbac: true,
        });
        enforcePostGuard(req, session);

        const body = CompleteTradeBodySchema.parse(await readJsonBody(req));
        const completed = await services.trade.completeTrade({
          serverId,
          tradeId: m[1].toUpperCase(),
          actorId: session.yapinUserId,
          decisionNotes: body.decisionNotes,
          evidenceSummary: body.evidenceSummary,
          confirm: body.confirm,
          correlationId,
        });
        return sendJson(res, 200, { trade: completed });
      }

      if (method === 'POST' && (m = /^\/api\/trades\/([A-Za-z0-9-]+)\/cancel$/.exec(pathname))) {
        const session = await requireStaffSession(req, {
          minTier: STAFF_TIERS.MIDDLEMAN,
          requireFreshRbac: true,
        });
        enforcePostGuard(req, session);

        const body = CancelTradeBodySchema.parse(await readJsonBody(req));
        const cancelled = await services.trade.cancelTradeByStaff({
          serverId,
          tradeId: m[1].toUpperCase(),
          actorId: session.yapinUserId,
          reason: body.reason,
          confirm: body.confirm,
          correlationId,
        });
        return sendJson(res, 200, { trade: cancelled });
      }

      if (method === 'POST' && (m = /^\/api\/disputes\/([A-Za-z0-9-]+)\/resolve$/.exec(pathname))) {
        const session = await requireStaffSession(req, {
          minTier: STAFF_TIERS.MODERATOR,
          requireFreshRbac: true,
        });
        enforcePostGuard(req, session);

        const body = ResolveDisputeBodySchema.parse(await readJsonBody(req));
        const resolved = await services.dispute.resolveDispute({
          serverId,
          disputeIdOrTradeId: m[1].toUpperCase(),
          outcome: body.outcome,
          decisionSummary: body.decisionSummary,
          actorId: session.yapinUserId,
          confirm: body.confirm,
          correlationId,
        });
        return sendJson(res, 200, resolved);
      }

      // Ticket inspection & management routes
      if (method === 'GET' && (m = /^\/api\/tickets\/([A-Za-z0-9-]+)$/.exec(pathname))) {
        readLimiter.check(`ip:${clientIp}`);
        const session = await requireStaffSession(req);
        const ticket = await repositories.tickets.findByTicketId(m[1].toUpperCase());
        if (!ticket || ticket.serverId !== serverId) {
          throw new NotFoundError('Ticket not found.');
        }
        await services.ticket.assertTicketAccess(ticket, session.yapinUserId, { requireStaff: true });
        return sendJson(res, 200, { ticket });
      }

      if (method === 'POST' && (m = /^\/api\/tickets\/([A-Za-z0-9-]+)\/claim$/.exec(pathname))) {
        const session = await requireStaffSession(req, { requireFreshRbac: true });
        enforcePostGuard(req, session);
        const updated = await services.ticket.claimTicket({
          serverId,
          ticketId: m[1].toUpperCase(),
          actorId: session.yapinUserId,
          correlationId,
        });
        return sendJson(res, 200, { ticket: updated });
      }

      if (method === 'POST' && (m = /^\/api\/tickets\/([A-Za-z0-9-]+)\/note$/.exec(pathname))) {
        const session = await requireStaffSession(req, { requireFreshRbac: true });
        enforcePostGuard(req, session);
        const body = TicketNoteBodySchema.parse(await readJsonBody(req));
        const updated = await services.ticket.addNote({
          serverId,
          ticketId: m[1].toUpperCase(),
          actorId: session.yapinUserId,
          content: body.content,
          internalOnly: body.internalOnly,
          correlationId,
        });
        return sendJson(res, 200, { ticket: updated });
      }

      if (method === 'POST' && (m = /^\/api\/tickets\/([A-Za-z0-9-]+)\/close$/.exec(pathname))) {
        const session = await requireStaffSession(req, { requireFreshRbac: true });
        enforcePostGuard(req, session);
        const body = TicketCloseBodySchema.parse(await readJsonBody(req));
        const closed = await services.ticket.closeTicket({
          serverId,
          ticketId: m[1].toUpperCase(),
          actorId: session.yapinUserId,
          reason: body.reason,
          correlationId,
        });
        return sendJson(res, 200, { ticket: closed });
      }

      if (method === 'GET' && pathname === '/api/audits') {
        readLimiter.check(`ip:${clientIp}`);
        await requireStaffSession(req, { minTier: STAFF_TIERS.MIDDLEMAN });
        const q = AuditSearchQuerySchema.parse(Object.fromEntries(url.searchParams.entries()));
        const audits = await repositories.audits.query({
          serverId,
          ...q,
        });
        return sendJson(res, 200, audits);
      }

      if (method === 'GET' && pathname === '/api/config') {
        readLimiter.check(`ip:${clientIp}`);
        await requireStaffSession(req, { minTier: STAFF_TIERS.ADMIN, requireFreshRbac: true });
        const cfg = await repositories.serverConfigs.getOrCreate(serverId);
        return sendJson(res, 200, { config: cfg });
      }

      if (method === 'POST' && pathname === '/api/config') {
        const session = await requireStaffSession(req, {
          minTier: STAFF_TIERS.ADMIN,
          requireFreshRbac: true,
        });
        enforcePostGuard(req, session);

        const body = UpdateServerConfigBodySchema.parse(await readJsonBody(req));
        const patch = {};
        if (body.middlemanRoleIds) patch['staffRoles.middlemanRoleIds'] = body.middlemanRoleIds;
        if (body.moderatorRoleIds) patch['staffRoles.moderatorRoleIds'] = body.moderatorRoleIds;
        if (body.adminRoleIds) patch['staffRoles.adminRoleIds'] = body.adminRoleIds;
        if (body.supportRoleIds) patch['staffRoles.supportRoleIds'] = body.supportRoleIds;
        if (body.alertChannelId !== undefined) patch['channels.alertChannelId'] = body.alertChannelId;
        if (body.auditLogChannelId !== undefined) patch['channels.auditLogChannelId'] = body.auditLogChannelId;
        if (body.ticketCategoryId !== undefined) patch['channels.ticketCategoryId'] = body.ticketCategoryId;
        if (body.autoAssignMiddleman !== undefined) patch['tradeLimits.autoAssignMiddleman'] = body.autoAssignMiddleman;
        if (body.maxActiveTradesPerUser !== undefined) patch['tradeLimits.maxActiveTradesPerUser'] = body.maxActiveTradesPerUser;

        const updated = await repositories.serverConfigs.updateConfig(serverId, patch);
        await services.audit.record({
          serverId,
          actorId: session.yapinUserId,
          actorType: 'STAFF',
          action: 'SERVER_CONFIG_UPDATED',
          targetType: 'SERVER_CONFIG',
          targetId: serverId,
          correlationId,
          afterState: patch,
        });
        return sendJson(res, 200, { config: updated });
      }

      return sendJson(res, 404, { error: 'Dashboard route not found.' });
    } catch (err) {
      if (err?.name === 'ZodError') {
        return sendJson(res, 400, {
          error: 'Invalid request parameters',
          issues: err.issues?.map((i) => ({ path: i.path, message: i.message })),
          correlationId,
        });
      }
      const status =
        err instanceof AppError
          ? err.statusCode || 400
          : err?.name === 'AuthorizationError'
            ? 403
            : 500;
      const safeMessage =
        err instanceof AppError && err.expose !== false
          ? sanitizeErrorMessage(err.message)
          : 'Dashboard request could not be completed.';
      logger?.warn?.(
        { correlationId, status, errMessage: sanitizeErrorMessage(err?.message || String(err)) },
        'Dashboard HTTP error',
      );
      return sendJson(res, status, { error: safeMessage, correlationId });
    }
  });

  return {
    server,
    async listen(port = 3200, host = '0.0.0.0') {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
      const addr = server.address();
      return typeof addr === 'object' && addr ? addr.port : port;
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
