import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { redactSensitiveText, RateLimitExceededError } from '../../src/utils/errors.js';
import { parseYapinUserId } from '../../src/utils/ids.js';
import { parseCommandArgs } from '../../src/utils/argParser.js';
import { sanitizeUserText, validateSafeEvidenceUrl } from '../../src/security/sanitizer.js';
import { CooldownManager } from '../../src/security/rateLimiter.js';
import { IdempotencyGuard } from '../../src/security/idempotency.js';
import { YapinClient } from '../../src/api/YapinClient.js';
import { YapinMessagesApi } from '../../src/api/messages.js';
import { YapinChannelsApi } from '../../src/api/channels.js';
import { YapinPermissionsApi } from '../../src/api/permissions.js';
import { createApplicationServices } from '../../src/middleman/createServices.js';
import { createCommandRegistry } from '../../src/commands/index.js';
import { CommandHandler } from '../../src/handlers/commandHandler.js';
import { logger } from '../../src/utils/logger.js';
import { createMockYapinFetch } from '../helpers/mockYapinServer.js';
import { createInMemoryRepositories } from '../helpers/inMemoryRepositories.js';

describe('Stage 6 — Security Hardening, Event Parsing, Sanitization, Cooldowns & Expiration Sweeps', () => {
  it('validates startup environment variables strictly and rejects missing or malformed secrets', () => {
    expect(() => loadEnv({})).toThrow(/YAPIN_BOT_TOKEN/);
    expect(() =>
      loadEnv({
        YAPIN_BOT_TOKEN: 'invalid_not_yb_prefix',
        MONGODB_URI: 'mongodb://127.0.0.1:27017/mm',
        YAPIN_SERVER_ID: 'srv_1',
      }),
    ).toThrow(/yb_/);
    expect(() =>
      loadEnv({
        YAPIN_BOT_TOKEN: 'yb_valid_token_123456',
        MONGODB_URI: 'mongodb://127.0.0.1:27017/mm',
        YAPIN_SERVER_ID: 'srv_1',
        DASHBOARD_ENABLED: 'true',
        DASHBOARD_SESSION_SECRET: 'too_short',
      }),
    ).toThrow(/DASHBOARD_SESSION_SECRET/);
  });

  it('rejects mutable @username guesses, prototype pollution keys, unsafe URLs, and BiDi/mention spoofing', () => {
    // Plain @username must NEVER be accepted as a stable Yapin UUID
    expect(parseYapinUserId('@TrustedStaffAdmin')).toBeNull();
    expect(parseYapinUserId('<@22222222-2222-4222-8222-222222222222>')).toBe(
      '22222222-2222-4222-8222-222222222222',
    );

    // Prototype pollution guard in command arg parser
    const parsed = parseCommandArgs('__proto__=polluted constructor=bad item="Safe Item"');
    expect(Object.prototype.hasOwnProperty.call(parsed.flags, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(parsed.flags, 'constructor')).toBe(false);
    expect(parsed.flags.item).toBe('Safe Item');

    // Unsafe URL schemes & localhost SSRF URLs blocked
    expect(() => validateSafeEvidenceUrl('javascript:alert(1)')).toThrow();
    expect(() => validateSafeEvidenceUrl('http://insecure.example.com/proof.png')).toThrow();
    expect(() => validateSafeEvidenceUrl('https://127.0.0.1/internal')).toThrow();
    expect(validateSafeEvidenceUrl('https://files.yapper.website/uploads/proof.png')).toBe(
      'https://files.yapper.website/uploads/proof.png',
    );

    // BiDi override & mass-mention neutralization
    const cleaned = sanitizeUserText('Hello \u202E @everyone @here', { maxLength: 200 });
    expect(cleaned).not.toContain('\u202E');
    expect(cleaned).not.toMatch(/(?<!\\)@everyone/);
  });

  it('redacts Yapin bot tokens, OAuth tokens, MongoDB URIs, and callback tokens from logs/errors', () => {
    const raw =
      'Failed calling Authorization: Bot yb_secret_abc123456 with Bearer yo_oauth_xyz987 and mongodb+srv://admin:superpass@cluster.mongodb.net/yapin on /interactions/int1/tok_secret_999/callback';
    const redacted = redactSensitiveText(raw);
    expect(redacted).not.toContain('yb_secret_abc123456');
    expect(redacted).not.toContain('yo_oauth_xyz987');
    expect(redacted).not.toContain('superpass');
    expect(redacted).not.toContain('tok_secret_999');
  });

  it('enforces per-user command cooldowns, burst anti-spam, and idempotency replay protection', async () => {
    const cooldowns = new CooldownManager({ burstLimit: 4, burstWindowMs: 10_000 });
    cooldowns.enforce({ userId: 'u1', actionKey: 'cmd:ping', cooldownMs: 3000, now: 1000 });

    // Immediate repeat within 3s cooldown throws RateLimitExceededError
    expect(() =>
      cooldowns.enforce({ userId: 'u1', actionKey: 'cmd:ping', cooldownMs: 3000, now: 1500 }),
    ).toThrow(RateLimitExceededError);

    // Burst spam across distinct actions triggers anti-spam limit
    cooldowns.enforce({ userId: 'u1', actionKey: 'a2', cooldownMs: 0, now: 2000 });
    cooldowns.enforce({ userId: 'u1', actionKey: 'a3', cooldownMs: 0, now: 2100 });
    cooldowns.enforce({ userId: 'u1', actionKey: 'a4', cooldownMs: 0, now: 2200 });
    expect(() =>
      cooldowns.enforce({ userId: 'u1', actionKey: 'a5', cooldownMs: 0, now: 2300 }),
    ).toThrow(/Anti-spam protection triggered/i);

    // Idempotency guard executes side effect once and replays cached result on duplicate key
    const repos = createInMemoryRepositories();
    const guard = new IdempotencyGuard({ operationalRepo: repos.operational });
    let executions = 0;
    const first = await guard.runOnce(
      { key: 'idem:1', scope: 'test', actorId: 'u1' },
      async () => {
        executions++;
        return { tradeId: 'TRD-123' };
      },
    );
    const second = await guard.runOnce(
      { key: 'idem:1', scope: 'test', actorId: 'u1' },
      async () => {
        executions++;
        return { tradeId: 'TRD-999' };
      },
    );
    expect(executions).toBe(1);
    expect(first.result).toEqual({ tradeId: 'TRD-123' });
    expect(second.deduplicated).toBe(true);
    expect(second.result).toEqual({ tradeId: 'TRD-123' });
  });

  it('ignores bot authors and commands targeted at another bot via command_for, and expires only pre-deposit stale trades', async () => {
    const mock = createMockYapinFetch();
    const serverId = mock.defaultServerId;
    const traderA = '22222222-2222-4222-8222-222222222222';
    const traderB = '33333333-3333-4333-8333-333333333333';
    mock.setMember(serverId, traderA, [], 'TraderA');
    mock.setMember(serverId, traderB, [], 'TraderB');

    const client = new YapinClient({
      token: mock.state.botToken,
      fetchImpl: mock.fetchImpl,
      enableGateway: false,
    });
    await client.getMe();

    const repos = createInMemoryRepositories();
    const messagesApi = new YapinMessagesApi(client);
    const channelsApi = new YapinChannelsApi(client);
    const permissionsApi = new YapinPermissionsApi(client);
    const { services } = createApplicationServices({
      repositories: repos,
      permissionsApi,
      channelsApi,
      messagesApi,
      logger,
    });

    const commandHandler = new CommandHandler({
      client,
      commandRegistry: createCommandRegistry(),
      messagesApi,
      channelsApi,
      permissionsApi,
      repositories: repos,
      services,
      cooldowns: null,
      logger,
    });

    // Ignored: author_bot = true
    expect(
      await commandHandler.handleMessage({
        id: 'm1',
        server_id: serverId,
        channel_id: 'ch_1',
        author_id: traderA,
        author_bot: true,
        command: 'ping',
      }),
    ).toBe(false);

    // Ignored: command_for targets a different bot UUID
    expect(
      await commandHandler.handleMessage({
        id: 'm2',
        server_id: serverId,
        channel_id: 'ch_1',
        author_id: traderA,
        author_bot: false,
        command: 'ping',
        command_for: ['00000000-0000-4000-8000-ffffffffffff'],
      }),
    ).toBe(false);

    // Create a trade, backdate expiresAt into the past, and run expireStaleTrades
    const { trade } = await services.trade.createTrade({
      serverId,
      channelId: 'ch_1',
      createdBy: traderA,
      traderAId: traderA,
      traderBId: traderB,
      primaryAsset: 'Expiring Item',
      traderAGiving: 'Expiring Item',
      traderBGiving: '50 Coins',
      rulesAccepted: true,
    });

    await repos.trades.atomicUpdate(trade.tradeId, {
      expectedVersion: trade.version,
      set: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const expiredIds = await services.trade.expireStaleTrades({ limit: 50 });
    expect(expiredIds).toEqual([trade.tradeId]);
    const expiredDoc = await repos.trades.findByTradeId(trade.tradeId);
    expect(expiredDoc.state).toBe('EXPIRED');

    await client.stop();
  });
});
