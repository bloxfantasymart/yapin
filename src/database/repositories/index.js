import { getActiveDatabase } from '../connection.js';
import { JsonUserRepository } from './userRepository.js';
import {
  JsonModApplicationRepository,
  JsonModCaseRepository,
} from './caseApplicationRepository.js';
import {
  JsonReportRepository,
  JsonTicketRepository,
  OPEN_TICKET_STATUSES,
} from './ticketReportRepository.js';
import {
  JsonAuditRepository,
  JsonOperationalRepository,
  JsonServerConfigRepository,
} from './auditConfigRepository.js';

export { OPEN_TICKET_STATUSES };

export function createJsonRepositories(database = getActiveDatabase()) {
  if (!database) {
    throw new Error('JsonDatabase instance is required to initialize JSON repositories.');
  }

  const audits = new JsonAuditRepository(database);
  const serverConfigs = new JsonServerConfigRepository(database);

  return {
    db: database,
    users: new JsonUserRepository(database),
    cases: new JsonModCaseRepository(database),
    applications: new JsonModApplicationRepository(database),
    tickets: new JsonTicketRepository(database),
    reports: new JsonReportRepository(database),
    audits,
    auditLogs: audits,
    serverConfigs,
    serverConfig: serverConfigs,
    operational: new JsonOperationalRepository(database),
  };
}
