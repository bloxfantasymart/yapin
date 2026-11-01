import { withTransaction } from '../database/connection.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';
import { sanitizeUserText } from '../security/sanitizer.js';
import { assertValidTradeTransition } from './tradeStateMachine.js';

/**
 * Middleman Assignment, Availability, Workload & Conflict-of-Interest Service.
 *
 * Implements:
 * - Staff availability toggle (`/availability`)
 * - Authorized `/claim` (only in `WAITING_FOR_MIDDLEMAN`, never self-dealing)
 * - Manual `/assign`, `/unassign`, `/reassign` (with mandatory recorded reason & confirmation reset)
 * - Optional workload-balanced automatic assignment
 */
export class AssignmentService {
  /**
   * @param {{
   *   tradeRepo: import('../database/repositories/tradeRepository.js').MongooseTradeRepository,
   *   userRepo: import('../database/repositories/userRepository.js').MongooseUserRepository,
   *   serverConfigRepo: import('../database/repositories/auditConfigRepository.js').MongooseServerConfigRepository,
   *   permissionsApi: import('../api/permissions.js').YapinPermissionsApi,
   *   antiScam: import('../security/antiScam.js').AntiScamService,
   *   auditService: import('./auditService.js').AuditService,
   * }} deps
   */
  constructor({
    tradeRepo,
    userRepo,
    serverConfigRepo,
    permissionsApi,
    antiScam,
    auditService,
  }) {
    this.tradeRepo = tradeRepo;
    this.userRepo = userRepo;
    this.serverConfigRepo = serverConfigRepo;
    this.permissionsApi = permissionsApi;
    this.antiScam = antiScam;
    this.auditService = auditService;
  }

  /**
   * Updates a middleman's duty availability status after verifying middleman/admin permissions.
   */
  async setStaffAvailability({ serverId, actorId, available, note = '', correlationId }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    await this.permissionsApi.assertAuthorized({
      serverId,
      userId: actorId,
      serverConfig: cfg,
      requiredRole: 'middleman',
    });

    const cleanNote = sanitizeUserText(note, { maxLength: 200, fieldName: 'Availability note', allowNewlines: false });
    const updatedUser = await this.userRepo.setAvailability(actorId, {
      available: Boolean(available),
      note: cleanNote,
    });

    await this.auditService.record({
      serverId,
      actorId,
      actorType: 'STAFF',
      action: 'STAFF_AVAILABILITY_CHANGED',
      targetType: 'USER',
      targetId: actorId,
      afterState: { available: Boolean(available), note: cleanNote },
      correlationId,
    });

    return updatedUser;
  }

  /**
   * Allows an authorized middleman to claim an unassigned `WAITING_FOR_MIDDLEMAN` trade.
   */
  async claimTrade({ serverId, tradeId, actorId, correlationId }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    await this.permissionsApi.assertAuthorized({
      serverId,
      userId: actorId,
      serverConfig: cfg,
      requiredRole: 'middleman',
    });

    const trade = await this.tradeRepo.findByTradeId(tradeId);
    if (!trade || trade.serverId !== serverId) {
      throw new NotFoundError(`Trade \`${tradeId}\` was not found in this server.`);
    }

    this.antiScam.assertNoConflictOfInterest(trade, actorId, 'claim');

    if (trade.assignedMiddlemanId) {
      throw new ConflictError(
        `Trade \`${tradeId}\` is already assigned to <@${trade.assignedMiddlemanId}>.`,
      );
    }

    assertValidTradeTransition(trade, 'MIDDLEMAN_ASSIGNED');

    const activeLoad = await this.tradeRepo.countActiveForMiddleman(serverId, actorId);
    const maxLoad = cfg?.tradeLimits?.maxMiddlemanActiveWorkload ?? 5;
    if (activeLoad >= maxLoad) {
      throw new ValidationError(
        `You already have ${activeLoad} active middleman trades (server limit: ${maxLoad}).`,
      );
    }

    return this._applyAssignment({
      trade,
      action: 'CLAIM',
      newMiddlemanId: actorId,
      actorId,
      reason: 'Claimed by middleman',
      correlationId,
    });
  }

