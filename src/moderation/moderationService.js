import { withTransaction } from '../database/connection.js';
import { REPORT_CATEGORIES } from '../database/models/Report.js';
import { sanitizeUserText, validateSafeEvidenceUrl } from '../security/sanitizer.js';
import { buildModCaseEmbed } from '../utils/embeds.js';
import { AuthorizationError, NotFoundError, ValidationError } from '../utils/errors.js';
import { generateCaseId, generateReportId } from '../utils/ids.js';

/**
 * MurderMystery2 Sheriff Enforcement & Case File Service.
 * Supports Warn, ClearWarn, Mute (with timed auto-unmute), Unmute, Kick, Ban, Unban, Purge,
 * Channel Lock/Unlock, Slowmode, and non-auto-labeling Player Rulebreak Reports.
 */
export class ModerationService {
  constructor({
    userRepo,
    caseRepo,
    reportRepo,
    serverConfigRepo,
    permissionsApi,
    channelsApi = null,
    messagesApi = null,
    logService,
    logger = null,
  }) {
    this.userRepo = userRepo;
    this.caseRepo = caseRepo;
    this.reportRepo = reportRepo;
    this.serverConfigRepo = serverConfigRepo;
    this.permissionsApi = permissionsApi;
    this.channelsApi = channelsApi;
    this.messagesApi = messagesApi;
    this.logService = logService;
    this.logger = logger;
  }

  async _assertStaffHierarchy(serverId, actorId, targetUserId, cfg, requiredRole = 'moderator') {
    if (actorId === targetUserId) {
      throw new ValidationError('Staff cannot issue moderation Case Files against themselves.');
    }
    const actorAccess = await this.permissionsApi.assertAuthorized({
      serverId,
      userId: actorId,
      serverConfig: cfg,
      requiredRole,
    });
    const targetAccess = await this.permissionsApi.resolveMemberAccess(serverId, targetUserId, cfg);
    if (targetAccess.isMember && targetAccess.tier >= actorAccess.tier && !actorAccess.roles.isOwner) {
      throw new AuthorizationError(
        'Cannot moderate a MurderMystery2 member of equal or higher staff rank.',
      );
    }
    return { actorAccess, targetAccess };
  }

  /**
   * Issues an official Warning Case File (`$warn`), auto-escalating to a Mute if threshold reached.
   */
  async warnUser({
    serverId,
    actorId,
    targetUserId,
    reason,
    isAutoMod = false,
    correlationId = null,
  }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    if (!isAutoMod) {
      await this._assertStaffHierarchy(serverId, actorId, targetUserId, cfg, 'trialmod');
    }

    const cleanReason = sanitizeUserText(reason || '', { maxLength: 1000, fieldName: 'Warning reason' });
    if (cleanReason.length < 3) {
      throw new ValidationError('Warning reason must be at least 3 characters.');
    }

    const caseNumber = await this.caseRepo.nextCaseNumber(serverId);
    const caseId = generateCaseId();

    const { modCase, user } = await withTransaction(async () => {
      const createdCase = await this.caseRepo.create({
        caseId,
        caseNumber,
        serverId,
        action: isAutoMod ? 'AUTOMOD_WARN' : 'WARN',
        targetUserId,
        moderatorId: actorId,
        reason: cleanReason,
        active: true,
      });

      const updatedUser = await this.userRepo.updateUser(targetUserId, (draft) => {
        draft.moderation.activeWarnCount = (draft.moderation.activeWarnCount || 0) + 1;
        draft.moderation.totalCases = (draft.moderation.totalCases || 0) + 1;
      });

      await this.logService.record({
        serverId,
        actorId,
        actorType: isAutoMod ? 'SYSTEM' : 'STAFF',
        action: createdCase.action,
        targetType: 'CASE',
        targetId: createdCase.caseId,
        afterState: { targetUserId, activeWarnCount: updatedUser.moderation.activeWarnCount },
        metadata: { reason: cleanReason },
        correlationId,
        stream: 'mod',
        embed: buildModCaseEmbed(createdCase),
      });

      return { modCase: createdCase, user: updatedUser };
    });

    // Automatic escalation if active warnings reach configured threshold
    let autoMuteCase = null;
    const threshold = cfg.autoMod.autoWarnThreshold || 3;
    if (
      user.moderation.activeWarnCount >= threshold &&
      !user.moderation.activeMute?.active
    ) {
      autoMuteCase = await this.muteUser({
        serverId,
        actorId: 'SYSTEM_AUTOMOD',
        targetUserId,
        durationMs: cfg.autoMod.autoMuteDurationMs || 30 * 60_000,
        reason: `Automatic Sheriff escalation (${user.moderation.activeWarnCount} active warnings)`,
        isAutoMod: true,
        correlationId,
      }).catch(() => null);
    }

    return { modCase, user, autoMuteCase };
  }

