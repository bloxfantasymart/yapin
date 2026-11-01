import { MongooseUserRepository } from './userRepository.js';
import { MongooseTradeRepository, ACTIVE_TRADE_STATES } from './tradeRepository.js';
import {
  MongooseDisputeRepository,
  MongooseReportRepository,
  MongooseTicketRepository,
  OPEN_TICKET_STATUSES,
} from './ticketDisputeRepository.js';
import {
  MongooseAuditRepository,
  MongooseOperationalRepository,
  MongooseServerConfigRepository,
} from './auditConfigRepository.js';

export { ACTIVE_TRADE_STATES, OPEN_TICKET_STATUSES };

export function createMongooseRepositories() {
  const audits = new MongooseAuditRepository();
  const serverConfigs = new MongooseServerConfigRepository();
  return {
    users: new MongooseUserRepository(),
    trades: new MongooseTradeRepository(),
    tickets: new MongooseTicketRepository(),
    disputes: new MongooseDisputeRepository(),
    reports: new MongooseReportRepository(),
    audits,
    auditLogs: audits,
    serverConfigs,
    serverConfig: serverConfigs,
    operational: new MongooseOperationalRepository(),
  };
}
