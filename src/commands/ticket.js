import { EMBED_COLORS } from '../config/settings.js';
import { EmbedBuilder } from '../api/messages.js';
import { ValidationError } from '../utils/errors.js';
import { parseCommandArgs } from '../utils/argParser.js';
import { extractYapinUserId } from '../utils/ids.js';

export const ticketCommand = {
  name: 'ticket',
  description: 'Open or manage private support, trade assistance, dispute, scam report, staff report, or appeal tickets.',
  usage:
    '/ticket open type=GENERAL_SUPPORT|TRADE_ASSISTANCE|DISPUTE|SCAM_REPORT|STAFF_REPORT|APPEAL subject="..." description="..." [trade=TRD-...]\n' +
    '/ticket note|close|reopen|claim|assign|view <TKT-...> ...',
  category: 'tickets',
  staffOnly: false,

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const sub = (positional[0] || kv.action || 'open').toLowerCase();

    if (sub === 'open') {
      if (!kv.subject || !kv.description) {
        throw new ValidationError(
          'Usage: `/ticket open type=GENERAL_SUPPORT subject="Need help" description="Detailed issue..." [trade=TRD-...]`',
        );
      }
      const ticket = await ctx.services.ticket.openTicket({
        serverId: ctx.event.server_id,
        creatorId: ctx.event.author_id,
        type: (kv.type || 'GENERAL_SUPPORT').toUpperCase(),
        subject: kv.subject,
        description: kv.description,
        tradeId: kv.trade ? kv.trade.toUpperCase() : null,
        correlationId: ctx.correlationId,
      });

      const embed = new EmbedBuilder()
        .setTitle(`🎫 Ticket Opened — ${ticket.ticketId}`)
        .setColor(EMBED_COLORS.SUCCESS)
        .addField('Type', ticket.type, true)
        .addField('Private Channel', ticket.channelId ? `<#${ticket.channelId}>` : 'Created', true)
        .addField('Status', ticket.status, true);

      await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
        embeds: [embed],
        replyTo: ctx.event.id,
      });
      return;
    }

    const ticketId = (positional[1] || kv.id || kv.ticket || '').toUpperCase();
    if (!ticketId) {
      throw new ValidationError(`Specify a ticket ID (\`TKT-...\`) for \`/ticket ${sub}\`.`);
    }

    if (sub === 'view') {
      const ticket = await ctx.repositories.tickets.findByTicketId(ticketId);
      if (!ticket || ticket.serverId !== ctx.event.server_id) {
        throw new ValidationError(`Ticket \`${ticketId}\` not found.`);
      }
      await ctx.services.ticket.assertTicketAccess(ticket, ctx.event.author_id);

      const embed = new EmbedBuilder()
        .setTitle(`🎫 Ticket ${ticket.ticketId} — ${ticket.status}`)
        .setDescription(`**Subject:** ${ticket.subject}\n${ticket.description}`)
        .setColor(EMBED_COLORS.INFO)
        .addField('Type', ticket.type, true)
        .addField('Creator', `<@${ticket.creatorId}>`, true)
        .addField('Assigned Staff', ticket.assignedStaffId ? `<@${ticket.assignedStaffId}>` : 'Unclaimed', true)
        .addField('Notes Count', String(ticket.notes?.length || 0), true);
      await ctx.messagesApi.sendMessage(ctx.event.channel_id, { embeds: [embed], replyTo: ctx.event.id });
      return;
    }

    if (sub === 'claim') {
      const updated = await ctx.services.ticket.claimTicket({
        serverId: ctx.event.server_id,
        ticketId,
        actorId: ctx.event.author_id,
        correlationId: ctx.correlationId,
      });
      await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
        content: `🛡️ Ticket **${updated.ticketId}** claimed by <@${ctx.event.author_id}>.`,
        replyTo: ctx.event.id,
      });
      return;
    }

    if (sub === 'assign') {
      const targetStaffId = extractYapinUserId(kv.staff || kv.user || positional[2]);
      if (!targetStaffId) throw new ValidationError('Specify `staff=<@uuid>` to assign.');
      const updated = await ctx.services.ticket.assignTicket({
        serverId: ctx.event.server_id,
        ticketId,
        actorId: ctx.event.author_id,
        targetStaffId,
        correlationId: ctx.correlationId,
      });
      await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
        content: `🛡️ Ticket **${updated.ticketId}** assigned to <@${targetStaffId}>.`,
        replyTo: ctx.event.id,
      });
      return;
    }

    if (sub === 'note') {
      const content = kv.note || kv.content || positional.slice(2).join(' ');
      if (!content) throw new ValidationError('Provide `note="..."` content.');
      const updated = await ctx.services.ticket.addNote({
        serverId: ctx.event.server_id,
        ticketId,
        actorId: ctx.event.author_id,
        content,
        internalOnly: kv.internal === 'yes' || kv.internal === 'true',
        correlationId: ctx.correlationId,
      });
      await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
        content: `📝 Note recorded on **${updated.ticketId}** (total notes: ${updated.notes.length}).`,
        replyTo: ctx.event.id,
      });
      return;
    }

    if (sub === 'close') {
      const reason = kv.reason || positional.slice(2).join(' ');
      if (!reason) throw new ValidationError('Provide `reason="..."` when closing a ticket.');
      const closed = await ctx.services.ticket.closeTicket({
        serverId: ctx.event.server_id,
        ticketId,
        actorId: ctx.event.author_id,
        reason,
        correlationId: ctx.correlationId,
      });
      const checksum = closed.transcript?.checksumSha256 || 'recorded';
      await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
        content: `🔒 Ticket **${closed.ticketId}** closed. Transcript SHA-256: \`${checksum.slice(0, 16)}...\`.`,
        replyTo: ctx.event.id,
      });
      return;
    }

    if (sub === 'reopen') {
      const reason = kv.reason || positional.slice(2).join(' ');
      if (!reason) throw new ValidationError('Provide `reason="..."` when reopening a ticket.');
      const updated = await ctx.services.ticket.reopenTicket({
        serverId: ctx.event.server_id,
        ticketId,
        actorId: ctx.event.author_id,
        reason,
        correlationId: ctx.correlationId,
      });
      await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
        content: `🔓 Ticket **${updated.ticketId}** reopened by <@${ctx.event.author_id}>.`,
        replyTo: ctx.event.id,
      });
      return;
    }

    throw new ValidationError(`Unknown ticket subcommand \`${sub}\`. Use: open, view, claim, assign, note, close, reopen.`);
  },
};
