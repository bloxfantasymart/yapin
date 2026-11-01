import { AuditService } from './auditService.js';
import { TradeService } from './tradeService.js';
import { ConfirmationService } from './confirmationService.js';
import { AssignmentService } from './assignmentService.js';
import { DepositService } from './depositService.js';
import { DisputeService } from './disputeService.js';
import { TranscriptService } from '../tickets/transcriptService.js';
import { TicketService } from '../tickets/ticketService.js';
import { ModerationService } from '../moderation/moderationService.js';
import { AntiScamService } from '../security/antiScam.js';
import { CooldownManager } from '../security/rateLimiter.js';
import { IdempotencyGuard } from '../security/idempotency.js';

/**
 * Wires all domain services, repositories, and API adapters into a cohesive application container.
 */
export function createApplicationServices({
  repositories,
  permissionsApi,
  channelsApi,
  messagesApi,
  logger,
}) {
  const cooldowns = new CooldownManager();
  const idempotency = new IdempotencyGuard({ operationalRepo: repositories.operational });

  const audit = new AuditService({
    auditRepo: repositories.audits,
    serverConfigRepo: repositories.serverConfigs,
    messagesApi,
    logger,
  });

  const antiScam = new AntiScamService({
    userRepo: repositories.users,
    permissionsApi,
    messagesApi,
    auditService: audit,
  });

  const transcript = new TranscriptService({ messagesApi });

  const ticket = new TicketService({
    ticketRepo: repositories.tickets,
    serverConfigRepo: repositories.serverConfigs,
    channelsApi,
    messagesApi,
    permissionsApi,
    antiScam,
    transcriptService: transcript,
    auditService: audit,
    logger,
  });

  const assignment = new AssignmentService({
    tradeRepo: repositories.trades,
    userRepo: repositories.users,
    serverConfigRepo: repositories.serverConfigs,
    permissionsApi,
    antiScam,
    auditService: audit,
  });

  const confirmation = new ConfirmationService({
    tradeRepo: repositories.trades,
    userRepo: repositories.users,
    auditService: audit,
    assignmentService: assignment,
    serverConfigRepo: repositories.serverConfigs,
  });

  const deposit = new DepositService({
    tradeRepo: repositories.trades,
    serverConfigRepo: repositories.serverConfigs,
    permissionsApi,
    antiScam,
    auditService: audit,
  });

  const dispute = new DisputeService({
    disputeRepo: repositories.disputes,
    tradeRepo: repositories.trades,
    userRepo: repositories.users,
    serverConfigRepo: repositories.serverConfigs,
    permissionsApi,
    antiScam,
    auditService: audit,
    ticketService: ticket,
    logger,
  });

  const trade = new TradeService({
    tradeRepo: repositories.trades,
    userRepo: repositories.users,
    disputeRepo: repositories.disputes,
    serverConfigRepo: repositories.serverConfigs,
    permissionsApi,
    antiScam,
    auditService: audit,
    idempotencyGuard: idempotency,
    logger,
  });

  const moderation = new ModerationService({
    userRepo: repositories.users,
    reportRepo: repositories.reports,
    serverConfigRepo: repositories.serverConfigs,
    permissionsApi,
    antiScam,
    auditService: audit,
  });

  return {
    services: {
      audit,
      antiScam,
      transcript,
      trade,
      confirmation,
      assignment,
      deposit,
      dispute,
      ticket,
      moderation,
    },
    cooldowns,
    idempotency,
  };
}
