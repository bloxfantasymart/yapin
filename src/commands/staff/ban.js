import { parseBooleanInput, parseCommandArgs } from '../../utils/argParser.js';
import { buildModCaseEmbed } from '../../utils/embeds.js';
import { ValidationError } from '../../utils/errors.js';
import { extractYapinUserId, parseDurationMs } from '../../utils/ids.js';

export const banCommand = {
  name: 'ban',
  description: 'Issue a MurderMystery2 Ban Case File and quarantine the member.',
  usage: '/ban <@user> confirm=yes [duration=7d] <reason>',
  category: 'moderation',
  staffOnly: true,
  requiredRole: 'moderator',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const targetUserId = extractYapinUserId(kv.user || positional[0] || '');
    const durationMs = kv.duration ? parseDurationMs(kv.duration) : null;
    const reason = kv.reason || positional.slice(1).join(' ');
    if (!targetUserId || !reason) {
      throw new ValidationError('Usage: `/ban <@user> confirm=yes <reason>`');
    }

    const modCase = await ctx.services.moderation.banUser({
      serverId: ctx.event.server_id,
      actorId: ctx.event.author_id,
      targetUserId,
      durationMs,
      reason,
      confirm: parseBooleanInput(kv.confirm),
      correlationId: ctx.correlationId,
    });

    await ctx.reply({ embeds: [buildModCaseEmbed(modCase)] });
  },
};
