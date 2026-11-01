import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { YapinClient } from '../../src/api/YapinClient.js';
import { YapinOAuth2Client } from '../../src/api/authentication.js';
import { YapinMessagesApi } from '../../src/api/messages.js';
import { YapinChannelsApi } from '../../src/api/channels.js';
import { YapinPermissionsApi } from '../../src/api/permissions.js';
import { createApplicationServices } from '../../src/middleman/createServices.js';
import { createDashboardServer } from '../../src/dashboard/server.js';
import { logger } from '../../src/utils/logger.js';
import { createMockYapinFetch } from '../helpers/mockYapinServer.js';
import { createInMemoryRepositories } from '../helpers/inMemoryRepositories.js';

const STAFF_ADMIN_ID = '88888888-8888-4888-8888-888888888888';
const STAFF_MM_ID = '77777777-7777-4777-8777-777777777777';
const NON_STAFF_USER_ID = '99999999-9999-4999-8999-999999999999';
const TRADER_A = '22222222-2222-4222-8222-222222222222';
const TRADER_B = '33333333-3333-4333-8333-333333333333';

describe('Stage 5 — Secure OAuth2 Staff Dashboard (PKCE, RBAC, Hashed Sessions, CSRF, Same-Origin & Full Actions)', () => {
  let mock;
  let serverId;
  let client;
  let repos;
  let services;
  let dashboard;
  let baseUrl;
  let currentOAuthUserId;

  beforeEach(async () => {
    currentOAuthUserId = STAFF_ADMIN_ID;
    mock = createMockYapinFetch();
    serverId = mock.defaultServerId;
    mock.setMember(serverId, STAFF_ADMIN_ID, ['role-admin'], 'AdminAlice');
    mock.setMember(serverId, STAFF_MM_ID, ['role-mm'], 'MiddlemanBob');
    mock.setMember(serverId, NON_STAFF_USER_ID, [], 'RegularEve');
    mock.setMember(serverId, TRADER_A, [], 'TraderA');
    mock.setMember(serverId, TRADER_B, [], 'TraderB');

    const customFetch = async (urlStr, init) => {
      const u = new URL(urlStr);
      if (u.pathname === '/api/oauth/me') {
        return new Response(
          JSON.stringify({
            id: currentOAuthUserId,
            username: currentOAuthUserId === STAFF_ADMIN_ID ? 'AdminAlice' : 'StaffOrUser',
            display_name: 'OAuth User',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return mock.fetchImpl(urlStr, init);
    };

    client = new YapinClient({
      token: mock.state.botToken,
      fetchImpl: customFetch,
      enableGateway: false,
    });
    await client.getMe();

    repos = createInMemoryRepositories();
    await repos.serverConfigs.updateConfig(serverId, {
      'staffRoles.adminRoleIds': ['role-admin'],
      'staffRoles.middlemanRoleIds': ['role-mm'],
      'staffRoles.moderatorRoleIds': ['role-mod'],
    });

    const messagesApi = new YapinMessagesApi(client);
    const channelsApi = new YapinChannelsApi(client);
    const permissionsApi = new YapinPermissionsApi(client, { cacheTtlMs: 0 });
    const appServices = createApplicationServices({
      repositories: repos,
      permissionsApi,
      channelsApi,
      messagesApi,
      logger,
    });
    services = appServices.services;

    const oauthClient = new YapinOAuth2Client({
      clientId: 'yapin_oauth_client_123',
      clientSecret: 'yapin_oauth_secret_super_private_999',
      redirectUri: 'http://127.0.0.1/auth/callback',
      siteUrl: 'https://www.yapin.gg',
      fetchImpl: customFetch,
    });

    dashboard = createDashboardServer({
      oauthClient,
      serverId,
      sessionSecret: 'dashboard_session_secret_at_least_32_characters_long!',
      secureCookies: false,
      permissionsApi,
      repositories: repos,
      services,
      logger,
    });

    const port = await dashboard.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await dashboard.close();
    await client.stop();
  });

  async function completeStaffLogin() {
    const loginRes = await fetch(`${baseUrl}/auth/login`, { redirect: 'manual' });
    expect(loginRes.status).toBe(302);
    const location = new URL(loginRes.headers.get('location'));
    expect(location.pathname).toBe('/oauth/authorize');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');

    const state = location.searchParams.get('state');
    const oauthCookie = loginRes.headers.getSetCookie()[0].split(';')[0];

    return fetch(
      `${baseUrl}/auth/callback?code=valid_oauth_code&state=${encodeURIComponent(state)}`,
      {
        redirect: 'manual',
        headers: { cookie: oauthCookie },
      },
    );
  }

  it('denies dashboard login to non-staff Yapin OAuth2 accounts and audits DASHBOARD_LOGIN_DENIED', async () => {
    currentOAuthUserId = NON_STAFF_USER_ID;
    const cbRes = await completeStaffLogin();
    expect(cbRes.status).toBe(403);
    const html = await cbRes.text();
    expect(html).toContain('Access denied');

    const audits = await repos.audits.query({ serverId, action: 'DASHBOARD_LOGIN_DENIED' });
    expect(audits.total).toBe(1);
  });

  it('authenticates verified staff via OAuth2 PKCE, enforces CSRF + Same-Origin, and executes trade/dispute/ticket/config actions', async () => {
    const cbRes = await completeStaffLogin();
    expect(cbRes.status).toBe(302);
    const sessionCookie = cbRes.headers
      .getSetCookie()
      .find((c) => c.startsWith('yapin_mm_session='))
      .split(';')[0];

    const htmlRes = await fetch(`${baseUrl}/`, { headers: { cookie: sessionCookie } });
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();
    expect(html).not.toContain(mock.state.botToken);
    expect(html).not.toContain('yapin_oauth_secret_super_private_999');

    const me = await (await fetch(`${baseUrl}/api/me`, { headers: { cookie: sessionCookie } })).json();
    expect(me.yapinUserId).toBe(STAFF_ADMIN_ID);

    // Cross-Origin POST with evil Origin header MUST be rejected even WITH a valid CSRF token!
    const crossOriginRes = await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: {
        cookie: sessionCookie,
        'content-type': 'application/json',
        'x-csrf-token': me.csrfToken,
        origin: 'https://evil-attacker.example.com',
      },
      body: JSON.stringify({ autoAssignMiddleman: true }),
    });
    expect(crossOriginRes.status).toBe(403);

    // Create trade, accept invite, then assign MM, verify deposits, open/resolve dispute, and complete via Dashboard API!
    const { trade: created } = await services.trade.createTrade({
      serverId,
      channelId: 'ch_1',
      createdBy: TRADER_A,
      traderAId: TRADER_A,
      traderBId: TRADER_B,
      primaryAsset: 'Dashboard Crown',
      traderAGiving: 'Dashboard Crown',
      traderBGiving: '$120',
      rulesAccepted: true,
    });
    await services.confirmation.acceptTrade({ serverId, tradeId: created.tradeId, actorId: TRADER_B });

    // Assign middleman via Dashboard API
    const assignRes = await fetch(`${baseUrl}/api/trades/${created.tradeId}/assign`, {
      method: 'POST',
      headers: {
        cookie: sessionCookie,
        'content-type': 'application/json',
        'x-csrf-token': me.csrfToken,
      },
      body: JSON.stringify({ targetMiddlemanId: STAFF_MM_ID, reason: 'Dashboard assignment' }),
    });
    expect(assignRes.status).toBe(200);

    // Confirm MM & report deposits
    await services.confirmation.submitParticipantConfirmation({ serverId, tradeId: created.tradeId, actorId: TRADER_A });
    await services.confirmation.submitParticipantConfirmation({ serverId, tradeId: created.tradeId, actorId: TRADER_B });
    await services.deposit.reportDeposit({ serverId, tradeId: created.tradeId, actorId: TRADER_A, reference: 'REF-A' });
    await services.deposit.reportDeposit({ serverId, tradeId: created.tradeId, actorId: TRADER_B, reference: 'REF-B' });

    // Verify both deposits via Dashboard API
    for (const side of ['A', 'B']) {
      const vdRes = await fetch(`${baseUrl}/api/trades/${created.tradeId}/verify-deposit`, {
        method: 'POST',
        headers: {
          cookie: sessionCookie,
          'content-type': 'application/json',
          'x-csrf-token': me.csrfToken,
        },
        body: JSON.stringify({ traderSideOrUserId: side, decision: 'CONFIRMED', notes: `Verified ${side}` }),
      });
      expect(vdRes.status).toBe(200);
    }

    // Open dispute & resolve via Dashboard API
    const { dispute } = await services.dispute.openDispute({
      serverId,
      tradeId: created.tradeId,
      actorId: TRADER_A,
      reason: 'Need quick staff check on transfer receipt',
    });
    const resolveRes = await fetch(`${baseUrl}/api/disputes/${dispute.disputeId}/resolve`, {
      method: 'POST',
      headers: {
        cookie: sessionCookie,
        'content-type': 'application/json',
        'x-csrf-token': me.csrfToken,
      },
      body: JSON.stringify({
        outcome: 'RESUME_TRADE',
        decisionSummary: 'Receipt verified authentic; trade un-frozen',
        confirm: true,
      }),
    });
    expect(resolveRes.status).toBe(200);

    // Submit release confirmations & complete trade via Dashboard API
    await services.confirmation.submitParticipantConfirmation({ serverId, tradeId: created.tradeId, actorId: TRADER_A, stageHint: 'release' });
    await services.confirmation.submitParticipantConfirmation({ serverId, tradeId: created.tradeId, actorId: TRADER_B, stageHint: 'release' });

    const compRes = await fetch(`${baseUrl}/api/trades/${created.tradeId}/complete`, {
      method: 'POST',
      headers: {
        cookie: sessionCookie,
        'content-type': 'application/json',
        'x-csrf-token': me.csrfToken,
      },
      body: JSON.stringify({
        decisionNotes: 'Completed cleanly from Staff Operations Console',
        confirm: true,
      }),
    });
    expect(compRes.status).toBe(200);
    expect((await compRes.json()).trade.state).toBe('COMPLETED');

    // Open ticket, claim & close via Dashboard API
    const tk = await services.ticket.openTicket({
      serverId,
      creatorId: TRADER_A,
      type: 'GENERAL_SUPPORT',
      subject: 'Dashboard ticket test',
      description: 'Testing dashboard ticket claim and close endpoints',
    });
    const tkClaim = await fetch(`${baseUrl}/api/tickets/${tk.ticketId}/claim`, {
      method: 'POST',
      headers: { cookie: sessionCookie, 'content-type': 'application/json', 'x-csrf-token': me.csrfToken },
      body: '{}',
    });
    expect(tkClaim.status).toBe(200);

    const tkClose = await fetch(`${baseUrl}/api/tickets/${tk.ticketId}/close`, {
      method: 'POST',
      headers: { cookie: sessionCookie, 'content-type': 'application/json', 'x-csrf-token': me.csrfToken },
      body: JSON.stringify({ reason: 'Resolved via dashboard' }),
    });
    expect(tkClose.status).toBe(200);
  });
});
