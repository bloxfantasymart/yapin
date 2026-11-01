import { z } from 'zod';
import { withTransaction } from '../database/connection.js';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../utils/errors.js';
import { generateTradeId, isValidYapinId } from '../utils/ids.js';
import { computeTradeFingerprint } from '../security/antiScam.js';
import { containsSpoofedSystemBanner, sanitizeUserText } from '../security/sanitizer.js';
import { IdempotencyGuard } from '../security/idempotency.js';
import {
  assertValidTradeTransition,
  canParticipantSelfCancel,
  isTerminalTradeState,
} from './tradeStateMachine.js';

const CreateTradeInputSchema = z.object({
  serverId: z.string().min(1),
  channelId: z.string().min(1),
  createdBy: z.string().refine(isValidYapinId, 'Invalid creator Yapin user ID'),
  traderAId: z.string().refine(isValidYapinId, 'Invalid Trader A Yapin user ID'),
  traderBId: z.string().refine(isValidYapinId, 'Invalid Trader B Yapin user ID'),
  primaryAsset: z.string().min(2, 'Item/asset description must be at least 2 characters').max(300),
  traderAGiving: z.string().min(2, 'Specify what Trader A is giving').max(500),
  traderBGiving: z.string().min(2, 'Specify what Trader B is giving').max(500),
  cashAmount: z.number().min(0).max(1_000_000_000).default(0),
  cashCurrency: z.string().trim().min(1).max(16).default('USD'),
  cashPayer: z.enum(['NONE', 'TRADER_A', 'TRADER_B']).default('NONE'),
  notes: z.string().max(1000).default(''),
  preferredMiddlemanId: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v || null),
  rulesAccepted: z.literal(true, {
    errorMap: () => ({
      message: 'You must explicitly agree to the server trading rules (`rules=yes`) before creating a trade.',
    }),
  }),
});

/**
 * Core Middleman Trade Orchestration Service.
 *
 * Implements:
 * - Validated trade creation (`CREATED -> WAITING_FOR_PARTICIPANTS`)
 * - Duplicate request prevention (`dedupeFingerprint`), active limit checks, suspension checks
 * - Participant cancellation (`/cancel`) & Staff cancellation (`/canceltrade`)
 * - Staff review with restricted evidence disclosure (`/review`)
 * - 8-step verified trade completion (`/complete`) with atomic CAS concurrency protection
 * - Explicit audited stale-trade expiration sweep (never silent MongoDB TTL deletion!)
 */
export class TradeService {
  /**
   * @param {{
   *   tradeRepo: import('../database/repositories/tradeRepository.js').MongooseTradeRepository,
   *   userRepo: import('../database/repositories/userRepository.js').MongooseUserRepository,
   *   disputeRepo: import('../database/repositories/ticketDisputeRepository.js').MongooseDisputeRepository,
   *   serverConfigRepo: import('../database/repositories/auditConfigRepository.js').MongooseServerConfigRepository,
   *   permissionsApi: import('../api/permissions.js').YapinPermissionsApi,
   *   antiScam: import('../security/antiScam.js').AntiScamService,
   *   auditService: import('./auditService.js').AuditService,
   *   idempotencyGuard?: IdempotencyGuard,
   * }} deps
   */
  constructor({
    tradeRepo,
    userRepo,
    disputeRepo,
    serverConfigRepo,
    permissionsApi,
    antiScam,
    auditService,
    idempotencyGuard,
  }) {
    this.tradeRepo = tradeRepo;
    this.userRepo = userRepo;
    this.disputeRepo = disputeRepo;
    this.serverConfigRepo = serverConfigRepo;
    this.permissionsApi = permissionsApi;
    this.antiScam = antiScam;
    this.auditService = auditService;
    this.idempotencyGuard = idempotencyGuard || new IdempotencyGuard();
  }

  /**
   * Creates a new Middleman Trade Request, validates both participants against Yapin's server member list,
   * records `CREATED` and transitions immediately to `WAITING_FOR_PARTICIPANTS`.
   */
  async createTrade(rawInput, { correlationId } = {}) {
    const parsed = CreateTradeInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid trade creation parameters.');
    }
    const input = parsed.data;

    // Creator must be one of the two participants (prevents unauthorized third parties opening trades for strangers)
    if (input.createdBy !== input.traderAId && input.createdBy !== input.traderBId) {
      throw new AuthorizationError('Trade creator must be either Trader A or Trader B.');
    }

