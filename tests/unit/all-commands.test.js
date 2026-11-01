import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { YapinClient } from '../../src/api/YapinClient.js';
import { YapinMessagesApi } from '../../src/api/messages.js';
import { YapinChannelsApi } from '../../src/api/channels.js';
import { YapinPermissionsApi } from '../../src/api/permissions.js';
import { createCommandRegistry } from '../../src/commands/index.js';
import { createApplicationServices } from '../../src/middleman/createServices.js';
import { CommandHandler } from '../../src/handlers/commandHandler.js';
import { logger } from '../../src/utils/logger.js';
import { createMockYapinFetch } from '../helpers/mockYapinServer.js';
import { createInMemoryRepositories } from '../helpers/inMemoryRepositories.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000090';
const MOD_ID = '00000000-0000-4000-8000-000000000080';
const MM_1 = '00000000-0000-4000-8000-000000000011';
const MM_2 = '00000000-0000-4000-8000-000000000012';
const TRADER_A = '00000000-0000-4000-8000-000000000101';
const TRADER_B = '00000000-0000-4000-8000-000000000202';
const TRADER_C = '00000000-0000-4000-8000-000000000303';

describe('Full 33-Command Execution Coverage Suite', () => {
  let mock;
  let serverId;
  let client;
  let repos;
  let commandHandler;
  let msgSeq = 1;

  const runCmd = (authorId, command, args = '') =>
    commandHandler.handleMessage({
      id: `m_${msgSeq++}`,
      channel_id: 'ch_main',
      server_id: serverId,
      author_id: authorId,
      username: `u_${authorId.slice(-3)}`,
      author_bot: false,
      command,
      args,
    });

  beforeEach(async () => {
    mock = createMockYapinFetch();
    serverId = mock.defaultServerId;
    mock.setMember(serverId, ADMIN_ID, ['role-admin'], 'AdminUser');
    mock.setMember(serverId, MOD_ID, ['role-mod'], 'ModUser');
    mock.setMember(serverId, MM_1, ['role-mm'], 'MiddlemanOne');
    mock.setMember(serverId, MM_2, ['role-mm'], 'MiddlemanTwo');
    mock.setMember(serverId, TRADER_A, [], 'TraderA');
    mock.setMember(serverId, TRADER_B, [], 'TraderB');
    mock.setMember(serverId, TRADER_C, [], 'TraderC');
    mock.state.channels.set('ch_main', {
      id: 'ch_main',
      server_id: serverId,
      name: 'trades',
      kind: 'text',
    });

    client = new YapinClient({
      token: mock.state.botToken,
      fetchImpl: mock.fetchImpl,
      enableGateway: false,
    });
    await client.getMe();

    repos = createInMemoryRepositories();
    const messagesApi = new YapinMessagesApi(client);
    const channelsApi = new YapinChannelsApi(client);
    const permissionsApi = new YapinPermissionsApi(client, { cacheTtlMs: 0 });
    const { services } = createApplicationServices({
      repositories: repos,
      permissionsApi,
      channelsApi,
      messagesApi,
      logger,
    });

    commandHandler = new CommandHandler({
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
  });

  afterEach(async () => {
    await client.stop();
  });

  it('executes every single user, middleman, moderator, and admin command cleanly end-to-end', async () => {
    // 1. /config (set-role, set-channel, autoassign, view)
    await runCmd(ADMIN_ID, 'config', 'set-role tier=middleman roles=role-mm');
    await runCmd(ADMIN_ID, 'config', 'set-role tier=moderator roles=role-mod');
    await runCmd(ADMIN_ID, 'config', 'set-role tier=admin roles=role-admin');
    await runCmd(ADMIN_ID, 'config', 'set-channel key=alertChannelId value=ch_main');
    await runCmd(ADMIN_ID, 'config', 'autoassign enabled=no');
    await runCmd(ADMIN_ID, 'config', 'view');

    const cfg = await repos.serverConfigs.getOrCreate(serverId);
    expect(cfg.staffRoles.middlemanRoleIds).toEqual(['role-mm']);

    // 2. /ping, /help, /rules, /availability
    await runCmd(TRADER_A, 'ping');
    await runCmd(TRADER_A, 'help');
    await runCmd(TRADER_A, 'help', 'middleman');
    await runCmd(TRADER_A, 'rules');
    await runCmd(MM_1, 'availability', 'status=on note="Ready for middleman duty"');
    expect((await repos.users.getOrCreate(MM_1)).staffAvailability.available).toBe(true);

    // 3. /middleman -> /reject & /middleman -> /cancel
    await runCmd(
      TRADER_A,
      'middleman',
      `partner=${TRADER_B} item="Silver Ring" giving="Silver Ring" receiving="10 Gold" rules=yes`,
    );
    const rejectable = (await repos.trades.listTrades({ serverId })).items[0];
    await runCmd(TRADER_B, 'reject', `${rejectable.tradeId} reason="Changed my mind"`);
    expect((await repos.trades.findByTradeId(rejectable.tradeId)).state).toBe('REJECTED');

    await runCmd(
      TRADER_A,
      'middleman',
      `partner=${TRADER_B} item="Bronze Shield" giving="Bronze Shield" receiving="20 Gold" rules=yes`,
    );
    const cancellable = (await repos.trades.listTrades({ serverId, state: 'WAITING_FOR_PARTICIPANTS' })).items[0];
    await runCmd(TRADER_A, 'cancel', `${cancellable.tradeId} reason="Wrong item listed"`);
    expect((await repos.trades.findByTradeId(cancellable.tradeId)).state).toBe('CANCELLED');

    // 4. Full lifecycle via commands: /middleman -> /accept -> /claim -> /unassign -> /assign -> /reassign -> /confirm -> /deposit -> /verifydeposit -> /dispute -> /resolve -> /release -> /review -> /complete
    await runCmd(
      TRADER_A,
      'middleman',
      `partner=${TRADER_B} item="Emerald Blade" giving="Emerald Blade" receiving="300 Gems" rules=yes`,
    );
    const mainTrade = (await repos.trades.listTrades({ serverId, state: 'WAITING_FOR_PARTICIPANTS' })).items[0];

    await runCmd(TRADER_A, 'trade');
    await runCmd(TRADER_A, 'trade', mainTrade.tradeId);
    await runCmd(TRADER_A, 'status', mainTrade.tradeId);

    await runCmd(TRADER_B, 'accept', mainTrade.tradeId);
    expect((await repos.trades.findByTradeId(mainTrade.tradeId)).state).toBe('WAITING_FOR_MIDDLEMAN');

    await runCmd(MM_1, 'claim', mainTrade.tradeId);
    expect((await repos.trades.findByTradeId(mainTrade.tradeId)).state).toBe('MIDDLEMAN_ASSIGNED');

    await runCmd(MM_1, 'unassign', `${mainTrade.tradeId} reason="Stepping away briefly"`);
    expect((await repos.trades.findByTradeId(mainTrade.tradeId)).state).toBe('WAITING_FOR_MIDDLEMAN');

    await runCmd(ADMIN_ID, 'assign', `${mainTrade.tradeId} middleman=${MM_1} reason="Back online"`);
    expect((await repos.trades.findByTradeId(mainTrade.tradeId)).assignedMiddlemanId).toBe(MM_1);

    await runCmd(MOD_ID, 'reassign', `${mainTrade.tradeId} middleman=${MM_2} reason="Load balancing handoff"`);
    expect((await repos.trades.findByTradeId(mainTrade.tradeId)).assignedMiddlemanId).toBe(MM_2);

    await runCmd(TRADER_A, 'confirm', mainTrade.tradeId);
    await runCmd(TRADER_B, 'confirm', mainTrade.tradeId);
    expect((await repos.trades.findByTradeId(mainTrade.tradeId)).state).toBe('WAITING_FOR_DEPOSITS');

    await runCmd(TRADER_A, 'deposit', `${mainTrade.tradeId} ref="TX-EMERALD-1"`);
    await runCmd(TRADER_B, 'deposit', `${mainTrade.tradeId} ref="TX-GEMS-2"`);

    await runCmd(MM_2, 'verifydeposit', `${mainTrade.tradeId} trader=A status=CONFIRMED notes="Blade verified"`);
    await runCmd(MM_2, 'verifydeposit', `${mainTrade.tradeId} trader=B status=CONFIRMED notes="Gems verified"`);
    expect((await repos.trades.findByTradeId(mainTrade.tradeId)).state).toBe('WAITING_FOR_FINAL_CONFIRMATION');

    // Freeze via /dispute & unfreeze via /resolve
    await runCmd(TRADER_A, 'dispute', `${mainTrade.tradeId} reason="Double checking gem count before release"`);
    expect((await repos.trades.findByTradeId(mainTrade.tradeId)).state).toBe('DISPUTED');

    await runCmd(
      MOD_ID,
      'resolve',
      `${mainTrade.tradeId} outcome=RESUME_TRADE decision="Verified exact 300 Gems count with both parties" confirm=yes`,
    );
    expect((await repos.trades.findByTradeId(mainTrade.tradeId)).state).toBe('WAITING_FOR_FINAL_CONFIRMATION');

    await runCmd(TRADER_A, 'release', mainTrade.tradeId);
    await runCmd(TRADER_B, 'release', mainTrade.tradeId);
    await runCmd(MM_2, 'review', mainTrade.tradeId);
    await runCmd(MM_2, 'complete', `${mainTrade.tradeId} notes="All items verified and confirmed" confirm=yes`);
    expect((await repos.trades.findByTradeId(mainTrade.tradeId)).state).toBe('COMPLETED');

    // 5. /canceltrade (staff force-cancel)
    await runCmd(
      TRADER_A,
      'middleman',
      `partner=${TRADER_C} item="Force Cancel Test" giving="Item" receiving="Coins" rules=yes`,
    );
    const staffCancelTarget = (await repos.trades.listTrades({ serverId, state: 'WAITING_FOR_PARTICIPANTS' })).items[0];
    await runCmd(MOD_ID, 'canceltrade', `${staffCancelTarget.tradeId} reason="Policy violation cancelled by mod" confirm=yes`);
    expect((await repos.trades.findByTradeId(staffCancelTarget.tradeId)).state).toBe('CANCELLED');

    // 6. /ticket (open, view, claim, assign, note, close, reopen)
    await runCmd(
      TRADER_A,
      'ticket',
      'open type=GENERAL_SUPPORT subject="Question on rules" description="Need clarification on high-value trades"',
    );
    const ticket = (await repos.tickets.listTickets({ serverId })).items.find((t) => t.type === 'GENERAL_SUPPORT');
    expect(ticket).toBeTruthy();

    await runCmd(TRADER_A, 'ticket', `view ${ticket.ticketId}`);
    await runCmd(MM_1, 'ticket', `claim ${ticket.ticketId}`);
    await runCmd(ADMIN_ID, 'ticket', `assign ${ticket.ticketId} staff=${MM_2}`);
    await runCmd(MM_2, 'ticket', `note ${ticket.ticketId} note="Answered user question clearly"`);
    await runCmd(MM_2, 'ticket', `close ${ticket.ticketId} reason="Resolved inquiry"`);
    expect((await repos.tickets.findByTicketId(ticket.ticketId)).status).toBe('CLOSED');
    await runCmd(MM_2, 'ticket', `reopen ${ticket.ticketId} reason="Follow-up question from trader"`);
    expect((await repos.tickets.findByTicketId(ticket.ticketId)).status).toBe('REOPENED');

    // 7. Moderation & Reporting: /report, /warnuser, /suspenduser, /unsuspenduser, /profile, /stats, /staffstats, /tradehistory
    await runCmd(
      TRADER_A,
      'report',
      `user=${TRADER_C} category=IMPERSONATION reason="Attempted to mimic staff display name in chat"`,
    );
    expect((await repos.users.getOrCreate(TRADER_C)).riskFlags.openReportsCount).toBe(1);
    expect((await repos.users.getOrCreate(TRADER_C)).suspension.active).toBe(false); // Never auto-suspended!

    await runCmd(MOD_ID, 'warnuser', `user=${TRADER_C} reason="Do not mimic staff nicknames"`);
    expect((await repos.users.getOrCreate(TRADER_C)).warnings).toHaveLength(1);

    await runCmd(MOD_ID, 'suspenduser', `user=${TRADER_C} reason="Confirmed impersonation attempt" hours=24 confirm=yes`);
    expect((await repos.users.getOrCreate(TRADER_C)).suspension.active).toBe(true);

    await runCmd(MOD_ID, 'unsuspenduser', `user=${TRADER_C} reason="Appeal accepted after review"`);
    expect((await repos.users.getOrCreate(TRADER_C)).suspension.active).toBe(false);

    await runCmd(TRADER_A, 'profile');
    await runCmd(MM_2, 'profile', `user=${TRADER_C}`);
    await runCmd(TRADER_A, 'stats');
    await runCmd(MM_2, 'staffstats');
    await runCmd(MM_2, 'staffstats', `user=${MM_2}`);
    await runCmd(MM_2, 'tradehistory', 'state=COMPLETED page=1');
  });
});
