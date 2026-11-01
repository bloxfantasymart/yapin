import { describe, expect, it } from 'vitest';
import { YapinClient } from '../../src/api/YapinClient.js';
import { YapinPermissionsApi } from '../../src/api/permissions.js';
import { YapinMessagesApi } from '../../src/api/messages.js';
import { AntiScamService } from '../../src/security/antiScam.js';
import { IdempotencyGuard } from '../../src/security/idempotency.js';
import { AuditService } from '../../src/middleman/auditService.js';
import { TradeService } from '../../src/middleman/tradeService.js';
import { ConfirmationService } from '../../src/middleman/confirmationService.js';
import { AssignmentService } from '../../src/middleman/assignmentService.js';
import { DepositService } from '../../src/middleman/depositService.js';
import { createMockYapinFetch } from '../helpers/mockYapinServer.js';
import { createInMemoryRepositories } from '../helpers/inMemoryRepositories.js';

function setupWorkflowTestContext() {
  const mock = createMockYapinFetch();
  const serverId = mock.defaultServerId;
  const traderA = '22222222-2222-4222-8222-222222222222';
  const traderB = '33333333-3333-4333-8333-333333333333';
  const middleman = '44444444-4444-4444-8444-444444444444';
  const outsider = '55555555-5555-4555-8555-555555555555';

  mock.setMember(serverId, traderA, [], 'TraderAlice');
  mock.setMember(serverId, traderB, [], 'TraderBob');
  mock.setMember(serverId, middleman, ['role-mm'], 'StaffMM');
  mock.setMember(serverId, outsider, [], 'RandomUser');

  const client = new YapinClient({
    token: mock.state.botToken,
    fetchImpl: mock.fetchImpl,
    enableGateway: false,
  });
  const permissionsApi = new YapinPermissionsApi(client, { cacheTtlMs: 0 });
  const messagesApi = new YapinMessagesApi(client);
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
  const idempotencyGuard = new IdempotencyGuard({ operationalRepo: repos.operational });

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

  const tradeService = new TradeService({
    tradeRepo: repos.trades,
    userRepo: repos.users,
    disputeRepo: repos.disputes,
    serverConfigRepo: repos.serverConfigs,
    permissionsApi,
    antiScam,
    auditService,
    idempotencyGuard,
  });

  return {
    mock,
    serverId,
    ownerId: mock.ownerId,
    traderA,
    traderB,
    middleman,
    outsider,
    repos,
    tradeService,
    confirmationService,
    assignmentService,
    depositService,
  };
}