  /**
   * Voids / pardons an active Warning Case File (`$clearwarn`).
   */
  async clearWarning({ serverId, actorId, caseId, reason, correlationId = null }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    await this.permissionsApi.assertAuthorized({
      serverId,
      userId: actorId,
      serverConfig: cfg,
      requiredRole: 'moderator',
    });

    const found = await this.caseRepo.findByCaseId(caseId);
    if (!found || found.serverId !== serverId) {
      throw new NotFoundError(`Case \`${caseId}\` was not found.`);
    }
    if (!['WARN', 'AUTOMOD_WARN'].includes(found.action)) {
      throw new ValidationError(`Case \`${found.caseId}\` is a \`${found.action}\`, not a warning.`);
    }
    if (!found.active) {
      throw new ValidationError(`Case \`${found.caseId}\` has already been cleared.`);
    }

    const cleanReason = sanitizeUserText(reason || 'Warning cleared by Moderator', {
      maxLength: 500,
      fieldName: 'Clear reason',
    });

    return withTransaction(async () => {
      const updatedCase = await this.caseRepo.updateCase(found.caseId, {
        active: false,
        voidedBy: actorId,
        voidReason: cleanReason,
        voidedAt: new Date(),
      });

      await this.userRepo.updateUser(found.targetUserId, (draft) => {
        draft.moderation.activeWarnCount = Math.max(
          0,
          (draft.moderation.activeWarnCount || 1) - 1,
        );
      });

      await this.logService.record({
        serverId,
        actorId,
        actorType: 'STAFF',
        action: 'WARNING_CLEARED',
        targetType: 'CASE',
        targetId: found.caseId,
        metadata: { targetUserId: found.targetUserId, reason: cleanReason },
        correlationId,
        stream: 'mod',
      });

      return updatedCase;
    });
  }

  /**
   * Mutes a member (`$mute`), assigning `mutedRoleId` and scheduling timed expiry.
   */
  async muteUser({
    serverId,
    actorId,
    targetUserId,
    durationMs = 30 * 60_000,
    reason,
    isAutoMod = false,
    correlationId = null,
  }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    if (!isAutoMod) {
      await this._assertStaffHierarchy(serverId, actorId, targetUserId, cfg, 'trialmod');
    }

    const cleanReason = sanitizeUserText(reason || 'Muted by MurderMystery2 Staff', {
      maxLength: 1000,
      fieldName: 'Mute reason',
    });
    const safeDuration = Math.max(60_000, Math.min(28 * 86_400_000, Number(durationMs) || 1_800_000));
    const expiresAt = new Date(Date.now() + safeDuration);
    const caseNumber = await this.caseRepo.nextCaseNumber(serverId);
    const caseId = generateCaseId();

    const modCase = await withTransaction(async () => {
      const createdCase = await this.caseRepo.create({
        caseId,
        caseNumber,
        serverId,
        action: isAutoMod ? 'AUTOMOD_MUTE' : 'MUTE',
        targetUserId,
        moderatorId: actorId,
        reason: cleanReason,
        durationMs: safeDuration,
        expiresAt,
        active: true,
      });

      await this.userRepo.updateUser(targetUserId, (draft) => {
        draft.moderation.totalCases = (draft.moderation.totalCases || 0) + 1;
        draft.moderation.activeMute = {
          active: true,
          caseId: createdCase.caseId,
          reason: cleanReason,
          mutedBy: actorId,
          mutedAt: new Date(),
          expiresAt,
        };
      });

      await this.logService.record({
        serverId,
        actorId,
        actorType: isAutoMod ? 'SYSTEM' : 'STAFF',
        action: createdCase.action,
        targetType: 'CASE',
        targetId: createdCase.caseId,
        afterState: { targetUserId, expiresAt },
        correlationId,
        stream: 'mod',
        embed: buildModCaseEmbed(createdCase),
      });

      return createdCase;
    });

    if (cfg.roles.mutedRoleId) {
      await this.permissionsApi
        .addMemberRole(serverId, targetUserId, cfg.roles.mutedRoleId)
        .catch(() => undefined);
    }

    return modCase;
  }

