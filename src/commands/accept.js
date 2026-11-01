import { ValidationError } from '../utils/errors.js';
import { parseCommandArgs } from '../utils/argParser.js';
import { buildTradeActionRows, buildTradeEmbed } from '../utils/embeds.js';

export const acceptCommand = {
  name: 'accept',
  description: 'Accept a middleman trade invitation and confirm its terms.',
  usage: '/accept <tradeId>',
  category: 'trades',
  staffOnly: false,

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const tradeId = (positional[0] || kv.id || kv.trade || '').toUpperCase();
    if (!tradeId) {
      throw new ValidationError('Usage: `/accept <TRD-...>`');
    }

    const finalTrade = await ctx.services.confirmation.acceptTrade({
      serverId: ctx.event.server_id,
      tradeId,
      actorId: ctx.event.author_id,
      correlationId: ctx.correlationId,
    });

    const serverCfg = await ctx.repositories.serverConfigs.getOrCreate(ctx.event.server_id);
    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      content: `✅ <@${ctx.event.author_id}> accepted trade **${finalTrade.tradeId}**! Current state: \`${finalTrade.state}\`.`,
      embeds: [buildTradeEmbed(finalTrade, { disclaimerText: serverCfg.disclaimerText })],
      components: buildTradeActionRows(finalTrade),
      replyTo: ctx.event.id,
    });
  },
};
