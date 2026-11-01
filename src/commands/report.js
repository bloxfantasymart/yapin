import { EMBED_COLORS } from '../config/settings.js';
import { EmbedBuilder } from '../api/messages.js';
import { ValidationError } from '../utils/errors.js';
import { parseCommandArgs } from '../utils/argParser.js';
import { extractYapinUserId } from '../utils/ids.js';

export const reportCommand = {
  name: 'report',
  description: 'Report suspicious trade behavior, fake proof, or impersonation for staff review.',
  usage:
    '/report user=<@id> [category=IMPERSONATION|FAKE_PROOF|CHARGEBACK_THREAT|OFF_PLATFORM_LURE|OTHER_SUSPICIOUS] reason="Detailed explanation" [trade=TRD-...] [proof=https://...]',
  category: 'moderation',
  staffOnly: false,

  async execute(ctx) {
    const { kv } = parseCommandArgs(ctx.event.args || '');
    const targetUserId = extractYapinUserId(kv.user || kv.target);
    const description = kv.reason || kv.description;
    if (!targetUserId || !description) {
      throw new ValidationError(
        'Usage: `/report user=<@uuid> category=IMPERSONATION reason="Detailed description" [trade=TRD-...] [proof=https://...]`',
      );
    }

    const report = await ctx.services.moderation.submitReport({
      serverId: ctx.event.server_id,
      reporterId: ctx.event.author_id,
      targetUserId,
      tradeId: kv.trade ? kv.trade.toUpperCase() : null,
      category: (kv.category || 'OTHER_SUSPICIOUS').toUpperCase(),
      description,
      evidenceUrl: kv.proof || null,
      correlationId: ctx.correlationId,
    });

    const embed = new EmbedBuilder()
      .setTitle(`🛡️ Report Submitted — ${report.reportId}`)
      .setDescription(
        'Your report has been queued for confidential staff review (`PENDING_REVIEW`).\n' +
          '_Note: Unverified reports never automatically label or suspend a user; moderators verify evidence first._',
      )
      .setColor(EMBED_COLORS.WARNING)
      .addField('Category', report.category, true)
      .addField('Related Trade', report.tradeId || 'None', true);

    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      embeds: [embed],
      replyTo: ctx.event.id,
    });
  },
};
