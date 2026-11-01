import { randomUUID } from 'node:crypto';
import { EMBED_COLORS } from '../config/settings.js';
import { EmbedBuilder } from '../api/messages.js';
import { TICKET_TYPES } from '../database/models/Ticket.js';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  SecurityError,
  ValidationError,
} from '../utils/errors.js';
import { generateTicketId } from '../utils/ids.js';
import { sanitizeUserText } from '../security/sanitizer.js';

/**
 * Private Ticket Lifecycle Service for Yapin.gg.
 *
 * Supports:
 * - GENERAL_SUPPORT, TRADE_ASSISTANCE, DISPUTE, SCAM_REPORT, STAFF_REPORT, APPEAL
 * - Real Yapin private channel enforcement (`PATCH /channels/:id` `{ private: true, role_ids }`)
 * - Fail-closed rollback + immediate staff alert if channel privacy lock fails
 * - Claim, Assign, Add Note, Close (with SHA-256 transcript), and Reopen
 */
export class TicketService {
  /**
   * @param {{
   *   ticketRepo: import('../database/repositories/ticketDisputeRepository.js').MongooseTicketRepository,
   *   serverConfigRepo: import('../database/repositories/auditConfigRepository.js').MongooseServerConfigRepository,
   *   channelsApi: import('../api/channels.js').YapinChannelsApi,
   *   messagesApi: import('../api/messages.js').YapinMessagesApi,
   *   permissionsApi: import('../api/permissions.js').YapinPermissionsApi,
   *   antiScam: import('../security/antiScam.js').AntiScamService,
   *   transcriptService: import('./transcriptService.js').TranscriptService,
   *   auditService: import('../middleman/auditService.js').AuditService,
   * }} deps
   */
  constructor({
    ticketRepo,
    serverConfigRepo,
    channelsApi,
    messagesApi,
    permissionsApi,
    antiScam,
    transcriptService,
    auditService,
  }) {
    this.ticketRepo = ticketRepo;
    this.serverConfigRepo = serverConfigRepo;
    this.channelsApi = channelsApi;
    this.messagesApi = messagesApi;
    this.permissionsApi = permissionsApi;
    this.antiScam = antiScam;
    this.transcriptService = transcriptService;
    this.auditService = auditService;
  }

  /**
   * Resolves the role IDs permitted to view a private ticket channel based on `ticket.type`.
   * Notably, `STAFF_REPORT` tickets restrict visibility strictly to Admin/ManageServer roles!
   */
  async _resolveAllowedStaffRoleIds(serverId, cfg, ticketType) {
    const serverRoles = await this.permissionsApi.fetchServerRoles(serverId);
    const botRoleIds = await this.permissionsApi.getBotRoleIds(serverId);
    const manageServerRoleIds = serverRoles
      .filter((r) => r.manage_server || r.manageServer)
      .map((r) => String(r.id));

    const staffCfg = cfg?.staffRoles || {};
    let roleIds;

    if (ticketType === 'STAFF_REPORT') {
      // Sensitive staff misconduct reports are visible ONLY to Admins + Bot
      roleIds = [
        ...(staffCfg.adminRoleIds || []),
        ...manageServerRoleIds,
        ...botRoleIds,
      ];
    } else {
      roleIds = [
        ...(staffCfg.adminRoleIds || []),
        ...(staffCfg.moderatorRoleIds || []),
        ...(staffCfg.middlemanRoleIds || []),
        ...(staffCfg.supportRoleIds || []),
        ...manageServerRoleIds,
        ...botRoleIds,
      ];
    }

    return [...new Set(roleIds.filter(Boolean))];
  }

