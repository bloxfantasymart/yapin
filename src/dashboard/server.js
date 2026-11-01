import { createServer } from 'node:http';
import { STAFF_TIERS } from '../api/permissions.js';
import { BOT_BRAND } from '../config/settings.js';
import { OPEN_TICKET_STATUSES } from '../database/repositories/index.js';
import {
  AppError,
  AuthorizationError,
  ValidationError,
  sanitizeErrorMessage,
} from '../utils/errors.js';
import { generateCorrelationId } from '../utils/ids.js';
import {
  ApplicationReviewBodySchema,
  AuditSearchQuerySchema,
  ClearWarningBodySchema,
  ModerationWarnBodySchema,
  TicketCloseBodySchema,
  TicketNoteBodySchema,
  UpdateServerConfigBodySchema,
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
 * Creates the optional "Login with Yapin'" OAuth2 **MurderMystery2 Sheriff HQ** HTTP Console.
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

  async function requireStaffSession(
    req,
    { minTier = STAFF_TIERS.SUPPORT, requireFreshRbac = false } = {},
  ) {
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
        throw new AuthorizationError('Your MurderMystery2 staff permissions were revoked or are insufficient.');
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
        return sendJson(res, 200, {
          status: 'ok',
          bot: BOT_BRAND.botName,
          server: BOT_BRAND.serverName,
        });
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
            renderLoginPage({
              errorMsg: 'Invalid or expired OAuth2 state. Please try signing in again.',
            }),
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
            metadata: { reason: 'Authenticated Yapin user lacks MurderMystery2 staff roles' },
          });
          return sendHtml(
            res,
            403,
            renderLoginPage({
              errorMsg:
                'Access denied: your Yapin account does not hold an authorized MurderMystery2 staff role.',
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

      // 4. Main Sheriff HQ Console UI
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
        const [verifiedCitizens, appsOut, ticketsOut, casesOut, reportsOut, leaderboardOut] =
          await Promise.all([
            repositories.users.countVerified(),
            repositories.applications.listByServer(serverId, { limit: 25 }),
            repositories.tickets.listTickets({
              serverId,
              status: OPEN_TICKET_STATUSES,
              limit: 40,
            }),
            repositories.cases.listRecentByServer(serverId, { limit: 25 }),
            repositories.reports.listReports({ serverId, status: 'PENDING_REVIEW', limit: 25 }),
            repositories.users.getLeaderboard({ page: 1, limit: 10 }),
          ]);

        const visibleTickets = ticketsOut.items.filter(
          (t) => t.type !== 'STAFF_REPORT' || session.staffTier >= STAFF_TIERS.ADMIN,
        );

        return sendJson(res, 200, {
          verifiedCitizens,
          applications: appsOut.items,
          openTickets: visibleTickets,
          recentCases: casesOut.items,
          pendingReports: reportsOut.items,
          leaderboard: leaderboardOut.items,
        });
      }

      let m;

      // Moderator Application Review
      if (
        method === 'POST' &&
        (m = /^\/api\/applications\/([A-Za-z0-9-]+)\/review$/.exec(pathname))
      ) {
        const session = await requireStaffSession(req, {
          minTier: STAFF_TIERS.ADMIN,
          requireFreshRbac: true,
        });
        enforcePostGuard(req, session);

        const body = ApplicationReviewBodySchema.parse(await readJsonBody(req));
        const updated = await services.application.reviewApplication({
          serverId,
          applicationId: m[1].toUpperCase(),
          actorId: session.yapinUserId,
          decision: body.decision,
          notes: body.notes,
          correlationId,
        });
        return sendJson(res, 200, { application: updated });
      }

      // Moderation Case Routes
      if (method === 'POST' && pathname === '/api/moderation/warn') {
        const session = await requireStaffSession(req, {
          minTier: STAFF_TIERS.TRIAL_MOD,
          requireFreshRbac: true,
        });
        enforcePostGuard(req, session);

        const body = ModerationWarnBodySchema.parse(await readJsonBody(req));
        const out = await services.moderation.warnUser({
          serverId,
          actorId: session.yapinUserId,
          targetUserId: body.targetUserId,
          reason: body.reason,
          correlationId,
        });
        return sendJson(res, 200, { case: out.modCase });
      }

      if (
        method === 'POST' &&
        (m = /^\/api\/cases\/([A-Za-z0-9-]+)\/clear$/.exec(pathname))
      ) {
        const session = await requireStaffSession(req, {
          minTier: STAFF_TIERS.MODERATOR,
          requireFreshRbac: true,
        });
        enforcePostGuard(req, session);

        const body = ClearWarningBodySchema.parse(await readJsonBody(req));
        const cleared = await services.moderation.clearWarning({
          serverId,
          actorId: session.yapinUserId,
          caseId: m[1].toUpperCase(),
          reason: body.reason,
          correlationId,
        });
        return sendJson(res, 200, { case: cleared });
      }

      // Ticket inspection & management routes
      if (method === 'GET' && (m = /^\/api\/tickets\/([A-Za-z0-9-]+)$/.exec(pathname))) {
        readLimiter.check(`ip:${clientIp}`);
        const session = await requireStaffSession(req);
        const ticket = await services.ticket.getTicketForViewer({
          serverId,
          ticketId: m[1].toUpperCase(),
          viewerId: session.yapinUserId,
        });
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

      // Append-only Audit Search
      if (method === 'GET' && pathname === '/api/audits') {
        readLimiter.check(`ip:${clientIp}`);
        await requireStaffSession(req, { minTier: STAFF_TIERS.TRIAL_MOD });
        const q = AuditSearchQuerySchema.parse(Object.fromEntries(url.searchParams.entries()));
        const audits = await repositories.audits.query({
          serverId,
          ...q,
        });
        return sendJson(res, 200, audits);
      }

      // Server Configuration (Admin Only)
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
        if (body.adminRoleIds) patch['staffRoles.adminRoleIds'] = body.adminRoleIds;
        if (body.moderatorRoleIds) patch['staffRoles.moderatorRoleIds'] = body.moderatorRoleIds;
        if (body.trialModRoleIds) patch['staffRoles.trialModRoleIds'] = body.trialModRoleIds;
        if (body.supportRoleIds) patch['staffRoles.supportRoleIds'] = body.supportRoleIds;
        if (body.verifiedRoleId !== undefined) patch['roles.verifiedRoleId'] = body.verifiedRoleId;
        if (body.mutedRoleId !== undefined) patch['roles.mutedRoleId'] = body.mutedRoleId;
        if (body.modLogChannelId !== undefined) patch['channels.modLogChannelId'] = body.modLogChannelId;
        if (body.modAppLogChannelId !== undefined) patch['channels.modAppLogChannelId'] = body.modAppLogChannelId;
        if (body.ticketLogChannelId !== undefined) patch['channels.ticketLogChannelId'] = body.ticketLogChannelId;
        if (body.welcomeChannelId !== undefined) patch['channels.welcomeChannelId'] = body.welcomeChannelId;
        if (body.verificationMode) patch['verification.mode'] = body.verificationMode;
        if (body.applicationsOpen !== undefined) patch['applications.open'] = body.applicationsOpen;
        if (body.autoModEnabled !== undefined) patch['autoMod.enabled'] = body.autoModEnabled;

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
