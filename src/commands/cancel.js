import { ValidationError } from '../utils/errors.js';
import { parseCommandArgs } from '../utils/argParser.js';

export const cancelCommand = {
  name: 'cancel',
  description: 'Cancel a trade before deposits begin (post-deposit cancellation requires staff or dispute).',
  usage: '/cancel <tradeId> [reason="..."]',
  category: 'trades',
  staffOnly: false,

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const tradeId = (positional[0] || kv.id || kv.trade || '').toUpperCase();
    if (!tradeId) {
      throw new ValidationError('Usage: `/cancel <TRD-...> [reason="..."]`');
    }

    const reason = kv.reason || positional.slice(1).join(' ') || 'Cancelled by participant';
    const trade = await ctx.services.trade.cancelTradeByParticipant({
      serverId: ctx.event.server_id,
      tradeId,
      actorId: ctx.event.author_id,
      reason,
      correlationId: ctx.correlationId,
    });

    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      content: `🚫 Trade **${trade.tradeId}** cancelled by <@${ctx.event.author_id}>.`,
      replyTo: ctx.event.id,
    });
  },
};
