import { ValidationError } from '../utils/errors.js';
import { parseCommandArgs } from '../utils/argParser.js';
import { buildTradeActionRows, buildTradeEmbed } from '../utils/embeds.js';

export const confirmCommand = {
  name: 'confirm',
  description: 'Submit your stage confirmation (terms, assigned middleman, or final release).',
  usage: '/confirm <tradeId>',
  category: 'trades',
  staffOnly: false,

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const tradeId = (positional[0] || kv.id || kv.trade || '').toUpperCase();
    if (!tradeId) {
      throw new ValidationError('Usage: `/confirm <TRD-...>`');
    }

    const updated = await ctx.services.confirmation.submitParticipantConfirmation({
      serverId: ctx.event.server_id,
      tradeId,
      actorId: ctx.event.author_id,
      correlationId: ctx.correlationId,
    });

    const serverCfg = await ctx.repositories.serverConfigs.getOrCreate(ctx.event.server_id);
    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      content: `✅ Confirmation recorded from <@${ctx.event.author_id}> on **${updated.tradeId}** (state: \`${updated.state}\`).`,
      embeds: [buildTradeEmbed(updated, { disclaimerText: serverCfg.disclaimerText })],
      components: buildTradeActionRows(updated),
      replyTo: ctx.event.id,
    });
  },
};
