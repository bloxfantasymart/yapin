import { withTransaction } from '../database/connection.js';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../utils/errors.js';
import { sanitizeUserText, validateSafeEvidenceUrl } from '../security/sanitizer.js';
import { assertValidTradeTransition } from './tradeStateMachine.js';

/**
 * Deposit Reporting & Staff Verification Service.
 *
 * Security Invariants (Requirement 4):
 * - A trader reporting a deposit (`/deposit`) ONLY sets their deposit status to `REPORTED_SENT` —
 *   NEVER `CONFIRMED`!
 * - Only an authorized, conflict-free Middleman or Admin can verify a deposit (`CONFIRMED`, `REJECTED`,
 *   `UNDER_REVIEW`, or `NOT_REQUIRED`).
 * - This bot does NOT hold custody, wallets, or automated escrow; it records references & staff verification.
 */
export class DepositService {
  /**
   * @param {{
   *   tradeRepo: import('../database/repositories/tradeRepository.js').MongooseTradeRepository,
   *   serverConfigRepo: import('../database/repositories/auditConfigRepository.js').MongooseServerConfigRepository,
   *   permissionsApi: import('../api/permissions.js').YapinPermissionsApi,
   *   antiScam: import('../security/antiScam.js').AntiScamService,
   *   auditService: import('./auditService.js').AuditService,
   * }} deps
   */
  constructor({ tradeRepo, serverConfigRepo, permissionsApi, antiScam, auditService }) {
    this.tradeRepo = tradeRepo;
    this.serverConfigRepo = serverConfigRepo;
    this.permissionsApi = permissionsApi;
    this.antiScam = antiScam;
    this.auditService = auditService;
  }

  /**
   * Allows a participant to submit a deposit report with transaction/delivery reference and optional HTTPS proof URL.
   * Sets status strictly to `REPORTED_SENT` (never `CONFIRMED`).
   */
  async reportDeposit({
    serverId,
    tradeId,
    actorId,
    reference,
    evidenceUrl = null,
    notes = '',
    correlationId,
  }) {
    const trade = await this.tradeRepo.findByTradeId(tradeId);
    if (!trade || trade.serverId !== serverId) {
      throw new NotFoundError(`Trade \`${tradeId}\` was not found in this server.`);
    }

    const side =
      String(trade.traderAId) === String(actorId)
        ? 'traderA'
        : String(trade.traderBId) === String(actorId)
          ? 'traderB'
          : null;

    if (!side) {
      throw new AuthorizationError('Only Trader A or Trader B may report a deposit on this trade.');
    }

    if (!['WAITING_FOR_DEPOSITS', 'DEPOSIT_CONFIRMATION'].includes(trade.state)) {
      throw new ValidationError(
        `Deposits cannot be reported while trade is in state \`${trade.state}\`. Wait until the assigned middleman is confirmed by both traders.`,
      );
    }

    const currentDep = trade.deposits[side];
    if (currentDep.status === 'CONFIRMED' || currentDep.status === 'NOT_REQUIRED') {
      throw new ValidationError(
        `Your deposit is already marked \`${currentDep.status}\` and cannot be overwritten.`,
      );
    }

    const cleanRef = sanitizeUserText(reference || '', {
      maxLength: 500,
      fieldName: 'Deposit reference',
      allowNewlines: false,
    });
    if (cleanRef.length < 3) {
      throw new ValidationError(
        'Deposit report requires a transaction ID, item transfer reference, or delivery proof (at least 3 characters).',
      );
    }

    const cleanNotes = sanitizeUserText(notes || '', {
      maxLength: 1000,
      fieldName: 'Deposit notes',
    });

    const evidenceUrls = [];
    if (evidenceUrl) {
      evidenceUrls.push(validateSafeEvidenceUrl(evidenceUrl));
    }

    const now = new Date();
    const updatedDeposit = {
      status: 'REPORTED_SENT',
      reference: cleanRef,
      evidenceUrls,
      notes: cleanNotes,
      reportedAt: now,
      verifiedBy: null,
      verifiedAt: null,
      verificationNotes: null,
    };

    // Move WAITING_FOR_DEPOSITS -> DEPOSIT_CONFIRMATION once required deposits are reported/confirmed
    const otherSide = side === 'traderA' ? 'traderB' : 'traderA';
    const otherStatus = trade.deposits[otherSide].status;
    const bothSubmittedOrConfirmed = ['REPORTED_SENT', 'CONFIRMED', 'NOT_REQUIRED', 'UNDER_REVIEW'].includes(
      otherStatus,
    );

    let nextState = trade.state;
    const pushOps = {};
    if (trade.state === 'WAITING_FOR_DEPOSITS' && bothSubmittedOrConfirmed) {
      nextState = 'DEPOSIT_CONFIRMATION';
      assertValidTradeTransition(trade, nextState);
      pushOps.stateHistory = {
        fromState: trade.state,
        toState: nextState,
        actorId,
        reason: 'Participant deposits reported; awaiting staff verification',
        correlationId: correlationId || null,
        timestamp: now,
      };
    }

    return withTransaction(async (session) => {
      const saved = await this.tradeRepo.atomicUpdate(
        tradeId,
        {
          expectedVersion: trade.version,
          expectedStates: ['WAITING_FOR_DEPOSITS', 'DEPOSIT_CONFIRMATION'],
          set: {
            [`deposits.${side}`]: updatedDeposit,
            state: nextState,
          },
          push: pushOps,
        },
        session,
      );

      if (!saved) {
        throw new ConflictError('Trade changed concurrently while reporting deposit. Please retry.');
      }

      await this.auditService.record({
        serverId,
        actorId,
        actorType: 'USER',
        action: 'DEPOSIT_REPORTED',
        targetType: 'TRADE',
        targetId: tradeId,
        beforeState: { state: trade.state, depositStatus: currentDep.status },
        afterState: { state: saved.state, side, depositStatus: 'REPORTED_SENT' },
        metadata: { hasEvidenceUrl: evidenceUrls.length > 0 },
        correlationId,
        session,
      });

      return saved;
    });
  }

