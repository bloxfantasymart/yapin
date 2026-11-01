import { randomUUID } from 'node:crypto';
import { withTransaction } from '../database/connection.js';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../utils/errors.js';
import { generateDisputeId } from '../utils/ids.js';
import { sanitizeUserText, validateSafeEvidenceUrl } from '../security/sanitizer.js';
import { assertValidTradeTransition, isTerminalTradeState } from './tradeStateMachine.js';

/**
 * Dispute Lifecycle & Trade Completion Freeze Service.
 *
 * Security Invariants (Requirement 7 & 8):
 * - Opening a dispute immediately transitions the trade to `DISPUTED`, records `preDisputeState`,
 *   sets `activeDisputeId`, and FREEZES all completion / confirmation / deposit progression.
 * - Dispute evidence is marked `restrictedToStaff: true` and only exposed in staff `/review` or staff dashboard.
 * - Only authorized, conflict-free Moderators/Admins can resolve a dispute (`/resolve`) with a documented decision.
 */
export class DisputeService {
  /**
   * @param {{
   *   disputeRepo: import('../database/repositories/ticketDisputeRepository.js').MongooseDisputeRepository,
   *   tradeRepo: import('../database/repositories/tradeRepository.js').MongooseTradeRepository,
   *   userRepo: import('../database/repositories/userRepository.js').MongooseUserRepository,
   *   serverConfigRepo: import('../database/repositories/auditConfigRepository.js').MongooseServerConfigRepository,
   *   permissionsApi: import('../api/permissions.js').YapinPermissionsApi,
   *   antiScam: import('../security/antiScam.js').AntiScamService,
   *   auditService: import('./auditService.js').AuditService,
   *   ticketService?: import('../tickets/ticketService.js').TicketService | null,
   * }} deps
   */
  constructor({
    disputeRepo,
    tradeRepo,
    userRepo,
    serverConfigRepo,
    permissionsApi,
    antiScam,
    auditService,
    ticketService = null,
  }) {
    this.disputeRepo = disputeRepo;
    this.tradeRepo = tradeRepo;
    this.userRepo = userRepo;
    this.serverConfigRepo = serverConfigRepo;
    this.permissionsApi = permissionsApi;
    this.antiScam = antiScam;
    this.auditService = auditService;
    this.ticketService = ticketService;
  }

  setTicketService(ticketService) {
    this.ticketService = ticketService;
  }

