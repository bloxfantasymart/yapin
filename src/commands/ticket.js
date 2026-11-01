import { parseBooleanInput, parseCommandArgs } from '../utils/argParser.js';
import { buildTicketEmbed } from '../utils/embeds.js';
import { ValidationError } from '../utils/errors.js';
import { extractYapinUserId } from '../utils/ids.js';

export const ticketCommand = {
  name: 'ticket',
  description: 'Open or manage private MurderMystery2 support and character tickets.',
  usage: '/ticket <open|view|claim|assign|note|close|reopen> ...',
  category: 'tickets',
  staffOnly: false,

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const sub = (positional[0] || '').toLowerCase();

    if (sub === 'open') {
      const type = (kv.type || positional[1] || 'GENERAL_SUPPORT').toUpperCase();
      const subject = kv.subject || positional[2] || `${type} Inquiry`;
      const description =
        kv.description || positional.slice(3).join(' ') || subject;

      const created = await ctx.services.ticket.openTicket({
        serverId: ctx.event.server_id,
        creatorId: ctx.event.author_id,
        type,
        subject,
        description,
        correlationId: ctx.correlationId,
      });

      await ctx.reply({
        content: created.channelId
          ? `🕵️ Private Ticket \`${created.ticketId}\` opened in <#${created.channelId}>.`
          : `🕵️ Private Ticket \`${created.ticketId}\` opened.`,
        embeds: [buildTicketEmbed(created)],
      });
      return;
    }

    if (sub === 'view') {
      const ticketId = (kv.id || positional[1] || '').toUpperCase();
      if (!ticketId) throw new ValidationError('Provide a Ticket ID (`TKT-...`).');
      const ticket = await ctx.services.ticket.getTicketForViewer({
        serverId: ctx.event.server_id,
        ticketId,
        viewerId: ctx.event.author_id,
      });
      await ctx.reply({ embeds: [buildTicketEmbed(ticket)] });
      return;
    }

    if (sub === 'claim') {
      const ticketId = (kv.id || positional[1] || '').toUpperCase();
      if (!ticketId) throw new ValidationError('Provide a Ticket ID (`TKT-...`).');
      const updated = await ctx.services.ticket.claimTicket({
        serverId: ctx.event.server_id,
        ticketId,
        actorId: ctx.event.author_id,
        correlationId: ctx.correlationId,
      });
      await ctx.reply({
        content: `👮 Claimed Ticket \`${updated.ticketId}\`.`,
        embeds: [buildTicketEmbed(updated)],
      });
      return;
    }

    if (sub === 'assign') {
      const ticketId = (kv.id || positional[1] || '').toUpperCase();
      const staffId = extractYapinUserId(kv.staff || positional[2] || '');
      if (!ticketId || !staffId) {
        throw new ValidationError('Usage: `/ticket assign <TKT-ID> <@staff>`');
      }
      const updated = await ctx.services.ticket.assignTicket({
        serverId: ctx.event.server_id,
        ticketId,
        actorId: ctx.event.author_id,
        targetStaffId: staffId,
        correlationId: ctx.correlationId,
      });
      await ctx.reply({ embeds: [buildTicketEmbed(updated)] });
      return;
    }

    if (sub === 'note') {
      const ticketId = (kv.id || positional[1] || '').toUpperCase();
      const content = kv.text || positional.slice(2).join(' ');
      if (!ticketId || !content) {
        throw new ValidationError('Usage: `/ticket note <TKT-ID> <message>`');
      }
      const updated = await ctx.services.ticket.addNote({
        serverId: ctx.event.server_id,
        ticketId,
        actorId: ctx.event.author_id,
        content,
        internalOnly: parseBooleanInput(kv.internal),
        correlationId: ctx.correlationId,
      });
      await ctx.reply({
        content: `📝 Note appended to \`${updated.ticketId}\` (${updated.notes.length} total).`,
      });
      return;
    }

    if (sub === 'close') {
      const ticketId = (kv.id || positional[1] || '').toUpperCase();
      const reason = kv.reason || positional.slice(2).join(' ') || 'Resolved';
      if (!ticketId) throw new ValidationError('Usage: `/ticket close <TKT-ID> [reason]`');
      const closed = await ctx.services.ticket.closeTicket({
        serverId: ctx.event.server_id,
        ticketId,
        actorId: ctx.event.author_id,
        reason,
        correlationId: ctx.correlationId,
      });
      await ctx.reply({
        content: `🔒 Ticket \`${closed.ticketId}\` archived (SHA-256: \`${closed.transcript?.checksumSha256?.slice(0, 16)}...\`).`,
      });
      return;
    }

    if (sub === 'reopen') {
      const ticketId = (kv.id || positional[1] || '').toUpperCase();
      const reason = kv.reason || positional.slice(2).join(' ') || 'Reopened by Staff';
      if (!ticketId) throw new ValidationError('Usage: `/ticket reopen <TKT-ID> [reason]`');
      const reopened = await ctx.services.ticket.reopenTicket({
        serverId: ctx.event.server_id,
        ticketId,
        actorId: ctx.event.author_id,
        reason,
        correlationId: ctx.correlationId,
      });
      await ctx.reply({
        content: `🔓 Ticket \`${reopened.ticketId}\` reopened.`,
        embeds: [buildTicketEmbed(reopened)],
      });
      return;
    }

    throw new ValidationError(
      'Subcommands: `/ticket open`, `/ticket view`, `/ticket claim`, `/ticket assign`, `/ticket note`, `/ticket close`, `/ticket reopen`.',
    );
  },
};
