import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildBotAuthHeaders,
  validateBotToken,
  verifyYapinWebhookSignature,
  YapinOAuth2Client,
} from '../../src/api/authentication.js';
import { YapinClient } from '../../src/api/YapinClient.js';
import { loadEnv } from '../../src/config/env.js';
import { redactSensitiveText } from '../../src/utils/errors.js';
import { createMockYapinFetch } from '../helpers/mockYapinServer.js';

describe('Stage 1 — Yapin API Authentication, Rate Limits, Timeouts & Resilience', () => {
  it('validates yb_ bot token format and rejects malformed tokens', () => {
    expect(validateBotToken('yb_valid_token_12345')).toBe('yb_valid_token_12345');
    expect(() => validateBotToken('')).toThrow(/required/i);
    expect(() => validateBotToken('discord_token_abc')).toThrow(/yb_/i);
    expect(() => validateBotToken('yb_has spaces')).toThrow(/yb_/i);
  });

  it('builds documented Authorization: Bot <token> headers and redacts tokens in error text', () => {
    const headers = buildBotAuthHeaders('yb_super_secret_token_999', { hasJsonBody: true });
    expect(headers.authorization).toBe('Bot yb_super_secret_token_999');
    expect(headers['content-type']).toBe('application/json');

    const scrubbed = redactSensitiveText(
      'Failed calling /interactions/123/secret_tok/callback with Authorization: Bot yb_super_secret_token_999 and mongodb+srv://admin:pass123@cluster.mongodb.net/db',
    );
    expect(scrubbed).not.toContain('yb_super_secret_token_999');
    expect(scrubbed).not.toContain('secret_tok');
    expect(scrubbed).not.toContain('pass123');
    expect(scrubbed).toContain('[REDACTED]');
  });

  it('validates environment startup variables strictly', () => {
    expect(() =>
      loadEnv({
        YAPIN_BOT_TOKEN: 'invalid',
        MONGODB_URI: 'mongodb://127.0.0.1:27017/test',
        YAPIN_SERVER_ID: 'srv-1',
      }),
    ).toThrow(/yb_/i);

    expect(() =>
      loadEnv({
        YAPIN_BOT_TOKEN: 'yb_valid_123456',
        MONGODB_URI: 'mongodb://127.0.0.1:27017/test',
        YAPIN_SERVER_ID: 'srv-1',
        DASHBOARD_ENABLED: 'true',
      }),
    ).toThrow(/DASHBOARD_SESSION_SECRET/);

    const valid = loadEnv({
      YAPIN_BOT_TOKEN: 'yb_valid_123456',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/test',
      YAPIN_SERVER_ID: 'srv-1',
    });
    expect(valid.YAPIN_API_BASE_URL).toBe('https://www.yapin.gg/api/bot/v1');
  });

  it('authenticates via GET /me and rejects 401 unauthorized tokens immediately', async () => {
    const mock = createMockYapinFetch();
    const okClient = new YapinClient({
      token: mock.state.botToken,
      fetchImpl: mock.fetchImpl,
      enableGateway: false,
    });
    const { profile, latencyMs } = await okClient.getMe();
    expect(profile.username).toBe('MiddlemanBot');
    expect(latencyMs).toBeGreaterThanOrEqual(0);

    const badClient = new YapinClient({
      token: 'yb_wrong_token_999999',
      fetchImpl: mock.fetchImpl,
      enableGateway: false,
    });
    await expect(badClient.getMe()).rejects.toMatchObject({
      status: 401,
      isUnauthorized: true,
    });
  });

  it('waits and retries on 429 with Retry-After and 503 busy, but fails immediately on 429 without Retry-After', async () => {
    const mock = createMockYapinFetch();
    const client = new YapinClient({
      token: mock.state.botToken,
      fetchImpl: mock.fetchImpl,
      enableGateway: false,
    });

    const rateLimitEvents = [];
    client.on('rateLimited', (ev) => rateLimitEvents.push(ev));

    mock.state.rateLimitNextCount = 1;
    mock.state.rateLimitRetryAfter = '0.01';
    const meAfter429 = await client.getMe();
    expect(meAfter429.profile.username).toBe('MiddlemanBot');
    expect(rateLimitEvents).toHaveLength(1);

    mock.state.busyNextCount = 1;
    const meAfter503 = await client.getMe();
    expect(meAfter503.profile.username).toBe('MiddlemanBot');

    // Non-retryable 429 (no Retry-After header or field)
    mock.state.rateLimitNextCount = 1;
    mock.state.rateLimitRetryAfter = '';
    await expect(client.getMe()).rejects.toMatchObject({
      status: 429,
      isRateLimit: true,
    });
  });

  it('enforces request timeouts and NEVER blind-retries non-idempotent POST on network failure', async () => {
    let postAttempts = 0;
    let getAttempts = 0;

    const flakyFetch = async (url, init) => {
      if (init.method === 'POST') {
        postAttempts += 1;
        throw new Error('socket hang up');
      }
      getAttempts += 1;
      if (getAttempts < 2) {
        throw new Error('ECONNRESET');
      }
      return new Response(JSON.stringify({ id: 'bot-1', username: 'MiddlemanBot' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const client = new YapinClient({
      token: 'yb_test_token_123456',
      fetchImpl: flakyFetch,
      enableGateway: false,
      maxRetries: 2,
      timeoutMs: 100,
    });

    // POST must NOT retry on network error (prevents duplicate messages/channels)
    await expect(
      client.request('POST', '/channels/ch-1/messages', { body: { content: 'hello' } }),
    ).rejects.toThrow(/Network or timeout failure/);
    expect(postAttempts).toBe(1);

    // GET IS idempotent and recovers on transient network reset
    const out = await client.getMe();
    expect(out.profile.username).toBe('MiddlemanBot');
    expect(getAttempts).toBe(2);
  });

  it('verifies Yapin HMAC-SHA256 webhook signatures and OAuth2 flow', async () => {
    const secret = 'whsec_test_secret_1234567890';
    const body = JSON.stringify({ id: 501, event: 'test', data: { hello: 'world' } });
    const validSig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

    expect(verifyYapinWebhookSignature(body, validSig, secret)).toBe(true);
    expect(verifyYapinWebhookSignature(body, 'sha256=deadbeef', secret)).toBe(false);
    expect(verifyYapinWebhookSignature(`${body}x`, validSig, secret)).toBe(false);

    const mock = createMockYapinFetch();
    const oauth = new YapinOAuth2Client({
      clientId: 'client_123',
      clientSecret: 'secret_456',
      redirectUri: 'https://bot.example/auth/callback',
      fetchImpl: mock.fetchImpl,
    });
    const state = YapinOAuth2Client.generateState();
    const pkce = YapinOAuth2Client.generatePKCE();
    const authUrl = oauth.buildAuthorizeUrl({ state, codeChallenge: pkce.challenge });
    expect(authUrl).toContain('scope=identify');
    expect(authUrl).toContain('code_challenge_method=S256');

    const tokenData = await oauth.exchangeCode('valid_oauth_code');
    expect(tokenData.accessToken).toMatch(/^yo_/);
    const user = await oauth.fetchCurrentUser(tokenData.accessToken);
    expect(user.id).toBe(mock.ownerId);
  });
});
