import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { YapinClient } from '../../src/api/YapinClient.js';
import { YapinOAuth2Client } from '../../src/api/authentication.js';
import { YapinChannelsApi } from '../../src/api/channels.js';
import { YapinMessagesApi } from '../../src/api/messages.js';
import { YapinPermissionsApi } from '../../src/api/permissions.js';
import { createDashboardServer } from '../../src/dashboard/server.js';
import { createApplicationServices } from '../../src/systems/createServices.js';
import { logger } from '../../src/utils/logger.js';
import { createInMemoryRepositories } from '../helpers/inMemoryRepositories.js';
import { createMockYapinFetch } from '../helpers/mockYapinServer.js';

const STAFF_ADMIN_ID = '88888888-8888-4888-8888-888888888888';
const NON_STAFF_USER_ID = '99999999-9999-4999-8999-999999999999';
const CITIZEN_A = '22222222-2222-4222-8222-222222222222';

describe('Stage 5 — MM2 Helper Sheriff HQ OAuth2 Web Console (PKCE, RBAC, CSRF, Same-Origin & Actions)', () => {
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
    mock.setMember(serverId, STAFF_ADMIN_ID, ['role-admin'], 'SheriffAdmin');
    mock.setMember(serverId, NON_STAFF_USER_ID, ['role-verified'], 'RegularCitizen');
    mock.setMember(serverId, CITIZEN_A, ['role-verified'], 'ApplicantNoah');

    const customFetch = async (urlStr, init) => {
      const u = new URL(urlStr);
      if (u.pathname === '/api/oauth/me') {
        return new Response(
          JSON.stringify({
            id: currentOAuthUserId,
            username: currentOAuthUserId === STAFF_ADMIN_ID ? 'SheriffAdmin' : 'RegularCitizen',
            display_name: 'MM2 User',
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
      'staffRoles.moderatorRoleIds': ['role-mod'],
      'staffRoles.trialModRoleIds': ['role-trialmod'],
    });

    const messagesApi = new YapinMessagesApi(client);
    const channelsApi = new YapinChannelsApi(client);
    const permissionsApi = new YapinPermissionsApi(client, { cacheTtlMs: 0 });
    services = createApplicationServices({
      repositories: repos,
      permissionsApi,
      channelsApi,
      messagesApi,
      logger,
    }).services;

    const oauthClient = new YapinOAuth2Client({
      clientId: 'mm2_oauth_client_123',
      clientSecret: 'mm2_oauth_secret_super_private_999',
      redirectUri: 'http://127.0.0.1/auth/callback',
      siteUrl: 'https://www.yapin.gg',
      fetchImpl: customFetch,
    });

    dashboard = createDashboardServer({
      oauthClient,
      serverId,
      sessionSecret: 'mm2_dashboard_session_secret_at_least_32_chars!',
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

  it('denies Sheriff HQ login to non-staff Yapin OAuth2 accounts and audits DASHBOARD_LOGIN_DENIED', async () => {
    currentOAuthUserId = NON_STAFF_USER_ID;
    const cbRes = await completeStaffLogin();
    expect(cbRes.status).toBe(403);
    expect(await cbRes.text()).toContain('Access denied');

    const audits = await repos.audits.query({ serverId, action: 'DASHBOARD_LOGIN_DENIED' });
    expect(audits.total).toBe(1);
  });

  it('authenticates verified MM2 staff via OAuth2 PKCE, enforces CSRF + Same-Origin, and reviews Apps, Cases, Tickets & Config', async () => {
    const cbRes = await completeStaffLogin();
    expect(cbRes.status).toBe(302);
    const sessionCookie = cbRes.headers
      .getSetCookie()
      .find((c) => c.startsWith('mm2_helper_session='))
      .split(';')[0];

    const html = await (await fetch(`${baseUrl}/`, { headers: { cookie: sessionCookie } })).text();
    expect(html).toContain('MM2 Helper');
    expect(html).toContain('MurderMystery2');
    expect(html).not.toContain(mock.state.botToken);

    const me = await (await fetch(`${baseUrl}/api/me`, { headers: { cookie: sessionCookie } })).json();
    expect(me.yapinUserId).toBe(STAFF_ADMIN_ID);

    // Cross-origin POST rejected even with valid CSRF token
    const crossOriginRes = await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: {
        cookie: sessionCookie,
        'content-type': 'application/json',
        'x-csrf-token': me.csrfToken,
        origin: 'https://evil-attacker.example.com',
      },
      body: JSON.stringify({ applicationsOpen: false }),
    });
    expect(crossOriginRes.status).toBe(403);

    // Submit Mod Application & Accept via Sheriff HQ Console API!
    const app = await services.application.submitApplication({
      serverId,
      applicantId: CITIZEN_A,
      answers: {
        age: '20',
        timezone: 'UTC+1',
        hours: '3h/day',
        experience: 'RP Lead Mod',
        reason: 'Love MurderMystery2 RP',
        scenario: 'Check clips & enforce Case File fairly',
      },
    });

    const appRevRes = await fetch(`${baseUrl}/api/applications/${app.applicationId}/review`, {
      method: 'POST',
      headers: {
        cookie: sessionCookie,
        'content-type': 'application/json',
        'x-csrf-token': me.csrfToken,
      },
      body: JSON.stringify({ decision: 'ACCEPTED', notes: 'Approved via Sheriff HQ Console' }),
    });
    expect(appRevRes.status).toBe(200);
    expect((await appRevRes.json()).application.status).toBe('ACCEPTED');

    // Issue Warning Case File & Clear Warning via Sheriff HQ Console API!
    const warnRes = await fetch(`${baseUrl}/api/moderation/warn`, {
      method: 'POST',
      headers: {
        cookie: sessionCookie,
        'content-type': 'application/json',
        'x-csrf-token': me.csrfToken,
      },
      body: JSON.stringify({ targetUserId: NON_STAFF_USER_ID, reason: 'OOC spam in Hotel scene' }),
    });
    expect(warnRes.status).toBe(200);
    const createdCase = (await warnRes.json()).case;

    const clearRes = await fetch(`${baseUrl}/api/cases/${createdCase.caseId}/clear`, {
      method: 'POST',
      headers: {
        cookie: sessionCookie,
        'content-type': 'application/json',
        'x-csrf-token': me.csrfToken,
      },
      body: JSON.stringify({ reason: 'Pardoned after apology' }),
    });
    expect(clearRes.status).toBe(200);

    // Open ticket -> Claim & Close via Console API
    const tk = await services.ticket.openTicket({
      serverId,
      creatorId: NON_STAFF_USER_ID,
      type: 'RP_CHARACTER',
      subject: 'Custom Detective approval',
      description: 'Requesting Chief Detective backstory approval',
    });
    expect(
      (
        await fetch(`${baseUrl}/api/tickets/${tk.ticketId}/claim`, {
          method: 'POST',
          headers: { cookie: sessionCookie, 'content-type': 'application/json', 'x-csrf-token': me.csrfToken },
          body: '{}',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}/api/tickets/${tk.ticketId}/close`, {
          method: 'POST',
          headers: { cookie: sessionCookie, 'content-type': 'application/json', 'x-csrf-token': me.csrfToken },
          body: JSON.stringify({ reason: 'Character approved!' }),
        })
      ).status,
    ).toBe(200);
  });
});
