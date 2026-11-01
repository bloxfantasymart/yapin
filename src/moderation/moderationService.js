import { randomUUID } from 'node:crypto';
import { REPORT_CATEGORIES } from '../database/models/Report.js';
import { ValidationError } from '../utils/errors.js';
import { generateReportId, isValidYapinId } from '../utils/ids.js';
import { sanitizeUserText, validateSafeEvidenceUrl } from '../security/sanitizer.js';

/**
 * Moderation & Suspicious-Behavior Report Service.
 *
 * Security Invariants (Requirement 6 & 8):
 * - `/warnuser`, `/suspenduser`, `/unsuspenduser` require server-side Moderator/Admin permissions.
 * - `/report` NEVER automatically labels or suspends a target user as a "scammer" based on an
 *   unverified report; it queues `PENDING_REVIEW` for staff investigation and increments `openReportsCount`.
 */
export class ModerationService {
  /**
   * @param {{
   *   userRepo: import('../database/repositories/userRepository.js').MongooseUserRepository,
   *   reportRepo: import('../database/repositories/ticketDisputeRepository.js').MongooseReportRepository,
   *   serverConfigRepo: import('../database/repositories/auditConfigRepository.js').MongooseServerConfigRepository,
   *   permissionsApi: import('../api/permissions.js').YapinPermissionsApi,
   *   antiScam: import('../security/antiScam.js').AntiScamService,
   *   auditService: import('../middleman/auditService.js').AuditService,
   * }} deps
   */
  constructor({
    userRepo,
    reportRepo,
    serverConfigRepo,
    permissionsApi,
    antiScam,
    auditService,
  }) {
    this.userRepo = userRepo;
    this.reportRepo = reportRepo;
    this.serverConfigRepo = serverConfigRepo;
    this.permissionsApi = permissionsApi;
    this.antiScam = antiScam;
    this.auditService = auditService;
  }

  async warnUser({ serverId, targetUserId, actorId, reason, tradeId = null, correlationId }) {
    if (!isValidYapinId(targetUserId)) {
      throw new ValidationError('Invalid target Yapin user ID.');
    }
    const cleanReason = sanitizeUserText(reason || '', {
      maxLength: 1000,
      fieldName: 'Warning reason',
    });
    if (cleanReason.length < 3) {
      throw new ValidationError('Warning reason must be at least 3 characters.');
    }

    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    await this.permissionsApi.assertAuthorized({
      serverId,
      userId: actorId,
      serverConfig: cfg,
      requiredRole: 'moderator',
    });

    const warning = {
      warningId: `warn_${randomUUID().slice(0, 8)}`,
      serverId,
      issuedBy: actorId,
      reason: cleanReason,
      tradeId,
      createdAt: new Date(),
    };

    const updatedUser = await this.userRepo.addWarning(targetUserId, warning);

    await this.auditService.record({
      serverId,
      actorId,
      actorType: 'STAFF',
      action: 'USER_WARNED',
      targetType: 'USER',
      targetId: targetUserId,
      afterState: { warningId: warning.warningId, totalWarnings: updatedUser.warnings.length },
      metadata: { reason: cleanReason, tradeId },
      correlationId,
    });

    return { user: updatedUser, warning };
  }

  async suspendUser({
    serverId,
    targetUserId,
    actorId,
    reason,
    durationHours = null,
    confirm = false,
    correlationId,
  }) {
    if (!confirm) {
      throw new ValidationError(
        'Suspending a user from trades requires explicit confirmation (`confirm=yes`).',
      );
    }
    if (!isValidYapinId(targetUserId)) {
      throw new ValidationError('Invalid target Yapin user ID.');
    }
    if (targetUserId === actorId) {
      throw new ValidationError('You cannot suspend yourself.');
    }

    const cleanReason = sanitizeUserText(reason || '', {
      maxLength: 1000,
      fieldName: 'Suspension reason',
    });
    if (cleanReason.length < 5) {
      throw new ValidationError('Suspension requires a documented reason of at least 5 characters.');
    }

    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    await this.permissionsApi.assertAuthorized({
      serverId,
      userId: actorId,
      serverConfig: cfg,
      requiredRole: 'moderator',
    });

    // Prevent moderators from suspending the server owner or admins
    const targetAccess = await this.permissionsApi.resolveMemberAccess(serverId, targetUserId, cfg);
    if (targetAccess.roles.isAdmin || targetAccess.roles.isOwner) {
      throw new ValidationError('Cannot suspend a server Owner or Admin.');
    }

    let expiresAt = null;
    if (durationHours !== null && durationHours !== undefined && durationHours !== '') {
      const hours = Number(durationHours);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 8760) {
        throw new ValidationError('Suspension durationHours must be between 1 and 8760 hours.');
      }
      expiresAt = new Date(Date.now() + hours * 3600 * 1000);
    }

