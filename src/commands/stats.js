import { EMBED_COLORS } from '../config/settings.js';
import { EmbedBuilder } from '../api/messages.js';

export const statsCommand = {
  name: 'stats',
  description: 'View server-wide middleman trade statistics and available staff count.',
  usage: '/stats',
  category: 'utility',
  staffOnly: false,

  async execute(ctx) {
    const { countsByState = {} } = await ctx.repositories.trades.getServerStats(ctx.event.server_id);
    const availableStaff = await ctx.repositories.users.listAvailableMiddlemen();

    const completed = countsByState.COMPLETED || 0;
    const active = Object.entries(countsByState)
      .filter(([state]) => !['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(state))
      .reduce((acc, [, n]) => acc + n, 0);
    const disputed = countsByState.DISPUTED || 0;

    const embed = new EmbedBuilder()
      .setTitle('📊 Server Middleman Statistics')
      .setColor(EMBED_COLORS.PRIMARY)
      .addField('Completed Trades', String(completed), true)
      .addField('Active Trades', String(active), true)
      .addField('Open Disputes', String(disputed), true)
      .addField('Available Middlemen', String(availableStaff.length), true);

    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      embeds: [embed],
      replyTo: ctx.event.id,
    });
  },
};