  /**
   * Lifts an active mute (`$unmute`).
   */
  async unmuteUser({
    serverId,
    actorId,
    targetUserId,
    reason = 'Mute lifted',
    isSystemExpiry = false,
    correlationId = null,
  }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    if (!isSystemExpiry) {
      await this.permissionsApi.assertAuthorized({
        serverId,
        userId: actorId,
        serverConfig: cfg,
        requiredRole: 'trialmod',
      });
    }

    const cleanReason = sanitizeUserText(reason, { maxLength: 500, fieldName: 'Unmute reason' });
    const caseNumber = await this.caseRepo.nextCaseNumber(serverId);
    const caseId = generateCaseId();

    const modCase = await withTransaction(async () => {
      const createdCase = await this.caseRepo.create({
        caseId,
        caseNumber,
        serverId,
        action: 'UNMUTE',
        targetUserId,
        moderatorId: actorId,
        reason: cleanReason,
        active: false,
      });

      await this.userRepo.updateUser(targetUserId, (draft) => {
        draft.moderation.activeMute.active = false;
        draft.moderation.activeMute.expiresAt = null;
      });

      await this.logService.record({
        serverId,
        actorId,
        actorType: isSystemExpiry ? 'SYSTEM' : 'STAFF',
        action: 'UNMUTE',
        targetType: 'CASE',
        targetId: createdCase.caseId,
        metadata: { targetUserId, reason: cleanReason },
        correlationId,
        stream: 'mod',
        embed: buildModCaseEmbed(createdCase),
      });

      return createdCase;
    });

    if (cfg.roles.mutedRoleId) {
      await this.permissionsApi
        .removeMemberRole(serverId, targetUserId, cfg.roles.mutedRoleId)
        .catch(() => undefined);
    }

    return modCase;
  }

  /**
   * Periodic background sweep lifting expired timed mutes.
   */
  async sweepExpiredMutes(serverId, now = new Date()) {
    const expiredUsers = await this.userRepo.listExpiredMutes(now, 50);
    const unmutedIds = [];
    for (const u of expiredUsers) {
      await this.unmuteUser({
        serverId,
        actorId: 'SYSTEM_TIMER',
        targetUserId: u.yapinUserId,
        reason: 'Timed mute expired automatically',
        isSystemExpiry: true,
      }).catch(() => undefined);
      unmutedIds.push(u.yapinUserId);
    }
    return unmutedIds;
  }

  /**
   * Issues an official Kick Case File & revokes Verified Citizen access (`$kick`).
   */
  async kickUser({ serverId, actorId, targetUserId, reason, confirm = false, correlationId = null }) {
    if (!confirm) {
      throw new ValidationError('Kick requires explicit confirmation: pass `confirm=yes`.');
    }
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    await this._assertStaffHierarchy(serverId, actorId, targetUserId, cfg, 'moderator');

    const cleanReason = sanitizeUserText(reason || '', { maxLength: 1000, fieldName: 'Kick reason' });
    if (cleanReason.length < 4) {
      throw new ValidationError('Kick reason must be at least 4 characters.');
    }

    const caseNumber = await this.caseRepo.nextCaseNumber(serverId);
    const modCase = await this.caseRepo.create({
      caseId: generateCaseId(),
      caseNumber,
      serverId,
      action: 'KICK',
      targetUserId,
      moderatorId: actorId,
      reason: cleanReason,
      active: true,
    });

    await this.userRepo.updateUser(targetUserId, (draft) => {
      draft.verification.verified = false;
      draft.moderation.totalCases = (draft.moderation.totalCases || 0) + 1;
    });

    if (cfg.roles.verifiedRoleId) {
      await this.permissionsApi
        .removeMemberRole(serverId, targetUserId, cfg.roles.verifiedRoleId)
        .catch(() => undefined);
    }

    await this.logService.record({
      serverId,
      actorId,
      actorType: 'STAFF',
      action: 'KICK',
      targetType: 'CASE',
      targetId: modCase.caseId,
      metadata: { targetUserId, reason: cleanReason },
      correlationId,
      stream: 'mod',
      embed: buildModCaseEmbed(modCase),
    });

    return modCase;
  }

