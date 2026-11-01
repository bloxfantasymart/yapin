import { ValidationError } from '../utils/errors.js';
import { parseCommandArgs } from '../utils/argParser.js';
import { buildTradeActionRows, buildTradeEmbed } from '../utils/embeds.js';

export const claimCommand = {
  name: 'claim',
  description: 'Claim an available WAITING_FOR_MIDDLEMAN trade as an authorized middleman.',
  usage: '/claim <tradeId>',
  category: 'staff',
  staffOnly: true,
  requiredRole: 'middleman',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const tradeId = (positional[0] || kv.id || kv.trade || '').toUpperCase();
    if (!tradeId) {
      throw new ValidationError('Usage: `/claim <TRD-...>`');
    }

    const updated = await ctx.services.assignment.claimTrade({
      serverId: ctx.event.server_id,
      tradeId,
      actorId: ctx.event.author_id,
      correlationId: ctx.correlationId,
    });

    const serverCfg = await ctx.repositories.serverConfig.getOrCreate(ctx.event.server_id);
    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      content: `🛡️ Middleman <@${ctx.event.author_id}> claimed **${updated.tradeId}**! Both participants (<@${updated.traderAId}> & <@${updated.traderBId}>) must now confirm the assigned middleman.`,
      embeds: [buildTradeEmbed(updated, { disclaimerText: serverCfg.disclaimerText })],
      components: buildTradeActionRows(updated),
      replyTo: ctx.event.id,
    });
  },
};
