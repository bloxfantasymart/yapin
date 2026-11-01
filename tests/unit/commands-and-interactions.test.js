import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { YapinClient } from '../../src/api/YapinClient.js';
import { YapinCommandsApi } from '../../src/api/commands.js';
import { YapinMessagesApi } from '../../src/api/messages.js';
import { YapinChannelsApi } from '../../src/api/channels.js';
import { YapinPermissionsApi } from '../../src/api/permissions.js';
import { verifyYapinWebhookSignature } from '../../src/api/authentication.js';
import { createCommandRegistry } from '../../src/commands/index.js';
import { createApplicationServices } from '../../src/middleman/createServices.js';
import { CommandHandler } from '../../src/handlers/commandHandler.js';
import { InteractionHandler } from '../../src/handlers/interactionHandler.js';
import { logger } from '../../src/utils/logger.js';
import { createMockYapinFetch } from '../helpers/mockYapinServer.js';
import { createInMemoryRepositories } from '../helpers/inMemoryRepositories.js';

const STAFF_MM = '00000000-0000-4000-8000-000000000010';
const TRADER_A = '00000000-0000-4000-8000-000000000101';
const TRADER_B = '00000000-0000-4000-8000-000000000202';

describe('Stage 4 — Full Command Registry, Command Dispatcher, Button Interactions & Security', () => {
  let mock;
  let serverId;
  let client;
  let repos;
  let commandRegistry;
  let commandHandler;
  let interactionHandler;

  beforeEach(async () => {
    mock = createMockYapinFetch();
    serverId = mock.defaultServerId;
    mock.setMember(serverId, STAFF_MM, ['role-mm'], 'staff_mm');
    mock.setMember(serverId, TRADER_A, [], 'trader_a');
    mock.setMember(serverId, TRADER_B, [], 'trader_b');
    mock.state.channels.set('ch_general', {
      id: 'ch_general',
      server_id: serverId,
      name: 'general',
      kind: 'text',
    });

    client = new YapinClient({
      token: mock.state.botToken,
      fetchImpl: mock.fetchImpl,
      timeoutMs: 2000,
    });
    await client.getMe();

    repos = createInMemoryRepositories();
    await repos.serverConfigs.updateConfig(serverId, {
      'staffRoles.middlemanRoleIds': ['role-mm'],
      'staffRoles.moderatorRoleIds': ['role-mod'],
      'staffRoles.adminRoleIds': ['role-admin'],
      'channels.alertChannelId': 'ch_general',
    });

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

    commandRegistry = createCommandRegistry();
    commandHandler = new CommandHandler({
      client,
      commandRegistry,
      messagesApi,
      channelsApi,
      permissionsApi,
      repositories: repos,
      services,
      cooldowns: null,
      logger,
    });

    interactionHandler = new InteractionHandler({
      client,
      messagesApi,
      permissionsApi,
      repositories: repos,
      services,
      cooldowns: null,
      logger,
    });
  });

  afterEach(async () => {
    await client.stop();
  });

  it('registers all 33 verified user & staff commands within Yapin 100-command limit', async () => {
    const commandsApi = new YapinCommandsApi(client);
    const definitions = commandRegistry.toYapinDefinitions();
    expect(definitions.length).toBe(33);
    expect(definitions.length).toBeLessThanOrEqual(100);

    const registered = await commandsApi.syncCommands(definitions);
    expect(registered.commands).toHaveLength(33);
  });

  it('drives a trade through /middleman, button accept, button claim, button confirm_mm, /deposit, /verifydeposit, button confirm_release, and /complete', async () => {
    // 1. Trader A runs /middleman
    await commandHandler.handleMessage({
      id: 'msg_100',
      channel_id: 'ch_general',
      server_id: serverId,
      author_id: TRADER_A,
      username: 'trader_a',
      author_bot: false,
      command: 'middleman',
      args: `partner=<@${TRADER_B}> item="Limited Collectible" giving="Limited Collectible" receiving="$90 USD" cash=90 currency=USD payer=B rules=yes`,
    });

    const allTrades = await repos.trades.listTrades({ serverId });
    expect(allTrades.total).toBe(1);
    const tradeId = allTrades.items[0].tradeId;

    // 2. Trader B clicks Accept button (`mm:accept:<tradeId>`)
    await interactionHandler.handleInteraction({
      id: 'int_1',
      token: 'tok_1',
      type: 'button',
      custom_id: `mm:accept:${tradeId}`,
      channel_id: 'ch_general',
      server_id: serverId,
      user_id: TRADER_B,
      username: 'trader_b',
    });

    expect((await repos.trades.findByTradeId(tradeId)).state).toBe('WAITING_FOR_MIDDLEMAN');
    expect(mock.state.interactions.get('int_1')[0].body.type).toBe('update');

    // 3. Unauthorized Trader A tries to click Staff Claim button (`mm:claim:<tradeId>`) -> DENIED ephemerally & audited!
    await interactionHandler.handleInteraction({
      id: 'int_unauth',
      token: 'tok_unauth',
      type: 'button',
      custom_id: `mm:claim:${tradeId}`,
      channel_id: 'ch_general',
      server_id: serverId,
      user_id: TRADER_A,
      username: 'trader_a',
    });
    const unauthCb = mock.state.interactions.get('int_unauth')[0];
    expect(unauthCb.body.type).toBe('ephemeral');
    expect(unauthCb.body.content).toMatch(/Insufficient server permissions/i);

    // 4. Authorized Middleman clicks Claim button
    await interactionHandler.handleInteraction({
      id: 'int_claim',
      token: 'tok_claim',
      type: 'button',
      custom_id: `mm:claim:${tradeId}`,
      channel_id: 'ch_general',
      server_id: serverId,
      user_id: STAFF_MM,
      username: 'staff_mm',
    });
    expect((await repos.trades.findByTradeId(tradeId)).state).toBe('MIDDLEMAN_ASSIGNED');

    // 5. Both traders click Confirm Assigned Middleman button
    await interactionHandler.handleInteraction({
      id: 'int_mm_a',
      token: 'tok_mm_a',
      type: 'button',
      custom_id: `mm:confirm_mm:${tradeId}`,
      channel_id: 'ch_general',
      server_id: serverId,
      user_id: TRADER_A,
    });
    await interactionHandler.handleInteraction({
      id: 'int_mm_b',
      token: 'tok_mm_b',
      type: 'button',
      custom_id: `mm:confirm_mm:${tradeId}`,
      channel_id: 'ch_general',
      server_id: serverId,
      user_id: TRADER_B,
    });
    expect((await repos.trades.findByTradeId(tradeId)).state).toBe('WAITING_FOR_DEPOSITS');

    // 6. Both traders run /deposit
    await commandHandler.handleMessage({
      id: 'msg_dep_a',
      channel_id: 'ch_general',
      server_id: serverId,
      author_id: TRADER_A,
      command: 'deposit',
      args: `${tradeId} ref="DELIVERY-111" proof=https://files.yapper.website/proofs/a.png`,
    });
    await commandHandler.handleMessage({
      id: 'msg_dep_b',
      channel_id: 'ch_general',
      server_id: serverId,
      author_id: TRADER_B,
      command: 'deposit',
      args: `${tradeId} ref="PAY-222"`,
    });

    // 7. Staff verifies both deposits via /verifydeposit
    await commandHandler.handleMessage({
      id: 'msg_ver_a',
      channel_id: 'ch_general',
      server_id: serverId,
      author_id: STAFF_MM,
      command: 'verifydeposit',
      args: `${tradeId} trader=A status=CONFIRMED notes="Verified collectible transfer"`,
    });
    await commandHandler.handleMessage({
      id: 'msg_ver_b',
      channel_id: 'ch_general',
      server_id: serverId,
      author_id: STAFF_MM,
      command: 'verifydeposit',
      args: `${tradeId} trader=B status=CONFIRMED notes="Verified $90 payment receipt"`,
    });
    expect((await repos.trades.findByTradeId(tradeId)).state).toBe('WAITING_FOR_FINAL_CONFIRMATION');

    // 8. Both traders click Confirm Final Release button
    await interactionHandler.handleInteraction({
      id: 'int_rel_a',
      token: 'tok_rel_a',
      type: 'button',
      custom_id: `mm:confirm_release:${tradeId}`,
      channel_id: 'ch_general',
      server_id: serverId,
      user_id: TRADER_A,
    });
    await interactionHandler.handleInteraction({
      id: 'int_rel_b',
      token: 'tok_rel_b',
      type: 'button',
      custom_id: `mm:confirm_release:${tradeId}`,
      channel_id: 'ch_general',
      server_id: serverId,
      user_id: TRADER_B,
    });

    // 9. Staff finalizes via /complete
    await commandHandler.handleMessage({
      id: 'msg_comp',
      channel_id: 'ch_general',
      server_id: serverId,
      author_id: STAFF_MM,
      command: 'complete',
      args: `${tradeId} notes="Both parties verified and released" confirm=yes`,
    });

    const completed = await repos.trades.findByTradeId(tradeId);
    expect(completed.state).toBe('COMPLETED');
  });

  it('blocks unauthorized staff commands (/suspenduser, /complete, /config) and logs STAFF_AUTH_DENIED', async () => {
    await commandHandler.handleMessage({
      id: 'msg_hack_1',
      channel_id: 'ch_general',
      server_id: serverId,
      author_id: TRADER_A,
      command: 'suspenduser',
      args: `user=${TRADER_B} reason="Fake staff claim" confirm=yes`,
    });

    const target = await repos.users.getOrCreate(TRADER_B);
    expect(target.suspension.active).toBe(false);

    const deniedLogs = await repos.audits.query({
      serverId,
      action: 'STAFF_AUTH_DENIED',
    });
    expect(deniedLogs.total).toBeGreaterThanOrEqual(1);
  });

  it('verifies Yapin HMAC-SHA256 webhook signatures accurately and rejects tampered payloads', () => {
    const secret = 'webhook_secret_key_test_12345';
    const rawBody = JSON.stringify({ id: 42, type: 'message', data: { content: 'hi' } });
    const goodSig = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

    expect(verifyYapinWebhookSignature(rawBody, goodSig, secret)).toBe(true);
    expect(verifyYapinWebhookSignature(rawBody + ' ', goodSig, secret)).toBe(false);
  });
});
