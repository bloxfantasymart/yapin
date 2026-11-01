import { parseCommandArgs } from '../../utils/argParser.js';
import { ValidationError } from '../../utils/errors.js';

export const clearwarnCommand = {
  name: 'clearwarn',
  description: 'Pardon / clear an active MurderMystery2 Warning Case File.',
  usage: '$clearwarn <CASE-ID> [reason]',
  category: 'moderation',
  staffOnly: true,
  requiredRole: 'moderator',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const caseId = (kv.case || kv.id || positional[0] || '').toUpperCase();
    const reason = kv.reason || positional.slice(1).join(' ') || 'Cleared by Moderator';
    if (!caseId) {
      throw new ValidationError('Usage: `$clearwarn <CASE-ID> [reason]`');
    }

    const cleared = await ctx.services.moderation.clearWarning({
      serverId: ctx.event.server_id,
      actorId: ctx.event.author_id,
      caseId,
      reason,
      correlationId: ctx.correlationId,
    });

    await ctx.reply({
      content: `✅ Warning Case \`${cleared.caseId}\` (#${cleared.caseNumber}) has been pardoned.`,
    });
  },
};
