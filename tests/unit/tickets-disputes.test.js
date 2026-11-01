import { describe, expect, it } from 'vitest';
import { YapinClient } from '../../src/api/YapinClient.js';
import { YapinChannelsApi } from '../../src/api/channels.js';
import { YapinMessagesApi } from '../../src/api/messages.js';
import { YapinPermissionsApi } from '../../src/api/permissions.js';
import { AntiScamService } from '../../src/security/antiScam.js';
import { AuditService } from '../../src/middleman/auditService.js';
import { TradeService } from '../../src/middleman/tradeService.js';
import { ConfirmationService } from '../../src/middleman/confirmationService.js';
import { AssignmentService } from '../../src/middleman/assignmentService.js';
import { DepositService } from '../../src/middleman/depositService.js';
import { DisputeService } from '../../src/middleman/disputeService.js';
import { TranscriptService } from '../../src/tickets/transcriptService.js';
import { TicketService } from '../../src/tickets/ticketService.js';
import { ModerationService } from '../../src/moderation/moderationService.js';
import { createMockYapinFetch } from '../helpers/mockYapinServer.js';
import { createInMemoryRepositories } from '../helpers/inMemoryRepositories.js';

function createTicketDisputeSuite() {
  const mock = createMockYapinFetch();
  const serverId = mock.defaultServerId;
  const traderA = '22222222-2222-4222-8222-222222222222';
  const traderB = '33333333-3333-4333-8333-333333333333';
  const middleman = '44444444-4444-4444-8444-444444444444';
  const moderator = '66666666-6666-4666-8666-666666666666';
  const outsider = '77777777-7777-4777-8777-777777777777';

  mock.setMember(serverId, traderA, [], 'TraderAlice');
  mock.setMember(serverId, traderB, [], 'TraderBob');
  mock.setMember(serverId, middleman, ['role-mm'], 'MiddlemanDan');
  mock.setMember(serverId, moderator, ['role-mod'], 'ModSarah');
  mock.setMember(serverId, outsider, [], 'OutsiderEve');

  const client = new YapinClient({
    token: mock.state.botToken,
    fetchImpl: mock.fetchImpl,
    enableGateway: false,
  });
  const channelsApi = new YapinChannelsApi(client);
  const messagesApi = new YapinMessagesApi(client);
  const permissionsApi = new YapinPermissionsApi(client, { cacheTtlMs: 0 });
  const repos = createInMemoryRepositories();

  const auditService = new AuditService({
    auditRepo: repos.audits,
    serverConfigRepo: repos.serverConfigs,
    messagesApi,
  });
  const antiScam = new AntiScamService({
    userRepo: repos.users,
    permissionsApi,
    messagesApi,
    auditService,
  });
  const transcriptService = new TranscriptService({ messagesApi });
  const ticketService = new TicketService({
    ticketRepo: repos.tickets,
    serverConfigRepo: repos.serverConfigs,
    channelsApi,
    messagesApi,
    permissionsApi,
    antiScam,
    transcriptService,
    auditService,
  });

  const assignmentService = new AssignmentService({
    tradeRepo: repos.trades,
    userRepo: repos.users,
    serverConfigRepo: repos.serverConfigs,
    permissionsApi,
    antiScam,
    auditService,
  });
  const confirmationService = new ConfirmationService({
    tradeRepo: repos.trades,
    userRepo: repos.users,
    auditService,
    assignmentService,
    serverConfigRepo: repos.serverConfigs,
  });
  const depositService = new DepositService({
    tradeRepo: repos.trades,
    serverConfigRepo: repos.serverConfigs,
    permissionsApi,
    antiScam,
    auditService,
  });
  const disputeService = new DisputeService({
    disputeRepo: repos.disputes,
    tradeRepo: repos.trades,
    userRepo: repos.users,
    serverConfigRepo: repos.serverConfigs,
    permissionsApi,
    antiScam,
    auditService,
    ticketService,
  });
  const tradeService = new TradeService({
    tradeRepo: repos.trades,
    userRepo: repos.users,
    disputeRepo: repos.disputes,
    serverConfigRepo: repos.serverConfigs,
    permissionsApi,
    antiScam,
    auditService,
  });
  const moderationService = new ModerationService({
    userRepo: repos.users,
    reportRepo: repos.reports,
    serverConfigRepo: repos.serverConfigs,
    permissionsApi,
    antiScam,
    auditService,
  });

  return {
    mock,
    serverId,
    ownerId: mock.ownerId,
    traderA,
    traderB,
    middleman,
    moderator,
    outsider,
    repos,
    ticketService,
    disputeService,
    tradeService,
    confirmationService,
    assignmentService,
    depositService,
    moderationService,
  };
}

