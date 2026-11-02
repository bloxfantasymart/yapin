import { parseCommandArgs } from '../../utils/argParser.js';
import { buildModCaseEmbed } from '../../utils/embeds.js';
import { ValidationError } from '../../utils/errors.js';
import { extractYapinUserId } from '../../utils/ids.js';

export const unbanCommand = {
  name: 'unban',
  description: 'Lift an active MurderMystery2 Ban from a user.',
  usage: '$unban <@user|uuid> [reason]',
  category: 'moderation',
  staffOnly: true,
  requiredRole: 'moderator',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const targetUserId = extractYapinUserId(kv.user || positional[0] || '');
    const reason = kv.reason || positional.slice(1).join(' ') || 'Ban lifted by Moderator';
    if (!targetUserId) {
      throw new ValidationError('Usage: `$unban <@user|uuid> [reason]`');
    }

    const modCase = await ctx.services.moderation.unbanUser({
      serverId: ctx.event.server_id,
      actorId: ctx.event.author_id,
      targetUserId,
      reason,
      correlationId: ctx.correlationId,
    });

    await ctx.reply({ embeds: [buildModCaseEmbed(modCase)] });
  },
};
