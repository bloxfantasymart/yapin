import { ValidationError } from '../../utils/errors.js';
import { parseCommandArgs } from '../../utils/argParser.js';
import { extractYapinUserId } from '../../utils/ids.js';
import { buildTradeActionRows, buildTradeEmbed } from '../../utils/embeds.js';

export const reassignCommand = {
  name: 'reassign',
  description: 'Reassign an active trade to another authorized middleman with documented reason.',
  usage: '/reassign <tradeId> middleman=<@id> reason="..."',
  category: 'staff',
  staffOnly: true,
  requiredRole: 'moderator',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const tradeId = (positional[0] || kv.id || kv.trade || '').toUpperCase();
    const newMiddlemanId = extractYapinUserId(kv.middleman || kv.staff);
    const reason = kv.reason;

    if (!tradeId || !newMiddlemanId || !reason) {
      throw new ValidationError('Usage: `/reassign <TRD-...> middleman=<@uuid> reason="Detailed handoff reason"`');
    }

    const updated = await ctx.services.assignment.reassignMiddleman({
      serverId: ctx.event.server_id,
      tradeId,
      actorId: ctx.event.author_id,
      newMiddlemanId,
      reason,
      correlationId: ctx.correlationId,
    });

    const serverCfg = await ctx.repositories.serverConfig.getOrCreate(ctx.event.server_id);
    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      content: `🔄 **${updated.tradeId}** reassigned to <@${newMiddlemanId}> by <@${ctx.event.author_id}>.`,
      embeds: [buildTradeEmbed(updated, { disclaimerText: serverCfg.disclaimerText })],
      components: buildTradeActionRows(updated),
      replyTo: ctx.event.id,
    });
  },
};
