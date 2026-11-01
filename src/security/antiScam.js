import { createHash } from 'node:crypto';
import { EMBED_COLORS } from '../config/settings.js';
import { EmbedBuilder } from '../api/messages.js';
import { AuthorizationError, ConflictError, ValidationError } from '../utils/errors.js';
import { userMention } from '../utils/ids.js';

/**
 * Computes a deterministic SHA-256 fingerprint for a trade pair and asset set
 * so duplicate active requests are blocked regardless of spacing or casing differences.
 */
export function computeTradeFingerprint({ serverId, traderAId, traderBId, primaryAsset, traderAGiving, traderBGiving }) {
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const participants = [String(traderAId), String(traderBId)].sort().join(':');
  const payload = [
    String(serverId),
    participants,
    norm(primaryAsset),
    norm(traderAGiving),
    norm(traderBGiving),
  ].join('||');
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Scam Prevention, Anti-Impersonation, Suspension & Conflict-of-Interest Verifier.
 */
export class AntiScamService {
  /**
   * @param {{
   *   userRepo: import('../database/repositories/userRepository.js').MongooseUserRepository,
   *   permissionsApi: import('../api/permissions.js').YapinPermissionsApi,
   *   messagesApi?: import('../api/messages.js').YapinMessagesApi,
   *   auditService?: import('../middleman/auditService.js').AuditService,
   * }} deps
   */
  constructor({ userRepo, permissionsApi, messagesApi = null, auditService = null }) {
    this.userRepo = userRepo;
    this.permissionsApi = permissionsApi;
    this.messagesApi = messagesApi;
    this.auditService = auditService;
  }

  /**
   * Verifies whether a user is currently suspended (auto-expiring temporary suspensions cleanly)
   * or restricted under server policy.
   */
  async assertUserEligibleForTrade(serverId, userId, serverConfig = null) {
    const userDoc = await this.userRepo.getOrCreate(userId);
    const restrictSuspended = serverConfig?.features?.restrictSuspendedUsers !== false;

    if (userDoc?.suspension?.active) {
      const expiresAt = userDoc.suspension.expiresAt ? new Date(userDoc.suspension.expiresAt) : null;
      if (expiresAt && expiresAt.getTime() <= Date.now()) {
        await this.userRepo.unsuspendUser(userId, { liftedBy: 'SYSTEM_EXPIRY' });
      } else if (restrictSuspended) {
        throw new AuthorizationError(
          `User ${userMention(userId)} is currently suspended from middleman trades (${userDoc.suspension.reason || 'policy restriction'}).`,
        );
      }
    }

    if (
      serverConfig?.features?.restrictUnderReviewUsers &&
      userDoc?.riskFlags?.underStaffReview
    ) {
      throw new AuthorizationError(
        `User ${userMention(userId)} has an account restriction pending staff review and cannot open new trades.`,
      );
    }

    return userDoc;
  }

  /**
   * Verifies both traders are real members of the Yapin server via stable IDs
   * and checks for display-name impersonation collisions against server staff or each other.
   */
  async verifyParticipantsIdentity({ serverId, traderAId, traderBId, allowSelfTrade = false, serverConfig = null }) {
    if (!allowSelfTrade && traderAId === traderBId) {
      throw new ValidationError('Self-trades are not permitted: Trader A and Trader B must be distinct Yapin users.');
    }

    const [accessA, accessB] = await Promise.all([
      this.permissionsApi.resolveMemberAccess(serverId, traderAId, serverConfig),
      this.permissionsApi.resolveMemberAccess(serverId, traderBId, serverConfig),
    ]);

    if (!accessA.isMember) {
      throw new ValidationError(`Trader A (${userMention(traderAId)}) is not a member of this Yapin server.`);
    }
    if (!accessB.isMember) {
      throw new ValidationError(`Trader B (${userMention(traderBId)}) is not a member of this Yapin server.`);
    }

    // Anti-impersonation check: warn if two distinct stable user IDs share an identical normalized display name
    const nameA = this._extractDisplayName(accessA.member);
    const nameB = this._extractDisplayName(accessB.member);
    const warnings = [];

    if (traderAId !== traderBId && nameA && nameB && nameA.toLowerCase() === nameB.toLowerCase()) {
      warnings.push(
        `Anti-impersonation notice: Both participants share the display name "${nameA}" with different stable Yapin IDs.`,
      );
    }

    return { accessA, accessB, warnings };
  }

  /**
   * Enforces strict Staff Conflict-of-Interest rules:
   * A staff member CANNOT claim, assign themselves to, verify deposits for, resolve disputes for,
   * or complete ANY trade in which they are Trader A or Trader B!
   */
  assertNoConflictOfInterest(trade, staffUserId, actionLabel = 'manage') {
    const id = String(staffUserId);
    if (String(trade.traderAId) === id || String(trade.traderBId) === id) {
      throw new ConflictError(
        `Conflict-of-interest violation: Staff member ${userMention(id)} is a participant in trade ${trade.tradeId} and cannot ${actionLabel} it.`,
      );
    }
  }

  /**
   * Sends a sanitized suspicious-activity alert to the server's configured alert channel if enabled.
   */
  async emitSuspiciousAlert({ serverId, serverConfig, title, summary, metadata = {} }) {
    if (this.auditService) {
      await this.auditService.record({
        serverId,
        actorId: metadata.actorId || 'SYSTEM',
        actorType: 'SYSTEM',
        action: 'SUSPICIOUS_ACTIVITY_ALERT',
        targetType: 'SYSTEM',
        targetId: serverId,
        metadata: { title, summary, ...metadata },
      });
    }

    const alertChannelId = serverConfig?.channels?.alertChannelId;
    const enabled = serverConfig?.features?.suspiciousActivityAlertsEnabled !== false;
    if (!enabled || !alertChannelId || !this.messagesApi) return;

    const embed = new EmbedBuilder()
      .setTitle(`⚠️ Security Alert — ${title}`)
      .setDescription(summary)
      .setColor(EMBED_COLORS.WARNING)
      .setTimestamp();

    await this.messagesApi.sendMessage(alertChannelId, { embeds: [embed] }).catch(() => undefined);
  }

  _extractDisplayName(member) {
    if (!member) return '';
    return String(
      member.nickname || member.user?.display_name || member.user?.username || member.username || '',
    ).trim();
  }
}
