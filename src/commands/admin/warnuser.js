import { ValidationError } from '../../utils/errors.js';
import { parseCommandArgs } from '../../utils/argParser.js';
import { extractYapinUserId } from '../../utils/ids.js';

export const warnuserCommand = {
  name: 'warnuser',
  description: 'Issue an audited trade moderation warning on a user profile.',
  usage: '/warnuser user=<@id> reason="Documented warning reason" [trade=TRD-...]',
  category: 'staff',
  staffOnly: true,
  requiredRole: 'moderator',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const targetUserId = extractYapinUserId(kv.user || positional[0]);
    const reason = kv.reason;
    if (!targetUserId || !reason) {
      throw new ValidationError('Usage: `/warnuser user=<@uuid> reason="Documented reason" [trade=TRD-...]`');
    }

    const { user: updated } = await ctx.services.moderation.warnUser({
      serverId: ctx.event.server_id,
      actorId: ctx.event.author_id,
      targetUserId,
      reason,
      tradeId: kv.trade ? kv.trade.toUpperCase() : null,
      correlationId: ctx.correlationId,
    });

    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      content: `⚠️ Warning recorded on <@${targetUserId}> by <@${ctx.event.author_id}> (total warnings: ${updated.warnings.length}).`,
      replyTo: ctx.event.id,
    });
  },
};
