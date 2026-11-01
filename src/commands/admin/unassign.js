import { ValidationError } from '../../utils/errors.js';
import { parseCommandArgs } from '../../utils/argParser.js';
import { buildTradeActionRows, buildTradeEmbed } from '../../utils/embeds.js';

export const unassignCommand = {
  name: 'unassign',
  description: 'Unassign the middleman from a MIDDLEMAN_ASSIGNED trade (returns to WAITING_FOR_MIDDLEMAN).',
  usage: '/unassign <tradeId> reason="..."',
  category: 'staff',
  staffOnly: true,
  requiredRole: 'middleman',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const tradeId = (positional[0] || kv.id || kv.trade || '').toUpperCase();
    const reason = kv.reason || positional.slice(1).join(' ');
    if (!tradeId || !reason) {
      throw new ValidationError('Usage: `/unassign <TRD-...> reason="Explain reason"`');
    }

    const updated = await ctx.services.assignment.unassignMiddleman({
      serverId: ctx.event.server_id,
      tradeId,
      actorId: ctx.event.author_id,
      reason,
      correlationId: ctx.correlationId,
    });

    const serverCfg = await ctx.repositories.serverConfig.getOrCreate(ctx.event.server_id);
    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      content: `🔄 Middleman unassigned from **${updated.tradeId}** (state: \`${updated.state}\`).`,
      embeds: [buildTradeEmbed(updated, { disclaimerText: serverCfg.disclaimerText })],
      components: buildTradeActionRows(updated),
      replyTo: ctx.event.id,
    });
  },
};