  /**
   * Assigns a verified middleman to a `WAITING_FOR_MIDDLEMAN` trade (Admin/Coordinator action).
   */
  async assignMiddleman({ serverId, tradeId, targetMiddlemanId, actorId, reason = 'Manual staff assignment', correlationId }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    await this.permissionsApi.assertAuthorized({
      serverId,
      userId: actorId,
      serverConfig: cfg,
      requiredRole: 'admin',
    });

    // Verify target user is ALSO an authorized middleman on the server
    await this.permissionsApi.assertAuthorized({
      serverId,
      userId: targetMiddlemanId,
      serverConfig: cfg,
      requiredRole: 'middleman',
    });

    const trade = await this.tradeRepo.findByTradeId(tradeId);
    if (!trade || trade.serverId !== serverId) {
      throw new NotFoundError(`Trade \`${tradeId}\` was not found in this server.`);
    }

    this.antiScam.assertNoConflictOfInterest(trade, targetMiddlemanId, 'be assigned to');

    if (trade.assignedMiddlemanId) {
      throw new ConflictError(
        `Trade \`${tradeId}\` already has an assigned middleman (<@${trade.assignedMiddlemanId}>). Use \`/reassign\` with a reason instead.`,
      );
    }

    assertValidTradeTransition(trade, 'MIDDLEMAN_ASSIGNED');

    const activeLoad = await this.tradeRepo.countActiveForMiddleman(serverId, targetMiddlemanId);
    const maxLoad = cfg?.tradeLimits?.maxMiddlemanActiveWorkload ?? 5;
    if (activeLoad >= maxLoad) {
      throw new ValidationError(
        `Target middleman <@${targetMiddlemanId}> is at max active workload (${activeLoad}/${maxLoad}).`,
      );
    }

    return this._applyAssignment({
      trade,
      action: 'ASSIGN',
      newMiddlemanId: targetMiddlemanId,
      actorId,
      reason: sanitizeUserText(reason, { maxLength: 500, fieldName: 'Assignment reason' }),
      correlationId,
    });
  }

