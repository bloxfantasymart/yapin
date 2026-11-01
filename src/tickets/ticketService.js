import { EmbedBuilder } from '../api/messages.js';
import { BOT_BRAND, EMBED_COLORS } from '../config/settings.js';
import { TICKET_TYPES } from '../database/models/Ticket.js';
import { sanitizeUserText } from '../security/sanitizer.js';
import { buildTicketEmbed, buildTicketRoomRows } from '../utils/embeds.js';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  SecurityError,
  ValidationError,
} from '../utils/errors.js';
import { generateEntityId, generateTicketId, userMention } from '../utils/ids.js';

/**
 * Fail-Closed Private Support & Roleplay Ticket Desk for **MM2 Helper** (`MurderMystery2`).
 */
export class TicketService {
  constructor({
    ticketRepo,
    serverConfigRepo,
    permissionsApi,
    channelsApi = null,
    messagesApi = null,
    transcriptService,
    logService,
    logger = null,
  }) {
    this.ticketRepo = ticketRepo;
    this.serverConfigRepo = serverConfigRepo;
    this.permissionsApi = permissionsApi;
    this.channelsApi = channelsApi;
    this.messagesApi = messagesApi;
    this.transcriptService = transcriptService;
    this.logService = logService;
    this.logger = logger;
  }

  async openTicket({
    serverId,
    creatorId,
    type = 'GENERAL_SUPPORT',
    subject,
    description,
    additionalParticipantIds = [],
    correlationId = null,
  }) {
    const normalizedType = String(type || 'GENERAL_SUPPORT').toUpperCase();
    if (!TICKET_TYPES.includes(normalizedType)) {
      throw new ValidationError(
        `Invalid ticket category. Choose one of: ${TICKET_TYPES.join(', ')}`,
      );
    }

    const cleanSubject = sanitizeUserText(subject || `${normalizedType} Case`, {
      maxLength: 200,
      fieldName: 'Subject',
    });
    const cleanDesc = sanitizeUserText(
      description || 'Opened via MurderMystery2 Support Desk button.',
      { maxLength: 2000, fieldName: 'Description' },
    );

    const cfg = await this.serverConfigRepo.getOrCreate(serverId);

    const duplicate = await this.ticketRepo.findOpenDuplicate({
      serverId,
      creatorId,
      type: normalizedType,
    });
    if (duplicate) {
      throw new ConflictError(
        `You already have an open \`${normalizedType}\` ticket (\`${duplicate.ticketId}\`).`,
      );
    }

    const openCount = await this.ticketRepo.countOpenByCreator(serverId, creatorId);
    if (openCount >= cfg.ticketConfig.maxOpenPerUser) {
      throw new ValidationError(
        `You already have ${openCount} open ticket(s) (maximum ${cfg.ticketConfig.maxOpenPerUser}).`,
      );
    }

    const ticketId = generateTicketId();
    const participantIds = [...new Set([creatorId, ...additionalParticipantIds.filter(Boolean)])];

    let channelId = null;
    let allowedRoleIds = [];
    let scopedRoleId = null;

    if (cfg.ticketConfig.createDedicatedChannel && this.channelsApi) {
      const botRoles = await this.permissionsApi.getBotRoleIds(serverId);
      // STAFF_REPORT is strictly restricted to Server Admins (never Trial Mods / Mods / Support!)
      const staffRoles =
        normalizedType === 'STAFF_REPORT'
          ? [...cfg.staffRoles.adminRoleIds]
          : [
              ...cfg.staffRoles.adminRoleIds,
              ...cfg.staffRoles.moderatorRoleIds,
              ...cfg.staffRoles.trialModRoleIds,
              ...cfg.staffRoles.supportRoleIds,
            ];

      const roleCandidates = [...new Set([...botRoles, ...staffRoles].filter(Boolean))];
      if (roleCandidates.length === 0) {
        const allServerRoles = await this.permissionsApi.fetchServerRoles(serverId);
        for (const r of allServerRoles) {
          if (r.manage_server || r.auto) roleCandidates.push(String(r.id));
        }
      }

      try {
        const provisioned = await this.channelsApi.createPrivateChannel({
          serverId,
          name: `case-${ticketId.toLowerCase()}`,
          categoryId: cfg.channels.ticketCategoryId,
          allowedRoleIds: roleCandidates,
          participantUserIds: participantIds,
          useScopedParticipantRole: cfg.ticketConfig.useScopedParticipantRole,
        });
        channelId = provisioned.channel.id;
        allowedRoleIds = provisioned.allowedRoleIds;
        scopedRoleId = provisioned.scopedRoleId;
      } catch (err) {
        // Alert staff & fail closed so private ticket details NEVER leak to a public channel!
        await this.logService.record({
          serverId,
          actorId: creatorId,
          actorType: 'SYSTEM',
          action: 'TICKET_PRIVATE_LOCK_FAILED',
          targetType: 'TICKET',
          targetId: ticketId,
          metadata: { error: err?.message },
          correlationId,
          stream: 'alert',
        });
        throw new SecurityError(
          'Unable to provision a private staff-scoped ticket channel (rolled back safely; staff alerted).',
        );
      }
    }

    const created = await this.ticketRepo.create({
      ticketId,
      serverId,
      creatorId,
      participantIds,
      type: normalizedType,
      subject: cleanSubject,
      description: cleanDesc,
      channelId,
      accessConfig: {
        isPrivate: true,
        allowedRoleIds,
        scopedRoleId,
      },
      status: 'OPEN',
    });

    if (channelId && this.messagesApi) {
      await this.messagesApi
        .sendMessage(channelId, {
          content: `🕵️ **MurderMystery2 Case Room** opened for ${userMention(creatorId)} (\`${created.ticketId}\`)`,
          embeds: [buildTicketEmbed(created)],
          components: buildTicketRoomRows(created),
        })
        .catch(() => undefined);
    }

    await this.logService.record({
      serverId,
      actorId: creatorId,
      actorType: 'USER',
      action: 'TICKET_OPENED',
      targetType: 'TICKET',
      targetId: created.ticketId,
      afterState: { type: normalizedType, channelId },
      correlationId,
      stream: 'ticket',
    });

    return created;
  }