  /**
   * Opens a new private ticket, prevents duplicates, and enforces fail-closed channel privacy.
   */
  async openTicket({
    serverId,
    creatorId,
    type = 'GENERAL_SUPPORT',
    subject,
    description,
    tradeId = null,
    additionalParticipantIds = [],
    correlationId,
  }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    if (cfg?.features?.ticketsEnabled === false) {
      throw new ValidationError('Tickets are currently disabled in server configuration.');
    }

    const upperType = String(type || 'GENERAL_SUPPORT').trim().toUpperCase();
    if (!TICKET_TYPES.includes(upperType)) {
      throw new ValidationError(
        `Invalid ticket type "${type}". Supported types: ${TICKET_TYPES.join(', ')}.`,
      );
    }

    const cleanSubject = sanitizeUserText(subject || `${upperType} Request`, {
      maxLength: 200,
      fieldName: 'Ticket subject',
      allowNewlines: false,
    });
    const cleanDescription = sanitizeUserText(description || '', {
      maxLength: 2000,
      fieldName: 'Ticket description',
    });
    if (cleanDescription.length < 5) {
      throw new ValidationError('Please provide a ticket description of at least 5 characters.');
    }

    // Prevent duplicate open tickets of the same type/trade
    const duplicate = await this.ticketRepo.findOpenDuplicate({
      serverId,
      creatorId,
      type: upperType,
      tradeId,
    });
    if (duplicate) {
      throw new ConflictError(
        `You already have an open \`${upperType}\` ticket (\`${duplicate.ticketId}\`).`,
      );
    }

    // Enforce max open tickets per user
    const openCount = await this.ticketRepo.countOpenByCreator(serverId, creatorId);
    const maxOpen = cfg?.ticketConfig?.maxOpenPerUser ?? 2;
    if (openCount >= maxOpen && upperType !== 'DISPUTE') {
      throw new ValidationError(
        `You already have ${openCount} open tickets (server limit: ${maxOpen}).`,
      );
    }

    const ticketId = generateTicketId();
    const participantIds = [...new Set([creatorId, ...additionalParticipantIds].filter(Boolean))];
    const allowedRoleIds = await this._resolveAllowedStaffRoleIds(serverId, cfg, upperType);

    let channelId = null;
    let scopedRoleId = null;

    if (cfg?.ticketConfig?.createDedicatedChannel !== false) {
      try {
        const privateRes = await this.channelsApi.createPrivateChannel({
          serverId,
          name: `ticket-${ticketId.toLowerCase()}`,
          categoryId: cfg?.channels?.ticketCategoryId || null,
          allowedRoleIds,
          participantUserIds: participantIds,
          useScopedParticipantRole: Boolean(cfg?.ticketConfig?.useScopedParticipantRole),
        });
        channelId = privateRes.channel.id;
        scopedRoleId = privateRes.scopedRoleId;
      } catch (err) {
        // FAIL SECURELY: Never persist or expose a public ticket channel, and notify authorized staff!
        await this.auditService.record({
          serverId,
          actorId: creatorId,
          actorType: 'SYSTEM',
          action: 'TICKET_PRIVATE_LOCK_FAILED',
          targetType: 'TICKET',
          targetId: ticketId,
          metadata: {
            ticketType: upperType,
            error: err?.message,
            rollbackSucceeded: err?.metadata?.rollbackSucceeded ?? true,
          },
          correlationId,
        });

        await this.antiScam.emitSuspiciousAlert({
          serverId,
          serverConfig: cfg,
          title: 'Ticket Private Channel Lock Failed (Fail-Closed)',
          summary:
            `Ticket \`${ticketId}\` (${upperType}) aborted channel creation because private role permissions could not be verified. ` +
            'Verify the bot has the `Manage Channels` permission and configured staff role IDs.',
          metadata: { actorId: creatorId, ticketId },
        });

        throw new SecurityError(
          'Unable to provision a private ticket channel securely. The channel was rolled back and server staff have been notified.',
        );
      }
    }

    const ticket = await this.ticketRepo.create({
      ticketId,
      serverId,
      creatorId,
      participantIds,
      tradeId,
      type: upperType,
      subject: cleanSubject,
      description: cleanDescription,
      channelId,
      accessConfig: {
        isPrivate: true,
        allowedRoleIds,
        scopedRoleId,
      },
      status: 'OPEN',
      version: 1,
    });

    if (channelId && this.messagesApi) {
      const introEmbed = new EmbedBuilder()
        .setTitle(`🎫 Private Ticket ${ticketId} — ${upperType}`)
        .setDescription(cleanDescription)
        .setColor(EMBED_COLORS.PRIMARY)
        .addField('Opened By', `<@${creatorId}>`, true)
        .addField('Subject', cleanSubject, true)
        .addField('Linked Trade', tradeId ? `\`${tradeId}\`` : 'None', true)
        .setFooter('Private access enforced via Yapin role permissions')
        .setTimestamp();

      await this.messagesApi.sendMessage(channelId, { embeds: [introEmbed] }).catch(() => undefined);
    }

    await this.auditService.record({
      serverId,
      actorId: creatorId,
      actorType: 'USER',
      action: 'TICKET_OPENED',
      targetType: 'TICKET',
      targetId: ticketId,
      afterState: { status: 'OPEN', type: upperType, channelId, isPrivate: true },
      correlationId,
    });

    return ticket;
  }