  /**
   * Staff-only verification of a trader's deposit (`/verifydeposit`).
   * Allowed decisions: `'CONFIRMED' | 'REJECTED' | 'UNDER_REVIEW' | 'NOT_REQUIRED'`.
   * Automatically advances to `WAITING_FOR_FINAL_CONFIRMATION` once both deposits are `CONFIRMED` or `NOT_REQUIRED`.
   */
  async verifyDeposit({
    serverId,
    tradeId,
    traderSideOrUserId,
    decision,
    notes = '',
    actorId,
    correlationId,
  }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    const access = await this.permissionsApi.assertAuthorized({
      serverId,
      userId: actorId,
      serverConfig: cfg,
      requiredRole: 'middleman',
    });

    const trade = await this.tradeRepo.findByTradeId(tradeId);
    if (!trade || trade.serverId !== serverId) {
      throw new NotFoundError(`Trade \`${tradeId}\` was not found in this server.`);
    }

    // Conflict-of-interest check: staff cannot verify deposits in their own trade!
    this.antiScam.assertNoConflictOfInterest(trade, actorId, 'verify deposits for');

    // Only the assigned middleman or a server Admin can verify deposits
    if (!access.roles.isAdmin && trade.assignedMiddlemanId !== actorId) {
      throw new AuthorizationError(
        `Only the assigned middleman (<@${trade.assignedMiddlemanId}>) or a server Admin can verify deposits for trade \`${tradeId}\`.`,
      );
    }

    if (!['WAITING_FOR_DEPOSITS', 'DEPOSIT_CONFIRMATION'].includes(trade.state)) {
      throw new ValidationError(
        `Deposits cannot be verified while trade is in state \`${trade.state}\`.`,
      );
    }

    const normalizedSideInput = String(traderSideOrUserId || '').trim().toLowerCase();
    let side = null;
    if (['a', 'tradera', 'trader_a'].includes(normalizedSideInput) || traderSideOrUserId === trade.traderAId) {
      side = 'traderA';
    } else if (
      ['b', 'traderb', 'trader_b'].includes(normalizedSideInput) ||
      traderSideOrUserId === trade.traderBId
    ) {
      side = 'traderB';
    }
    if (!side) {
      throw new ValidationError(
        'Specify which trader deposit to verify (`trader=A`, `trader=B`, or the trader\'s Yapin User ID).',
      );
    }

    const upperDecision = String(decision || '').trim().toUpperCase();
    if (!['CONFIRMED', 'REJECTED', 'UNDER_REVIEW', 'NOT_REQUIRED'].includes(upperDecision)) {
      throw new ValidationError(
        'Deposit verification status must be one of: CONFIRMED, REJECTED, UNDER_REVIEW, NOT_REQUIRED.',
      );
    }

    const currentDep = trade.deposits[side];
    if (upperDecision === 'CONFIRMED' && currentDep.status !== 'REPORTED_SENT' && currentDep.status !== 'UNDER_REVIEW') {
      throw new ValidationError(
        `Cannot mark ${side} deposit CONFIRMED when its status is \`${currentDep.status}\` (trader must report sending it first, or mark NOT_REQUIRED if no asset is due).`,
      );
    }

    const cleanNotes = sanitizeUserText(notes || '', {
      maxLength: 1000,
      fieldName: 'Verification notes',
    });

    const now = new Date();
    const nextDeposits = structuredClone(trade.deposits);
    nextDeposits[side] = {
      ...currentDep,
      status: upperDecision,
      verifiedBy: actorId,
      verifiedAt: now,
      verificationNotes: cleanNotes || null,
    };

    const depA = nextDeposits.traderA.status;
    const depB = nextDeposits.traderB.status;
    const bothVerified =
      ['CONFIRMED', 'NOT_REQUIRED'].includes(depA) && ['CONFIRMED', 'NOT_REQUIRED'].includes(depB);

    let nextState = trade.state;
    if (bothVerified) {
      nextState = 'WAITING_FOR_FINAL_CONFIRMATION';
    } else if (upperDecision === 'REJECTED') {
      nextState = 'WAITING_FOR_DEPOSITS';
    } else if (trade.state === 'WAITING_FOR_DEPOSITS' && upperDecision === 'UNDER_REVIEW') {
      nextState = 'DEPOSIT_CONFIRMATION';
    }

    const pushOps = {};
    if (nextState !== trade.state) {
      assertValidTradeTransition({ ...trade, deposits: nextDeposits }, nextState);
      pushOps.stateHistory = {
        fromState: trade.state,
        toState: nextState,
        actorId,
        reason: `Deposit ${side} marked ${upperDecision}`,
        correlationId: correlationId || null,
        timestamp: now,
      };
    }

    return withTransaction(async (session) => {
      const saved = await this.tradeRepo.atomicUpdate(
        tradeId,
        {
          expectedVersion: trade.version,
          expectedStates: ['WAITING_FOR_DEPOSITS', 'DEPOSIT_CONFIRMATION'],
          set: {
            [`deposits.${side}`]: nextDeposits[side],
            state: nextState,
          },
          push: pushOps,
        },
        session,
      );

      if (!saved) {
        throw new ConflictError('Trade changed concurrently during deposit verification.');
      }

      await this.auditService.record({
        serverId,
        actorId,
        actorType: 'STAFF',
        action: 'DEPOSIT_VERIFIED',
        targetType: 'TRADE',
        targetId: tradeId,
        beforeState: { state: trade.state, side, depositStatus: currentDep.status },
        afterState: { state: saved.state, side, depositStatus: upperDecision },
        metadata: { verificationNotes: cleanNotes },
        correlationId,
        session,
      });

      return saved;
    });
  }
}
