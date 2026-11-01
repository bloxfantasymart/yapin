import { parseCommandArgs } from '../../utils/argParser.js';

export const lockCommand = {
  name: 'lock',
  description: 'Lock the current channel for Sheriff investigation (staff-only posting).',
  usage: '$lock [reason]',
  category: 'moderation',
  staffOnly: true,
  requiredRole: 'moderator',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const reason = kv.reason || positional.join(' ') || 'Sheriff Lockdown';

    await ctx.services.moderation.setChannelLock({
      serverId: ctx.event.server_id,
      channelId: ctx.event.channel_id,
      actorId: ctx.event.author_id,
      locked: true,
      reason,
      correlationId: ctx.correlationId,
    });

    await ctx.reply({
      content: `🔒 **Sheriff Lockdown Active:** This channel is now read-only (*${reason}*).`,
    });
  },
};
