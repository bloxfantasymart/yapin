import { ValidationError } from '../utils/errors.js';
import { parseCommandArgs } from '../utils/argParser.js';
import { buildTradeActionRows, buildTradeEmbed } from '../utils/embeds.js';

export const releaseCommand = {
  name: 'release',
  description: 'Confirm final trade release after deposits are verified by the assigned middleman.',
  usage: '/release <tradeId>',
  category: 'trades',
  staffOnly: false,

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const tradeId = (positional[0] || kv.id || kv.trade || '').toUpperCase();
    if (!tradeId) {
      throw new ValidationError('Usage: `/release <TRD-...>`');
    }

    const updated = await ctx.services.confirmation.submitParticipantConfirmation({
      serverId: ctx.event.server_id,
      tradeId,
      actorId: ctx.event.author_id,
      stageHint: 'release',
      correlationId: ctx.correlationId,
    });

    const bothConfirmed =
      updated.confirmations?.traderA?.finalReleaseConfirmed &&
      updated.confirmations?.traderB?.finalReleaseConfirmed;

    const serverCfg = await ctx.repositories.serverConfigs.getOrCreate(ctx.event.server_id);
    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      content: bothConfirmed
        ? `✅ Both participants have confirmed final release on **${updated.tradeId}**! Assigned middleman <@${updated.assignedMiddlemanId}> may now finalize via \`/complete ${updated.tradeId} notes="..." confirm=yes\`.`
        : `✅ Final release confirmation recorded from <@${ctx.event.author_id}> on **${updated.tradeId}**. Waiting for counterparty confirmation.`,
      embeds: [buildTradeEmbed(updated, { disclaimerText: serverCfg.disclaimerText })],
      components: buildTradeActionRows(updated),
      replyTo: ctx.event.id,
    });
  },
};