    const updatedUser = await this.userRepo.suspendUser(targetUserId, {
      reason: cleanReason,
      suspendedBy: actorId,
      expiresAt,
    });

    await this.auditService.record({
      serverId,
      actorId,
      actorType: 'STAFF',
      action: 'USER_SUSPENDED',
      targetType: 'USER',
      targetId: targetUserId,
      afterState: { active: true, reason: cleanReason, expiresAt },
      correlationId,
    });

    return updatedUser;
  }

  async unsuspendUser({ serverId, targetUserId, actorId, reason = 'Suspension lifted', correlationId }) {
    if (!isValidYapinId(targetUserId)) {
      throw new ValidationError('Invalid target Yapin user ID.');
    }

    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    await this.permissionsApi.assertAuthorized({
      serverId,
      userId: actorId,
      serverConfig: cfg,
      requiredRole: 'moderator',
    });

    const cleanReason = sanitizeUserText(reason, { maxLength: 500, fieldName: 'Unsuspend reason' });
    const updatedUser = await this.userRepo.unsuspendUser(targetUserId, { liftedBy: actorId });

    await this.auditService.record({
      serverId,
      actorId,
      actorType: 'STAFF',
      action: 'USER_UNSUSPENDED',
      targetType: 'USER',
      targetId: targetUserId,
      afterState: { active: false, liftedBy: actorId },
      metadata: { reason: cleanReason },
      correlationId,
    });

    return updatedUser;
  }

  /**
   * Submits a suspicious-behavior report (`/report`) for staff review.
   * Never auto-bans, auto-suspends, or labels the reported user a scammer!
   */
  async submitReport({
    serverId,
    reporterId,
    targetUserId,
    category = 'OTHER_SUSPICIOUS',
    description,
    tradeId = null,
    evidenceUrl = null,
    correlationId,
  }) {
    if (!isValidYapinId(targetUserId)) {
      throw new ValidationError('Provide a valid Yapin User ID or `<@user_id>` mention to report.');
    }
    if (reporterId === targetUserId) {
      throw new ValidationError('You cannot submit a suspicious-behavior report against yourself.');
    }

    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    if (cfg?.features?.reportsEnabled === false) {
      throw new ValidationError('Suspicious-behavior reports are currently disabled.');
    }

    const upperCategory = String(category || 'OTHER_SUSPICIOUS').trim().toUpperCase();
    const validCategory = REPORT_CATEGORIES.includes(upperCategory)
      ? upperCategory
      : 'OTHER_SUSPICIOUS';

    const cleanDescription = sanitizeUserText(description || '', {
      maxLength: 2000,
      fieldName: 'Report description',
    });
    if (cleanDescription.length < 10) {
      throw new ValidationError(
        'Please describe the suspicious behavior in at least 10 characters so staff can review it fairly.',
      );
    }

    const evidenceRefs = [];
    if (evidenceUrl) {
      evidenceRefs.push(validateSafeEvidenceUrl(evidenceUrl));
    }

    const reportId = generateReportId();
    const retainUntil = new Date(Date.now() + 90 * 86400 * 1000); // 90-day configurable evidence retention

    const report = await this.reportRepo.create({
      reportId,
      serverId,
      reporterId,
      targetUserId,
      tradeId,
      category: validCategory,
      description: cleanDescription,
      evidenceRefs,
      status: 'PENDING_REVIEW',
      retainUntil,
    });

    // Increment unverified openReportsCount ONLY — never label as scammer or auto-suspend!
    await this.userRepo.updateRiskFlags(targetUserId, { incOpenReports: 1 });

    await this.auditService.record({
      serverId,
      actorId: reporterId,
      actorType: 'USER',
      action: 'SUSPICIOUS_BEHAVIOR_REPORTED',
      targetType: 'REPORT',
      targetId: reportId,
      afterState: { status: 'PENDING_REVIEW', category: validCategory, targetUserId },
      metadata: { tradeId, evidenceCount: evidenceRefs.length },
      correlationId,
    });

    await this.antiScam.emitSuspiciousAlert({
      serverId,
      serverConfig: cfg,
      title: `New Unverified Report (${reportId})`,
      summary: `<@${reporterId}> submitted report \`${reportId}\` (${validCategory}) regarding <@${targetUserId}>. Status: \`PENDING_REVIEW\` (awaiting staff investigation).`,
      metadata: { actorId: reporterId, reportId },
    });

    return report;
  }
}
