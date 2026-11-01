import { ValidationError } from '../../utils/errors.js';
import { parseCommandArgs, parseYesBoolean } from '../../utils/argParser.js';
import { buildTradeActionRows, buildTradeEmbed } from '../../utils/embeds.js';

export const resolveCommand = {
  name: 'resolve',
  description: 'Resolve an open trade dispute with documented decision and explicit confirmation.',
  usage: '/resolve <DSP-... or TRD-...> outcome=RESUME_TRADE|CANCEL_TRADE decision="Documented ruling" confirm=yes',
  category: 'staff',
  staffOnly: true,
  requiredRole: 'moderator',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const disputeIdOrTradeId = (positional[0] || kv.id || kv.dispute || kv.trade || '').toUpperCase();
    const outcome = (kv.outcome || '').toUpperCase();
    const decisionSummary = kv.decision || kv.reason || '';
    const confirm = parseYesBoolean(kv.confirm);

    if (!disputeIdOrTradeId || !outcome || !decisionSummary) {
      throw new ValidationError(
        'Usage: `/resolve <DSP-... or TRD-...> outcome=RESUME_TRADE|CANCEL_TRADE decision="Detailed findings" confirm=yes`',
      );
    }

    const { dispute, trade } = await ctx.services.dispute.resolveDispute({
      serverId: ctx.event.server_id,
      disputeIdOrTradeId,
      actorId: ctx.event.author_id,
      outcome,
      decisionSummary,
      confirm,
      correlationId: ctx.correlationId,
    });

    const serverCfg = await ctx.repositories.serverConfigs.getOrCreate(ctx.event.server_id);
    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      content: `⚖️ Dispute **${dispute.disputeId}** resolved as **\`${outcome}\`** by <@${ctx.event.author_id}>. Trade **${trade.tradeId}** is now \`${trade.state}\`.`,
      embeds: [buildTradeEmbed(trade, { disclaimerText: serverCfg.disclaimerText })],
      components: buildTradeActionRows(trade),
      replyTo: ctx.event.id,
    });
  },
};