  /**
   * Verifies whether `viewerId` is allowed to read or interact with a ticket.
   * `STAFF_REPORT` tickets block non-admin staff from snooping on reports against staff!
   */
  async assertTicketAccess(ticket, viewerId, { requireStaff = false } = {}) {
    const cfg = await this.serverConfigRepo.getOrCreate(ticket.serverId);
    const access = await this.permissionsApi.resolveMemberAccess(
      ticket.serverId,
      viewerId,
      cfg,
      { forceRefresh: requireStaff },
    );

    const isEligibleStaff =
      ticket.type === 'STAFF_REPORT' ? access.roles.isAdmin : access.roles.isStaff;

    if (requireStaff && !isEligibleStaff) {
      throw new AuthorizationError(
        ticket.type === 'STAFF_REPORT'
          ? 'Only server Admins may manage STAFF_REPORT tickets.'
          : 'Only authorized server staff may perform this ticket action.',
      );
    }

    const isParticipant =
      ticket.creatorId === viewerId || (ticket.participantIds || []).includes(viewerId);

    if (!isParticipant && !isEligibleStaff) {
      throw new AuthorizationError('You do not have access to this private ticket.');
    }

    return { access, isEligibleStaff, isParticipant };
  }

  async claimTicket({ serverId, ticketId, actorId, correlationId }) {
    const ticket = await this.ticketRepo.findByTicketId(ticketId);
    if (!ticket || ticket.serverId !== serverId) {
      throw new NotFoundError(`Ticket \`${ticketId}\` was not found.`);
    }

    await this.assertTicketAccess(ticket, actorId, { requireStaff: true });

    if (ticket.status === 'CLOSED') {
      throw new ValidationError(`Ticket \`${ticketId}\` is closed. Reopen it before claiming.`);
    }
    if (ticket.assignedStaffId && ticket.assignedStaffId !== actorId) {
      throw new ConflictError(`Ticket \`${ticketId}\` is already claimed by <@${ticket.assignedStaffId}>.`);
    }

    const updated = await this.ticketRepo.atomicUpdate(ticketId, {
      expectedVersion: ticket.version,
      set: {
        assignedStaffId: actorId,
        status: 'CLAIMED',
      },
    });
    if (!updated) throw new ConflictError('Ticket changed concurrently while claiming.');

    await this.auditService.record({
      serverId,
      actorId,
      actorType: 'STAFF',
      action: 'TICKET_CLAIMED',
      targetType: 'TICKET',
      targetId: ticketId,
      beforeState: { status: ticket.status, assignedStaffId: ticket.assignedStaffId },
      afterState: { status: 'CLAIMED', assignedStaffId: actorId },
      correlationId,
    });

    return updated;
  }

  async assignTicket({ serverId, ticketId, targetStaffId, actorId, correlationId }) {
    const ticket = await this.ticketRepo.findByTicketId(ticketId);
    if (!ticket || ticket.serverId !== serverId) {
      throw new NotFoundError(`Ticket \`${ticketId}\` was not found.`);
    }

    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    await this.permissionsApi.assertAuthorized({
      serverId,
      userId: actorId,
      serverConfig: cfg,
      requiredRole: 'moderator',
    });

    await this.assertTicketAccess(ticket, targetStaffId, { requireStaff: true });

    if (ticket.status === 'CLOSED') {
      throw new ValidationError(`Ticket \`${ticketId}\` is closed.`);
    }

    const updated = await this.ticketRepo.atomicUpdate(ticketId, {
      expectedVersion: ticket.version,
      set: {
        assignedStaffId: targetStaffId,
        status: 'CLAIMED',
      },
    });
    if (!updated) throw new ConflictError('Ticket changed concurrently while assigning.');

    await this.auditService.record({
      serverId,
      actorId,
      actorType: 'STAFF',
      action: 'TICKET_ASSIGNED',
      targetType: 'TICKET',
      targetId: ticketId,
      beforeState: { assignedStaffId: ticket.assignedStaffId },
      afterState: { assignedStaffId: targetStaffId },
      correlationId,
    });

    return updated;
  }

  async addNote({ serverId, ticketId, actorId, content, internalOnly = false, correlationId }) {
    const ticket = await this.ticketRepo.findByTicketId(ticketId);
    if (!ticket || ticket.serverId !== serverId) {
      throw new NotFoundError(`Ticket \`${ticketId}\` was not found.`);
    }

    const { isEligibleStaff } = await this.assertTicketAccess(ticket, actorId, {
      requireStaff: Boolean(internalOnly),
    });

    if (ticket.status === 'CLOSED') {
      throw new ValidationError(`Ticket \`${ticketId}\` is closed and cannot receive new notes.`);
    }

    const cleanContent = sanitizeUserText(content || '', {
      maxLength: 2000,
      fieldName: 'Ticket note',
    });
    if (!cleanContent) {
      throw new ValidationError('Ticket note content cannot be empty.');
    }

    const note = {
      noteId: `note_${randomUUID().slice(0, 8)}`,
      authorId: actorId,
      content: cleanContent,
      internalOnly: Boolean(internalOnly && isEligibleStaff),
      createdAt: new Date(),
    };

    const updated = await this.ticketRepo.atomicUpdate(ticketId, {
      expectedVersion: ticket.version,
      push: { notes: note },
    });
    if (!updated) throw new ConflictError('Ticket changed concurrently while adding note.');

    await this.auditService.record({
      serverId,
      actorId,
      actorType: isEligibleStaff ? 'STAFF' : 'USER',
      action: 'TICKET_NOTE_ADDED',
      targetType: 'TICKET',
      targetId: ticketId,
      metadata: { noteId: note.noteId, internalOnly: note.internalOnly },
      correlationId,
    });

    return updated;
  }

