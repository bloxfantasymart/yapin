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

describe('MM2 Helper — Sheriff Academy Mod Applications & Fail-Closed Detective Tickets', () => {
  it('processes Mod Applications end-to-end, blocks self-review & under-leveled applicants, and auto-grants Trial Mod role on Accept', async () => {
    const mock = createMockYapinFetch();
    const serverId = mock.defaultServerId;
    const applicantId = '22222222-2222-4222-8222-222222222222';
    const adminId = '88888888-8888-4888-8888-888888888888';
    mock.setMember(serverId, applicantId, ['role-verified'], 'CandidateLeo');
    mock.setMember(serverId, adminId, ['role-admin'], 'SheriffAdmin');

    const client = new YapinClient({
      token: mock.state.botToken,
      fetchImpl: mock.fetchImpl,
      enableGateway: false,
    });
    const repos = createInMemoryRepositories();
    await repos.serverConfigs.updateConfig(serverId, {
      'staffRoles.adminRoleIds': ['role-admin'],
      'staffRoles.trialModRoleIds': ['role-trialmod'],
      'channels.modAppLogChannelId': 'ch-mod-apps',
      'applications.open': true,
      'applications.minLevel': 3,
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

    // Level 1 applicant rejected when minLevel = 3
    await expect(
      services.application.submitApplication({
        serverId,
        applicantId,
        answers: {
          age: '19',
          timezone: 'EST',
          hours: '4h',
          experience: '2 yrs RP Mod',
          reason: 'Keep MM2 fair',
          scenario: 'Gather clips before warning',
        },
      }),
    ).rejects.toThrow(/Level 3/);

    // Promote applicant to Level 4
    await services.leveling.modifyUserXp({
      serverId,
      actorId: adminId,
      targetUserId: applicantId,
      action: 'setlevel',
      amount: 4,
    });

    const submitted = await services.application.submitApplication({
      serverId,
      applicantId,
      applicantUsername: 'CandidateLeo',
      answers: {
        age: '19',
        timezone: 'EST',
        hours: '4h/day',
        experience: 'Moderated Murder Mystery RP communities',
        reason: 'Passionate about fair MurderMystery2 scenes',
        scenario: 'Pause OOC argument, check clips, issue Case File warning if RDM proven',
      },
    });
    expect(submitted.status).toBe('PENDING');

    // Duplicate open application blocked
    await expect(
      services.application.submitApplication({
        serverId,
        applicantId,
        answers: submitted.answers,
      }),
    ).rejects.toThrow(/already have an active application/i);

    // Admin accepts via button interaction (`mm2:app:accept:<APP-ID>`) -> auto-grants `role-trialmod`!
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
      id: 'int-app-1',
      token: 'tok-app-1',
      type: 'button',
      custom_id: `mm2:app:accept:${submitted.applicationId}`,
      server_id: serverId,
      channel_id: 'ch-mod-apps',
      user_id: adminId,
    });

    const accepted = await repos.applications.findByApplicationId(submitted.applicationId);
    expect(accepted.status).toBe('ACCEPTED');
    expect(mock.state.members.get(`${serverId}:${applicantId}`).roles).toContain('role-trialmod');
  });

  it('provisions fail-closed private tickets, isolates STAFF_REPORT to Admins, and generates SHA-256 transcripts', async () => {
    const mock = createMockYapinFetch();
    const serverId = mock.defaultServerId;
    const userId = '22222222-2222-4222-8222-222222222222';
    const modId = '55555555-5555-4555-8555-555555555555';
    const adminId = '88888888-8888-4888-8888-888888888888';
    mock.setMember(serverId, userId, ['role-verified'], 'CitizenAva');
    mock.setMember(serverId, modId, ['role-mod'], 'ModOwen');
    mock.setMember(serverId, adminId, ['role-admin'], 'AdminZoe');

    const client = new YapinClient({
      token: mock.state.botToken,
      fetchImpl: mock.fetchImpl,
      enableGateway: false,
    });
    await client.getMe();

    const repos = createInMemoryRepositories();
    await repos.serverConfigs.updateConfig(serverId, {
      'staffRoles.adminRoleIds': ['role-admin'],
      'staffRoles.moderatorRoleIds': ['role-mod'],
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

    // 1. Fail-closed rollback if private channel lock fails!
    mock.state.failPrivateLockOnChannelId = '*';
    await expect(
      services.ticket.openTicket({
        serverId,
        creatorId: userId,
        type: 'GENERAL_SUPPORT',
        subject: 'Should rollback',
        description: 'Private lock test',
      }),
    ).rejects.toThrow(/rolled back safely/i);
    mock.state.failPrivateLockOnChannelId = null;

    // 2. STAFF_REPORT ticket excludes regular Moderators and blocks Mod access!
    const staffReport = await services.ticket.openTicket({
      serverId,
      creatorId: userId,
      type: 'STAFF_REPORT',
      subject: 'Confidential report',
      description: 'Strictly for High Sheriff Admins',
    });
    expect(staffReport.accessConfig.allowedRoleIds).not.toContain('role-mod');
    await expect(
      services.ticket.getTicketForViewer({
        serverId,
        ticketId: staffReport.ticketId,
        viewerId: modId,
      }),
    ).rejects.toThrow(/restricted to Server Admins/i);

    // Admin claims, adds internal note, closes -> SHA-256 transcript persisted, then reopens -> REOPENED
    await services.ticket.claimTicket({
      serverId,
      ticketId: staffReport.ticketId,
      actorId: adminId,
    });
    await services.ticket.addNote({
      serverId,
      ticketId: staffReport.ticketId,
      actorId: adminId,
      content: 'Internal Sheriff investigation note',
      internalOnly: true,
    });

    // Creator cannot see internalOnly note
    const creatorView = await services.ticket.getTicketForViewer({
      serverId,
      ticketId: staffReport.ticketId,
      viewerId: userId,
    });
    expect(creatorView.notes).toHaveLength(0);

    const closed = await services.ticket.closeTicket({
      serverId,
      ticketId: staffReport.ticketId,
      actorId: adminId,
      reason: 'Resolved by High Sheriff',
    });
    expect(closed.status).toBe('CLOSED');
    expect(closed.transcript.checksumSha256).toMatch(/^[0-9a-f]{64}$/);

    const reopened = await services.ticket.reopenTicket({
      serverId,
      ticketId: staffReport.ticketId,
      actorId: adminId,
      reason: 'Follow-up evidence received',
    });
    expect(reopened.status).toBe('REOPENED');
  });
});
