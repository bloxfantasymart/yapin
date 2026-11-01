import { ValidationError } from '../../utils/errors.js';
import { parseCommandArgs } from '../../utils/argParser.js';
import { buildTradeActionRows, buildTradeEmbed } from '../../utils/embeds.js';

export const verifydepositCommand = {
  name: 'verifydeposit',
  description: 'Verify or reject a participant deposit after independent staff inspection.',
  usage:
    '/verifydeposit <tradeId> trader=A|B|<@id> status=CONFIRMED|REJECTED|UNDER_REVIEW|NOT_REQUIRED notes="Verification summary"',
  category: 'staff',
  staffOnly: true,
  requiredRole: 'middleman',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const tradeId = (positional[0] || kv.id || kv.trade || '').toUpperCase();
    const rawTrader = kv.trader || positional[1];
    const decision = (kv.status || kv.decision || positional[2] || '').toUpperCase();
    const notes = kv.notes || '';

    if (!tradeId || !rawTrader || !decision) {
      throw new ValidationError(
        'Usage: `/verifydeposit <TRD-...> trader=A|B status=CONFIRMED|REJECTED|UNDER_REVIEW|NOT_REQUIRED notes="Verified transfer #..."`',
      );
    }

    const updated = await ctx.services.deposit.verifyDeposit({
      serverId: ctx.event.server_id,
      tradeId,
      traderSideOrUserId: rawTrader,
      decision,
      notes,
      actorId: ctx.event.author_id,
      correlationId: ctx.correlationId,
    });

    const serverCfg = await ctx.repositories.serverConfigs.getOrCreate(ctx.event.server_id);
    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      content: `🔎 Deposit (${rawTrader}) marked **\`${decision}\`** by <@${ctx.event.author_id}> on **${updated.tradeId}** (state: \`${updated.state}\`).`,
      embeds: [buildTradeEmbed(updated, { disclaimerText: serverCfg.disclaimerText })],
      components: buildTradeActionRows(updated),
      replyTo: ctx.event.id,
    });
  },
};