  /**
   * Closes a ticket, archives a SHA-256 checksummed transcript, records the closure reason,
   * and sets channel `read_only: true` so unauthorized post-close tampering is prevented.
   */
  async closeTicket({ serverId, ticketId, actorId, reason, correlationId }) {
    const ticket = await this.ticketRepo.findByTicketId(ticketId);
    if (!ticket || ticket.serverId !== serverId) {
      throw new NotFoundError(`Ticket \`${ticketId}\` was not found.`);
    }

    await this.assertTicketAccess(ticket, actorId, { requireStaff: true });

    if (ticket.status === 'CLOSED') {
      throw new ValidationError(`Ticket \`${ticketId}\` is already closed.`);
    }

    const cleanReason = sanitizeUserText(reason || '', {
      maxLength: 1000,
      fieldName: 'Ticket close reason',
    });
    if (cleanReason.length < 3) {
      throw new ValidationError('Closing a ticket requires a documented reason (at least 3 characters).');
    }

    const transcript = await this.transcriptService.buildTranscript({
      channelId: ticket.channelId,
      generatedBy: actorId,
      fallbackNotes: ticket.notes || [],
    });

    const now = new Date();
    const updated = await this.ticketRepo.atomicUpdate(ticketId, {
      expectedVersion: ticket.version,
      set: {
        status: 'CLOSED',
        transcript,
        'closure.closedAt': now,
        'closure.closedBy': actorId,
        'closure.reason': cleanReason,
      },
    });
    if (!updated) throw new ConflictError('Ticket changed concurrently while closing.');

    if (ticket.channelId) {
      await this.channelsApi
        .editChannel(ticket.channelId, {
          readOnly: true,
          postRoleIds: ticket.accessConfig?.allowedRoleIds || [],
        })
        .catch(() => undefined);
    }

    await this.auditService.record({
      serverId,
      actorId,
      actorType: 'STAFF',
      action: 'TICKET_CLOSED',
      targetType: 'TICKET',
      targetId: ticketId,
      beforeState: { status: ticket.status },
      afterState: {
        status: 'CLOSED',
        reason: cleanReason,
        transcriptMessages: transcript.messageCount,
        transcriptChecksum: transcript.checksumSha256,
      },
      correlationId,
    });

    return updated;
  }

  async reopenTicket({ serverId, ticketId, actorId, reason = 'Reopened by authorized staff', correlationId }) {
    const ticket = await this.ticketRepo.findByTicketId(ticketId);
    if (!ticket || ticket.serverId !== serverId) {
      throw new NotFoundError(`Ticket \`${ticketId}\` was not found.`);
    }

    await this.assertTicketAccess(ticket, actorId, { requireStaff: true });

    if (ticket.status !== 'CLOSED') {
      throw new ValidationError(`Ticket \`${ticketId}\` is already open (\`${ticket.status}\`).`);
    }

    const cleanReason = sanitizeUserText(reason, { maxLength: 1000, fieldName: 'Reopen reason' });
    const now = new Date();

    const updated = await this.ticketRepo.atomicUpdate(ticketId, {
      expectedVersion: ticket.version,
      set: {
        status: 'REOPENED',
        'closure.reopenedAt': now,
        'closure.reopenedBy': actorId,
        'closure.reopenReason': cleanReason,
      },
    });
    if (!updated) throw new ConflictError('Ticket changed concurrently while reopening.');

    if (ticket.channelId) {
      await this.channelsApi
        .editChannel(ticket.channelId, { readOnly: false })
        .catch(() => undefined);
    }

    await this.auditService.record({
      serverId,
      actorId,
      actorType: 'STAFF',
      action: 'TICKET_REOPENED',
      targetType: 'TICKET',
      targetId: ticketId,
      beforeState: { status: 'CLOSED' },
      afterState: { status: 'REOPENED', reopenReason: cleanReason },
      correlationId,
    });

    return updated;
  }
}
