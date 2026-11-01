import { ValidationError } from '../utils/errors.js';
import { parseCommandArgs } from '../utils/argParser.js';
import { buildTradeEmbed } from '../utils/embeds.js';

export const disputeCommand = {
  name: 'dispute',
  description: 'Open a dispute on an active trade and immediately freeze completion until staff resolution.',
  usage: '/dispute <tradeId> reason="Detailed reason" [ref="..."] [proof=https://...]',
  category: 'disputes',
  staffOnly: false,

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const tradeId = (positional[0] || kv.id || kv.trade || '').toUpperCase();
    const reason = kv.reason || positional.slice(1).join(' ');

    if (!tradeId || !reason) {
      throw new ValidationError(
        'Usage: `/dispute <TRD-...> reason="Explain the issue in at least 5 characters" [proof=https://...]`',
      );
    }

    const { dispute, trade } = await ctx.services.dispute.openDispute({
      serverId: ctx.event.server_id,
      tradeId,
      actorId: ctx.event.author_id,
      reason,
      evidenceRef: kv.ref || '',
      evidenceUrl: kv.proof || null,
      correlationId: ctx.correlationId,
    });

    const serverCfg = await ctx.repositories.serverConfigs.getOrCreate(ctx.event.server_id);
    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      content:
        `⚠️ **DISPUTE OPENED (${dispute.disputeId})** — Trade **${trade.tradeId}** is immediately **FROZEN (\`DISPUTED\`)**.\n` +
        `Completion is blocked until an authorized moderator resolves \`${dispute.disputeId}\` via \`/resolve\`.`,
      embeds: [buildTradeEmbed(trade, { disclaimerText: serverCfg.disclaimerText })],
      replyTo: ctx.event.id,
    });
  },
};
