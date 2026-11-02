import { parseCommandArgs } from '../../utils/argParser.js';
import { buildModCaseEmbed } from '../../utils/embeds.js';
import { ValidationError } from '../../utils/errors.js';
import { extractYapinUserId } from '../../utils/ids.js';

export const unmuteCommand = {
  name: 'unmute',
  description: 'Lift an active Mute from a MurderMystery2 member.',
  usage: '$unmute <@user> [reason]',
  category: 'moderation',
  staffOnly: true,
  requiredRole: 'trialmod',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const targetUserId = extractYapinUserId(kv.user || positional[0] || '');
    const reason = kv.reason || positional.slice(1).join(' ') || 'Unmuted by Staff';
    if (!targetUserId) {
      throw new ValidationError('Usage: `$unmute <@user> [reason]`');
    }

    const modCase = await ctx.services.moderation.unmuteUser({
      serverId: ctx.event.server_id,
      actorId: ctx.event.author_id,
      targetUserId,
      reason,
      correlationId: ctx.correlationId,
    });

    await ctx.reply({ embeds: [buildModCaseEmbed(modCase)] });
  },
};
