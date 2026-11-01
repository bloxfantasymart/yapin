import { parseCommandArgs } from '../../utils/argParser.js';
import { buildModCaseEmbed } from '../../utils/embeds.js';
import { ValidationError } from '../../utils/errors.js';
import { extractYapinUserId, parseDurationMs } from '../../utils/ids.js';

export const muteCommand = {
  name: 'mute',
  description: 'Place a timed Mute & Muted Role on a MurderMystery2 member.',
  usage: '/mute <@user> <duration e.g. 30m|2h|1d> <reason>',
  category: 'moderation',
  staffOnly: true,
  requiredRole: 'trialmod',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const targetUserId = extractYapinUserId(kv.user || positional[0] || '');
    const durStr = kv.duration || positional[1] || '30m';
    const durationMs = parseDurationMs(durStr);
    const reason =
      kv.reason ||
      (durationMs ? positional.slice(2).join(' ') : positional.slice(1).join(' ')) ||
      'Rule violation';

    if (!targetUserId) {
      throw new ValidationError('Usage: `/mute <@user> <duration e.g. 30m> <reason>`');
    }

    const modCase = await ctx.services.moderation.muteUser({
      serverId: ctx.event.server_id,
      actorId: ctx.event.author_id,
      targetUserId,
      durationMs: durationMs || 30 * 60_000,
      reason,
      correlationId: ctx.correlationId,
    });

    await ctx.reply({
      embeds: [buildModCaseEmbed(modCase)],
    });
  },
};
