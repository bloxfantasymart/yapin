import { ValidationError } from '../utils/errors.js';
import { parseCommandArgs } from '../utils/argParser.js';
import { buildTradeActionRows, buildTradeEmbed } from '../utils/embeds.js';

export const depositCommand = {
  name: 'deposit',
  description: 'Report sending your agreed asset/payment for middleman verification (does not auto-confirm).',
  usage: '/deposit <tradeId> ref="Transfer ID / Receipt" [proof=https://...] [notes="..."]',
  category: 'trades',
  staffOnly: false,

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const tradeId = (positional[0] || kv.id || kv.trade || '').toUpperCase();
    if (!tradeId || !kv.ref) {
      throw new ValidationError(
        'Usage: `/deposit <TRD-...> ref="Transaction or delivery reference" [proof=https://...] [notes="..."]`',
      );
    }

    const trade = await ctx.services.deposit.reportDeposit({
      serverId: ctx.event.server_id,
      tradeId,
      actorId: ctx.event.author_id,
      reference: kv.ref,
      evidenceUrl: kv.proof || null,
      notes: kv.notes || '',
      correlationId: ctx.correlationId,
    });

    const serverCfg = await ctx.repositories.serverConfigs.getOrCreate(ctx.event.server_id);
    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      content:
        `📦 <@${ctx.event.author_id}> reported deposit as **REPORTED_SENT** on **${trade.tradeId}**.\n` +
        `⚠️ **Notice:** Self-reported deposits are NEVER marked \`CONFIRMED\` automatically. Assigned middleman <@${trade.assignedMiddlemanId}> must independently verify via \`/verifydeposit\`.`,
      embeds: [buildTradeEmbed(trade, { disclaimerText: serverCfg.disclaimerText })],
      components: buildTradeActionRows(trade),
      replyTo: ctx.event.id,
    });
  },
};