  /**
   * Opens a dispute on an active trade, immediately freezing normal completion.
   */
  async openDispute({
    serverId,
    tradeId,
    actorId,
    reason,
    evidenceRef = '',
    evidenceUrl = null,
    correlationId,
  }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    if (cfg?.features?.disputesEnabled === false) {
      throw new ValidationError('Dispute submissions are currently disabled in server configuration.');
    }

    const trade = await this.tradeRepo.findByTradeId(tradeId);
    if (!trade || trade.serverId !== serverId) {
      throw new NotFoundError(`Trade \`${tradeId}\` was not found in this server.`);
    }

    const access = await this.permissionsApi.resolveMemberAccess(serverId, actorId, cfg);
    const isParticipant = trade.traderAId === actorId || trade.traderBId === actorId;
    if (!isParticipant && !access.roles.isStaff) {
      throw new AuthorizationError('Only trade participants or server staff may open a dispute on this trade.');
    }

    if (isTerminalTradeState(trade.state)) {
      throw new ValidationError(
        `Trade \`${tradeId}\` is already \`${trade.state}\`. Open an appeal or scam report ticket instead.`,
      );
    }

    const existingDispute = await this.disputeRepo.findActiveByTradeId(tradeId);
    if (existingDispute || trade.state === 'DISPUTED') {
      throw new ConflictError(
        `Trade \`${tradeId}\` already has an active dispute (\`${existingDispute?.disputeId || trade.activeDisputeId}\`).`,
      );
    }

    const cleanReason = sanitizeUserText(reason || '', {
      maxLength: 2000,
      fieldName: 'Dispute reason',
    });
    if (cleanReason.length < 5) {
      throw new ValidationError('Dispute reason must be at least 5 characters.');
    }

    assertValidTradeTransition(trade, 'DISPUTED', { isStaff: access.roles.isStaff });

    const evidence = [];
    if (evidenceRef || evidenceUrl) {
      evidence.push({
        evidenceId: `ev_${randomUUID().slice(0, 8)}`,
        submittedBy: actorId,
        reference: sanitizeUserText(evidenceRef || 'Attached evidence URL', {
          maxLength: 500,
          fieldName: 'Evidence reference',
        }),
        url: evidenceUrl ? validateSafeEvidenceUrl(evidenceUrl) : null,
        description: '',
        restrictedToStaff: true,
        submittedAt: new Date(),
      });
    }

    const disputeId = generateDisputeId();
    const now = new Date();

    const result = await withTransaction(async (session) => {
      const dispute = await this.disputeRepo.create(
        {
          disputeId,
          serverId,
          tradeId,
          reporterId: actorId,
          reason: cleanReason,
          evidence,
          status: 'OPEN',
        },
        session,
      );

      const frozenTrade = await this.tradeRepo.atomicUpdate(
        tradeId,
        {
          expectedVersion: trade.version,
          expectedStates: [trade.state],
          set: {
            preDisputeState: trade.state,
            state: 'DISPUTED',
            activeDisputeId: disputeId,
          },
          push: {
            disputeIds: disputeId,
            stateHistory: {
              fromState: trade.state,
              toState: 'DISPUTED',
              actorId,
              reason: `Dispute ${disputeId} opened: ${cleanReason.slice(0, 200)}`,
              correlationId: correlationId || null,
              timestamp: now,
            },
          },
        },
        session,
      );

      if (!frozenTrade) {
        throw new ConflictError('Trade changed concurrently while freezing for dispute. Please retry.');
      }

      await this.userRepo.incrementStats(trade.traderAId, { disputed: 1 }, session);
      await this.userRepo.incrementStats(trade.traderBId, { disputed: 1 }, session);

      await this.auditService.record({
        serverId,
        actorId,
        actorType: access.roles.isStaff ? 'STAFF' : 'USER',
        action: 'DISPUTE_OPENED',
        targetType: 'DISPUTE',
        targetId: disputeId,
        beforeState: { tradeId, state: trade.state },
        afterState: { tradeId, state: 'DISPUTED', disputeId },
        metadata: { reasonLength: cleanReason.length, evidenceCount: evidence.length },
        correlationId,
        session,
      });

      return { dispute, trade: frozenTrade };
    });

    // Attempt to open an associated private DISPUTE ticket if ticketService is wired
    if (this.ticketService) {
      try {
        const ticket = await this.ticketService.openTicket({
          serverId,
          creatorId: actorId,
          type: 'DISPUTE',
          subject: `Dispute ${disputeId} — Trade ${tradeId}`,
          description: cleanReason,
          tradeId,
          additionalParticipantIds: [trade.traderAId, trade.traderBId],
          correlationId,
        });
        await this.disputeRepo.updateDispute(disputeId, {
          set: { ticketId: ticket.ticketId },
        });
        result.dispute.ticketId = ticket.ticketId;
      } catch {
        // Non-fatal: the trade remains strictly FROZEN in DISPUTED state even if private channel creation fails!
      }
    }

    return result;
  }

