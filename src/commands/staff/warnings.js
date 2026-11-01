import { EmbedBuilder } from '../../api/messages.js';
import { BOT_BRAND, EMBED_COLORS } from '../../config/settings.js';
import { parseCommandArgs } from '../../utils/argParser.js';
import { ValidationError } from '../../utils/errors.js';
import { extractYapinUserId, userMention } from '../../utils/ids.js';

export const warningsCommand = {
  name: 'warnings',
  description: 'Inspect recorded warnings for a MurderMystery2 member.',
  usage: '$warnings <@user>',
  category: 'moderation',
  staffOnly: true,
  requiredRole: 'trialmod',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const targetUserId = extractYapinUserId(kv.user || positional[0] || '');
    if (!targetUserId) {
      throw new ValidationError('Usage: `$warnings <@user>`');
    }

    const cases = await ctx.repositories.cases.listByTarget(ctx.event.server_id, targetUserId, {
      limit: 15,
    });
    const warns = cases.filter((c) => ['WARN', 'AUTOMOD_WARN'].includes(c.action));

    const lines = warns.map((w) => {
      const state = w.active ? '🔴 Active' : '⚪ Cleared';
      return `• **#${w.caseNumber}** (\`${w.caseId}\`) [${state}] — ${w.reason} *(by ${userMention(w.moderatorId)})*`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`⚠️ Warning Record • ${targetUserId}`)
      .setColor(EMBED_COLORS.WARNING)
      .setDescription(
        `Citizen: ${userMention(targetUserId)}\n\n` +
          (lines.length > 0 ? lines.join('\n') : '_Clean record — 0 warnings filed._'),
      )
      .setFooter(BOT_BRAND.footer);

    await ctx.reply({ embeds: [embed] });
  },
};
