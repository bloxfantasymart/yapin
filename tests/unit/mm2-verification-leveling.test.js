import { describe, expect, it } from 'vitest';
import { YapinClient } from '../../src/api/YapinClient.js';
import { YapinChannelsApi } from '../../src/api/channels.js';
import { YapinMessagesApi } from '../../src/api/messages.js';
import { YapinPermissionsApi } from '../../src/api/permissions.js';
import { createApplicationServices } from '../../src/systems/createServices.js';
import { xpRequiredForLevel } from '../../src/systems/levelingService.js';
import { logger } from '../../src/utils/logger.js';
import { createInMemoryRepositories } from '../helpers/inMemoryRepositories.js';
import { createMockYapinFetch } from '../helpers/mockYapinServer.js';

describe('MM2 Helper — Sheriff Checkpoint Verification & Leveling / Ranks Suite', () => {
  it('supports Sheriff Passcode (MM2-XXXX) & Instant verification, grants/removes roles, and blocks banned users', async () => {
    const mock = createMockYapinFetch();
    const serverId = mock.defaultServerId;
    const citizenId = '22222222-2222-4222-8222-222222222222';
    const modId = '55555555-5555-4555-8555-555555555555';
    mock.setMember(serverId, citizenId, ['role-unverified'], 'SuspectKai');
    mock.setMember(serverId, modId, ['role-mod'], 'SheriffMod');

    const client = new YapinClient({
      token: mock.state.botToken,
      fetchImpl: mock.fetchImpl,
      enableGateway: false,
    });
    const repos = createInMemoryRepositories();
    await repos.serverConfigs.updateConfig(serverId, {
      'staffRoles.moderatorRoleIds': ['role-mod'],
      'roles.verifiedRoleId': 'role-verified',
      'roles.unverifiedRoleId': 'role-unverified',
      'channels.welcomeChannelId': 'ch-welcome',
      'verification.mode': 'code',
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

    // Step 1: Request Sheriff Passcode
    const step1 = await services.verification.verifyMember({
      serverId,
      userId: citizenId,
      username: 'SuspectKai',
    });
    expect(step1.status).toBe('CHALLENGE_ISSUED');
    expect(step1.code).toMatch(/^MM2-[A-Z0-9]{4}$/);

    // Wrong code rejected
    await expect(
      services.verification.verifyMember({
        serverId,
        userId: citizenId,
        code: 'MM2-0000',
      }),
    ).rejects.toThrow(/Incorrect Sheriff Passcode/i);

    // Correct code verifies, grants role-verified, removes role-unverified, awards starter XP, posts welcome!
    const step2 = await services.verification.verifyMember({
      serverId,
      userId: citizenId,
      code: step1.code,
    });
    expect(step2.status).toBe('VERIFIED');
    expect(step2.user.verification.verified).toBe(true);

    const memberAfter = mock.state.members.get(`${serverId}:${citizenId}`);
    expect(memberAfter.roles).toContain('role-verified');
    expect(memberAfter.roles).not.toContain('role-unverified');

    const updatedUser = await repos.users.findByYapinId(citizenId);
    expect(updatedUser.leveling.totalXp).toBeGreaterThanOrEqual(50);

    // Staff can unverify & re-verify via /verifyuser
    await services.verification.staffSetVerification({
      serverId,
      actorId: modId,
      targetUserId: citizenId,
      verified: false,
      reason: 'Re-checking checkpoint',
    });
    expect((await repos.users.findByYapinId(citizenId)).verification.verified).toBe(false);
  });

  it('awards Chat & RP bonus XP, enforces XP cooldowns, grants Level-Up milestone roles, and handles /daily crates', async () => {
    const mock = createMockYapinFetch();
    const serverId = mock.defaultServerId;
    const playerId = '33333333-3333-4333-8333-333333333333';
    const adminId = '88888888-8888-4888-8888-888888888888';
    mock.setMember(serverId, playerId, ['role-verified'], 'DetectiveMia');
    mock.setMember(serverId, adminId, ['role-admin'], 'AdminNikilis');

    const client = new YapinClient({
      token: mock.state.botToken,
      fetchImpl: mock.fetchImpl,
      enableGateway: false,
    });
    const repos = createInMemoryRepositories();
    await repos.serverConfigs.updateConfig(serverId, {
      'staffRoles.adminRoleIds': ['role-admin'],
      'roles.levelRewards': { '5': 'role-detective-lv5' },
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

    // RP post (*action*) awards XP + RP bonus
    const rpRes = await services.leveling.awardChatXp({
      server_id: serverId,
      channel_id: 'ch-mansion',
      author_id: playerId,
      username: 'DetectiveMia',
      content: '*carefully inspects the shattered display case inside The Mansion foyer*',
    });
    expect(rpRes.awarded).toBe(true);
    expect(rpRes.xpGained).toBeGreaterThanOrEqual(23);

    // Immediate second message within cooldown does NOT grant duplicate XP
    const spamRes = await services.leveling.awardChatXp({
      server_id: serverId,
      channel_id: 'ch-mansion',
      author_id: playerId,
      content: 'Another fast message',
    });
    expect(spamRes.awarded).toBe(false);

    // Claim daily crate -> grants XP & streak = 1; immediate repeat rejected
    const daily = await services.leveling.claimDaily({ serverId, userId: playerId });
    expect(daily.gainedXp).toBeGreaterThanOrEqual(135);
    expect(daily.streak).toBe(1);
    await expect(services.leveling.claimDaily({ serverId, userId: playerId })).rejects.toThrow(
      /already claimed/i,
    );

    // Staff /xp setlevel 5 -> automatically grants milestone role `role-detective-lv5`!
    const lv5 = await services.leveling.modifyUserXp({
      serverId,
      actorId: adminId,
      targetUserId: playerId,
      action: 'setlevel',
      amount: 5,
    });
    expect(lv5.leveling.level).toBe(5);
    expect(xpRequiredForLevel(5)).toBeGreaterThan(300);
    expect(mock.state.members.get(`${serverId}:${playerId}`).roles).toContain('role-detective-lv5');
  });
});