  /**
   * Removes an existing middleman assignment (`MIDDLEMAN_ASSIGNED -> WAITING_FOR_MIDDLEMAN`).
   * Blocked once deposits have entered `WAITING_FOR_DEPOSITS` or later; use `/reassign` with a reason instead.
   */
  async unassignMiddleman({ serverId, tradeId, actorId, reason = 'Unassigned', correlationId }) {
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

    if (!trade.assignedMiddlemanId) {
      throw new ValidationError(`Trade \`${tradeId}\` has no assigned middleman to remove.`);
    }

    if (!access.roles.isAdmin && trade.assignedMiddlemanId !== actorId) {
      throw new ValidationError('Only the assigned middleman or a server Admin may unassign this trade.');
    }

    if (trade.state !== 'MIDDLEMAN_ASSIGNED') {
      throw new ValidationError(
        `Cannot unassign without replacement while trade is in \`${trade.state}\`. Use \`/reassign\` instead.`,
      );
    }

    assertValidTradeTransition(trade, 'WAITING_FOR_MIDDLEMAN');
    const cleanReason = sanitizeUserText(reason, { maxLength: 500, fieldName: 'Unassign reason' });
    const previousMm = trade.assignedMiddlemanId;
    const now = new Date();

    return withTransaction(async (session) => {
      const saved = await this.tradeRepo.atomicUpdate(
        tradeId,
        {
          expectedVersion: trade.version,
          expectedStates: ['MIDDLEMAN_ASSIGNED'],
          set: {
            assignedMiddlemanId: null,
            state: 'WAITING_FOR_MIDDLEMAN',
            'confirmations.traderA.middlemanConfirmed': false,
            'confirmations.traderA.middlemanConfirmedAt': null,
            'confirmations.traderB.middlemanConfirmed': false,
            'confirmations.traderB.middlemanConfirmedAt': null,
          },
          push: {
            assignmentHistory: {
              action: 'UNASSIGN',
              middlemanId: null,
              previousMiddlemanId: previousMm,
              actorId,
              reason: cleanReason,
              timestamp: now,
            },
            stateHistory: {
              fromState: 'MIDDLEMAN_ASSIGNED',
              toState: 'WAITING_FOR_MIDDLEMAN',
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
        throw new ConflictError('Trade changed concurrently; could not unassign.');
      }

      await this.userRepo.incrementStats(previousMm, { activeMiddlemanLoad: -1 }, session);

      await this.auditService.record({
        serverId,
        actorId,
        actorType: 'STAFF',
        action: 'MIDDLEMAN_UNASSIGNED',
        targetType: 'TRADE',
        targetId: tradeId,
        beforeState: { state: trade.state, assignedMiddlemanId: previousMm },
        afterState: { state: 'WAITING_FOR_MIDDLEMAN', assignedMiddlemanId: null },
        metadata: { reason: cleanReason },
        correlationId,
        session,
      });

      return saved;
    });
  }

  /**
   * Transfers middleman responsibility to another verified middleman with a mandatory recorded reason.
   * If the trade was in `MIDDLEMAN_ASSIGNED`, resets `middlemanConfirmed` so both traders confirm the new middleman.
   */
  async reassignMiddleman({ serverId, tradeId, newMiddlemanId, actorId, reason, correlationId }) {
    const cleanReason = sanitizeUserText(reason || '', { maxLength: 500, fieldName: 'Reassignment reason' });
    if (cleanReason.length < 5) {
      throw new ValidationError('Reassignment requires a documented reason of at least 5 characters.');
    }

    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    await this.permissionsApi.assertAuthorized({
      serverId,
      userId: actorId,
      serverConfig: cfg,
      requiredRole: 'moderator',
    });

    await this.permissionsApi.assertAuthorized({
      serverId,
      userId: newMiddlemanId,
      serverConfig: cfg,
      requiredRole: 'middleman',
    });

    const trade = await this.tradeRepo.findByTradeId(tradeId);
    if (!trade || trade.serverId !== serverId) {
      throw new NotFoundError(`Trade \`${tradeId}\` was not found in this server.`);
    }

    if (!trade.assignedMiddlemanId) {
      throw new ValidationError(`Trade \`${tradeId}\` has no current middleman. Use \`/assign\` instead.`);
    }
    if (trade.assignedMiddlemanId === newMiddlemanId) {
      throw new ValidationError('New middleman must be different from the currently assigned middleman.');
    }

    this.antiScam.assertNoConflictOfInterest(trade, newMiddlemanId, 'be reassigned to');

    const reassignableStates = [
      'MIDDLEMAN_ASSIGNED',
      'WAITING_FOR_DEPOSITS',
      'DEPOSIT_CONFIRMATION',
      'WAITING_FOR_FINAL_CONFIRMATION',
      'DISPUTED',
      'UNDER_REVIEW',
    ];
    if (!reassignableStates.includes(trade.state)) {
      throw new ValidationError(`Cannot reassign middleman when trade is in state \`${trade.state}\`.`);
    }

    const previousMm = trade.assignedMiddlemanId;
    const now = new Date();
    const setFields = {
      assignedMiddlemanId: newMiddlemanId,
    };
    if (trade.state === 'MIDDLEMAN_ASSIGNED') {
      setFields['confirmations.traderA.middlemanConfirmed'] = false;
      setFields['confirmations.traderA.middlemanConfirmedAt'] = null;
      setFields['confirmations.traderB.middlemanConfirmed'] = false;
      setFields['confirmations.traderB.middlemanConfirmedAt'] = null;
    }

    return withTransaction(async (session) => {
      const saved = await this.tradeRepo.atomicUpdate(
        tradeId,
        {
          expectedVersion: trade.version,
          expectedStates: reassignableStates,
          set: setFields,
          push: {
            assignmentHistory: {
              action: 'REASSIGN',
              middlemanId: newMiddlemanId,
              previousMiddlemanId: previousMm,
              actorId,
              reason: cleanReason,
              timestamp: now,
            },
          },
        },
        session,
      );

      if (!saved) {
        throw new ConflictError('Trade changed concurrently during reassignment.');
      }

      await this.userRepo.incrementStats(previousMm, { activeMiddlemanLoad: -1 }, session);
      await this.userRepo.incrementStats(
        newMiddlemanId,
        { activeMiddlemanLoad: 1, asMiddlemanClaimed: 1 },
        session,
      );

      await this.auditService.record({
        serverId,
        actorId,
        actorType: 'STAFF',
        action: 'MIDDLEMAN_REASSIGNED',
        targetType: 'TRADE',
        targetId: tradeId,
        beforeState: { assignedMiddlemanId: previousMm },
        afterState: { assignedMiddlemanId: newMiddlemanId },
        metadata: { reason: cleanReason },
        correlationId,
        session,
      });

      return saved;
    });
  }

  /**
   * Attempts optional workload-balanced automatic assignment when enabled in `ServerConfig`.
   * Honors preferredMiddlemanId first if available, authorized, and conflict-free.
   */
  async tryAutoAssign({ serverId, tradeId, correlationId }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    const maxLoad = cfg?.tradeLimits?.maxMiddlemanActiveWorkload ?? 5;
    const trade = await this.tradeRepo.findByTradeId(tradeId);
    if (!trade || trade.state !== 'WAITING_FOR_MIDDLEMAN' || trade.assignedMiddlemanId) {
      return null;
    }

    const candidates = await this.userRepo.listAvailableMiddlemen({ maxWorkload: maxLoad });
    if (!candidates.length) return null;

    // Prioritize preferredMiddlemanId if they are in the available list
    if (trade.preferredMiddlemanId) {
      const idx = candidates.findIndex((c) => c.yapinUserId === trade.preferredMiddlemanId);
      if (idx > 0) {
        const [preferred] = candidates.splice(idx, 1);
        candidates.unshift(preferred);
      }
    }

    for (const candidate of candidates) {
      const mmId = candidate.yapinUserId;
      if (mmId === trade.traderAId || mmId === trade.traderBId) continue;

      try {
        await this.permissionsApi.assertAuthorized({
          serverId,
          userId: mmId,
          serverConfig: cfg,
          requiredRole: 'middleman',
        });
      } catch {
        continue;
      }

      const liveLoad = await this.tradeRepo.countActiveForMiddleman(serverId, mmId);
      if (liveLoad >= maxLoad) continue;

      return this._applyAssignment({
        trade,
        action: 'AUTO_ASSIGN',
        newMiddlemanId: mmId,
        actorId: 'SYSTEM',
        reason: 'Automatic workload-balanced assignment',
        correlationId,
      });
    }

    return null;
  }

  async _applyAssignment({ trade, action, newMiddlemanId, actorId, reason, correlationId }) {
    const now = new Date();
    return withTransaction(async (session) => {
      const saved = await this.tradeRepo.atomicUpdate(
        trade.tradeId,
        {
          expectedVersion: trade.version,
          expectedStates: ['WAITING_FOR_MIDDLEMAN'],
          set: {
            assignedMiddlemanId: newMiddlemanId,
            state: 'MIDDLEMAN_ASSIGNED',
            'confirmations.traderA.middlemanConfirmed': false,
            'confirmations.traderA.middlemanConfirmedAt': null,
            'confirmations.traderB.middlemanConfirmed': false,
            'confirmations.traderB.middlemanConfirmedAt': null,
          },
          push: {
            assignmentHistory: {
              action,
              middlemanId: newMiddlemanId,
              previousMiddlemanId: null,
              actorId,
              reason,
              timestamp: now,
            },
            stateHistory: {
              fromState: 'WAITING_FOR_MIDDLEMAN',
              toState: 'MIDDLEMAN_ASSIGNED',
              actorId,
              reason,
              correlationId: correlationId || null,
              timestamp: now,
            },
          },
        },
        session,
      );

      if (!saved) {
        throw new ConflictError('Trade was already claimed or modified concurrently.');
      }

      await this.userRepo.incrementStats(
        newMiddlemanId,
        { activeMiddlemanLoad: 1, asMiddlemanClaimed: 1 },
        session,
      );

      await this.auditService.record({
        serverId: trade.serverId,
        actorId,
        actorType: actorId === 'SYSTEM' ? 'SYSTEM' : 'STAFF',
        action: `MIDDLEMAN_${action}`,
        targetType: 'TRADE',
        targetId: trade.tradeId,
        beforeState: { state: trade.state, assignedMiddlemanId: null },
        afterState: { state: 'MIDDLEMAN_ASSIGNED', assignedMiddlemanId: newMiddlemanId },
        metadata: { reason },
        correlationId,
        session,
      });

      return saved;
    });
  }
}
