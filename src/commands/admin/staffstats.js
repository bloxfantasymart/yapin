import { EMBED_COLORS } from '../../config/settings.js';
import { EmbedBuilder } from '../../api/messages.js';
import { parseCommandArgs } from '../../utils/argParser.js';
import { extractYapinUserId } from '../../utils/ids.js';

export const staffstatsCommand = {
  name: 'staffstats',
  description: 'Display middleman availability, active workload, and completion metrics.',
  usage: '/staffstats [user=<@id>]',
  category: 'staff',
  staffOnly: true,
  requiredRole: 'middleman',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const rawUser = kv.user || positional[0];

    if (rawUser) {
      const targetId = extractYapinUserId(rawUser) || ctx.event.author_id;
      const userDoc = await ctx.repositories.users.getOrCreate(targetId);
      const activeWorkload = await ctx.repositories.trades.countActiveForMiddleman(
        ctx.event.server_id,
        targetId,
      );

      const embed = new EmbedBuilder()
        .setTitle('🛡️ Staff Middleman Metrics')
        .setColor(EMBED_COLORS.PRIMARY)
        .setDescription(`Staff Member: <@${targetId}> (\`${targetId}\`)`)
        .addField('Availability', userDoc.staffAvailability?.available ? '🟢 Available' : '🔴 Offline', true)
        .addField('Active Assigned Trades', String(activeWorkload), true)
        .addField('Completed as Middleman', String(userDoc.tradeStats?.asMiddlemanCompleted || 0), true);

      await ctx.messagesApi.sendMessage(ctx.event.channel_id, { embeds: [embed], replyTo: ctx.event.id });
      return;
    }

    const topStaff = await ctx.repositories.users.listStaffLeaderboard({ limit: 15 });
    const availableStaff = await ctx.repositories.users.listAvailableMiddlemen();
    const lines = await Promise.all(
      topStaff.slice(0, 10).map(async (u, idx) => {
        const active = await ctx.repositories.trades.countActiveForMiddleman(
          ctx.event.server_id,
          u.yapinUserId,
        );
        const avail = u.staffAvailability?.available ? '🟢' : '⚪';
        return `${idx + 1}. ${avail} <@${u.yapinUserId}> — **${u.tradeStats?.asMiddlemanCompleted || 0}** completed (${active} active)`;
      }),
    );

    const embed = new EmbedBuilder()
      .setTitle('🛡️ Staff Middleman Overview')
      .setColor(EMBED_COLORS.PRIMARY)
      .addField('Currently Available Middlemen', String(availableStaff.length), true)
      .addField('Staff Activity', lines.length > 0 ? lines.join('\n') : 'No middleman activity recorded yet.', false);

    await ctx.messagesApi.sendMessage(ctx.event.channel_id, { embeds: [embed], replyTo: ctx.event.id });
  },
};
