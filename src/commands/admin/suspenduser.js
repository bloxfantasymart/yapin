import { ValidationError } from '../../utils/errors.js';
import { parseCommandArgs, parseYesBoolean } from '../../utils/argParser.js';
import { extractYapinUserId } from '../../utils/ids.js';

export const suspenduserCommand = {
  name: 'suspenduser',
  description: 'Suspend a user from opening or participating in new middleman trades.',
  usage: '/suspenduser user=<@id> reason="Documented suspension reason" [hours=24] confirm=yes',
  category: 'staff',
  staffOnly: true,
  requiredRole: 'moderator',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const targetUserId = extractYapinUserId(kv.user || positional[0]);
    const reason = kv.reason;
    const durationHours = kv.hours ? Number(kv.hours) : null;
    const confirm = parseYesBoolean(kv.confirm);

    if (!targetUserId || !reason) {
      throw new ValidationError(
        'Usage: `/suspenduser user=<@uuid> reason="Documented reason" [hours=24] confirm=yes`',
      );
    }

    const updated = await ctx.services.moderation.suspendUser({
      serverId: ctx.event.server_id,
      actorId: ctx.event.author_id,
      targetUserId,
      reason,
      durationHours,
      confirm,
      correlationId: ctx.correlationId,
    });

    const exp = updated.suspension?.expiresAt || updated.user?.suspension?.expiresAt;
    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      content:
        `⛔ <@${targetUserId}> has been suspended from new trades by <@${ctx.event.author_id}>` +
        (exp ? ` until \`${new Date(exp).toISOString()}\`.` : ' (indefinite until lifted).'),
      replyTo: ctx.event.id,
    });
  },
};