    if (input.preferredMiddlemanId && !isValidYapinId(input.preferredMiddlemanId)) {
      throw new ValidationError('Invalid preferred middleman Yapin user ID.');
    }

    const cfg = await this.serverConfigRepo.getOrCreate(input.serverId);
    if (cfg?.features?.tradesEnabled === false) {
      throw new ValidationError('Middleman trade requests are currently paused by server staff.');
    }

    // Sanitize all user text fields & check for spoofed system banners
    const primaryAsset = sanitizeUserText(input.primaryAsset, {
      maxLength: 300,
      fieldName: 'Item/Asset',
      allowNewlines: false,
    });
    const traderAGiving = sanitizeUserText(input.traderAGiving, {
      maxLength: 500,
      fieldName: 'Trader A giving',
    });
    const traderBGiving = sanitizeUserText(input.traderBGiving, {
      maxLength: 500,
      fieldName: 'Trader B giving',
    });
    const notes = sanitizeUserText(input.notes || '', {
      maxLength: 1000,
      fieldName: 'Trade notes',
    });

    if (
      [primaryAsset, traderAGiving, traderBGiving, notes].some((field) =>
        containsSpoofedSystemBanner(field),
      )
    ) {
      await this.antiScam.emitSuspiciousAlert({
        serverId: input.serverId,
        serverConfig: cfg,
        title: 'Spoofed Verification Text Blocked',
        summary: `<@${input.createdBy}> attempted to create a trade containing fake system/staff verification text.`,
        metadata: { actorId: input.createdBy },
      });
      throw new ValidationError(
        'Trade text contains disallowed system/verification spoofing markers.',
      );
    }

    // Verify suspension & restriction status on both participants
    await Promise.all([
      this.antiScam.assertUserEligibleForTrade(input.serverId, input.traderAId, cfg),
      this.antiScam.assertUserEligibleForTrade(input.serverId, input.traderBId, cfg),
    ]);

    // Verify platform server membership & anti-impersonation checks
    const { warnings: impersonationWarnings } = await this.antiScam.verifyParticipantsIdentity({
      serverId: input.serverId,
      traderAId: input.traderAId,
      traderBId: input.traderBId,
      allowSelfTrade: Boolean(cfg?.tradeLimits?.allowSelfTrade),
      serverConfig: cfg,
    });

    if (impersonationWarnings.length > 0) {
      await this.antiScam.emitSuspiciousAlert({
        serverId: input.serverId,
        serverConfig: cfg,
        title: 'Duplicate Display Name Detected in Trade',
        summary: impersonationWarnings.join(' '),
        metadata: { traderAId: input.traderAId, traderBId: input.traderBId },
      });
    }

    // Enforce active trade count limit per participant
    const maxActive = cfg?.tradeLimits?.maxActiveTradesPerUser ?? 3;
    const [activeA, activeB] = await Promise.all([
      this.tradeRepo.countActiveForParticipant(input.serverId, input.traderAId),
      this.tradeRepo.countActiveForParticipant(input.serverId, input.traderBId),
    ]);
    if (activeA >= maxActive) {
      throw new ValidationError(
        `<@${input.traderAId}> already has ${activeA} active trades (limit: ${maxActive}).`,
      );
    }
    if (activeB >= maxActive) {
      throw new ValidationError(
        `<@${input.traderBId}> already has ${activeB} active trades (limit: ${maxActive}).`,
      );
    }

    const dedupeFingerprint = computeTradeFingerprint({
      serverId: input.serverId,
      traderAId: input.traderAId,
      traderBId: input.traderBId,
      primaryAsset,
      traderAGiving,
      traderBGiving,
    });

    const idempotencyKey = IdempotencyGuard.buildKey('trade:create', input.createdBy, [
      dedupeFingerprint,
    ]);

