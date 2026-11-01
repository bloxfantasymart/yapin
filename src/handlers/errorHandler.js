import {
  AppError,
  AuthorizationError,
  DatabaseUnavailableError,
  sanitizeErrorMessage,
} from '../utils/errors.js';
import { logger as rootLogger } from '../utils/logger.js';

/**
 * Maps internal/domain errors into safe, non-leaking user-facing text while logging structured context.
 */
export function formatUserSafeError(error, correlationId) {
  if (error instanceof AppError && error.expose !== false) {
    return `❌ ${sanitizeErrorMessage(error.message)} *(ref: \`${correlationId}\`)*`;
  }
  if (error instanceof DatabaseUnavailableError) {
    return `⚠️ Database is temporarily unavailable. No trade changes were committed. Please retry shortly *(ref: \`${correlationId}\`)*.`;
  }
  return `❌ An unexpected internal error occurred. No unsafe state change was applied *(ref: \`${correlationId}\`)*.`;
}

export async function handleCommandError({
  error,
  event,
  correlationId,
  messagesApi,
  auditService,
  logger = rootLogger,
}) {
  const isExpectedDomainError = error instanceof AppError && error.expose !== false;

  if (error instanceof AuthorizationError && auditService && event?.server_id && event?.author_id) {
    await auditService
      .record({
        serverId: event.server_id,
        action: 'STAFF_AUTH_DENIED',
        actorId: event.author_id,
        actorType: 'USER',
        targetType: 'SYSTEM',
        targetId: event.command || 'unknown',
        correlationId,
        metadata: { reason: sanitizeErrorMessage(error.message) },
      })
      .catch(() => undefined);
  }

  const logPayload = {
    correlationId,
    command: event?.command,
    serverId: event?.server_id,
    channelId: event?.channel_id,
    authorId: event?.author_id,
    errorCode: error?.code || 'UNHANDLED_ERROR',
    errMessage: sanitizeErrorMessage(error?.message || String(error)),
  };

  if (isExpectedDomainError) {
    logger.warn(logPayload, 'Command rejected with domain error');
  } else {
    logger.error(logPayload, 'Unexpected error during command execution');
  }

  if (messagesApi && event?.channel_id) {
    await messagesApi
      .sendMessage(event.channel_id, {
        content: formatUserSafeError(error, correlationId),
        replyTo: event.id,
      })
      .catch((sendErr) => {
        logger.warn(
          { correlationId, errMessage: sanitizeErrorMessage(sendErr.message) },
          'Failed to send error reply to channel',
        );
      });
  }
}

export async function handleInteractionError({
  error,
  interaction,
  correlationId,
  messagesApi,
  auditService,
  logger = rootLogger,
}) {
  if (error instanceof AuthorizationError && auditService && interaction?.server_id && interaction?.user_id) {
    await auditService
      .record({
        serverId: interaction.server_id,
        action: 'STAFF_AUTH_DENIED',
        actorId: interaction.user_id,
        actorType: 'USER',
        targetType: 'SYSTEM',
        targetId: interaction.custom_id || 'button',
        correlationId,
        metadata: { reason: sanitizeErrorMessage(error.message) },
      })
      .catch(() => undefined);
  }

  logger.warn(
    {
      correlationId,
      customId: interaction?.custom_id,
      userId: interaction?.user_id,
      errorCode: error?.code || 'INTERACTION_ERROR',
      errMessage: sanitizeErrorMessage(error?.message || String(error)),
    },
    'Interaction rejected or failed',
  );

  if (messagesApi && interaction?.id && interaction?.token) {
    await messagesApi
      .respondToInteraction(interaction, 'ephemeral', {
        content: formatUserSafeError(error, correlationId),
      })
      .catch(() => undefined);
  }
}