  /**
   * Resolves an active dispute (`/resolve`) — restricted to authorized Moderators/Admins
   * with no conflict of interest in the trade.
   *
   * Supported outcomes:
   * - `RESUME_TRADE`: Unfreezes trade back to `trade.preDisputeState`
   * - `CANCEL_TRADE`: Terminates trade as `CANCELLED`
   */
  async resolveDispute({
    serverId,
    disputeIdOrTradeId,
    outcome,
    decisionSummary,
    actorId,
    confirm = false,
    correlationId,
  }) {
    if (!confirm) {
      throw new ValidationError(
        'Resolving a dispute is a sensitive staff action. Pass `confirm=yes` to confirm your documented decision.',
      );
    }

    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    await this.permissionsApi.assertAuthorized({
      serverId,
      userId: actorId,
      serverConfig: cfg,
      requiredRole: 'moderator',
    });

    let dispute = await this.disputeRepo.findByDisputeId(disputeIdOrTradeId);
    if (!dispute) {
      dispute = await this.disputeRepo.findActiveByTradeId(disputeIdOrTradeId);
    }
    if (!dispute || dispute.serverId !== serverId) {
      throw new NotFoundError(`Active dispute \`${disputeIdOrTradeId}\` was not found.`);
    }

    if (!['OPEN', 'UNDER_REVIEW', 'ESCALATED'].includes(dispute.status)) {
      throw new ValidationError(`Dispute \`${dispute.disputeId}\` is already resolved (\`${dispute.status}\`).`);
    }

    const trade = await this.tradeRepo.findByTradeId(dispute.tradeId);
    if (!trade) {
      throw new NotFoundError(`Associated trade \`${dispute.tradeId}\` was not found.`);
    }

    this.antiScam.assertNoConflictOfInterest(trade, actorId, 'resolve dispute for');

    const normalizedOutcome = String(outcome || '').trim().toUpperCase();
    if (!['RESUME_TRADE', 'CANCEL_TRADE'].includes(normalizedOutcome)) {
      throw new ValidationError('Resolution outcome must be either `RESUME_TRADE` or `CANCEL_TRADE`.');
    }

    const cleanDecision = sanitizeUserText(decisionSummary || '', {
      maxLength: 2000,
      fieldName: 'Resolution decision',
    });
    if (cleanDecision.length < 10) {
      throw new ValidationError(
        'Dispute resolution requires a documented decision summary of at least 10 characters.',
      );
    }

    const targetTradeState =
      normalizedOutcome === 'RESUME_TRADE'
        ? trade.preDisputeState || 'WAITING_FOR_MIDDLEMAN'
        : 'CANCELLED';

    assertValidTradeTransition(trade, targetTradeState, { isStaff: true });

    const disputeStatus =
      normalizedOutcome === 'RESUME_TRADE' ? 'RESOLVED_RESUME' : 'RESOLVED_CANCELLED';
    const now = new Date();

    return withTransaction(async (session) => {
      const updatedDispute = await this.disputeRepo.updateDispute(
        dispute.disputeId,
        {
          set: {
            status: disputeStatus,
            assignedReviewerId: dispute.assignedReviewerId || actorId,
            resolution: {
              outcome: normalizedOutcome,
              decisionSummary: cleanDecision,
              decidedBy: actorId,
              decidedAt: now,
            },
          },
        },
        session,
      );

      const tradeSet = {
        state: targetTradeState,
        activeDisputeId: null,
        preDisputeState: null,
      };
      if (targetTradeState === 'CANCELLED') {
        tradeSet.cancellationRecord = {
          cancelledAt: now,
          cancelledBy: actorId,
          reason: `Cancelled via dispute ${dispute.disputeId}: ${cleanDecision.slice(0, 300)}`,
        };
      }

      const updatedTrade = await this.tradeRepo.atomicUpdate(
        trade.tradeId,
        {
          expectedVersion: trade.version,
          expectedStates: ['DISPUTED', 'UNDER_REVIEW'],
          set: tradeSet,
          push: {
            stateHistory: {
              fromState: trade.state,
              toState: targetTradeState,
              actorId,
              reason: `Dispute ${dispute.disputeId} resolved (${normalizedOutcome})`,
              correlationId: correlationId || null,
              timestamp: now,
            },
          },
        },
        session,
      );

      if (!updatedTrade) {
        throw new ConflictError('Trade changed concurrently while resolving dispute.');
      }

      if (targetTradeState === 'CANCELLED') {
        await this.userRepo.incrementStats(trade.traderAId, { cancelled: 1 }, session);
        await this.userRepo.incrementStats(trade.traderBId, { cancelled: 1 }, session);
        if (trade.assignedMiddlemanId) {
          await this.userRepo.incrementStats(
            trade.assignedMiddlemanId,
            { activeMiddlemanLoad: -1 },
            session,
          );
        }
      }

      await this.auditService.record({
        serverId,
        actorId,
        actorType: 'STAFF',
        action: 'DISPUTE_RESOLVED',
        targetType: 'DISPUTE',
        targetId: dispute.disputeId,
        beforeState: { status: dispute.status, tradeState: trade.state },
        afterState: { status: disputeStatus, tradeState: targetTradeState, outcome: normalizedOutcome },
        metadata: { tradeId: trade.tradeId, decisionSummary: cleanDecision },
        correlationId,
        session,
      });

      return { dispute: updatedDispute, trade: updatedTrade };
    });
  }
}
