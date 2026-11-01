import { EMBED_COLORS } from '../config/settings.js';
import { EmbedBuilder } from '../api/messages.js';
import { generateAuditId } from '../utils/ids.js';
import { getCorrelationId, logger as defaultLogger, sanitizeForLog } from '../utils/logger.js';

/**
 * Append-Only Audit & Structured Security Event Service.
 *
 * Guarantees:
 * - Every privileged, state-changing, or security-relevant event is persisted with an immutable `auditId`,
 *   `correlationId`, `beforeState`, `afterState`, and sanitized `metadata`.
 * - Never exposes raw API tokens, OAuth secrets, database credentials, or restricted private evidence URLs
 *   in public channel logs.
 */
export class AuditService {
  /**
   * @param {{
   *   auditRepo: import('../database/repositories/auditConfigRepository.js').MongooseAuditRepository,
   *   serverConfigRepo?: import('../database/repositories/auditConfigRepository.js').MongooseServerConfigRepository,
   *   messagesApi?: import('../api/messages.js').YapinMessagesApi | null,
   *   logger?: import('pino').Logger,
   * }} deps
   */
  constructor({ auditRepo, serverConfigRepo = null, messagesApi = null, logger = defaultLogger }) {
    this.auditRepo = auditRepo;
    this.serverConfigRepo = serverConfigRepo;
    this.messagesApi = messagesApi;
    this.logger = logger;
  }

  /**
   * Appends a sanitized, immutable entry to the AuditLog collection and emits a structured log line.
   *
   * @param {{
   *   serverId: string,
   *   actorId: string,
   *   actorType?: 'USER' | 'STAFF' | 'SYSTEM',
   *   action: string,
   *   targetType: 'TRADE' | 'TICKET' | 'DISPUTE' | 'USER' | 'REPORT' | 'SERVER_CONFIG' | 'SYSTEM',
   *   targetId: string,
   *   beforeState?: unknown,
   *   afterState?: unknown,
   *   metadata?: Record<string, unknown>,
   *   correlationId?: string,
   *   session?: unknown,
   *   broadcastToChannel?: boolean,
   * }} entry
   */
  async record(entry) {
    const correlationId = entry.correlationId || getCorrelationId() || null;
    const sanitizedMetadata = sanitizeForLog(entry.metadata || {});
    const sanitizedBefore = entry.beforeState !== undefined ? sanitizeForLog(entry.beforeState) : null;
    const sanitizedAfter = entry.afterState !== undefined ? sanitizeForLog(entry.afterState) : null;

    const doc = {
      auditId: generateAuditId(),
      serverId: String(entry.serverId || 'GLOBAL'),
      actorId: String(entry.actorId || 'SYSTEM'),
      actorType: entry.actorType || 'USER',
      action: String(entry.action),
      targetType: entry.targetType,
      targetId: String(entry.targetId),
      beforeState: sanitizedBefore,
      afterState: sanitizedAfter,
      correlationId,
      metadata: sanitizedMetadata,
      timestamp: new Date(),
    };

    const saved = await this.auditRepo.append(doc, entry.session || null);

    this.logger.info(
      {
        auditId: saved.auditId,
        serverId: saved.serverId,
        actorId: saved.actorId,
        actorType: saved.actorType,
        action: saved.action,
        targetType: saved.targetType,
        targetId: saved.targetId,
        correlationId,
      },
      `Audit recorded: ${saved.action}`,
    );

    if (entry.broadcastToChannel !== false && this.messagesApi && this.serverConfigRepo && entry.serverId) {
      this._postAuditSummaryCard(saved).catch((err) => {
        this.logger.warn({ err, auditId: saved.auditId }, 'Failed to post audit log card to server channel');
      });
    }

    return saved;
  }

  async queryLogs(filters) {
    return this.auditRepo.query(filters);
  }

  async _postAuditSummaryCard(saved) {
    const cfg = await this.serverConfigRepo.getOrCreate(saved.serverId);
    const channelId = cfg?.channels?.auditLogChannelId;
    if (!channelId) return;

    // Redact evidence URLs from general staff log embeds; evidence is restricted to `/review` & dispute staff view
    const embed = new EmbedBuilder()
      .setTitle(`📋 Audit: ${saved.action}`)
      .setColor(saved.actorType === 'STAFF' ? EMBED_COLORS.INFO : EMBED_COLORS.NEUTRAL)
      .addField('Audit ID', `\`${saved.auditId}\``, true)
      .addField('Actor', saved.actorId === 'SYSTEM' ? 'SYSTEM' : `<@${saved.actorId}>`, true)
      .addField('Target', `${saved.targetType}: \`${saved.targetId}\``, true)
      .setFooter(`Correlation: ${saved.correlationId || 'n/a'}`)
      .setTimestamp(saved.timestamp);

    if (saved.beforeState?.state || saved.afterState?.state) {
      embed.addField(
        'State Transition',
        `\`${saved.beforeState?.state || 'NONE'}\` → \`${saved.afterState?.state || 'NONE'}\``,
        false,
      );
    }

    await this.messagesApi.sendMessage(channelId, { embeds: [embed] });
  }
}
