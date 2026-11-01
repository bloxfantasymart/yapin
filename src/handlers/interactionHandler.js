import { DEFAULT_COOLDOWNS } from '../config/settings.js';
import { generateCorrelationId } from '../utils/ids.js';
import { withCorrelationLogger } from '../utils/logger.js';
import { ValidationError } from '../utils/errors.js';
import { buildTradeActionRows, buildTradeEmbed } from '../utils/embeds.js';
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

    if (!interaction.custom_id.startsWith('mm:')) {
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

      const [, action, tradeId] = interaction.custom_id.split(':');
      if (!action || !tradeId) {
        throw new ValidationError('Malformed trade button payload.');
      }

      if (action === 'deposit_info') {
        await this.messagesApi.respondToInteraction(interaction, 'ephemeral', {
          content:
            `📦 **How to Report Your Deposit on \`${tradeId}\`:**\n` +
            `Run:\n\`/deposit ${tradeId} ref="Transfer or delivery ID" proof=https://files.yapper.website/...\`\n` +
            `_(Reminder: Self-reported deposits remain \`REPORTED_SENT\` until independently verified by the assigned middleman.)_`,
        });
        return true;
      }

      if (action === 'dispute_info') {
        await this.messagesApi.respondToInteraction(interaction, 'ephemeral', {
          content:
            `⚠️ **Need to Freeze Trade \`${tradeId}\`?**\n` +
            `Run:\n\`/dispute ${tradeId} reason="Detailed explanation of issue" proof=https://...\`\n` +
            `Opening a dispute immediately freezes trade completion until moderator review.`,
        });
        return true;
      }

      let updatedTrade;

      if (action === 'accept') {
        updatedTrade = await this.services.confirmation.acceptTrade({
          serverId,
          tradeId,
          actorId,
          correlationId,
        });
      } else if (action === 'reject') {
        updatedTrade = await this.services.confirmation.rejectTrade({
          serverId,
          tradeId,
          actorId,
          reason: 'Rejected via trade invitation button',
          correlationId,
        });
      } else if (action === 'cancel') {
        updatedTrade = await this.services.trade.cancelTradeByParticipant({
          serverId,
          tradeId,
          actorId,
          reason: 'Cancelled via trade card button',
          correlationId,
        });
      } else if (action === 'claim') {
        updatedTrade = await this.services.assignment.claimTrade({
          serverId,
          tradeId,
          actorId,
          correlationId,
        });
      } else if (action === 'confirm_mm') {
        updatedTrade = await this.services.confirmation.submitParticipantConfirmation({
          serverId,
          tradeId,
          actorId,
          stageHint: 'middleman',
          correlationId,
        });
      } else if (action === 'confirm_release') {
        updatedTrade = await this.services.confirmation.submitParticipantConfirmation({
          serverId,
          tradeId,
          actorId,
          stageHint: 'release',
          correlationId,
        });
      } else {
        throw new ValidationError(`Unsupported button action: ${action}`);
      }

      const embed = buildTradeEmbed(updatedTrade, { disclaimerText: serverCfg.disclaimerText });
      const components = buildTradeActionRows(updatedTrade);

      await this.messagesApi.respondToInteraction(interaction, 'update', {
        content: `🔄 Trade **${updatedTrade.tradeId}** updated by <@${actorId}> — State: \`${updatedTrade.state}\`.`,
        embeds: [embed],
        components,
      });

      return true;
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
