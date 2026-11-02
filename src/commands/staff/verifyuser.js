import { parseCommandArgs } from '../../utils/argParser.js';
import { ValidationError } from '../../utils/errors.js';
import { extractYapinUserId, userMention } from '../../utils/ids.js';

export const verifyuserCommand = {
  name: 'verifyuser',
  description: 'Manually verify or revoke verification for a MurderMystery2 member.',
  usage: '$verifyuser <verify|unverify> <@user> [reason]',
  category: 'verification',
  staffOnly: true,
  requiredRole: 'moderator',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const action = (kv.action || positional[0] || '').toLowerCase();
    const targetUserId = extractYapinUserId(kv.user || positional[1] || '');
    const reason = kv.reason || positional.slice(2).join(' ') || 'Staff verification override';

    if (!['verify', 'unverify'].includes(action) || !targetUserId) {
      throw new ValidationError('Usage: `$verifyuser <verify|unverify> <@user> [reason]`');
    }

    await ctx.services.verification.staffSetVerification({
      serverId: ctx.event.server_id,
      actorId: ctx.event.author_id,
      targetUserId,
      verified: action === 'verify',
      reason,
      correlationId: ctx.correlationId,
    });

    await ctx.reply({
      content:
        action === 'verify'
          ? `✅ Manually verified ${userMention(targetUserId)} as a **MurderMystery2 Citizen**.`
          : `⛔ Revoked verification from ${userMention(targetUserId)} (*${reason}*).`,
    });
  },
};
