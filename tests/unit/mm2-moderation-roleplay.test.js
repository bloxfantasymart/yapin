import { describe, expect, it } from 'vitest';
import { YapinClient } from '../../src/api/YapinClient.js';
import { YapinChannelsApi } from '../../src/api/channels.js';
import { YapinMessagesApi } from '../../src/api/messages.js';
import { YapinPermissionsApi } from '../../src/api/permissions.js';
import { InteractionHandler } from '../../src/handlers/interactionHandler.js';
import { createApplicationServices } from '../../src/systems/createServices.js';
import { logger } from '../../src/utils/logger.js';
import { createInMemoryRepositories } from '../helpers/inMemoryRepositories.js';
import { createMockYapinFetch } from '../helpers/mockYapinServer.js';

describe('MM2 Helper — Sheriff Moderation, Auto-Mod & MurderMystery2 Character and Mystery Suite', () => {
  it('enforces Sheriff Case Files, auto-escalates warnings to timed Mute, sweeps expired mutes, filters Auto-Mod links, and never auto-bans on /report', async () => {
    const mock = createMockYapinFetch();
    const serverId = mock.defaultServerId;
    const suspectId = '22222222-2222-4222-8222-222222222222';
    const reporterId = '33333333-3333-4333-8333-333333333333';
    const modId = '55555555-5555-4555-8555-555555555555';
    const adminId = '88888888-8888-4888-8888-888888888888';
    mock.setMember(serverId, suspectId, ['role-verified'], 'SuspectRex');
    mock.setMember(serverId, reporterId, ['role-verified'], 'WitnessNora');
    mock.setMember(serverId, modId, ['role-mod'], 'ModCole');
    mock.setMember(serverId, adminId, ['role-admin'], 'AdminVera');

    const client = new YapinClient({
      token: mock.state.botToken,
      fetchImpl: mock.fetchImpl,
      enableGateway: false,
    });
    const repos = createInMemoryRepositories();
    await repos.serverConfigs.updateConfig(serverId, {
      'staffRoles.adminRoleIds': ['role-admin'],
      'staffRoles.moderatorRoleIds': ['role-mod'],
      'roles.mutedRoleId': 'role-muted',
      'autoMod.autoWarnThreshold': 2,
    });

    const permissionsApi = new YapinPermissionsApi(client, { cacheTtlMs: 0 });
    const messagesApi = new YapinMessagesApi(client);
    const channelsApi = new YapinChannelsApi(client);
    const { services } = createApplicationServices({
      repositories: repos,
      permissionsApi,
      channelsApi,
      messagesApi,
      logger,
    });

    // Moderator CANNOT moderate a higher-tier Admin!
    await expect(
      services.moderation.warnUser({
        serverId,
        actorId: modId,
        targetUserId: adminId,
        reason: 'Attempted upward moderation',
      }),
    ).rejects.toThrow(/equal or higher staff rank/i);

    // 1. Player submits /report -> queued for review WITHOUT auto-banning or auto-muting suspect!
    const report = await services.moderation.submitReport({
      serverId,
      reporterId,
      targetUserId: suspectId,
      category: 'RDM_FAILRP',
      description: 'Eliminated players in Hotel lobby with zero RP motive',
      evidenceUrl: 'https://files.yapper.website/clips/rdm1.mp4',
    });
    expect(report.status).toBe('PENDING_REVIEW');
    expect((await repos.users.findByYapinId(suspectId)).moderation.activeBan.active).toBe(false);

    // 2. Auto-Mod catches scam link from regular user (deletes + issues Warn #1), but exempts Staff!
    const staffMsg = await services.autoMod.inspectMessage({
      id: 'msg-staff-1',
      server_id: serverId,
      channel_id: 'ch-chat',
      author_id: modId,
      content: 'Investigating https://discord.gg/someinvite link',
    });
    expect(staffMsg.triggered).toBe(false);

    const scamMsg = await services.autoMod.inspectMessage({
      id: 'msg-scam-1',
      server_id: serverId,
      channel_id: 'ch-chat',
      author_id: suspectId,
      content: 'Claim free godly knives at https://free-godly-mm2.example.com/claim',
    });
    expect(scamMsg.triggered).toBe(true);
    expect((await repos.users.findByYapinId(suspectId)).moderation.activeWarnCount).toBe(1);

    // 3. Second warning hits threshold=2 -> automatically escalates to Timed Mute + grants role-muted!
    const warn2 = await services.moderation.warnUser({
      serverId,
      actorId: modId,
      targetUserId: suspectId,
      reason: 'Continued FailRP in Nikilis Factory',
    });
    expect(warn2.autoMuteCase).toBeTruthy();
    expect(mock.state.members.get(`${serverId}:${suspectId}`).roles).toContain('role-muted');

    // 4. Expired mute sweep automatically lifts mute & removes role-muted!
    await repos.users.updateUser(suspectId, (d) => {
      d.moderation.activeMute.expiresAt = new Date(Date.now() - 5000);
    });
    const unmuted = await services.moderation.sweepExpiredMutes(serverId);
    expect(unmuted).toContain(suspectId);
    expect(mock.state.members.get(`${serverId}:${suspectId}`).roles).not.toContain('role-muted');

    // 5. Ban requires explicit confirm=yes
    await expect(
      services.moderation.banUser({
        serverId,
        actorId: modId,
        targetUserId: suspectId,
        reason: 'Confirmed exploit',
        confirm: false,
      }),
    ).rejects.toThrow(/confirm=yes/i);

    const banCase = await services.moderation.banUser({
      serverId,
      actorId: modId,
      targetUserId: suspectId,
      reason: 'Confirmed exploit',
      confirm: true,
    });
    expect(banCase.action).toBe('BAN');
  });

  it('runs MurderMystery2 Character Profiles, Dice Rolls, Self-Roles, and Live Secret Mystery Rounds with private Ephemeral Role Reveal', async () => {
    const mock = createMockYapinFetch();
    const serverId = mock.defaultServerId;
    const p1 = '10000000-0000-4000-8000-000000000011';
    const p2 = '10000000-0000-4000-8000-000000000022';
    const p3 = '10000000-0000-4000-8000-000000000033';
    mock.setMember(serverId, p1, ['role-verified'], 'HostNikilis');
    mock.setMember(serverId, p2, ['role-verified'], 'PlayerJade');
    mock.setMember(serverId, p3, ['role-verified'], 'PlayerZack');

    const client = new YapinClient({
      token: mock.state.botToken,
      fetchImpl: mock.fetchImpl,
      enableGateway: false,
    });
    const repos = createInMemoryRepositories();
    await repos.serverConfigs.updateConfig(serverId, {
      'roles.selfRoles': { 'rp-pings': 'role-rp-pings' },
    });

    const permissionsApi = new YapinPermissionsApi(client, { cacheTtlMs: 0 });
    const messagesApi = new YapinMessagesApi(client);
    const channelsApi = new YapinChannelsApi(client);
    const { services } = createApplicationServices({
      repositories: repos,
      permissionsApi,
      channelsApi,
      messagesApi,
      logger,
    });

    // Character creation & switching
    const { character: c1 } = await services.roleplay.createCharacter({
      serverId,
      userId: p1,
      name: 'Inspector Vance',
      alignment: 'SHERIFF',
      weapon: 'Golden Luger',
      bio: 'Veteran investigator of Police Station HQ.',
    });
    expect(c1.alignment).toBe('SHERIFF');

    const roll = services.roleplay.rollDice('2d6');
    expect(roll.rolls).toHaveLength(2);
    expect(roll.total).toBeGreaterThanOrEqual(2);
    expect(roll.total).toBeLessThanOrEqual(12);

    // Self-role toggle (adds then removes)
    const addRole = await services.roleplay.toggleSelfRole({
      serverId,
      userId: p1,
      roleKey: 'rp-pings',
    });
    expect(addRole.action).toBe('added');
    expect(mock.state.members.get(`${serverId}:${p1}`).roles).toContain('role-rp-pings');

    // Live Secret Mystery Round: 3 players -> exactly 1 MURDERER, 1 SHERIFF, 1 INNOCENT!
    const round = services.roleplay.startMysteryRound({
      serverId,
      channelId: 'ch-mansion',
      hostId: p1,
      mapName: 'BioLab',
    });
    expect(round.map.id).toBe('BioLab');

    services.roleplay.joinMysteryRound({ roundId: round.roundId, userId: p2 });
    services.roleplay.joinMysteryRound({ roundId: round.roundId, userId: p3 });

    const active = await services.roleplay.drawMysteryRoles({
      serverId,
      roundId: round.roundId,
      actorId: p1,
    });
    const assignedRoles = Object.values(active.assignments).sort();
    expect(assignedRoles).toEqual(['INNOCENT', 'MURDERER', 'SHERIFF']);

    // Ephemeral button callback (`mm2:mystery:reveal:<roundId>`) privately reveals the clicker's secret role!
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
      id: 'int-reveal-1',
      token: 'tok-reveal-1',
      type: 'button',
      custom_id: `mm2:mystery:reveal:${round.roundId}`,
      server_id: serverId,
      channel_id: 'ch-mansion',
      user_id: p2,
    });

    const cbRecord = mock.state.interactions.get('int-reveal-1');
    expect(cbRecord[0].body.type).toBe('ephemeral');
    expect(cbRecord[0].body.embeds[0].title).toContain(active.assignments[p2]);
  });
});