    const { result } = await this.idempotencyGuard.runOnce(
      { key: idempotencyKey, scope: 'trade:create', actorId: input.createdBy, ttlMs: 15_000 },
      async () => {
        const duplicate = await this.tradeRepo.findActiveDuplicate(
          input.serverId,
          dedupeFingerprint,
        );
        if (duplicate) {
          throw new ConflictError(
            `An identical active trade request already exists (\`${duplicate.tradeId}\` in state \`${duplicate.state}\`).`,
          );
        }

        const tradeId = generateTradeId();
        const now = new Date();
        const expHours = cfg?.tradeLimits?.tradeExpirationHours ?? 48;
        const expiresAt = new Date(now.getTime() + expHours * 3600 * 1000);
        const creatorIsA = input.createdBy === input.traderAId;

        return withTransaction(async (session) => {
          // Step 1: Create in initial CREATED state
          const initialDoc = await this.tradeRepo.create(
            {
              tradeId,
              serverId: input.serverId,
              channelId: input.channelId,
              traderAId: input.traderAId,
              traderBId: input.traderBId,
              createdBy: input.createdBy,
              dedupeFingerprint,
              items: {
                primaryAsset,
                traderAGiving,
                traderBGiving,
                cashComponent: {
                  amount: input.cashAmount,
                  currency: input.cashCurrency.toUpperCase(),
                  payer: input.cashAmount > 0 ? input.cashPayer : 'NONE',
                },
                notes,
              },
              preferredMiddlemanId: input.preferredMiddlemanId,
              rulesAccepted: true,
              state: 'CREATED',
              stateHistory: [
                {
                  fromState: null,
                  toState: 'CREATED',
                  actorId: input.createdBy,
                  reason: 'Trade request submitted',
                  correlationId: correlationId || null,
                  timestamp: now,
                },
              ],
              confirmations: {
                traderA: {
                  acceptedInvite: creatorIsA,
                  acceptedInviteAt: creatorIsA ? now : null,
                  detailsConfirmed: creatorIsA,
                  detailsConfirmedAt: creatorIsA ? now : null,
                },
                traderB: {
                  acceptedInvite: !creatorIsA,
                  acceptedInviteAt: !creatorIsA ? now : null,
                  detailsConfirmed: !creatorIsA,
                  detailsConfirmedAt: !creatorIsA ? now : null,
                },
              },
              deposits: {
                traderA: { status: 'PENDING' },
                traderB: { status: 'PENDING' },
              },
              expiresAt,
              version: 1,
            },
            session,
          );

          // Step 2: Explicit validated transition CREATED -> WAITING_FOR_PARTICIPANTS
          assertValidTradeTransition(initialDoc, 'WAITING_FOR_PARTICIPANTS');
          const waitingDoc = await this.tradeRepo.atomicUpdate(
            tradeId,
            {
              expectedVersion: initialDoc.version,
              expectedStates: ['CREATED'],
              set: { state: 'WAITING_FOR_PARTICIPANTS' },
              push: {
                stateHistory: {
                  fromState: 'CREATED',
                  toState: 'WAITING_FOR_PARTICIPANTS',
                  actorId: input.createdBy,
                  reason: 'Awaiting counterparty invitation acceptance and confirmation',
                  correlationId: correlationId || null,
                  timestamp: now,
                },
              },
            },
            session,
          );

          await this.userRepo.incrementStats(input.createdBy, { created: 1 }, session);
          await this.userRepo.getOrCreate(
            creatorIsA ? input.traderBId : input.traderAId,
            null,
            session,
          );

          const audit = await this.auditService.record({
            serverId: input.serverId,
            actorId: input.createdBy,
            actorType: 'USER',
            action: 'TRADE_CREATED',
            targetType: 'TRADE',
            targetId: tradeId,
            beforeState: null,
            afterState: {
              state: 'WAITING_FOR_PARTICIPANTS',
              traderAId: input.traderAId,
              traderBId: input.traderBId,
              primaryAsset,
            },
            correlationId,
            session,
          });

          const finalDoc = await this.tradeRepo.atomicUpdate(
            tradeId,
            {
              expectedVersion: waitingDoc.version,
              set: {},
              push: { auditLogIds: audit.auditId },
            },
            session,
          );

          return {
            trade: finalDoc || waitingDoc,
            impersonationWarnings,
          };
        });
      },
    );

