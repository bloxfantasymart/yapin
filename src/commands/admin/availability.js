import { ValidationError } from '../../utils/errors.js';
import { parseCommandArgs } from '../../utils/argParser.js';

export const availabilityCommand = {
  name: 'availability',
  description: 'Toggle your middleman availability status for manual and automatic assignment.',
  usage: '/availability status=on|off [note="..."]',
  category: 'staff',
  staffOnly: true,
  requiredRole: 'middleman',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const raw = (kv.status || positional[0] || '').toLowerCase();
    if (!['on', 'off', 'true', 'false', 'available', 'offline'].includes(raw)) {
      throw new ValidationError('Usage: `/availability status=on|off [note="Available for 2 hours"]`');
    }

    const available = ['on', 'true', 'available'].includes(raw);
    const updated = await ctx.services.assignment.setStaffAvailability({
      serverId: ctx.event.server_id,
      actorId: ctx.event.author_id,
      available,
      note: kv.note || '',
      correlationId: ctx.correlationId,
    });

    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      content: updated.staffAvailability.available
        ? `🟢 <@${ctx.event.author_id}> is now marked **Available** for middleman assignments.`
        : `🔴 <@${ctx.event.author_id}> is now marked **Offline** for middleman assignments.`,
      replyTo: ctx.event.id,
    });
  },
};
