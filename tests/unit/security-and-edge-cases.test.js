import { describe, expect, it } from 'vitest';
import { YapinClient } from '../../src/api/YapinClient.js';
import { YapinChannelsApi } from '../../src/api/channels.js';
import { YapinMessagesApi } from '../../src/api/messages.js';
import { YapinPermissionsApi } from '../../src/api/permissions.js';
import { createCommandRegistry } from '../../src/commands/index.js';
import { loadEnv } from '../../src/config/env.js';
import { CommandHandler } from '../../src/handlers/commandHandler.js';
import { IdempotencyGuard } from '../../src/security/idempotency.js';
import { CooldownManager } from '../../src/security/rateLimiter.js';
import { sanitizeUserText, validateSafeEvidenceUrl } from '../../src/security/sanitizer.js';
import { createApplicationServices } from '../../src/systems/createServices.js';
import { parseCommandArgs } from '../../src/utils/argParser.js';
import { RateLimitExceededError, redactSensitiveText } from '../../src/utils/errors.js';
import { parseYapinUserId } from '../../src/utils/ids.js';
import { logger } from '../../src/utils/logger.js';
import { createInMemoryRepositories } from '../helpers/inMemoryRepositories.js';
import { createMockYapinFetch } from '../helpers/mockYapinServer.js';

describe('Stage 6 — MM2 Helper Security Hardening, Sanitization, Cooldowns & Bot Targeting', () => {
  it('validates startup environment variables strictly and rejects missing or malformed secrets', () => {
    expect(() => loadEnv({})).toThrow(/YAPIN_BOT_TOKEN/);
    expect(() =>
      loadEnv({
        YAPIN_BOT_TOKEN: 'invalid_not_yb_prefix',
        YAPIN_SERVER_ID: 'srv_mm2',
      }),
    ).toThrow(/yb_/);
    expect(() =>
      loadEnv({
        YAPIN_BOT_TOKEN: 'yb_valid_token_123456',
        YAPIN_SERVER_ID: 'srv_mm2',
        DASHBOARD_ENABLED: 'true',
        DASHBOARD_SESSION_SECRET: 'too_short',
      }),
    ).toThrow(/DASHBOARD_SESSION_SECRET/);
  });

  it('rejects mutable @username guesses, prototype pollution keys, unsafe URLs, and BiDi/mention spoofing', () => {
    expect(parseYapinUserId('@FakeSheriffAdmin')).toBeNull();
    expect(parseYapinUserId('<@22222222-2222-4222-8222-222222222222>')).toBe(
      '22222222-2222-4222-8222-222222222222',
    );

    const parsed = parseCommandArgs('__proto__=polluted constructor=bad weapon="Luger"');
    expect(Object.prototype.hasOwnProperty.call(parsed.flags, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(parsed.flags, 'constructor')).toBe(false);
    expect(parsed.flags.weapon).toBe('Luger');

    expect(() => validateSafeEvidenceUrl('javascript:alert(1)')).toThrow();
    expect(() => validateSafeEvidenceUrl('http://insecure.example.com/proof.png')).toThrow();
    expect(() => validateSafeEvidenceUrl('https://127.0.0.1/internal')).toThrow();
    expect(validateSafeEvidenceUrl('https://files.yapper.website/uploads/clip.mp4')).toBe(
      'https://files.yapper.website/uploads/clip.mp4',
    );

    const cleaned = sanitizeUserText('Hello \u202E @everyone @here', { maxLength: 200 });
    expect(cleaned).not.toContain('\u202E');
    expect(cleaned).not.toMatch(/(?<!\\)@everyone/);
  });

  it('redacts Yapin bot tokens, OAuth tokens, and callback tokens from logs/errors', () => {
    const raw =
      'Failed calling Authorization: Bot yb_secret_abc123456 with Bearer yo_oauth_xyz987 on /interactions/int1/tok_secret_999/callback';
    const redacted = redactSensitiveText(raw);
    expect(redacted).not.toContain('yb_secret_abc123456');
    expect(redacted).not.toContain('yo_oauth_xyz987');
    expect(redacted).not.toContain('tok_secret_999');
  });

  it('enforces per-user command cooldowns, burst anti-spam, and idempotency replay protection', async () => {
    const cooldowns = new CooldownManager({ burstLimit: 4, burstWindowMs: 10_000 });
    cooldowns.enforce({ userId: 'u1', actionKey: 'cmd:verify', cooldownMs: 3000, now: 1000 });

    expect(() =>
      cooldowns.enforce({ userId: 'u1', actionKey: 'cmd:verify', cooldownMs: 3000, now: 1500 }),
    ).toThrow(RateLimitExceededError);

    cooldowns.enforce({ userId: 'u1', actionKey: 'a2', cooldownMs: 0, now: 2000 });
    cooldowns.enforce({ userId: 'u1', actionKey: 'a3', cooldownMs: 0, now: 2100 });
    cooldowns.enforce({ userId: 'u1', actionKey: 'a4', cooldownMs: 0, now: 2200 });
    expect(() =>
      cooldowns.enforce({ userId: 'u1', actionKey: 'a5', cooldownMs: 0, now: 2300 }),
    ).toThrow(/Anti-spam protection triggered/i);

    const repos = createInMemoryRepositories();
    const guard = new IdempotencyGuard({ operationalRepo: repos.operational });
    let executions = 0;
    const first = await guard.runOnce(
      { key: 'idem:1', scope: 'test', actorId: 'u1' },
      async () => {
        executions++;
        return { caseId: 'CASE-123' };
      },
    );
    const second = await guard.runOnce(
      { key: 'idem:1', scope: 'test', actorId: 'u1' },
      async () => {
        executions++;
        return { caseId: 'CASE-999' };
      },
    );
    expect(executions).toBe(1);
    expect(first.result).toEqual({ caseId: 'CASE-123' });
    expect(second.deduplicated).toBe(true);
  });

  it('ignores bot authors and commands targeted at another bot via command_for, and denies non-staff from /warn', async () => {
    const mock = createMockYapinFetch();
    const serverId = mock.defaultServerId;
    const citizenId = '22222222-2222-4222-8222-222222222222';
    mock.setMember(serverId, citizenId, ['role-verified'], 'CitizenEve');

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

    expect(
      await commandHandler.handleMessage({
        id: 'm1',
        server_id: serverId,
        channel_id: 'ch_1',
        author_id: citizenId,
        author_bot: true,
        command: 'ping',
      }),
    ).toBe(false);

    expect(
      await commandHandler.handleMessage({
        id: 'm2',
        server_id: serverId,
        channel_id: 'ch_1',
        author_id: citizenId,
        author_bot: false,
        command: 'ping',
        command_for: ['00000000-0000-4000-8000-ffffffffffff'],
      }),
    ).toBe(false);

    // Non-staff user attempting `/warn` is blocked by server-side RBAC and audited as STAFF_AUTH_DENIED!
    await commandHandler.handleMessage({
      id: 'm3',
      server_id: serverId,
      channel_id: 'ch_1',
      author_id: citizenId,
      author_bot: false,
      command: 'warn',
      args: '<@33333333-3333-4333-8333-333333333333> Fake staff warn',
    });

    const deniedAudits = await repos.audits.query({ serverId, action: 'STAFF_AUTH_DENIED' });
    expect(deniedAudits.total).toBe(1);

    await client.stop();
  });
});