  /**
   * Bans a member from MurderMystery2 systems (`$ban`).
   */
  async banUser({
    serverId,
    actorId,
    targetUserId,
    reason,
    durationMs = null,
    confirm = false,
    correlationId = null,
  }) {
    if (!confirm) {
      throw new ValidationError('Ban is high-impact: pass `confirm=yes` with a documented reason.');
    }
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    await this._assertStaffHierarchy(serverId, actorId, targetUserId, cfg, 'moderator');

    const cleanReason = sanitizeUserText(reason || '', { maxLength: 1000, fieldName: 'Ban reason' });
    if (cleanReason.length < 4) {
      throw new ValidationError('Ban reason must be at least 4 characters.');
    }

    const expiresAt = durationMs ? new Date(Date.now() + durationMs) : null;
    const caseNumber = await this.caseRepo.nextCaseNumber(serverId);
    const modCase = await this.caseRepo.create({
      caseId: generateCaseId(),
      caseNumber,
      serverId,
      action: 'BAN',
      targetUserId,
      moderatorId: actorId,
      reason: cleanReason,
      durationMs,
      expiresAt,
      active: true,
    });

    await this.userRepo.updateUser(targetUserId, (draft) => {
      draft.verification.verified = false;
      draft.moderation.totalCases = (draft.moderation.totalCases || 0) + 1;
      draft.moderation.activeBan = {
        active: true,
        caseId: modCase.caseId,
        reason: cleanReason,
        bannedBy: actorId,
        bannedAt: new Date(),
        expiresAt,
      };
    });

    if (cfg.roles.verifiedRoleId) {
      await this.permissionsApi
        .removeMemberRole(serverId, targetUserId, cfg.roles.verifiedRoleId)
        .catch(() => undefined);
    }
    if (cfg.roles.mutedRoleId) {
      await this.permissionsApi
        .addMemberRole(serverId, targetUserId, cfg.roles.mutedRoleId)
        .catch(() => undefined);
    }

    await this.logService.record({
      serverId,
      actorId,
      actorType: 'STAFF',
      action: 'BAN',
      targetType: 'CASE',
      targetId: modCase.caseId,
      metadata: { targetUserId, reason: cleanReason, expiresAt },
      correlationId,
      stream: 'mod',
      embed: buildModCaseEmbed(modCase),
    });

    return modCase;
  }

  async unbanUser({ serverId, actorId, targetUserId, reason = 'Ban lifted', correlationId = null }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    await this.permissionsApi.assertAuthorized({
      serverId,
      userId: actorId,
      serverConfig: cfg,
      requiredRole: 'moderator',
    });

    const cleanReason = sanitizeUserText(reason, { maxLength: 500, fieldName: 'Unban reason' });
    const caseNumber = await this.caseRepo.nextCaseNumber(serverId);
    const modCase = await this.caseRepo.create({
      caseId: generateCaseId(),
      caseNumber,
      serverId,
      action: 'UNBAN',
      targetUserId,
      moderatorId: actorId,
      reason: cleanReason,
      active: false,
    });

    await this.userRepo.updateUser(targetUserId, (draft) => {
      draft.moderation.activeBan.active = false;
      draft.moderation.activeBan.expiresAt = null;
    });

    if (cfg.roles.mutedRoleId) {
      await this.permissionsApi
        .removeMemberRole(serverId, targetUserId, cfg.roles.mutedRoleId)
        .catch(() => undefined);
    }

    await this.logService.record({
      serverId,
      actorId,
      actorType: 'STAFF',
      action: 'UNBAN',
      targetType: 'CASE',
      targetId: modCase.caseId,
      metadata: { targetUserId, reason: cleanReason },
      correlationId,
      stream: 'mod',
      embed: buildModCaseEmbed(modCase),
    });

    return modCase;
  }

