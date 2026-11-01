import { ValidationError } from '../utils/errors.js';
import { parseCommandArgs } from '../utils/argParser.js';
import { buildTradeEmbed, renderProgressChecklist } from '../utils/embeds.js';

export const statusCommand = {
  name: 'status',
  description: 'Check detailed lifecycle progress, confirmations, and deposit verification status of a trade.',
  usage: '/status <tradeId>',
  category: 'trades',
  staffOnly: false,

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const tradeId = (positional[0] || kv.id || kv.trade || '').toUpperCase();
    if (!tradeId) {
      throw new ValidationError('Usage: `/status <TRD-...>`');
    }

    const { trade } = await ctx.services.trade.getTradeForViewer({
      serverId: ctx.event.server_id,
      tradeId,
      viewerId: ctx.event.author_id,
    });
    const serverCfg = await ctx.repositories.serverConfigs.getOrCreate(ctx.event.server_id);

    const embed = buildTradeEmbed(trade, { disclaimerText: serverCfg.disclaimerText }).addField(
      'Lifecycle Progress',
      renderProgressChecklist(trade),
      false,
    );

    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      embeds: [embed],
      replyTo: ctx.event.id,
    });
  },
};