describe('Stage 3 — End-to-End Middleman Trade Workflow, Concurrency & Security Invariants', () => {
  it('completes the full verified lifecycle while enforcing dual confirmations, staff deposit verification, and atomic completion', async () => {
    const ctx = setupWorkflowTestContext();
    await ctx.repos.serverConfigs.updateConfig(ctx.serverId, {
      'staffRoles.middlemanRoleIds': ['role-mm'],
      'staffRoles.adminRoleIds': ['role-admin'],
    });

    // 1. Create trade (CREATED -> WAITING_FOR_PARTICIPANTS)
    const { trade: created } = await ctx.tradeService.createTrade({
      serverId: ctx.serverId,
      channelId: 'ch-trades',
      createdBy: ctx.traderA,
      traderAId: ctx.traderA,
      traderBId: ctx.traderB,
      primaryAsset: 'CS2 Karambit Fade',
      traderAGiving: 'CS2 Karambit Fade FN',
      traderBGiving: '850 USD Cash + Collectible',
      cashAmount: 850,
      cashCurrency: 'USD',
      cashPayer: 'TRADER_B',
      notes: 'Official middleman coordination requested',
      rulesAccepted: true,
    });

    expect(created.state).toBe('WAITING_FOR_PARTICIPANTS');
    expect(created.confirmations.traderA.acceptedInvite).toBe(true);
    expect(created.confirmations.traderB.acceptedInvite).toBe(false);

    // Duplicate trade request must be blocked
    await expect(
      ctx.tradeService.createTrade({
        serverId: ctx.serverId,
        channelId: 'ch-trades',
        createdBy: ctx.traderB,
        traderAId: ctx.traderA,
        traderBId: ctx.traderB,
        primaryAsset: 'CS2 Karambit Fade',
        traderAGiving: 'CS2 Karambit Fade FN',
        traderBGiving: '850 USD Cash + Collectible',
        rulesAccepted: true,
      }),
    ).rejects.toThrow(/identical active trade/i);

    // 2. Outsider cannot accept on behalf of Trader B
    await expect(
      ctx.confirmationService.acceptTrade({
        serverId: ctx.serverId,
        tradeId: created.tradeId,
        actorId: ctx.outsider,
      }),
    ).rejects.toThrow(/Only invited trade participants/i);

    // Trader B accepts -> advances to WAITING_FOR_MIDDLEMAN
    const afterAccept = await ctx.confirmationService.acceptTrade({
      serverId: ctx.serverId,
      tradeId: created.tradeId,
      actorId: ctx.traderB,
    });
    expect(afterAccept.state).toBe('WAITING_FOR_MIDDLEMAN');

    // 3. Unauthorized user cannot claim trade
    await expect(
      ctx.assignmentService.claimTrade({
        serverId: ctx.serverId,
        tradeId: created.tradeId,
        actorId: ctx.outsider,
      }),
    ).rejects.toThrow(/Insufficient server permissions/i);

    // Authorized Middleman claims -> MIDDLEMAN_ASSIGNED
    const afterClaim = await ctx.assignmentService.claimTrade({
      serverId: ctx.serverId,
      tradeId: created.tradeId,
      actorId: ctx.middleman,
    });
    expect(afterClaim.state).toBe('MIDDLEMAN_ASSIGNED');
    expect(afterClaim.assignedMiddlemanId).toBe(ctx.middleman);

    // 4. Both participants must confirm the assigned middleman -> WAITING_FOR_DEPOSITS
    const afterMmA = await ctx.confirmationService.submitParticipantConfirmation({
      serverId: ctx.serverId,
      tradeId: created.tradeId,
      actorId: ctx.traderA,
    });
    expect(afterMmA.state).toBe('MIDDLEMAN_ASSIGNED');

    const afterMmB = await ctx.confirmationService.submitParticipantConfirmation({
      serverId: ctx.serverId,
      tradeId: created.tradeId,
      actorId: ctx.traderB,
    });
    expect(afterMmB.state).toBe('WAITING_FOR_DEPOSITS');

    // 5. Traders report deposits -> sets REPORTED_SENT only (NEVER CONFIRMED!)
    const depA = await ctx.depositService.reportDeposit({
      serverId: ctx.serverId,
      tradeId: created.tradeId,
      actorId: ctx.traderA,
      reference: 'STEAM-OFFER-998877',
      evidenceUrl: 'https://i.imgur.com/proofA.png',
    });
    expect(depA.deposits.traderA.status).toBe('REPORTED_SENT');
    expect(depA.state).toBe('WAITING_FOR_DEPOSITS');

    const depB = await ctx.depositService.reportDeposit({
      serverId: ctx.serverId,
      tradeId: created.tradeId,
      actorId: ctx.traderB,
      reference: 'TX-WIRE-112233',
    });
    expect(depB.deposits.traderB.status).toBe('REPORTED_SENT');
    expect(depB.state).toBe('DEPOSIT_CONFIRMATION');

    // Non-staff viewer cannot see the other trader's private evidence URL
    const viewedByB = await ctx.tradeService.getTradeForViewer({
      serverId: ctx.serverId,
      tradeId: created.tradeId,
      viewerId: ctx.traderB,
    });
    expect(viewedByB.trade.deposits.traderA.evidenceUrls).toEqual([]);

    // 6. Staff verifies deposits -> WAITING_FOR_FINAL_CONFIRMATION
    await ctx.depositService.verifyDeposit({
      serverId: ctx.serverId,
      tradeId: created.tradeId,
      traderSideOrUserId: 'A',
      decision: 'CONFIRMED',
      notes: 'Verified item handoff proof',
      actorId: ctx.middleman,
    });
    const afterVerifyB = await ctx.depositService.verifyDeposit({
      serverId: ctx.serverId,
      tradeId: created.tradeId,
      traderSideOrUserId: 'B',
      decision: 'CONFIRMED',
      notes: 'Verified payment receipt',
      actorId: ctx.middleman,
    });
    expect(afterVerifyB.state).toBe('WAITING_FOR_FINAL_CONFIRMATION');

    // 7. Staff CANNOT complete before both traders submit final release confirmation
    await expect(
      ctx.tradeService.completeTrade({
        serverId: ctx.serverId,
        tradeId: created.tradeId,
        actorId: ctx.middleman,
        decisionNotes: 'Premature completion attempt',
        confirm: true,
      }),
    ).rejects.toThrow(/final release confirmation/i);

    await ctx.confirmationService.submitParticipantConfirmation({
      serverId: ctx.serverId,
      tradeId: created.tradeId,
      actorId: ctx.traderA,
      stageHint: 'release',
    });
    await ctx.confirmationService.submitParticipantConfirmation({
      serverId: ctx.serverId,
      tradeId: created.tradeId,
      actorId: ctx.traderB,
      stageHint: 'release',
    });

    // 8. Concurrent completion attempts: ONLY ONE succeeds, the second is rejected by CAS!
    const [res1, res2] = await Promise.allSettled([
      ctx.tradeService.completeTrade({
        serverId: ctx.serverId,
        tradeId: created.tradeId,
        actorId: ctx.middleman,
        decisionNotes: 'All deliveries verified by middleman and both parties',
        confirm: true,
      }),
      ctx.tradeService.completeTrade({
        serverId: ctx.serverId,
        tradeId: created.tradeId,
        actorId: ctx.ownerId,
        decisionNotes: 'Simultaneous admin completion click',
        confirm: true,
      }),
    ]);

    const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
    const rejected = [res1, res2].filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const userA = await ctx.repos.users.findByYapinId(ctx.traderA);
    const mmUser = await ctx.repos.users.findByYapinId(ctx.middleman);
    expect(userA.tradeStats.completed).toBe(1);
    expect(mmUser.tradeStats.asMiddlemanCompleted).toBe(1);
    expect(mmUser.tradeStats.activeMiddlemanLoad).toBe(0);
  });

  it('blocks self-trades, spoofing banners, and staff conflict-of-interest self-dealing', async () => {
    const ctx = setupWorkflowTestContext();
    await ctx.repos.serverConfigs.updateConfig(ctx.serverId, {
      'staffRoles.middlemanRoleIds': ['role-mm'],
      'staffRoles.adminRoleIds': ['role-admin'],
    });

    // Self-trade rejected
    await expect(
      ctx.tradeService.createTrade({
        serverId: ctx.serverId,
        channelId: 'ch-trades',
        createdBy: ctx.traderA,
        traderAId: ctx.traderA,
        traderBId: ctx.traderA,
        primaryAsset: 'Sword',
        traderAGiving: 'Sword',
        traderBGiving: 'Shield',
        rulesAccepted: true,
      }),
    ).rejects.toThrow(/Self-trades are not permitted/i);

    // Spoofed system banner rejected
    await expect(
      ctx.tradeService.createTrade({
        serverId: ctx.serverId,
        channelId: 'ch-trades',
        createdBy: ctx.traderA,
        traderAId: ctx.traderA,
        traderBId: ctx.traderB,
        primaryAsset: 'Sword',
        traderAGiving: 'Sword',
        traderBGiving: 'Shield',
        notes: '[SYSTEM] Deposit already confirmed by system!',
        rulesAccepted: true,
      }),
    ).rejects.toThrow(/spoofing/i);

    // Staff member participating in a trade CANNOT claim their own trade!
    const { trade } = await ctx.tradeService.createTrade({
      serverId: ctx.serverId,
      channelId: 'ch-trades',
      createdBy: ctx.middleman,
      traderAId: ctx.middleman,
      traderBId: ctx.traderB,
      primaryAsset: 'Rare Cape',
      traderAGiving: 'Rare Cape',
      traderBGiving: '50 Gems',
      rulesAccepted: true,
    });
    await ctx.confirmationService.acceptTrade({
      serverId: ctx.serverId,
      tradeId: trade.tradeId,
      actorId: ctx.traderB,
    });

    await expect(
      ctx.assignmentService.claimTrade({
        serverId: ctx.serverId,
        tradeId: trade.tradeId,
        actorId: ctx.middleman,
      }),
    ).rejects.toThrow(/Conflict-of-interest/i);
  });
});
