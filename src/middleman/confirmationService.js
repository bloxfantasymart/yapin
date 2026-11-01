import { withTransaction } from '../database/connection.js';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';
import { assertValidTradeTransition } from './tradeStateMachine.js';

/**
 * Handles participant invitation acceptance, rejection, details confirmation,
 * middleman confirmation, and final release confirmation.
 *
 * Security Invariants:
 * - Neither trader can ever accept or confirm on behalf of the other (`resolveSide` matches strict Yapin User ID).
 * - Confirmations are stage-gated so traders cannot pre-confirm a middleman or final release before reaching that stage.
 */
export class ConfirmationService {
  /**
   * @param {{
   *   tradeRepo: import('../database/repositories/tradeRepository.js').MongooseTradeRepository,
   *   userRepo: import('../database/repositories/userRepository.js').MongooseUserRepository,
   *   auditService: import('./auditService.js').AuditService,
   *   assignmentService?: import('./assignmentService.js').AssignmentService | null,
   *   serverConfigRepo: import('../database/repositories/auditConfigRepository.js').MongooseServerConfigRepository,
   * }} deps
   */
  constructor({ tradeRepo, userRepo, auditService, assignmentService = null, serverConfigRepo }) {
    this.tradeRepo = tradeRepo;
    this.userRepo = userRepo;
    this.auditService = auditService;
    this.assignmentService = assignmentService;
    this.serverConfigRepo = serverConfigRepo;
  }

  setAssignmentService(assignmentService) {
    this.assignmentService = assignmentService;
  }

  resolveParticipantSide(trade, userId) {
    const uid = String(userId);
    if (String(trade.traderAId) === uid) return 'traderA';
    if (String(trade.traderBId) === uid) return 'traderB';
    return null;
  }

  /**
   * Accepts a pending trade invitation and confirms initial trade terms (`WAITING_FOR_PARTICIPANTS`).
   * Automatically advances to `WAITING_FOR_MIDDLEMAN` once BOTH traders have accepted and confirmed details,
   * and triggers optional auto-assignment if enabled in `ServerConfig`.
   */
  async acceptTrade({ serverId, tradeId, actorId, correlationId }) {
    const trade = await this.tradeRepo.findByTradeId(tradeId);
    if (!trade || trade.serverId !== serverId) {
      throw new NotFoundError(`Trade \`${tradeId}\` was not found in this server.`);
    }

    const side = this.resolveParticipantSide(trade, actorId);
    if (!side) {
      throw new AuthorizationError('Only invited trade participants can accept this trade.');
    }

    if (trade.state !== 'WAITING_FOR_PARTICIPANTS') {
      throw new ValidationError(
        `Trade \`${tradeId}\` is currently in state \`${trade.state}\` and is not awaiting participant acceptance.`,
      );
    }

    const now = new Date();
    const updatedConfirmations = structuredClone(trade.confirmations);
    updatedConfirmations[side].acceptedInvite = true;
    updatedConfirmations[side].acceptedInviteAt = now;
    updatedConfirmations[side].detailsConfirmed = true;
    updatedConfirmations[side].detailsConfirmedAt = now;

    const bothReady =
      updatedConfirmations.traderA.acceptedInvite &&
      updatedConfirmations.traderA.detailsConfirmed &&
      updatedConfirmations.traderB.acceptedInvite &&
      updatedConfirmations.traderB.detailsConfirmed;

    let nextState = trade.state;
    const pushOps = {};

    if (bothReady) {
      nextState = 'WAITING_FOR_MIDDLEMAN';
      assertValidTradeTransition(
        { ...trade, confirmations: updatedConfirmations },
        nextState,
      );
      pushOps.stateHistory = {
        fromState: trade.state,
        toState: nextState,
        actorId,
        reason: 'Both participants accepted and confirmed trade terms',
        correlationId: correlationId || null,
        timestamp: now,
      };
    }

    const updated = await withTransaction(async (session) => {
      const saved = await this.tradeRepo.atomicUpdate(
        tradeId,
        {
          expectedVersion: trade.version,
          expectedStates: ['WAITING_FOR_PARTICIPANTS'],
          set: {
            [`confirmations.${side}`]: updatedConfirmations[side],
            state: nextState,
          },
          push: pushOps,
        },
        session,
      );

      if (!saved) {
        throw new ConflictError('Trade was updated concurrently. Please retry `/accept`.');
      }

      const audit = await this.auditService.record({
        serverId,
        actorId,
        actorType: 'USER',
        action: bothReady ? 'TRADE_PARTICIPANTS_CONFIRMED' : 'TRADE_INVITE_ACCEPTED',
        targetType: 'TRADE',
        targetId: tradeId,
        beforeState: { state: trade.state, side },
        afterState: { state: saved.state, side, bothReady },
        correlationId,
        session,
      });

      await this.tradeRepo.atomicUpdate(
        tradeId,
        {
          expectedVersion: saved.version,
          set: {},
          push: { auditLogIds: audit.auditId },
        },
        session,
      );

      return saved;
    });

    // Optional automatic middleman assignment if enabled in ServerConfig
    if (bothReady && this.assignmentService) {
      const cfg = await this.serverConfigRepo.getOrCreate(serverId);
      if (cfg?.tradeLimits?.autoAssignMiddleman) {
        const autoResult = await this.assignmentService
          .tryAutoAssign({ serverId, tradeId, correlationId })
          .catch(() => null);
        if (autoResult) return autoResult;
      }
    }

    return this.tradeRepo.findByTradeId(tradeId) || updated;
  }

