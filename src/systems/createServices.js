import { AutoModService } from '../moderation/autoModService.js';
import { ModerationService } from '../moderation/moderationService.js';
import { IdempotencyGuard } from '../security/idempotency.js';
import { CooldownManager } from '../security/rateLimiter.js';
import { TicketService } from '../tickets/ticketService.js';
import { TranscriptService } from '../tickets/transcriptService.js';
import { ApplicationService } from './applicationService.js';
import { LevelingService } from './levelingService.js';
import { LogService } from './logService.js';
import { RoleplayService } from './roleplayService.js';
import { VerificationService } from './verificationService.js';

/**
 * Wires all **MM2 Helper** (`MurderMystery2`) domain services into a clean container.
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

  const logService = new LogService({
    auditRepo: repositories.audits,
    serverConfigRepo: repositories.serverConfigs,
    messagesApi,
    logger,
  });

  const levelingService = new LevelingService({
    userRepo: repositories.users,
    serverConfigRepo: repositories.serverConfigs,
    permissionsApi,
    messagesApi,
    logService,
    logger,
  });

  const verificationService = new VerificationService({
    userRepo: repositories.users,
    serverConfigRepo: repositories.serverConfigs,
    permissionsApi,
    messagesApi,
    levelingService,
    logService,
    logger,
  });

  const applicationService = new ApplicationService({
    applicationRepo: repositories.applications,
    userRepo: repositories.users,
    serverConfigRepo: repositories.serverConfigs,
    permissionsApi,
    messagesApi,
    logService,
    logger,
  });

  const transcriptService = new TranscriptService({ messagesApi });

  const ticketService = new TicketService({
    ticketRepo: repositories.tickets,
    serverConfigRepo: repositories.serverConfigs,
    permissionsApi,
    channelsApi,
    messagesApi,
    transcriptService,
    logService,
    logger,
  });

  const moderationService = new ModerationService({
    userRepo: repositories.users,
    caseRepo: repositories.cases,
    reportRepo: repositories.reports,
    serverConfigRepo: repositories.serverConfigs,
    permissionsApi,
    channelsApi,
    messagesApi,
    logService,
    logger,
  });

  const autoModService = new AutoModService({
    serverConfigRepo: repositories.serverConfigs,
    permissionsApi,
    messagesApi,
    moderationService,
    logService,
    logger,
  });

  const roleplayService = new RoleplayService({
    userRepo: repositories.users,
    serverConfigRepo: repositories.serverConfigs,
    permissionsApi,
    logService,
  });

  return {
    cooldowns,
    idempotency,
    services: {
      log: logService,
      audit: logService,
      leveling: levelingService,
      verification: verificationService,
      application: applicationService,
      transcript: transcriptService,
      ticket: ticketService,
      moderation: moderationService,
      autoMod: autoModService,
      roleplay: roleplayService,
    },
  };
}
