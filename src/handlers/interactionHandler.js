import { EmbedBuilder } from '../api/messages.js';
import {
  BOT_BRAND,
  DEFAULT_COOLDOWNS,
  DEFAULT_SERVER_RULES,
  EMBED_COLORS,
} from '../config/settings.js';
import {
  buildApplicationReviewEmbed,
  buildApplicationReviewRows,
  buildMysteryRoundEmbed,
  buildMysteryRoundRows,
  buildTicketEmbed,
  buildTicketRoomRows,
} from '../utils/embeds.js';
import { ValidationError } from '../utils/errors.js';
import { generateCorrelationId } from '../utils/ids.js';
import { withCorrelationLogger } from '../utils/logger.js';
import { handleInteractionError } from './errorHandler.js';

export class InteractionHandler {
  constructor({
    client,
    messagesApi,
    permissionsApi,
    repositories,
    services,
    cooldowns,
    logger,
  }) {
    this.client = client;
    this.messagesApi = messagesApi;
    this.permissionsApi = permissionsApi;
    this.repositories = repositories;
    this.services = services;
    this.cooldowns = cooldowns;
    this.logger = logger;
  }

  async handleInteraction(interaction) {
    if (!interaction || interaction.type !== 'button' || !interaction.custom_id) {
      return false;
    }
    if (!interaction.custom_id.startsWith('mm2:')) {
      return false;
    }

    const correlationId = generateCorrelationId();
    const log = withCorrelationLogger(correlationId, {
      customId: interaction.custom_id,
      serverId: interaction.server_id,
      userId: interaction.user_id,
    });

    try {
      const serverId = interaction.server_id;
      const actorId = interaction.user_id;
      const serverCfg = await this.repositories.serverConfigs.getOrCreate(serverId);

      if (this.cooldowns) {
        this.cooldowns.enforce({
          userId: actorId,
          actionKey: 'button',
          cooldownMs: serverCfg.cooldowns?.buttonClickMs ?? DEFAULT_COOLDOWNS.buttonClickMs,
        });
      }

      const parts = interaction.custom_id.split(':');
      const domain = parts[1];
      const action = parts[2];
      const target = parts.slice(3).join(':');

      // 1. Sheriff Checkpoint Verification Buttons
      if (domain === 'verify') {
        if (action === 'rules') {
          const rawRules = serverCfg.rulesText || DEFAULT_SERVER_RULES;
          const rulesStr = Array.isArray(rawRules) ? rawRules.join('\n') : String(rawRules);
          await this.messagesApi.respondToInteraction(interaction, 'ephemeral', {
            content: `📜 **${BOT_BRAND.serverName} Rules:**\n${rulesStr}`,
          });
          return true;
        }

        if (action === 'help') {
          await this.messagesApi.respondToInteraction(interaction, 'ephemeral', {
            content:
              `🛡️ **Sheriff Checkpoint Guide:**\n` +
              `1. Click **Verify at Checkpoint** (or run \`/verify\`).\n` +
              `2. If Passcode Mode is active, copy your \`MM2-XXXX\` code and type \`/verify MM2-XXXX\`.\n` +
              `3. Need help? Open a ticket with \`/ticket open\`.`,
          });
          return true;
        }

        if (action === 'getcode') {
          const issued = await this.services.verification.issueChallenge(
            serverId,
            actorId,
            interaction.username || null,
          );
          if (issued.alreadyVerified) {
            await this.messagesApi.respondToInteraction(interaction, 'ephemeral', {
              content: '✅ You are already a **Verified Citizen** of **MurderMystery2**!',
            });
            return true;
          }
          await this.messagesApi.respondToInteraction(interaction, 'ephemeral', {
            content:
              `🛡️ **Sheriff Passcode Issued:** \`${issued.code}\`\n` +
              `Type \`/verify ${issued.code}\` in this channel within 10 minutes to complete verification!`,
          });
          return true;
        }

        if (action === 'instant' || action === 'start') {
          const res = await this.services.verification.verifyMember({
            serverId,
            userId: actorId,
            username: interaction.username || null,
            correlationId,
          });

          if (res.alreadyVerified) {
            await this.messagesApi.respondToInteraction(interaction, 'ephemeral', {
              content: '✅ You are already verified in **MurderMystery2**!',
            });
            return true;
          }
          if (res.status === 'CHALLENGE_ISSUED') {
            await this.messagesApi.respondToInteraction(interaction, 'ephemeral', {
              content: `🛡️ **Sheriff Passcode Issued:** \`${res.code}\`\nRun \`/verify ${res.code}\` within 10 minutes to unlock **MurderMystery2**!`,
            });
            return true;
          }

          await this.messagesApi.respondToInteraction(interaction, 'ephemeral', {
            content:
              '🔫 **Clearance Granted!** Welcome to **MurderMystery2** — you now have Citizen access! Run `/character create` and `/daily` to get started.',
          });
          return true;
        }
      }

      // 2. Detective Support & RP Ticket Buttons
      if (domain === 'ticket') {
        if (action === 'open') {
          const category = target || 'GENERAL_SUPPORT';
          const created = await this.services.ticket.openTicket({
            serverId,
            creatorId: actorId,
            type: category,
            subject: `${category} Case`,
            description: `Opened via ${BOT_BRAND.serverName} Detective Bureau button panel.`,
            correlationId,
          });
          await this.messagesApi.respondToInteraction(interaction, 'ephemeral', {
            content: created.channelId
              ? `🕵️ Private Ticket \`${created.ticketId}\` created! Head to <#${created.channelId}>.`
              : `🕵️ Private Ticket \`${created.ticketId}\` created!`,
          });
          return true;
        }

        if (action === 'claim') {
          const updated = await this.services.ticket.claimTicket({
            serverId,
            ticketId: target,
            actorId,
            correlationId,
          });
          await this.messagesApi.respondToInteraction(interaction, 'update', {
            content: `👮 Case \`${updated.ticketId}\` claimed by <@${actorId}>.`,
            embeds: [buildTicketEmbed(updated)],
            components: buildTicketRoomRows(updated),
          });
          return true;
        }

        if (action === 'close') {
          const closed = await this.services.ticket.closeTicket({
            serverId,
            ticketId: target,
            actorId,
            reason: 'Closed via ticket room button',
            correlationId,
          });
          await this.messagesApi.respondToInteraction(interaction, 'update', {
            content: `🔒 Case \`${closed.ticketId}\` archived by <@${actorId}>.`,
            embeds: [buildTicketEmbed(closed)],
            components: buildTicketRoomRows(closed),
          });
          return true;
        }
      }

      // 3. Sheriff Academy (Moderator Applications) Buttons
      if (domain === 'app') {
        if (action === 'guide') {
          await this.messagesApi.respondToInteraction(interaction, 'ephemeral', {
            content:
              `⭐ **Apply for MurderMystery2 Trial Sheriff:**\n` +
              `Copy & fill out:\n` +
              `\`/apply 18 | EST | 3h/day | Prior RP Mod experience | Why you want to help MM2 | How you handle RDM/FailRP\``,
          });
          return true;
        }

        if (action === 'status') {
          const openApp = await this.repositories.applications.findOpenByApplicant(
            serverId,
            actorId,
          );
          await this.messagesApi.respondToInteraction(interaction, 'ephemeral', {
            content: openApp
              ? `📩 Your active application \`${openApp.applicationId}\` is currently **${openApp.status}**.`
              : '📭 You have no pending Moderator Application right now. Click **How to Apply** to submit one!',
          });
          return true;
        }

        const decisionMap = {
          review: 'UNDER_REVIEW',
          accept: 'ACCEPTED',
          deny: 'DENIED',
        };
        if (decisionMap[action]) {
          const updated = await this.services.application.reviewApplication({
            serverId,
            applicationId: target,
            actorId,
            decision: decisionMap[action],
            correlationId,
          });
          const applicantUser = await this.repositories.users.getOrCreate(updated.applicantId);
          await this.messagesApi.respondToInteraction(interaction, 'update', {
            content: `⚖️ Application \`${updated.applicationId}\` marked **${updated.status}** by <@${actorId}>.`,
            embeds: [buildApplicationReviewEmbed(updated, applicantUser)],
            components: buildApplicationReviewRows(updated),
          });
          return true;
        }
      }

      // 4. Live Secret MM2 Mystery Round Buttons
      if (domain === 'mystery') {
        if (action === 'join') {
          const round = this.services.roleplay.joinMysteryRound({
            roundId: target,
            userId: actorId,
          });
          await this.messagesApi.respondToInteraction(interaction, 'update', {
            embeds: [buildMysteryRoundEmbed(round)],
            components: buildMysteryRoundRows(round),
          });
          return true;
        }

        if (action === 'leave') {
          const round = this.services.roleplay.leaveMysteryRound({
            roundId: target,
            userId: actorId,
          });
          await this.messagesApi.respondToInteraction(interaction, 'update', {
            embeds: [buildMysteryRoundEmbed(round)],
            components: buildMysteryRoundRows(round),
          });
          return true;
        }

        if (action === 'draw') {
          const round = await this.services.roleplay.drawMysteryRoles({
            serverId,
            roundId: target,
            actorId,
          });
          await this.messagesApi.respondToInteraction(interaction, 'update', {
            content: '🕵️ **Secret Roles Assigned!** Click **Reveal Secret Role** to check yours privately!',
            embeds: [buildMysteryRoundEmbed(round)],
            components: buildMysteryRoundRows(round),
          });
          return true;
        }

        if (action === 'role' || action === 'reveal') {
          const { round, role } = this.services.roleplay.getPlayerSecretRole({
            roundId: target,
            userId: actorId,
          });
          const roleDetails = {
            MURDERER: {
              title: '🔪 YOU ARE THE MURDERER!',
              color: EMBED_COLORS.MURDERER,
              desc: `Eliminate suspects in **${round.map.name}** through stealthy roleplay without exposing yourself to the Sheriff!`,
            },
            SHERIFF: {
              title: '🔫 YOU ARE THE SHERIFF!',
              color: EMBED_COLORS.SHERIFF,
              desc: `Investigate clues across **${round.map.name}**, protect the Innocents, and identify the Murderer!`,
            },
            INNOCENT: {
              title: '💚 YOU ARE INNOCENT!',
              color: EMBED_COLORS.INNOCENT,
              desc: `Survive inside **${round.map.name}**, gather clues, and help the Sheriff uncover the Murderer!`,
            },
          }[role];

          const secretEmbed = new EmbedBuilder()
            .setTitle(roleDetails.title)
            .setColor(roleDetails.color)
            .setDescription(roleDetails.desc)
            .setFooter(`Round ${round.roundId} • Keep this strictly secret!`);

          await this.messagesApi.respondToInteraction(interaction, 'ephemeral', {
            embeds: [secretEmbed],
          });
          return true;
        }
      }

      // 5. RP Self-Roles Toggle Buttons (`mm2:selfrole:<key>`)
      if (domain === 'selfrole') {
        const key = parts.slice(2).join(':');
        const res = await this.services.roleplay.toggleSelfRole({
          serverId,
          userId: actorId,
          roleKey: key,
        });
        await this.messagesApi.respondToInteraction(interaction, 'ephemeral', {
          content:
            res.action === 'added'
              ? `✅ Equipped **${res.roleKey}** role!`
              : `➖ Removed **${res.roleKey}** role.`,
        });
        return true;
      }

      throw new ValidationError(`Unsupported MM2 Helper button action: \`${interaction.custom_id}\``);
    } catch (error) {
      await handleInteractionError({
        error,
        interaction,
        correlationId,
        messagesApi: this.messagesApi,
        auditService: this.services?.audit,
        logger: log,
      });
      return true;
    }
  }
}
