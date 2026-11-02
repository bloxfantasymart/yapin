import { EmbedBuilder } from '../api/messages.js';
import { BOT_BRAND, EMBED_COLORS } from '../config/settings.js';
import { redactSensitiveText } from '../utils/errors.js';
import { generateAuditId, userMention } from '../utils/ids.js';

function scrubValue(val, depth = 0) {
  if (depth > 5 || val === null || val === undefined) return val ?? null;
  if (typeof val === 'string') return redactSensitiveText(val);
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  if (val instanceof Date) return val.toISOString();
  if (Array.isArray(val)) return val.slice(0, 50).map((v) => scrubValue(v, depth + 1));
  if (typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      if (/(token|secret|password|cookie|authorization)/i.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = scrubValue(v, depth + 1);
      }
    }
    return out;
  }
  return String(val);
}

const LOG_STREAM_CHANNEL_KEY = Object.freeze({
  mod: 'modLogChannelId',
  member: 'memberLogChannelId',
  ticket: 'ticketLogChannelId',
  app: 'modAppLogChannelId',
  rp: 'rpLogChannelId',
  level: 'levelUpChannelId',
  alert: 'alertChannelId',
});

/**
 * Unified Append-Only Audit & Multi-Channel Server Event Logger for **MM2 Helper**.
 */
export class LogService {
  constructor({ auditRepo, serverConfigRepo = null, messagesApi = null, logger = null }) {
    this.auditRepo = auditRepo;
    this.serverConfigRepo = serverConfigRepo;
    this.messagesApi = messagesApi;
    this.logger = logger;
  }

  /**
   * Appends an immutable entry to `audit_logs.json` and optionally dispatches a themed
   * MurderMystery2 log embed to the configured server log channel.
   */
  async record({
    serverId,
    actorId,
    actorType = 'USER',
    action,
    targetType,
    targetId,
    beforeState = null,
    afterState = null,
    metadata = {},
    correlationId = null,
    stream = null,
    embed = null,
  }) {
    const entry = {
      auditId: generateAuditId(),
      serverId: String(serverId),
      actorId: String(actorId),
      actorType,
      action: String(action),
      targetType,
      targetId: String(targetId),
      beforeState: scrubValue(beforeState),
      afterState: scrubValue(afterState),
      correlationId: correlationId || null,
      metadata: scrubValue(metadata) || {},
      timestamp: new Date(),
    };

    const created = await this.auditRepo.append(entry);

    if (stream && this.serverConfigRepo && this.messagesApi) {
      this._dispatchChannelLog(serverId, stream, created, embed).catch((err) => {
        this.logger?.debug?.({ errMessage: err?.message, stream }, 'Channel log dispatch skipped');
      });
    }

    return created;
  }

  async _dispatchChannelLog(serverId, stream, auditEntry, customEmbed = null) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    const channelField = LOG_STREAM_CHANNEL_KEY[stream];
    const targetChannelId =
      (channelField && cfg?.channels?.[channelField]) || cfg?.channels?.modLogChannelId;
    if (!targetChannelId) return;

    const logEmbed =
      customEmbed ||
      new EmbedBuilder()
        .setTitle(`📡 MurderMystery2 Log • ${auditEntry.action}`)
        .setColor(stream === 'alert' || stream === 'mod' ? EMBED_COLORS.MURDERER : EMBED_COLORS.NOIR)
        .addField('Actor', auditEntry.actorType === 'SYSTEM' ? 'MM2 Helper' : userMention(auditEntry.actorId), true)
        .addField('Target', `\`${auditEntry.targetType}\` (${auditEntry.targetId})`, true)
        .addField('Audit ID', `\`${auditEntry.auditId}\``, true)
        .setFooter(BOT_BRAND.footer)
        .setTimestamp(auditEntry.timestamp);

    await this.messagesApi.sendMessage(targetChannelId, { embeds: [logEmbed] });
  }
}