  /**
   * Bulk-deletes recent messages in a channel (`$purge`), optionally filtering by author.
   */
  async purgeChannelMessages({
    serverId,
    channelId,
    actorId,
    count = 20,
    targetUserId = null,
    correlationId = null,
  }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    await this.permissionsApi.assertAuthorized({
      serverId,
      userId: actorId,
      serverConfig: cfg,
      requiredRole: 'moderator',
    });

    const clamped = Math.max(1, Math.min(100, Number(count) || 20));
    const recent = await this.messagesApi.fetchMessages(channelId, { limit: 100 });
    const filtered = recent
      .filter((m) => (!targetUserId ? true : m.author_id === targetUserId))
      .slice(-clamped);
    const ids = filtered.map((m) => m.id).filter(Boolean);

    const { deletedCount } = await this.messagesApi.bulkDeleteMessages(channelId, ids);

    await this.logService.record({
      serverId,
      actorId,
      actorType: 'STAFF',
      action: 'CHANNEL_PURGE',
      targetType: 'CHANNEL',
      targetId: channelId,
      metadata: { deletedCount, targetUserId },
      correlationId,
      stream: 'mod',
    });

    return { deletedCount };
  }

  async setSlowmode({ serverId, channelId, actorId, seconds = 0, correlationId = null }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    await this.permissionsApi.assertAuthorized({
      serverId,
      userId: actorId,
      serverConfig: cfg,
      requiredRole: 'trialmod',
    });
    const updated = await this.channelsApi.editChannel(channelId, { slowmode: Number(seconds) || 0 });
    await this.logService.record({
      serverId,
      actorId,
      actorType: 'STAFF',
      action: 'CHANNEL_SLOWMODE',
      targetType: 'CHANNEL',
      targetId: channelId,
      metadata: { seconds: Number(seconds) || 0 },
      correlationId,
      stream: 'mod',
    });
    return updated;
  }

  async setChannelLock({ serverId, channelId, actorId, locked = true, reason = '', correlationId = null }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    await this.permissionsApi.assertAuthorized({
      serverId,
      userId: actorId,
      serverConfig: cfg,
      requiredRole: 'moderator',
    });

    const staffPostRoles = [
      ...cfg.staffRoles.adminRoleIds,
      ...cfg.staffRoles.moderatorRoleIds,
      ...cfg.staffRoles.trialModRoleIds,
    ];
    const updated = await this.channelsApi.editChannel(channelId, {
      readOnly: Boolean(locked),
      ...(locked && staffPostRoles.length > 0 ? { postRoleIds: staffPostRoles } : {}),
    });

    await this.logService.record({
      serverId,
      actorId,
      actorType: 'STAFF',
      action: locked ? 'CHANNEL_LOCKED' : 'CHANNEL_UNLOCKED',
      targetType: 'CHANNEL',
      targetId: channelId,
      metadata: { reason },
      correlationId,
      stream: 'mod',
    });
    return updated;
  }

  /**
   * Queues a private player report (`$report`) without auto-banning or auto-labeling the accused!
   */
  async submitReport({
    serverId,
    reporterId,
    targetUserId,
    category = 'RDM_FAILRP',
    description,
    evidenceUrl = null,
    correlationId = null,
  }) {
    if (reporterId === targetUserId) {
      throw new ValidationError('You cannot submit a report against yourself.');
    }
    const normalizedCat = String(category || 'RDM_FAILRP').toUpperCase();
    if (!REPORT_CATEGORIES.includes(normalizedCat)) {
      throw new ValidationError(
        `Invalid report category. Choose one of: ${REPORT_CATEGORIES.join(', ')}`,
      );
    }

    const cleanDesc = sanitizeUserText(description || '', {
      maxLength: 2000,
      fieldName: 'Report details',
    });
    if (cleanDesc.length < 8) {
      throw new ValidationError('Please provide at least 8 characters describing what happened.');
    }

    const evidenceRefs = [];
    if (evidenceUrl) {
      evidenceRefs.push(validateSafeEvidenceUrl(evidenceUrl));
    }

    const report = await this.reportRepo.create({
      reportId: generateReportId(),
      serverId,
      reporterId,
      targetUserId,
      category: normalizedCat,
      description: cleanDesc,
      evidenceRefs,
      status: 'PENDING_REVIEW',
    });

    await this.userRepo.updateUser(targetUserId, (draft) => {
      draft.moderation.openReportsCount = (draft.moderation.openReportsCount || 0) + 1;
    });

    await this.logService.record({
      serverId,
      actorId: reporterId,
      actorType: 'USER',
      action: 'PLAYER_REPORT_SUBMITTED',
      targetType: 'REPORT',
      targetId: report.reportId,
      metadata: { category: normalizedCat, targetUserId },
      correlationId,
      stream: 'alert',
    });

    return report;
  }
}