  /**
   * Rejects a pending trade invitation (`WAITING_FOR_PARTICIPANTS -> REJECTED`).
   */
  async rejectTrade({ serverId, tradeId, actorId, reason = 'Declined trade invitation', correlationId }) {
    const trade = await this.tradeRepo.findByTradeId(tradeId);
    if (!trade || trade.serverId !== serverId) {
      throw new NotFoundError(`Trade \`${tradeId}\` was not found in this server.`);
    }

    const side = this.resolveParticipantSide(trade, actorId);
    if (!side) {
      throw new AuthorizationError('Only a trade participant can reject this trade invitation.');
    }

    assertValidTradeTransition(trade, 'REJECTED');
    const now = new Date();

    return withTransaction(async (session) => {
      const saved = await this.tradeRepo.atomicUpdate(
        tradeId,
        {
          expectedVersion: trade.version,
          expectedStates: ['WAITING_FOR_PARTICIPANTS'],
          set: {
            state: 'REJECTED',
            cancellationRecord: {
              cancelledAt: now,
              cancelledBy: actorId,
              reason: String(reason).slice(0, 500),
            },
          },
          push: {
            stateHistory: {
              fromState: trade.state,
              toState: 'REJECTED',
              actorId,
              reason: String(reason).slice(0, 500),
              correlationId: correlationId || null,
              timestamp: now,
            },
          },
        },
        session,
      );

      if (!saved) {
        throw new ConflictError('Trade state changed concurrently; could not reject.');
      }

      await this.userRepo.incrementStats(actorId, { rejected: 1 }, session);

      await this.auditService.record({
        serverId,
        actorId,
        actorType: 'USER',
        action: 'TRADE_REJECTED',
        targetType: 'TRADE',
        targetId: tradeId,
        beforeState: { state: trade.state },
        afterState: { state: 'REJECTED', reason },
        correlationId,
        session,
      });

      return saved;
    });
  }

