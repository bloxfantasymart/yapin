import { EmbedBuilder } from '../api/messages.js';
import { BOT_BRAND, EMBED_COLORS } from '../config/settings.js';
import { parseCommandArgs } from '../utils/argParser.js';
import { userMention } from '../utils/ids.js';

export const leaderboardCommand = {
  name: 'leaderboard',
  description: 'View the MurderMystery2 XP & Rank Leaderboard.',
  usage: '$leaderboard [page]',
  category: 'leveling',
  staffOnly: false,

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const page = Math.max(1, Number(kv.page || positional[0] || 1) || 1);
    const board = await ctx.repositories.users.getLeaderboard({ page, limit: 10 });

    const medals = ['🥇', '🥈', '🥉'];
    const lines = board.items.map((u, idx) => {
      const rankNum = (board.page - 1) * board.limit + idx + 1;
      const prefix = medals[rankNum - 1] || `**#${rankNum}**`;
      return `${prefix} ${userMention(u.yapinUserId)} — **Lv. ${u.leveling.level}** (${u.leveling.rankTitle}) • \`${u.leveling.totalXp} XP\``;
    });

    const embed = new EmbedBuilder()
      .setTitle(`🏆 ${BOT_BRAND.serverName} • Most Wanted XP Leaderboard`)
      .setColor(EMBED_COLORS.GOLD)
      .setDescription(lines.length > 0 ? lines.join('\n') : '_No XP recorded yet — start chatting!_')
      .setFooter(`Page ${board.page} • Total Ranked Citizens: ${board.total} • ${BOT_BRAND.botName}`);

    await ctx.reply({ embeds: [embed] });
  },
};
