import { EmbedBuilder } from '../../api/messages.js';
import { BOT_BRAND, EMBED_COLORS } from '../../config/settings.js';
import { parseCommandArgs } from '../../utils/argParser.js';
import { userMention } from '../../utils/ids.js';

export const applicationsCommand = {
  name: 'applications',
  description: 'List MurderMystery2 Moderator Applications by status or inspect one.',
  usage: '$applications [PENDING|UNDER_REVIEW|ACCEPTED|DENIED]',
  category: 'applications',
  staffOnly: true,
  requiredRole: 'staff',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const statusFilter = (kv.status || positional[0] || '').toUpperCase();
    const validStatus = ['PENDING', 'UNDER_REVIEW', 'ACCEPTED', 'DENIED'].includes(statusFilter)
      ? statusFilter
      : null;

    const list = await ctx.repositories.applications.listByServer(ctx.event.server_id, {
      status: validStatus,
      limit: 15,
    });

    const lines = list.items.map(
      (a) =>
        `• \`${a.applicationId}\` — ${userMention(a.applicantId)} (Lv. ${a.levelAtApply}) • **${a.status}**`,
    );

    const embed = new EmbedBuilder()
      .setTitle(`⭐ Sheriff Academy Applications ${validStatus ? `(${validStatus})` : ''}`)
      .setColor(EMBED_COLORS.GOLD)
      .setDescription(
        lines.length > 0
          ? lines.join('\n')
          : '_No Moderator Applications match this filter._',
      )
      .setFooter(`Total: ${list.total} • Review via $appreview <APP-ID> <accept|deny|review> • ${BOT_BRAND.botName}`);

    await ctx.reply({ embeds: [embed] });
  },
};
