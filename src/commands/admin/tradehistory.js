import { EMBED_COLORS } from '../../config/settings.js';
import { EmbedBuilder } from '../../api/messages.js';
import { parseCommandArgs } from '../../utils/argParser.js';
import { extractYapinUserId } from '../../utils/ids.js';

export const tradehistoryCommand = {
  name: 'tradehistory',
  description: 'Search paginated server trade history by participant, middleman, or state.',
  usage: '/tradehistory [user=<@id>] [middleman=<@id>] [state=COMPLETED] [page=1]',
  category: 'staff',
  staffOnly: true,
  requiredRole: 'middleman',

  async execute(ctx) {
    const { kv } = parseCommandArgs(ctx.event.args || '');
    const participantId = kv.user ? extractYapinUserId(kv.user) : undefined;
    const assignedMiddlemanId = kv.middleman ? extractYapinUserId(kv.middleman) : undefined;
    const state = kv.state ? kv.state.toUpperCase() : undefined;
    const page = Math.max(1, Number(kv.page) || 1);

    const { items, total, limit } = await ctx.repositories.trades.listTrades({
      serverId: ctx.event.server_id,
      participantId,
      assignedMiddlemanId,
      state,
      page,
      limit: 10,
    });

    const totalPages = Math.max(1, Math.ceil(total / limit));
    const embed = new EmbedBuilder()
      .setTitle(`📚 Trade History (Page ${page}/${totalPages} • Total: ${total})`)
      .setColor(EMBED_COLORS.INFO)
      .setDescription(
        items.length === 0
          ? 'No matching trade records found.'
          : items
              .map(
                (t) =>
                  `• **${t.tradeId}** \`${t.state}\` — <@${t.traderAId}> ↔ <@${t.traderBId}> (MM: ${t.assignedMiddlemanId ? `<@${t.assignedMiddlemanId}>` : 'None'})`,
              )
              .join('\n'),
      );

    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      embeds: [embed],
      replyTo: ctx.event.id,
    });
  },
};
