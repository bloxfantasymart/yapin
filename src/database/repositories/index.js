import { getActiveDatabase } from '../connection.js';
import { JsonUserRepository } from './userRepository.js';
import { JsonTradeRepository, ACTIVE_TRADE_STATES } from './tradeRepository.js';
import {
  JsonDisputeRepository,
  JsonReportRepository,
  JsonTicketRepository,
  OPEN_TICKET_STATUSES,
} from './ticketDisputeRepository.js';
import {
  JsonAuditRepository,
  JsonOperationalRepository,
  JsonServerConfigRepository,
} from './auditConfigRepository.js';

export { ACTIVE_TRADE_STATES, OPEN_TICKET_STATUSES };

/**
 * Creates the full repository suite backed by a `JsonDatabase` instance.
 *
 * @param {import('../jsonStore.js').JsonDatabase} [database]
 */
export function createJsonRepositories(database = getActiveDatabase()) {
  if (!database) {
    throw new Error('JsonDatabase instance is required to initialize JSON repositories.');
  }

  const audits = new JsonAuditRepository(database);
  const serverConfigs = new JsonServerConfigRepository(database);

  return {
    db: database,
    users: new JsonUserRepository(database),
    trades: new JsonTradeRepository(database),
    tickets: new JsonTicketRepository(database),
    disputes: new JsonDisputeRepository(database),
    reports: new JsonReportRepository(database),
    audits,
    auditLogs: audits,
    serverConfigs,
    serverConfig: serverConfigs,
    operational: new JsonOperationalRepository(database),
  };
}
