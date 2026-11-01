import { parseBooleanInput, parseCommandArgs } from '../../utils/argParser.js';
import { buildModCaseEmbed } from '../../utils/embeds.js';
import { ValidationError } from '../../utils/errors.js';
import { extractYapinUserId } from '../../utils/ids.js';

export const kickCommand = {
  name: 'kick',
  description: 'Issue a MurderMystery2 Kick Case File and revoke Verified Citizen access.',
  usage: '/kick <@user> confirm=yes <reason>',
  category: 'moderation',
  staffOnly: true,
  requiredRole: 'moderator',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const targetUserId = extractYapinUserId(kv.user || positional[0] || '');
    const reason = kv.reason || positional.slice(1).join(' ');
    if (!targetUserId || !reason) {
      throw new ValidationError('Usage: `/kick <@user> confirm=yes <reason>`');
    }

    const modCase = await ctx.services.moderation.kickUser({
      serverId: ctx.event.server_id,
      actorId: ctx.event.author_id,
      targetUserId,
      reason,
      confirm: parseBooleanInput(kv.confirm),
      correlationId: ctx.correlationId,
    });

    await ctx.reply({ embeds: [buildModCaseEmbed(modCase)] });
  },
};
