import { parseCommandArgs } from '../../utils/argParser.js';

export const unlockCommand = {
  name: 'unlock',
  description: 'Lift a Sheriff Lockdown on the current channel.',
  usage: '/unlock [reason]',
  category: 'moderation',
  staffOnly: true,
  requiredRole: 'moderator',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const reason = kv.reason || positional.join(' ') || 'Investigation concluded';

    await ctx.services.moderation.setChannelLock({
      serverId: ctx.event.server_id,
      channelId: ctx.event.channel_id,
      actorId: ctx.event.author_id,
      locked: false,
      reason,
      correlationId: ctx.correlationId,
    });

    await ctx.reply({
      content: `🔓 **Sheriff Lockdown Lifted:** Citizens may chat again (*${reason}*).`,
    });
  },
};