    return result;
  }

  /**
   * Retrieves a trade for a participant or staff member.
   * Redacts private deposit verification notes / evidence URLs unless `viewerIsStaff === true`.
   */
  async getTradeForViewer({ serverId, tradeId, viewerId }) {
    const trade = await this.tradeRepo.findByTradeId(tradeId);
    if (!trade || trade.serverId !== serverId) {
      throw new NotFoundError(`Trade \`${tradeId}\` was not found in this server.`);
    }

    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    const access = await this.permissionsApi.resolveMemberAccess(serverId, viewerId, cfg);
    const isParticipant = trade.traderAId === viewerId || trade.traderBId === viewerId;

    if (!isParticipant && !access.roles.isStaff) {
      throw new AuthorizationError('Only trade participants or server staff can inspect this trade.');
    }

    if (access.roles.isStaff) {
      const activeDispute = trade.activeDisputeId
        ? await this.disputeRepo.findByDisputeId(trade.activeDisputeId)
        : null;
      return { trade, activeDispute, viewerIsStaff: true };
    }

    // Redact the OTHER trader's raw evidence URLs for privacy
    const sanitized = structuredClone(trade);
    const otherSide = trade.traderAId === viewerId ? 'traderB' : 'traderA';
    if (sanitized.deposits?.[otherSide]) {
      sanitized.deposits[otherSide].evidenceUrls = [];
    }
    return { trade: sanitized, activeDispute: null, viewerIsStaff: false };
  }

  /**
   * Cancels a trade by a participant (permitted ONLY before any deposit is reported/confirmed).
   */
  async cancelTradeByParticipant({ serverId, tradeId, actorId, reason = 'Cancelled by participant', correlationId }) {
    const trade = await this.tradeRepo.findByTradeId(tradeId);
    if (!trade || trade.serverId !== serverId) {
      throw new NotFoundError(`Trade \`${tradeId}\` was not found in this server.`);
    }

    if (trade.traderAId !== actorId && trade.traderBId !== actorId) {
      throw new AuthorizationError('Only Trader A or Trader B can cancel their trade request.');
    }

    if (!canParticipantSelfCancel(trade)) {
      throw new ValidationError(
        `Trade \`${tradeId}\` is in state \`${trade.state}\` (or has reported/confirmed deposits) and can no longer be self-cancelled. Open a \`/dispute\` or ask staff.`,
      );
    }

    assertValidTradeTransition(trade, 'CANCELLED');
    const cleanReason = sanitizeUserText(reason, { maxLength: 500, fieldName: 'Cancel reason' });
    const now = new Date();

    return withTransaction(async (session) => {
      const saved = await this.tradeRepo.atomicUpdate(
        tradeId,
        {
          expectedVersion: trade.version,
          expectedStates: [trade.state],
          set: {
            state: 'CANCELLED',
            cancellationRecord: {
              cancelledAt: now,
              cancelledBy: actorId,
              reason: cleanReason,
            },
          },
          push: {
            stateHistory: {
              fromState: trade.state,
              toState: 'CANCELLED',
              actorId,
              reason: cleanReason,
              correlationId: correlationId || null,
              timestamp: now,
            },
          },
        },
        session,
      );

      if (!saved) {
        throw new ConflictError('Trade changed concurrently; cancellation failed.');
      }

      await this.userRepo.incrementStats(actorId, { cancelled: 1 }, session);
      if (trade.assignedMiddlemanId) {
        await this.userRepo.incrementStats(
          trade.assignedMiddlemanId,
          { activeMiddlemanLoad: -1 },
          session,
        );
      }

      await this.auditService.record({
        serverId,
        actorId,
        actorType: 'USER',
        action: 'TRADE_CANCELLED_BY_USER',
        targetType: 'TRADE',
        targetId: tradeId,
        beforeState: { state: trade.state },
        afterState: { state: 'CANCELLED', reason: cleanReason },
        correlationId,
        session,
      });

      return saved;
    });
  }

  /**
   * Staff force-cancellation (`/canceltrade`) with mandatory documented reason and confirmation flag.
   */
  async cancelTradeByStaff({ serverId, tradeId, actorId, reason, confirm = false, correlationId }) {
    if (!confirm) {
      throw new ValidationError(
        'Staff trade cancellation is irreversible. Pass `confirm=yes` with a documented reason.',
      );
    }

    const cleanReason = sanitizeUserText(reason || '', { maxLength: 1000, fieldName: 'Cancellation reason' });
    if (cleanReason.length < 5) {
      throw new ValidationError('Staff trade cancellation requires a reason of at least 5 characters.');
    }

    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    await this.permissionsApi.assertAuthorized({
      serverId,
      userId: actorId,
      serverConfig: cfg,
      requiredRole: 'moderator',
    });

    const trade = await this.tradeRepo.findByTradeId(tradeId);
    if (!trade || trade.serverId !== serverId) {
      throw new NotFoundError(`Trade \`${tradeId}\` was not found in this server.`);
    }

    this.antiScam.assertNoConflictOfInterest(trade, actorId, 'cancel as staff');

    if (isTerminalTradeState(trade.state)) {
      throw new ValidationError(`Trade \`${tradeId}\` is already in terminal state \`${trade.state}\`.`);
    }

    assertValidTradeTransition(trade, 'CANCELLED', { isStaff: true });
    const now = new Date();

    return withTransaction(async (session) => {
      const saved = await this.tradeRepo.atomicUpdate(
        tradeId,
        {
          expectedVersion: trade.version,
          expectedStates: [trade.state],
          set: {
            state: 'CANCELLED',
            activeDisputeId: null,
            cancellationRecord: {
              cancelledAt: now,
              cancelledBy: actorId,
              reason: cleanReason,
            },
          },
          push: {
            stateHistory: {
              fromState: trade.state,
              toState: 'CANCELLED',
              actorId,
              reason: cleanReason,
              correlationId: correlationId || null,
              timestamp: now,
            },
          },
        },
        session,
      );

      if (!saved) {
        throw new ConflictError('Trade changed concurrently; staff cancellation aborted.');
      }

      if (trade.assignedMiddlemanId) {
        await this.userRepo.incrementStats(
          trade.assignedMiddlemanId,
          { activeMiddlemanLoad: -1 },
          session,
        );
      }

      await this.auditService.record({
        serverId,
        actorId,
        actorType: 'STAFF',
        action: 'TRADE_CANCELLED_BY_STAFF',
        targetType: 'TRADE',
        targetId: tradeId,
        beforeState: { state: trade.state },
        afterState: { state: 'CANCELLED', reason: cleanReason },
        correlationId,
        session,
      });

      return saved;
    });
  }

  /**
   * Finalizes an eligible trade (`/complete`) after enforcing ALL 8 mandatory preconditions
   * from Requirement 4, protected against concurrent double-completion via idempotency + atomic CAS!
   */
  async completeTrade({
    serverId,
    tradeId,
    actorId,
    decisionNotes,
    evidenceSummary = '',
    confirm = false,
    correlationId,
  }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);

    // Precondition 7: Require configured final approval procedure
    if (cfg?.tradeLimits?.requireFinalStaffConfirmationFlag !== false && !confirm) {
      throw new ValidationError(
        'Final trade completion is irreversible. Pass `confirm=yes` alongside your verification notes after confirming off-bot delivery.',
      );
    }

    // Precondition 5: Verify live server-side staff authorization
    const access = await this.permissionsApi.assertAuthorized({
      serverId,
      userId: actorId,
      serverConfig: cfg,
      requiredRole: 'middleman',
    });

    const cleanDecision = sanitizeUserText(decisionNotes || '', {
      maxLength: 1000,
      fieldName: 'Completion notes',
    });
    if (cleanDecision.length < 5) {
      throw new ValidationError(
        'Completion requires documented verification notes (`notes="..."`, at least 5 characters).',
      );
    }
    const cleanEvidence = sanitizeUserText(evidenceSummary || '', {
      maxLength: 1000,
      fieldName: 'Evidence summary',
    });

    const trade = await this.tradeRepo.findByTradeId(tradeId);
    if (!trade || trade.serverId !== serverId) {
      throw new NotFoundError(`Trade \`${tradeId}\` was not found in this server.`);
    }

    // Conflict-of-interest check
    this.antiScam.assertNoConflictOfInterest(trade, actorId, 'complete');

    if (!access.roles.isAdmin && trade.assignedMiddlemanId !== actorId) {
      throw new AuthorizationError(
        `Only the assigned middleman (<@${trade.assignedMiddlemanId}>) or a server Admin may complete trade \`${tradeId}\`.`,
      );
    }

    // Precondition 1: Verify exact trade state == WAITING_FOR_FINAL_CONFIRMATION
    if (trade.state !== 'WAITING_FOR_FINAL_CONFIRMATION') {
      throw new ValidationError(
        `Trade \`${tradeId}\` cannot be completed from state \`${trade.state}\` (must be \`WAITING_FOR_FINAL_CONFIRMATION\`).`,
      );
    }

    // Precondition 4: Check for active disputes both on trade document AND in Dispute collection
    const openDispute = await this.disputeRepo.findActiveByTradeId(tradeId);
    if (trade.activeDisputeId || openDispute) {
      throw new ConflictError(
        `Trade \`${tradeId}\` has an active dispute (\`${openDispute?.disputeId || trade.activeDisputeId}\`) and cannot be completed.`,
      );
    }

    // Preconditions 2 & 3: State machine validates both participants' confirmations & verified deposits
    assertValidTradeTransition(trade, 'COMPLETED', { isStaff: true });

    const now = new Date();

    // Precondition 8: Atomic CAS transition (`expectedVersion`, `expectedStates: ['WAITING_FOR_FINAL_CONFIRMATION']`)
    // Guarantees at most ONE concurrent completion call can ever succeed!
    return withTransaction(async (session) => {
      const completed = await this.tradeRepo.atomicUpdate(
        tradeId,
        {
          expectedVersion: trade.version,
          expectedStates: ['WAITING_FOR_FINAL_CONFIRMATION'],
          set: {
            state: 'COMPLETED',
            completionRecord: {
              completedAt: now,
              completedBy: actorId,
              decisionNotes: cleanDecision,
              evidenceSummary: cleanEvidence || null,
            },
          },
          push: {
            stateHistory: {
              fromState: 'WAITING_FOR_FINAL_CONFIRMATION',
              toState: 'COMPLETED',
              actorId,
              reason: cleanDecision,
              correlationId: correlationId || null,
              timestamp: now,
            },
          },
        },
        session,
      );

      if (!completed) {
        throw new ConflictError(
          `Concurrent completion or state modification detected for trade \`${tradeId}\`; completion was not applied twice.`,
        );
      }

      await this.userRepo.incrementStats(trade.traderAId, { completed: 1 }, session);
      await this.userRepo.incrementStats(trade.traderBId, { completed: 1 }, session);
      if (trade.assignedMiddlemanId) {
        await this.userRepo.incrementStats(
          trade.assignedMiddlemanId,
          { asMiddlemanCompleted: 1, activeMiddlemanLoad: -1 },
          session,
        );
      }

      await this.auditService.record({
        serverId,
        actorId,
        actorType: 'STAFF',
        action: 'TRADE_COMPLETED',
        targetType: 'TRADE',
        targetId: tradeId,
        beforeState: { state: 'WAITING_FOR_FINAL_CONFIRMATION' },
        afterState: { state: 'COMPLETED', completedBy: actorId, completedAt: now },
        metadata: { decisionNotes: cleanDecision, hasEvidenceSummary: Boolean(cleanEvidence) },
        correlationId,
        session,
      });

      return completed;
    });
  }

  /**
   * Explicit audited expiration sweep for stale pre-deposit trades.
   * Replaces unsafe MongoDB TTL silent document deletion!
   */
  async expireStaleTrades(nowOrOptions = new Date()) {
    const now = nowOrOptions instanceof Date ? nowOrOptions : nowOrOptions?.now || new Date();
    const limit = typeof nowOrOptions?.limit === 'number' ? nowOrOptions.limit : 50;
    const candidates = await this.tradeRepo.findExpiredCandidates(now, limit);
    const expiredIds = [];

    for (const trade of candidates) {
      if (!['CREATED', 'WAITING_FOR_PARTICIPANTS', 'WAITING_FOR_MIDDLEMAN'].includes(trade.state)) {
        continue;
      }
      const saved = await this.tradeRepo.atomicUpdate(trade.tradeId, {
        expectedVersion: trade.version,
        expectedStates: [trade.state],
        set: { state: 'EXPIRED' },
        push: {
          stateHistory: {
            fromState: trade.state,
            toState: 'EXPIRED',
            actorId: 'SYSTEM',
            reason: 'Trade request expired past configured window',
            correlationId: null,
            timestamp: now,
          },
        },
      });
      if (saved) {
        expiredIds.push(trade.tradeId);
        await this.auditService.record({
          serverId: trade.serverId,
          actorId: 'SYSTEM',
          actorType: 'SYSTEM',
          action: 'TRADE_EXPIRED',
          targetType: 'TRADE',
          targetId: trade.tradeId,
          beforeState: { state: trade.state },
          afterState: { state: 'EXPIRED' },
          broadcastToChannel: false,
        });
      }
    }

    return expiredIds;
  }
}
