import { ValidationError } from '../../utils/errors.js';
import { parseCommandArgs } from '../../utils/argParser.js';
import { extractYapinUserId } from '../../utils/ids.js';
import { buildTradeActionRows, buildTradeEmbed } from '../../utils/embeds.js';

export const assignCommand = {
  name: 'assign',
  description: 'Assign an authorized middleman to a WAITING_FOR_MIDDLEMAN trade.',
  usage: '/assign <tradeId> middleman=<@id> [reason="..."]',
  category: 'staff',
  staffOnly: true,
  requiredRole: 'moderator',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const tradeId = (positional[0] || kv.id || kv.trade || '').toUpperCase();
    const targetMiddlemanId = extractYapinUserId(kv.middleman || kv.staff || positional[1]);

    if (!tradeId || !targetMiddlemanId) {
      throw new ValidationError('Usage: `/assign <TRD-...> middleman=<@uuid> [reason="..."]`');
    }

    const updated = await ctx.services.assignment.assignMiddleman({
      serverId: ctx.event.server_id,
      tradeId,
      actorId: ctx.event.author_id,
      targetMiddlemanId,
      reason: kv.reason || 'Manual staff assignment',
      correlationId: ctx.correlationId,
    });

    const serverCfg = await ctx.repositories.serverConfig.getOrCreate(ctx.event.server_id);
    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      content: `🛡️ <@${targetMiddlemanId}> assigned to **${updated.tradeId}** by <@${ctx.event.author_id}>. Both participants must confirm the middleman.`,
      embeds: [buildTradeEmbed(updated, { disclaimerText: serverCfg.disclaimerText })],
      components: buildTradeActionRows(updated),
      replyTo: ctx.event.id,
    });
  },
};
