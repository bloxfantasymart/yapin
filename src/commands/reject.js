import { ValidationError } from '../utils/errors.js';
import { parseCommandArgs } from '../utils/argParser.js';

export const rejectCommand = {
  name: 'reject',
  description: 'Reject a pending middleman trade invitation.',
  usage: '/reject <tradeId> [reason="..."]',
  category: 'trades',
  staffOnly: false,

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const tradeId = (positional[0] || kv.id || kv.trade || '').toUpperCase();
    if (!tradeId) {
      throw new ValidationError('Usage: `/reject <TRD-...> [reason="..."]`');
    }

    const reason = kv.reason || positional.slice(1).join(' ') || 'Declined trade invitation';
    const trade = await ctx.services.confirmation.rejectTrade({
      serverId: ctx.event.server_id,
      tradeId,
      actorId: ctx.event.author_id,
      reason,
      correlationId: ctx.correlationId,
    });

    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      content: `❌ Trade **${trade.tradeId}** has been rejected by <@${ctx.event.author_id}>.`,
      replyTo: ctx.event.id,
    });
  },
};