describe('Stage 3 — Tickets, Fail-Closed Private Channels, Disputes & Moderation', () => {
  it('enforces private channel locks, rolls back channel immediately if permission lock fails, and restricts STAFF_REPORT to Admins', async () => {
    const ctx = createTicketDisputeSuite();
    await ctx.repos.serverConfigs.updateConfig(ctx.serverId, {
      'staffRoles.adminRoleIds': ['role-admin'],
      'staffRoles.moderatorRoleIds': ['role-mod'],
      'staffRoles.middlemanRoleIds': ['role-mm'],
      'channels.alertChannelId': 'ch-staff-alerts',
    });

    // 1. Open valid private ticket
    const ticket = await ctx.ticketService.openTicket({
      serverId: ctx.serverId,
      creatorId: ctx.traderA,
      type: 'TRADE_ASSISTANCE',
      subject: 'Need help with trade',
      description: 'Question about deposit verification proof format',
    });

    expect(ticket.status).toBe('OPEN');
    expect(ticket.accessConfig.isPrivate).toBe(true);
    const createdCh = ctx.mock.state.channels.get(ticket.channelId);
    expect(createdCh.private).toBe(true);
    expect(createdCh.role_ids.length).toBeGreaterThan(0);

    // Outsider cannot read or add notes to private ticket
    await expect(
      ctx.ticketService.addNote({
        serverId: ctx.serverId,
        ticketId: ticket.ticketId,
        actorId: ctx.outsider,
        content: 'Snooping attempt',
      }),
    ).rejects.toThrow(/do not have access/i);

    // Duplicate open ticket blocked
    await expect(
      ctx.ticketService.openTicket({
        serverId: ctx.serverId,
        creatorId: ctx.traderA,
        type: 'TRADE_ASSISTANCE',
        subject: 'Duplicate',
        description: 'Another duplicate ticket attempt',
      }),
    ).rejects.toThrow(/already have an open/i);

    // Close ticket -> stores SHA-256 checksummed transcript & sets channel read_only
    const closed = await ctx.ticketService.closeTicket({
      serverId: ctx.serverId,
      ticketId: ticket.ticketId,
      actorId: ctx.moderator,
      reason: 'Question answered thoroughly',
    });
    expect(closed.status).toBe('CLOSED');
    expect(closed.transcript.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ctx.mock.state.channels.get(ticket.channelId).read_only).toBe(true);

    // 2. Simulate PATCH /channels/:id failure -> MUST delete channel immediately (never stay public!) and alert staff
    const channelCountBefore = ctx.mock.state.channels.size;
    ctx.mock.state.failPrivateLockOnChannelId = '*';

    await expect(
      ctx.ticketService.openTicket({
        serverId: ctx.serverId,
        creatorId: ctx.traderB,
        type: 'SCAM_REPORT',
        subject: 'Urgent scam proof',
        description: 'Private proof that must never leak publicly',
      }),
    ).rejects.toThrow(/rolled back/i);

    // Verify channel was rolled back (deleted) and alert was posted to staff alert channel
    expect(ctx.mock.state.channels.size).toBe(channelCountBefore);
    const staffAlerts = ctx.mock.state.messages.get('ch-staff-alerts') || [];
    expect(staffAlerts.length).toBeGreaterThan(0);
    ctx.mock.state.failPrivateLockOnChannelId = null;

    // 3. STAFF_REPORT ticket restricts access to Admin only (blocks regular moderator!)
    const staffReportTicket = await ctx.ticketService.openTicket({
      serverId: ctx.serverId,
      creatorId: ctx.traderB,
      type: 'STAFF_REPORT',
      subject: 'Report against moderator',
      description: 'Confidential report regarding staff member conduct',
    });
    await expect(
      ctx.ticketService.claimTicket({
        serverId: ctx.serverId,
        ticketId: staffReportTicket.ticketId,
        actorId: ctx.moderator,
      }),
    ).rejects.toThrow(/Only server Admins/i);
  });

  it('freezes trade completion when a dispute is opened until authorized staff resolves it', async () => {
    const ctx = createTicketDisputeSuite();
    await ctx.repos.serverConfigs.updateConfig(ctx.serverId, {
      'staffRoles.adminRoleIds': ['role-admin'],
      'staffRoles.moderatorRoleIds': ['role-mod'],
      'staffRoles.middlemanRoleIds': ['role-mm'],
    });

    const { trade } = await ctx.tradeService.createTrade({
      serverId: ctx.serverId,
      channelId: 'ch-trades',
      createdBy: ctx.traderA,
      traderAId: ctx.traderA,
      traderBId: ctx.traderB,
      primaryAsset: 'Golden Dragon Pet',
      traderAGiving: 'Golden Dragon Pet',
      traderBGiving: '200 Gems',
      rulesAccepted: true,
    });
    await ctx.confirmationService.acceptTrade({
      serverId: ctx.serverId,
      tradeId: trade.tradeId,
      actorId: ctx.traderB,
    });
    await ctx.assignmentService.claimTrade({
      serverId: ctx.serverId,
      tradeId: trade.tradeId,
      actorId: ctx.middleman,
    });
    await ctx.confirmationService.submitParticipantConfirmation({
      serverId: ctx.serverId,
      tradeId: trade.tradeId,
      actorId: ctx.traderA,
    });
    await ctx.confirmationService.submitParticipantConfirmation({
      serverId: ctx.serverId,
      tradeId: trade.tradeId,
      actorId: ctx.traderB,
    });
    await ctx.depositService.reportDeposit({
      serverId: ctx.serverId,
      tradeId: trade.tradeId,
      actorId: ctx.traderA,
      reference: 'TX-A-1',
    });
    await ctx.depositService.reportDeposit({
      serverId: ctx.serverId,
      tradeId: trade.tradeId,
      actorId: ctx.traderB,
      reference: 'TX-B-1',
    });
    await ctx.depositService.verifyDeposit({
      serverId: ctx.serverId,
      tradeId: trade.tradeId,
      traderSideOrUserId: 'A',
      decision: 'CONFIRMED',
      notes: 'Verified A',
      actorId: ctx.middleman,
    });
    await ctx.depositService.verifyDeposit({
      serverId: ctx.serverId,
      tradeId: trade.tradeId,
      traderSideOrUserId: 'B',
      decision: 'CONFIRMED',
      notes: 'Verified B',
      actorId: ctx.middleman,
    });
    await ctx.confirmationService.submitParticipantConfirmation({
      serverId: ctx.serverId,
      tradeId: trade.tradeId,
      actorId: ctx.traderA,
    });
    await ctx.confirmationService.submitParticipantConfirmation({
      serverId: ctx.serverId,
      tradeId: trade.tradeId,
      actorId: ctx.traderB,
    });

    // Trader B opens a dispute right before completion -> FREEZES trade!
    const { dispute, trade: frozen } = await ctx.disputeService.openDispute({
      serverId: ctx.serverId,
      tradeId: trade.tradeId,
      actorId: ctx.traderB,
      reason: 'Item stats differed from screenshot shown earlier',
      evidenceUrl: 'https://i.imgur.com/dispute1.png',
    });

    expect(frozen.state).toBe('DISPUTED');
    expect(frozen.preDisputeState).toBe('WAITING_FOR_FINAL_CONFIRMATION');

    // Completion attempt MUST fail while disputed!
    await expect(
      ctx.tradeService.completeTrade({
        serverId: ctx.serverId,
        tradeId: trade.tradeId,
        actorId: ctx.middleman,
        decisionNotes: 'Attempt during freeze',
        confirm: true,
      }),
    ).rejects.toThrow(/cannot be completed/i);

    // Moderator resolves dispute with RESUME_TRADE + confirm=true -> unfreezes back to WAITING_FOR_FINAL_CONFIRMATION
    const resolved = await ctx.disputeService.resolveDispute({
      serverId: ctx.serverId,
      disputeIdOrTradeId: dispute.disputeId,
      outcome: 'RESUME_TRADE',
      decisionSummary: 'Both parties inspected item stats in voice call and confirmed agreement to proceed',
      actorId: ctx.moderator,
      confirm: true,
    });

    expect(resolved.trade.state).toBe('WAITING_FOR_FINAL_CONFIRMATION');
    expect(resolved.trade.activeDisputeId).toBeNull();

    // Now completion succeeds!
    const completed = await ctx.tradeService.completeTrade({
      serverId: ctx.serverId,
      tradeId: trade.tradeId,
      actorId: ctx.middleman,
      decisionNotes: 'Completed following resolved dispute DSP',
      confirm: true,
    });
    expect(completed.state).toBe('COMPLETED');
  });

  it('queues /report for staff review without auto-labeling or auto-suspending target users, while enforcing staff /suspenduser', async () => {
    const ctx = createTicketDisputeSuite();
    await ctx.repos.serverConfigs.updateConfig(ctx.serverId, {
      'staffRoles.moderatorRoleIds': ['role-mod'],
    });

    const report = await ctx.moderationService.submitReport({
      serverId: ctx.serverId,
      reporterId: ctx.traderA,
      targetUserId: ctx.traderB,
      category: 'IMPERSONATION',
      description: 'User sent suspicious links outside the server channel',
      evidenceUrl: 'https://i.imgur.com/suspicious.png',
    });

    expect(report.status).toBe('PENDING_REVIEW');
    const targetAfterReport = await ctx.repos.users.findByYapinId(ctx.traderB);
    expect(targetAfterReport.suspension.active).toBe(false);
    expect(targetAfterReport.riskFlags.openReportsCount).toBe(1);

    // Unauthorized user cannot suspend anyone
    await expect(
      ctx.moderationService.suspendUser({
        serverId: ctx.serverId,
        targetUserId: ctx.traderB,
        actorId: ctx.traderA,
        reason: 'Fake staff attempt',
        confirm: true,
      }),
    ).rejects.toThrow(/Insufficient server permissions/i);

    // Moderator suspends user -> blocks user from opening trades
    await ctx.moderationService.suspendUser({
      serverId: ctx.serverId,
      targetUserId: ctx.traderB,
      actorId: ctx.moderator,
      reason: 'Confirmed impersonation attempt after review',
      durationHours: 24,
      confirm: true,
    });

    await expect(
      ctx.tradeService.createTrade({
        serverId: ctx.serverId,
        channelId: 'ch-trades',
        createdBy: ctx.traderB,
        traderAId: ctx.traderB,
        traderBId: ctx.traderA,
        primaryAsset: 'Test Item',
        traderAGiving: 'Test Item',
        traderBGiving: '10 USD',
        rulesAccepted: true,
      }),
    ).rejects.toThrow(/currently suspended/i);
  });
});
