import { ValidationError } from '../../utils/errors.js';
import { parseCommandArgs, parseYesBoolean } from '../../utils/argParser.js';
import { buildTradeEmbed } from '../../utils/embeds.js';

export const completeCommand = {
  name: 'complete',
  description: 'Finalize a trade as COMPLETED after dual confirmations, deposit verification, and explicit confirmation.',
  usage: '/complete <tradeId> notes="Final verification summary" [evidence="..."] confirm=yes',
  category: 'staff',
  staffOnly: true,
  requiredRole: 'middleman',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const tradeId = (positional[0] || kv.id || kv.trade || '').toUpperCase();
    const decisionNotes = kv.notes || kv.decision || '';
    const confirm = parseYesBoolean(kv.confirm);

    if (!tradeId || !decisionNotes) {
      throw new ValidationError(
        'Usage: `/complete <TRD-...> notes="Documented final verification notes" [evidence="..."] confirm=yes`',
      );
    }

    const completed = await ctx.services.trade.completeTrade({
      serverId: ctx.event.server_id,
      tradeId,
      actorId: ctx.event.author_id,
      decisionNotes,
      evidenceSummary: kv.evidence || '',
      confirm,
      idempotencyKey: `complete:${ctx.event.id}`,
      correlationId: ctx.correlationId,
    });

    const serverCfg = await ctx.repositories.serverConfig.getOrCreate(ctx.event.server_id);
    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      content: `🏁 Trade **${completed.tradeId}** has been verified and finalized as **COMPLETED** by <@${ctx.event.author_id}>!`,
      embeds: [buildTradeEmbed(completed, { disclaimerText: serverCfg.disclaimerText })],
      replyTo: ctx.event.id,
    });
  },
};
