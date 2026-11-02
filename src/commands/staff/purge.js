import { parseCommandArgs } from '../../utils/argParser.js';
import { ValidationError } from '../../utils/errors.js';
import { extractYapinUserId } from '../../utils/ids.js';

export const purgeCommand = {
  name: 'purge',
  description: 'Bulk-delete up to 100 recent channel messages (optionally filtered by user).',
  usage: '$purge <1-100> [@user]',
  category: 'moderation',
  staffOnly: true,
  requiredRole: 'moderator',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const count = Number(kv.count || positional[0]);
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      throw new ValidationError('Usage: `$purge <1-100> [@user]`');
    }
    const targetUserId = (kv.user || positional[1])
      ? extractYapinUserId(kv.user || positional[1])
      : null;

    const { deletedCount } = await ctx.services.moderation.purgeChannelMessages({
      serverId: ctx.event.server_id,
      channelId: ctx.event.channel_id,
      actorId: ctx.event.author_id,
      count,
      targetUserId,
      correlationId: ctx.correlationId,
    });

    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      content: `🧹 **Crime Scene Sanitized:** Purged **${deletedCount}** message(s).`,
    });
  },
};
