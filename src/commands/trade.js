import { EMBED_COLORS } from '../config/settings.js';
import { EmbedBuilder } from '../api/messages.js';
import { parseCommandArgs } from '../utils/argParser.js';
import { buildTradeActionRows, buildTradeEmbed } from '../utils/embeds.js';

export const tradeCommand = {
  name: 'trade',
  description: 'View an active trade card and interactive action controls, or list your active trades.',
  usage: '/trade [tradeId]',
  category: 'trades',
  staffOnly: false,

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const tradeId = (positional[0] || kv.id || kv.trade || '').toUpperCase();

    if (!tradeId) {
      const { items } = await ctx.repositories.trades.listTrades({
        serverId: ctx.event.server_id,
        participantId: ctx.event.author_id,
        limit: 10,
      });

      const embed = new EmbedBuilder()
        .setTitle('📋 Your Recent Trades')
        .setColor(EMBED_COLORS.INFO)
        .setDescription(
          items.length === 0
            ? 'You have no recorded trades on this server. Use `/middleman` to open one.'
            : items
                .map(
                  (t) =>
                    `• **${t.tradeId}** — \`${t.state}\` — ${t.items?.primaryAsset || 'Asset'} (with <@${t.traderAId === ctx.event.author_id ? t.traderBId : t.traderAId}>)`,
                )
                .join('\n'),
        );

      await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
        embeds: [embed],
        replyTo: ctx.event.id,
      });
      return;
    }

    const { trade } = await ctx.services.trade.getTradeForViewer({
      serverId: ctx.event.server_id,
      tradeId,
      viewerId: ctx.event.author_id,
    });

    const serverCfg = await ctx.repositories.serverConfigs.getOrCreate(ctx.event.server_id);
    const embed = buildTradeEmbed(trade, { disclaimerText: serverCfg.disclaimerText });
    const components = buildTradeActionRows(trade);

    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      embeds: [embed],
      components,
      replyTo: ctx.event.id,
    });
  },
};
