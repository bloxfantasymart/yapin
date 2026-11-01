import { parseCommandArgs } from '../../utils/argParser.js';
import { buildModCaseEmbed } from '../../utils/embeds.js';
import { ValidationError } from '../../utils/errors.js';
import { extractYapinUserId } from '../../utils/ids.js';

export const warnCommand = {
  name: 'warn',
  description: 'Issue an official MurderMystery2 Sheriff Warning Case File.',
  usage: '$warn <@user> <reason>',
  category: 'moderation',
  staffOnly: true,
  requiredRole: 'trialmod',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const targetUserId = extractYapinUserId(kv.user || positional[0] || '');
    const reason = kv.reason || positional.slice(1).join(' ');
    if (!targetUserId || !reason) {
      throw new ValidationError('Usage: `$warn <@user> <reason>`');
    }

    const { modCase, user, autoMuteCase } = await ctx.services.moderation.warnUser({
      serverId: ctx.event.server_id,
      actorId: ctx.event.author_id,
      targetUserId,
      reason,
      correlationId: ctx.correlationId,
    });

    await ctx.reply({
      content: autoMuteCase
        ? `⚠️ Warning \`${modCase.caseId}\` issued (Active warns: **${user.moderation.activeWarnCount}**) — **Auto-escalated to Mute (\`${autoMuteCase.caseId}\`)!**`
        : `⚠️ Warning \`${modCase.caseId}\` issued (Active warns: **${user.moderation.activeWarnCount}**).`,
      embeds: [buildModCaseEmbed(modCase)],
    });
  },
};
