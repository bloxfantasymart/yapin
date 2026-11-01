import { parseCommandArgs } from '../../utils/argParser.js';
import { ValidationError } from '../../utils/errors.js';
import { extractYapinUserId, userMention } from '../../utils/ids.js';

export const xpCommand = {
  name: 'xp',
  description: 'Grant, remove, set level, or reset XP for a MurderMystery2 member.',
  usage: '/xp <give|remove|setlevel|reset> <@user> [amount]',
  category: 'leveling',
  staffOnly: true,
  requiredRole: 'admin',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const action = (kv.action || positional[0] || '').toLowerCase();
    const targetUserId = extractYapinUserId(kv.user || positional[1] || '');
    const amount = Number(kv.amount ?? positional[2] ?? 0);

    if (!['give', 'remove', 'setlevel', 'reset'].includes(action) || !targetUserId) {
      throw new ValidationError('Usage: `/xp <give|remove|setlevel|reset> <@user> [amount]`');
    }

    const updated = await ctx.services.leveling.modifyUserXp({
      serverId: ctx.event.server_id,
      actorId: ctx.event.author_id,
      targetUserId,
      action,
      amount,
      correlationId: ctx.correlationId,
    });

    await ctx.reply({
      content: `🏆 Updated ${userMention(targetUserId)} → **Lv. ${updated.leveling.level}** (${updated.leveling.rankTitle}) • Total XP: \`${updated.leveling.totalXp}\`.`,
    });
  },
};
