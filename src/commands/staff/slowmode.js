import { parseCommandArgs } from '../../utils/argParser.js';
import { ValidationError } from '../../utils/errors.js';

export const slowmodeCommand = {
  name: 'slowmode',
  description: 'Set or disable message slowmode in the current MurderMystery2 channel.',
  usage: '$slowmode <seconds|off>',
  category: 'moderation',
  staffOnly: true,
  requiredRole: 'trialmod',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const raw = String(kv.seconds || positional[0] || '').toLowerCase();
    if (!raw) throw new ValidationError('Usage: `$slowmode <seconds|off>`');

    const seconds = raw === 'off' || raw === '0' ? 0 : Number(raw);
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 21600) {
      throw new ValidationError('Slowmode must be `off` or an integer between `0` and `21600` seconds.');
    }

    await ctx.services.moderation.setSlowmode({
      serverId: ctx.event.server_id,
      channelId: ctx.event.channel_id,
      actorId: ctx.event.author_id,
      seconds,
      correlationId: ctx.correlationId,
    });

    await ctx.reply({
      content:
        seconds === 0
          ? '⏱️ Channel slowmode disabled.'
          : `⏱️ Channel slowmode set to **${seconds}s**.`,
    });
  },
};
