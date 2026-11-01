import { ValidationError } from '../../utils/errors.js';
import { parseCommandArgs, parseYesBoolean } from '../../utils/argParser.js';
import { buildTradeEmbed } from '../../utils/embeds.js';

export const canceltradeCommand = {
  name: 'canceltrade',
  description: 'Force-cancel a non-terminal trade as authorized staff with explicit confirmation.',
  usage: '/canceltrade <tradeId> reason="Documented cancellation reason" confirm=yes',
  category: 'staff',
  staffOnly: true,
  requiredRole: 'moderator',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const tradeId = (positional[0] || kv.id || kv.trade || '').toUpperCase();
    const reason = kv.reason || '';
    const confirm = parseYesBoolean(kv.confirm);

    if (!tradeId || !reason) {
      throw new ValidationError(
        'Usage: `/canceltrade <TRD-...> reason="Detailed cancellation reason" confirm=yes`',
      );
    }

    const cancelled = await ctx.services.trade.cancelTradeByStaff({
      serverId: ctx.event.server_id,
      tradeId,
      actorId: ctx.event.author_id,
      reason,
      confirm,
      correlationId: ctx.correlationId,
    });

    const serverCfg = await ctx.repositories.serverConfig.getOrCreate(ctx.event.server_id);
    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      content: `🚫 Trade **${cancelled.tradeId}** cancelled by staff <@${ctx.event.author_id}>.`,
      embeds: [buildTradeEmbed(cancelled, { disclaimerText: serverCfg.disclaimerText })],
      replyTo: ctx.event.id,
    });
  },
};
