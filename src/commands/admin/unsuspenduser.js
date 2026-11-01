import { ValidationError } from '../../utils/errors.js';
import { parseCommandArgs } from '../../utils/argParser.js';
import { extractYapinUserId } from '../../utils/ids.js';

export const unsuspenduserCommand = {
  name: 'unsuspenduser',
  description: 'Lift an active trade suspension on a user.',
  usage: '/unsuspenduser user=<@id> [reason="..."]',
  category: 'staff',
  staffOnly: true,
  requiredRole: 'moderator',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const targetUserId = extractYapinUserId(kv.user || positional[0]);
    if (!targetUserId) {
      throw new ValidationError('Usage: `/unsuspenduser user=<@uuid> [reason="..."]`');
    }

    await ctx.services.moderation.unsuspendUser({
      serverId: ctx.event.server_id,
      actorId: ctx.event.author_id,
      targetUserId,
      reason: kv.reason || 'Suspension lifted by moderator',
      correlationId: ctx.correlationId,
    });

    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      content: `✅ Trade suspension lifted for <@${targetUserId}> by <@${ctx.event.author_id}>.`,
      replyTo: ctx.event.id,
    });
  },
};
