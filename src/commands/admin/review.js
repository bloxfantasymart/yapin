import { EMBED_COLORS } from '../../config/settings.js';
import { EmbedBuilder } from '../../api/messages.js';
import { ValidationError } from '../../utils/errors.js';
import { parseCommandArgs } from '../../utils/argParser.js';

export const reviewCommand = {
  name: 'review',
  description: 'Staff review of full trade audit history, deposit references, and dispute records.',
  usage: '/review <tradeId>',
  category: 'staff',
  staffOnly: true,
  requiredRole: 'middleman',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const tradeId = (positional[0] || kv.id || kv.trade || '').toUpperCase();
    if (!tradeId) {
      throw new ValidationError('Usage: `/review <TRD-...>`');
    }

    const { trade } = await ctx.services.trade.getTradeForViewer({
      serverId: ctx.event.server_id,
      tradeId,
      viewerId: ctx.event.author_id,
    });

    const depA = trade.deposits?.traderA || {};
    const depB = trade.deposits?.traderB || {};
    const historyTail = (trade.stateHistory || [])
      .slice(-6)
      .map((h) => `• \`${h.fromState || 'INIT'} -> ${h.toState}\` by \`${h.actorId}\``)
      .join('\n');

    const embed = new EmbedBuilder()
      .setTitle(`🕵️ Staff Trade Review — ${trade.tradeId}`)
      .setColor(EMBED_COLORS.DISPUTE)
      .setDescription(
        `State: \`${trade.state}\` • Version: \`v${trade.version}\` • Active Dispute: \`${trade.activeDisputeId || 'None'}\`\n` +
          '_Confidential Warning: Check channel privacy before sharing sensitive references publicly._',
      )
      .addField(
        'Trader A Deposit Record',
        `Status: \`${depA.status}\`\nRef: \`${depA.reference || 'None'}\`\nEvidence URLs: ${depA.evidenceUrls?.length || 0}`,
        true,
      )
      .addField(
        'Trader B Deposit Record',
        `Status: \`${depB.status}\`\nRef: \`${depB.reference || 'None'}\`\nEvidence URLs: ${depB.evidenceUrls?.length || 0}`,
        true,
      )
      .addField('Recent State Transitions', historyTail || 'None', false);

    if (trade.completionRecord?.completedBy) {
      embed.addField(
        'Completion Record',
        `By <@${trade.completionRecord.completedBy}>: ${trade.completionRecord.decisionNotes}`,
        false,
      );
    }

    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      embeds: [embed],
      replyTo: ctx.event.id,
    });
  },
};