  /**
   * Submits a stage-appropriate participant confirmation (`/confirm` or `/release` or button click):
   * - In `WAITING_FOR_PARTICIPANTS`: delegates to `acceptTrade` (details confirmation).
   * - In `MIDDLEMAN_ASSIGNED`: confirms the assigned middleman (`middlemanConfirmed`); once both confirm,
   *   transitions `MIDDLEMAN_ASSIGNED -> WAITING_FOR_DEPOSITS`.
   * - In `WAITING_FOR_FINAL_CONFIRMATION`: records `finalReleaseConfirmed` (never completes the trade alone —
   *   staff `/complete` is still required!).
   */
  async submitParticipantConfirmation({ serverId, tradeId, actorId, stageHint = null, correlationId }) {
    const trade = await this.tradeRepo.findByTradeId(tradeId);
    if (!trade || trade.serverId !== serverId) {
      throw new NotFoundError(`Trade \`${tradeId}\` was not found in this server.`);
    }

    const side = this.resolveParticipantSide(trade, actorId);
    if (!side) {
      throw new AuthorizationError('Only Trader A or Trader B may submit participant confirmations.');
    }

    if (trade.state === 'DISPUTED' || trade.state === 'UNDER_REVIEW') {
      throw new ValidationError(
        `Trade \`${tradeId}\` is currently \`${trade.state}\` and frozen pending staff review.`,
      );
    }

    if (trade.state === 'WAITING_FOR_PARTICIPANTS') {
      if (stageHint && stageHint !== 'details') {
        throw new ValidationError('Trade must first be accepted by both participants before later confirmations.');
      }
      return this.acceptTrade({ serverId, tradeId, actorId, correlationId });
    }

    const now = new Date();

    if (trade.state === 'MIDDLEMAN_ASSIGNED') {
      if (stageHint && stageHint === 'release') {
        throw new ValidationError(
          'Cannot submit final release confirmation before deposits are verified (`WAITING_FOR_FINAL_CONFIRMATION`).',
        );
      }

      const nextConfirmations = structuredClone(trade.confirmations);
      nextConfirmations[side].middlemanConfirmed = true;
      nextConfirmations[side].middlemanConfirmedAt = now;

      const bothConfirmedMm =
        nextConfirmations.traderA.middlemanConfirmed &&
        nextConfirmations.traderB.middlemanConfirmed;

      const nextState = bothConfirmedMm ? 'WAITING_FOR_DEPOSITS' : 'MIDDLEMAN_ASSIGNED';
      const pushOps = {};

      if (bothConfirmedMm) {
        assertValidTradeTransition({ ...trade, confirmations: nextConfirmations }, nextState);
        pushOps.stateHistory = {
          fromState: trade.state,
          toState: nextState,
          actorId,
          reason: 'Both participants confirmed the assigned middleman',
          correlationId: correlationId || null,
          timestamp: now,
        };
      }

      return withTransaction(async (session) => {
        const saved = await this.tradeRepo.atomicUpdate(
          tradeId,
          {
            expectedVersion: trade.version,
            expectedStates: ['MIDDLEMAN_ASSIGNED'],
            set: {
              [`confirmations.${side}`]: nextConfirmations[side],
              state: nextState,
            },
            push: pushOps,
          },
          session,
        );

        if (!saved) {
          throw new ConflictError('Trade changed concurrently; please retry confirmation.');
        }

        await this.auditService.record({
          serverId,
          actorId,
          actorType: 'USER',
          action: bothConfirmedMm ? 'MIDDLEMAN_CONFIRMED_ALL' : 'MIDDLEMAN_CONFIRMED_PARTICIPANT',
          targetType: 'TRADE',
          targetId: tradeId,
          beforeState: { state: trade.state },
          afterState: { state: saved.state, side, middlemanId: trade.assignedMiddlemanId },
          correlationId,
          session,
        });

        return saved;
      });
    }

    if (trade.state === 'WAITING_FOR_FINAL_CONFIRMATION') {
      const nextConfirmations = structuredClone(trade.confirmations);
      nextConfirmations[side].finalReleaseConfirmed = true;
      nextConfirmations[side].finalReleaseConfirmedAt = now;

      const bothFinal =
        nextConfirmations.traderA.finalReleaseConfirmed &&
        nextConfirmations.traderB.finalReleaseConfirmed;

      return withTransaction(async (session) => {
        const saved = await this.tradeRepo.atomicUpdate(
          tradeId,
          {
            expectedVersion: trade.version,
            expectedStates: ['WAITING_FOR_FINAL_CONFIRMATION'],
            set: {
              [`confirmations.${side}`]: nextConfirmations[side],
            },
          },
          session,
        );

        if (!saved) {
          throw new ConflictError('Trade changed concurrently; please retry release confirmation.');
        }

        await this.auditService.record({
          serverId,
          actorId,
          actorType: 'USER',
          action: 'FINAL_RELEASE_CONFIRMED_PARTICIPANT',
          targetType: 'TRADE',
          targetId: tradeId,
          beforeState: { state: trade.state, side },
          afterState: { state: saved.state, side, bothParticipantsReadyForStaffCompletion: bothFinal },
          correlationId,
          session,
        });

        return saved;
      });
    }

    throw new ValidationError(
      `No participant confirmation is open during state \`${trade.state}\`.`,
    );
  }
}
