import { EmbedBuilder } from '../api/messages.js';
import { BOT_BRAND, EMBED_COLORS } from '../config/settings.js';

export const dailyCommand = {
  name: 'daily',
  description: 'Open your daily MurderMystery2 Sheriff Mystery Crate for bonus XP.',
  usage: '/daily',
  category: 'leveling',
  staffOnly: false,

  async execute(ctx) {
    const res = await ctx.services.leveling.claimDaily({
      serverId: ctx.event.server_id,
      userId: ctx.event.author_id,
      username: ctx.event.username || null,
      channelId: ctx.event.channel_id,
    });

    const embed = new EmbedBuilder()
      .setTitle('📦 Sheriff Mystery Crate Unboxed!')
      .setColor(EMBED_COLORS.GOLD)
      .setDescription(
        `You claimed **+${res.gainedXp} XP**!\n` +
          `• **Daily Streak:** 🔥 ${res.streak} day(s)\n` +
          `• **Current Rank:** ${res.user.leveling.rankTitle} (Lv. **${res.user.leveling.level}**)`,
      )
      .setFooter(BOT_BRAND.footer);

    await ctx.reply({ embeds: [embed] });
  },
};
