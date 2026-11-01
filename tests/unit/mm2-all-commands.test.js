import { describe, expect, it } from 'vitest';
import { YapinClient } from '../../src/api/YapinClient.js';
import { YapinChannelsApi } from '../../src/api/channels.js';
import { YapinMessagesApi } from '../../src/api/messages.js';
import { YapinPermissionsApi } from '../../src/api/permissions.js';
import { createCommandRegistry } from '../../src/commands/index.js';
import { CommandHandler } from '../../src/handlers/commandHandler.js';
import { createApplicationServices } from '../../src/systems/createServices.js';
import { InteractionHandler } from '../../src/handlers/interactionHandler.js';
import { logger } from '../../src/utils/logger.js';
import { createInMemoryRepositories } from '../helpers/inMemoryRepositories.js';
import { createMockYapinFetch } from '../helpers/mockYapinServer.js';

describe('MM2 Helper — End-to-End Slash Command Execution Across All 36 Commands', () => {
  it('executes community, leveling, roleplay, ticket, mod application, moderation, and admin commands end-to-end', async () => {
    const mock = createMockYapinFetch();
    const serverId = mock.defaultServerId;
    const adminId = '88888888-8888-4888-8888-888888888888';
    const modId = '55555555-5555-4555-8555-555555555555';
    const userA = '22222222-2222-4222-8222-222222222222';
    const userB = '33333333-3333-4333-8333-333333333333';
    const userC = '44444444-4444-4444-8444-444444444444';

    mock.setMember(serverId, adminId, ['role-admin'], 'AdminNikilis');
    mock.setMember(serverId, modId, ['role-mod'], 'SheriffMod');
    mock.setMember(serverId, userA, ['role-unverified'], 'SuspectA');
    mock.setMember(serverId, userB, ['role-verified'], 'CitizenB');
    mock.setMember(serverId, userC, ['role-verified'], 'CitizenC');

    // Create a text channel in mock server for /slowmode, /lock, /unlock, /purge
    mock.state.channels.set('ch-rp', {
      id: 'ch-rp',
      server_id: serverId,
      name: 'mansion-rp',
      kind: 'text',
      private: false,
      role_ids: [],
      read_only: false,
      slowmode: 0,
    });

    const client = new YapinClient({
      token: mock.state.botToken,
      fetchImpl: mock.fetchImpl,
      enableGateway: false,
    });
    await client.getMe();

    const repos = createInMemoryRepositories();
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

    const handler = new CommandHandler({
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

    let msgSeq = 1;
    const runCmd = async (authorId, command, args = '', channelId = 'ch-rp') => {
      const id = `cmd-msg-${msgSeq++}`;
      await handler.handleMessage({
        id,
        server_id: serverId,
        channel_id: channelId,
        author_id: authorId,
        username: `u_${authorId.slice(0, 4)}`,
        author_bot: false,
        command,
        args,
      });
      const list = mock.state.messages.get(channelId) || [];
      return list[list.length - 1];
    };

    // 1. Admin configures roles, channels, instant verify, selfrole, levelrole, panels
    await runCmd(adminId, 'config', 'role admin role-admin');
    await runCmd(adminId, 'config', 'role mod role-mod');
    await runCmd(adminId, 'config', 'role trialmod role-trialmod');
    await runCmd(adminId, 'config', 'role verified role-verified');
    await runCmd(adminId, 'config', 'role muted role-muted');
    await runCmd(adminId, 'config', 'verify INSTANT');
    await runCmd(adminId, 'config', 'selfrole rp-pings role-rp-pings');
    await runCmd(adminId, 'config', 'levelrole 5 role-lv5');
    const cfgView = await runCmd(adminId, 'config', 'view');
    expect(cfgView.embeds[0].title).toContain('Server Configuration');

    let checkpointPanel;
    for (const panelType of ['verify', 'tickets', 'applications', 'roles']) {
      const panelMsg = await runCmd(adminId, 'panel', panelType);
      expect(panelMsg.embeds).toHaveLength(1);
      if (panelType === 'verify') checkpointPanel = panelMsg;
    }
    const checkpointButtonIds = checkpointPanel.components.flatMap((row) => row.components).map((button) => button.custom_id);
    expect(checkpointButtonIds).toContain('mm2:verify:start');
    expect(checkpointButtonIds).toContain('mm2:verify:rules');

    // 2. UserA runs /verify, /rules, /help, /serverinfo, /daily, /rank, /profile, /leaderboard
    const verifyMsg = await runCmd(userA, 'verify');
    expect(verifyMsg.embeds[0].title).toContain('Sheriff Checkpoint');
    expect((await repos.users.findByYapinId(userA)).verification.verified).toBe(false);

    const interactionHandler = new InteractionHandler({
      client,
      messagesApi,
      permissionsApi,
      repositories: repos,
      services,
      cooldowns: null,
      logger,
    });
    await interactionHandler.handleInteraction({
      id: 'verify-button-1',
      token: 'verify-token-1',
      type: 'button',
      custom_id: 'mm2:verify:start',
      message_id: 'checkpoint-panel',
      channel_id: 'ch-rp',
      server_id: serverId,
      user_id: userA,
      username: 'SuspectA',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    expect((await repos.users.findByYapinId(userA)).verification.verified).toBe(true);
    expect(mock.state.members.get(`${serverId}:${userA}`).roles).toContain('role-verified');

    const rulebook = await runCmd(userA, 'rules');
    expect(rulebook.embeds[0].title).toContain('MurderMystery2');
    expect(rulebook.embeds[0].description).toContain('Reports are leads, not verdicts');
    expect(rulebook.embeds[0].description).toContain('metagaming');
    expect((await runCmd(userA, 'help')).embeds[0].title).toContain('MM2 Helper');
    expect((await runCmd(userA, 'serverinfo')).embeds[0].title).toContain('MurderMystery2');
    expect((await runCmd(userA, 'daily')).embeds[0].title).toContain('Crate');
    expect((await runCmd(userA, 'rank')).embeds[0].title).toContain('MurderMystery2');
    expect((await runCmd(userA, 'profile')).embeds[0].title).toContain('Dossier');
    expect((await runCmd(userA, 'leaderboard')).embeds[0].title).toContain('Leaderboard');

    // 3. Roleplay commands: /character, /rp, /roles, /mystery
    await runCmd(
      userA,
      'character',
      'create Detective Blake | DETECTIVE | Revolver | Investigates Mansion mysteries',
    );
    expect((await runCmd(userA, 'character', 'list')).embeds[0].description).toContain(
      'Detective Blake',
    );
    expect((await runCmd(userA, 'rp', 'say Freeze right there!')).embeds[0].description).toContain(
      'Freeze right there!',
    );
    expect((await runCmd(userA, 'rp', 'scene Mansion Dark thunder rolls')).embeds[0].title).toContain(
      'The Mansion',
    );
    expect((await runCmd(userA, 'rp', 'clue Bloody knife near the vault')).embeds[0].title).toContain(
      'Forensic Clue',
    );
    expect((await runCmd(userA, 'rp', 'roll 1d20')).embeds[0].title).toContain('1d20');
    expect((await runCmd(userA, 'rp', 'maps')).embeds[0].description).toContain('Nikilis Factory');
    expect((await runCmd(userA, 'roles', 'toggle rp-pings')).content).toContain('Equipped');

    const startRoundMsg = await runCmd(userA, 'mystery', 'start Hotel');
    const roundIdMatch = /RND-[A-Z0-9]+/.exec(startRoundMsg.content);
    const roundId = roundIdMatch[0];
    await runCmd(userB, 'mystery', `join ${roundId}`);
    await runCmd(userC, 'mystery', `join ${roundId}`);
    const drawnMsg = await runCmd(userA, 'mystery', `draw ${roundId}`);
    expect(drawnMsg.content).toContain('Secret Roles Assigned');
    const endedMsg = await runCmd(userA, 'mystery', `end ${roundId}`);
    expect(endedMsg.content).toContain('Concluded');

    // 4. Applications & Tickets & Reports
    await runCmd(adminId, 'xp', `setlevel <@${userA}> 5`);
    const applyMsg = await runCmd(
      userA,
      'apply',
      '19 | UTC | 4h | RP Mod | Help MurderMystery2 | Investigate calmly',
    );
    const appId = applyMsg.embeds[0].fields[0].value.replace(/`/g, '');
    expect((await runCmd(adminId, 'applications', 'PENDING')).embeds[0].description).toContain(
      appId,
    );
    const reviewMsg = await runCmd(adminId, 'appreview', `${appId} accept Welcome aboard!`);
    expect(reviewMsg.content).toContain('ACCEPTED');

    const tkOpen = await runCmd(userB, 'ticket', 'open RP_CHARACTER LoreCheck Backstory review');
    const ticketId = /TKT-[A-Z0-9]+/.exec(tkOpen.content)[0];
    await runCmd(modId, 'ticket', `claim ${ticketId}`);
    await runCmd(modId, 'ticket', `note ${ticketId} Looks great!`);
    const tkClosed = await runCmd(modId, 'ticket', `close ${ticketId} Approved`);
    expect(tkClosed.content).toContain('archived');

    const repMsg = await runCmd(
      userB,
      'report',
      `<@${userC}> RDM_FAILRP Attacked in spawn with zero motive`,
    );
    expect(repMsg.embeds[0].title).toContain('Report Filed');

    // 5. Staff Moderation commands: /warn, /warnings, /case, /modlogs, /clearwarn, /mute, /unmute, /kick, /ban, /unban, /slowmode, /lock, /unlock, /purge, /verifyuser
    const warnMsg = await runCmd(modId, 'warn', `<@${userC}> RDM in Hotel elevator`);
    const caseId = /CASE-[A-Z0-9]+/.exec(warnMsg.content)[0];
    expect((await runCmd(modId, 'warnings', `<@${userC}>`)).embeds[0].description).toContain(caseId);
    expect((await runCmd(modId, 'case', caseId)).embeds[0].title).toContain(caseId);
    expect((await runCmd(modId, 'modlogs', `<@${userC}>`)).embeds[0].description).toContain(caseId);
    expect((await runCmd(modId, 'clearwarn', `${caseId} Pardoned`)).content).toContain('pardoned');

    await runCmd(modId, 'mute', `<@${userC}> 15m Cooling off`);
    await runCmd(modId, 'unmute', `<@${userC}> Cooled off`);
    await runCmd(modId, 'kick', `<@${userC}> confirm=yes Severe FailRP`);
    await runCmd(modId, 'ban', `<@${userC}> confirm=yes Confirmed exploit`);
    await runCmd(modId, 'unban', `<@${userC}> Appeal accepted`);
    await runCmd(modId, 'verifyuser', `verify <@${userC}> Re-verified`);

    expect((await runCmd(modId, 'slowmode', '10')).content).toContain('10s');
    expect((await runCmd(modId, 'lock', 'Investigation')).content).toContain('Lockdown Active');
    expect((await runCmd(modId, 'unlock', 'All clear')).content).toContain('Lockdown Lifted');
    expect((await runCmd(modId, 'purge', '5')).content).toContain('Purged');

    await client.stop();
  });
});