  async _assertTicketAccess(serverId, ticket, actorId, { staffOnly = false } = {}) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    const access = await this.permissionsApi.resolveMemberAccess(serverId, actorId, cfg, {
      forceRefresh: staffOnly,
    });

    if (ticket.type === 'STAFF_REPORT') {
      if (!access.roles.isAdmin && (staffOnly || ticket.creatorId !== actorId)) {
        throw new AuthorizationError('STAFF_REPORT tickets are restricted to Server Admins.');
      }
      return access;
    }

    if (staffOnly && !access.roles.isStaff) {
      throw new AuthorizationError('Only MurderMystery2 Staff can perform this ticket action.');
    }

    const isParticipant =
      ticket.creatorId === actorId || (ticket.participantIds || []).includes(actorId);
    if (!isParticipant && !access.roles.isStaff) {
      throw new AuthorizationError('You do not have access to this private ticket.');
    }
    return access;
  }

  async getTicketForViewer({ serverId, ticketId, viewerId }) {
    const ticket = await this.ticketRepo.findByTicketId(ticketId);
    if (!ticket || ticket.serverId !== serverId) {
      throw new NotFoundError(`Ticket \`${ticketId}\` was not found.`);
    }
    const access = await this._assertTicketAccess(serverId, ticket, viewerId);
    if (!access.roles.isStaff) {
      ticket.notes = (ticket.notes || []).filter((n) => !n.internalOnly);
    }
    return ticket;
  }

  async claimTicket({ serverId, ticketId, actorId, correlationId = null }) {
    const ticket = await this.ticketRepo.findByTicketId(ticketId);
    if (!ticket || ticket.serverId !== serverId) {
      throw new NotFoundError(`Ticket \`${ticketId}\` was not found.`);
    }
    await this._assertTicketAccess(serverId, ticket, actorId, { staffOnly: true });

    if (ticket.status === 'CLOSED') {
      throw new ValidationError('Closed tickets must be reopened before claiming.');
    }

    const updated = await this.ticketRepo.atomicUpdate(ticket.ticketId, {
      expectedVersion: ticket.version,
      set: {
        assignedStaffId: actorId,
        status: 'CLAIMED',
      },
    });
    if (!updated) throw new ConflictError('Ticket changed concurrently; please retry.');

    await this.logService.record({
      serverId,
      actorId,
      actorType: 'STAFF',
      action: 'TICKET_CLAIMED',
      targetType: 'TICKET',
      targetId: ticket.ticketId,
      correlationId,
      stream: 'ticket',
    });
    return updated;
  }

  async assignTicket({ serverId, ticketId, actorId, targetStaffId, correlationId = null }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    await this.permissionsApi.assertAuthorized({
      serverId,
      userId: actorId,
      serverConfig: cfg,
      requiredRole: 'moderator',
    });
    await this.permissionsApi.assertAuthorized({
      serverId,
      userId: targetStaffId,
      serverConfig: cfg,
      requiredRole: 'staff',
    });

    const ticket = await this.ticketRepo.findByTicketId(ticketId);
    if (!ticket || ticket.serverId !== serverId) {
      throw new NotFoundError(`Ticket \`${ticketId}\` was not found.`);
    }

    const updated = await this.ticketRepo.atomicUpdate(ticket.ticketId, {
      expectedVersion: ticket.version,
      set: {
        assignedStaffId: targetStaffId,
        status: ticket.status === 'OPEN' ? 'CLAIMED' : ticket.status,
      },
    });
    if (!updated) throw new ConflictError('Ticket changed concurrently.');

    await this.logService.record({
      serverId,
      actorId,
      actorType: 'STAFF',
      action: 'TICKET_ASSIGNED',
      targetType: 'TICKET',
      targetId: ticket.ticketId,
      afterState: { assignedStaffId: targetStaffId },
      correlationId,
      stream: 'ticket',
    });
    return updated;
  }

  async addNote({ serverId, ticketId, actorId, content, internalOnly = false, correlationId = null }) {
    const ticket = await this.ticketRepo.findByTicketId(ticketId);
    if (!ticket || ticket.serverId !== serverId) {
      throw new NotFoundError(`Ticket \`${ticketId}\` was not found.`);
    }
    const access = await this._assertTicketAccess(serverId, ticket, actorId);
    if (internalOnly && !access.roles.isStaff) {
      throw new AuthorizationError('Only staff may add internal-only notes.');
    }

    const cleanNote = sanitizeUserText(content, { maxLength: 2000, fieldName: 'Ticket note' });
    const updated = await this.ticketRepo.atomicUpdate(ticket.ticketId, {
      expectedVersion: ticket.version,
      push: {
        notes: {
          noteId: generateEntityId('NTE', 6),
          authorId: actorId,
          content: cleanNote,
          internalOnly: Boolean(internalOnly),
          createdAt: new Date(),
        },
      },
    });
    if (!updated) throw new ConflictError('Ticket changed concurrently.');

    await this.logService.record({
      serverId,
      actorId,
      actorType: access.roles.isStaff ? 'STAFF' : 'USER',
      action: 'TICKET_NOTE_ADDED',
      targetType: 'TICKET',
      targetId: ticket.ticketId,
      metadata: { internalOnly: Boolean(internalOnly) },
      correlationId,
    });
    return updated;
  }

  async closeTicket({ serverId, ticketId, actorId, reason, correlationId = null }) {
    const ticket = await this.ticketRepo.findByTicketId(ticketId);
    if (!ticket || ticket.serverId !== serverId) {
      throw new NotFoundError(`Ticket \`${ticketId}\` was not found.`);
    }
    const access = await this._assertTicketAccess(serverId, ticket, actorId, { staffOnly: true });

    if (ticket.status === 'CLOSED') {
      throw new ValidationError(`Ticket \`${ticket.ticketId}\` is already closed.`);
    }

    const cleanReason = sanitizeUserText(reason || 'Resolved by MurderMystery2 Staff', {
      maxLength: 1000,
      fieldName: 'Close reason',
    });

    const transcript = await this.transcriptService.buildTranscript({
      channelId: ticket.channelId,
      generatedBy: actorId,
      fallbackNotes: ticket.notes,
    });

    const updated = await this.ticketRepo.atomicUpdate(ticket.ticketId, {
      expectedVersion: ticket.version,
      set: {
        status: 'CLOSED',
        transcript,
        'closure.closedAt': new Date(),
        'closure.closedBy': actorId,
        'closure.reason': cleanReason,
      },
    });
    if (!updated) throw new ConflictError('Ticket changed concurrently.');

    if (ticket.channelId && this.channelsApi) {
      await this.channelsApi
        .editChannel(ticket.channelId, { readOnly: true })
        .catch(() => undefined);
    }

    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    const txChannelId = cfg.channels.transcriptChannelId || cfg.channels.ticketLogChannelId;
    if (txChannelId && this.messagesApi) {
      const txEmbed = new EmbedBuilder()
        .setTitle(`🗄️ Archived Case Transcript • ${updated.ticketId}`)
        .setColor(EMBED_COLORS.NOIR)
        .addField('Category', `\`${updated.type}\``, true)
        .addField('Closed By', userMention(actorId), true)
        .addField('Messages Archived', String(transcript.messageCount), true)
        .addField('SHA-256 Checksum', `\`${transcript.checksumSha256}\``, false)
        .addField('Resolution Reason', cleanReason, false)
        .setFooter(BOT_BRAND.footer);
      await this.messagesApi.sendMessage(txChannelId, { embeds: [txEmbed] }).catch(() => undefined);
    }

    await this.logService.record({
      serverId,
      actorId,
      actorType: access.roles.isStaff ? 'STAFF' : 'USER',
      action: 'TICKET_CLOSED',
      targetType: 'TICKET',
      targetId: updated.ticketId,
      afterState: { status: 'CLOSED', checksumSha256: transcript.checksumSha256 },
      correlationId,
      stream: 'ticket',
    });
    return updated;
  }

  async reopenTicket({ serverId, ticketId, actorId, reason, correlationId = null }) {
    const ticket = await this.ticketRepo.findByTicketId(ticketId);
    if (!ticket || ticket.serverId !== serverId) {
      throw new NotFoundError(`Ticket \`${ticketId}\` was not found.`);
    }
    await this._assertTicketAccess(serverId, ticket, actorId, { staffOnly: true });

    if (ticket.status !== 'CLOSED') {
      throw new ValidationError('Only CLOSED tickets can be reopened.');
    }

    const cleanReason = sanitizeUserText(reason || 'Reopened for follow-up investigation', {
      maxLength: 1000,
      fieldName: 'Reopen reason',
    });

    const updated = await this.ticketRepo.atomicUpdate(ticket.ticketId, {
      expectedVersion: ticket.version,
      set: {
        status: 'REOPENED',
        'closure.reopenedAt': new Date(),
        'closure.reopenedBy': actorId,
        'closure.reopenReason': cleanReason,
      },
    });
    if (!updated) throw new ConflictError('Ticket changed concurrently.');

    if (ticket.channelId && this.channelsApi) {
      await this.channelsApi
        .editChannel(ticket.channelId, { readOnly: false })
        .catch(() => undefined);
    }

    await this.logService.record({
      serverId,
      actorId,
      actorType: 'STAFF',
      action: 'TICKET_REOPENED',
      targetType: 'TICKET',
      targetId: updated.ticketId,
      metadata: { reason: cleanReason },
      correlationId,
      stream: 'ticket',
    });
    return updated;
  }
}
