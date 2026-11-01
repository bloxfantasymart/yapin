import { EmbedBuilder } from '../../api/messages.js';
import { BOT_BRAND, EMBED_COLORS } from '../../config/settings.js';
import { parseCommandArgs } from '../../utils/argParser.js';
import { ValidationError } from '../../utils/errors.js';
import { extractYapinUserId, userMention } from '../../utils/ids.js';

export const modlogsCommand = {
  name: 'modlogs',
  description: 'View complete moderation Case File history for a MurderMystery2 member.',
  usage: '/modlogs <@user>',
  category: 'moderation',
  staffOnly: true,
  requiredRole: 'staff',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const targetUserId = extractYapinUserId(kv.user || positional[0] || '');
    if (!targetUserId) throw new ValidationError('Usage: `/modlogs <@user>`');

    const cases = await ctx.repositories.cases.listByTarget(ctx.event.server_id, targetUserId, {
      limit: 15,
    });

    const lines = cases.map(
      (c) =>
        `• **#${c.caseNumber}** (\`${c.caseId}\`) — \`${c.action}\` • ${c.reason} *(by ${userMention(c.moderatorId)})*`,
    );

    const embed = new EmbedBuilder()
      .setTitle(`🗂️ Sheriff Case Dossier • ${targetUserId}`)
      .setColor(EMBED_COLORS.SHERIFF)
      .setDescription(
        `Citizen: ${userMention(targetUserId)}\n\n` +
          (lines.length > 0 ? lines.join('\n') : '_No Case Files recorded for this citizen._'),
      )
      .setFooter(BOT_BRAND.footer);

    await ctx.reply({ embeds: [embed] });
  },
};
