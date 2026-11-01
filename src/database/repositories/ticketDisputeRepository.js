import { ConflictError } from '../../utils/errors.js';
import { getByDotPath, setByDotPath } from '../jsonStore.js';
import { DisputeModel } from '../models/Dispute.js';
import { ReportModel } from '../models/Report.js';
import { TicketModel } from '../models/Ticket.js';
import { deepCloneRecord } from '../models/schemaHelpers.js';

export const OPEN_TICKET_STATUSES = Object.freeze(['OPEN', 'CLAIMED', 'REOPENED']);

export class JsonTicketRepository {
  /**
   * @param {import('../jsonStore.js').JsonDatabase} db
   */
  constructor(db) {
    this.db = db;
  }

  async create(ticketData) {
    return this.db.withDocLock(`ticket:${ticketData.ticketId}`, async () => {
      this.db.checkHealthy();
      if (this.db.store.tickets[ticketData.ticketId]) {
        const dup = new ConflictError(`Duplicate ticketId rejected: ${ticketData.ticketId}`);
        dup.code = 11000;
        throw dup;
      }
      const now = new Date();
      const validated = TicketModel.validate({
        ...ticketData,
        createdAt: ticketData.createdAt || now,
        updatedAt: now,
      });
      this.db.store.tickets[validated.ticketId] = validated;
      await this.db.markModified('tickets');
      return deepCloneRecord(validated);
    });
  }

  async findByTicketId(ticketId) {
    this.db.checkHealthy();
    const doc = this.db.store.tickets[ticketId];
    return doc ? deepCloneRecord(doc) : null;
  }

  async findByChannelId(channelId) {
    this.db.checkHealthy();
    const hit = Object.values(this.db.store.tickets).find((t) => t.channelId === channelId);
    return hit ? deepCloneRecord(hit) : null;
  }

  async findOpenDuplicate({ serverId, creatorId, type, tradeId = null }) {
    this.db.checkHealthy();
    const hit = Object.values(this.db.store.tickets).find((t) => {
      if (t.serverId !== serverId || t.creatorId !== creatorId || t.type !== type) return false;
      if (!OPEN_TICKET_STATUSES.includes(t.status)) return false;
      if (tradeId && t.tradeId !== tradeId) return false;
      return true;
    });
    return hit ? deepCloneRecord(hit) : null;
  }

  async countOpenByCreator(serverId, creatorId) {
    this.db.checkHealthy();
    return Object.values(this.db.store.tickets).filter(
      (t) =>
        t.serverId === serverId &&
        t.creatorId === creatorId &&
        OPEN_TICKET_STATUSES.includes(t.status),
    ).length;
  }

  async atomicUpdate(ticketId, { expectedVersion, set = {}, push = {} }) {
    return this.db.withDocLock(`ticket:${ticketId}`, async () => {
      this.db.checkHealthy();
      const current = this.db.store.tickets[ticketId];
      if (!current || current.version !== expectedVersion) return null;

      const candidate = deepCloneRecord(current);
      for (const [k, v] of Object.entries(set)) {
        setByDotPath(candidate, k, v);
      }
      for (const [k, v] of Object.entries(push)) {
        const arr = getByDotPath(candidate, k) || [];
        arr.push(v);
        setByDotPath(candidate, k, arr);
      }
      candidate.version = current.version + 1;
      candidate.updatedAt = new Date();

      const validated = TicketModel.validate(candidate);
      validated.createdAt = current.createdAt;
      this.db.store.tickets[ticketId] = validated;
      await this.db.markModified('tickets');
      return deepCloneRecord(validated);
    });
  }

  async listTickets({
    serverId,
    status,
    creatorId,
    assignedStaffId,
    page = 1,
    limit = 15,
  } = {}) {
    this.db.checkHealthy();
    const all = Object.values(this.db.store.tickets)
      .filter((t) => {
        if (serverId && t.serverId !== serverId) return false;
        if (status) {
          const allowed = Array.isArray(status) ? status : [status];
          if (!allowed.includes(t.status)) return false;
        }
        if (creatorId && t.creatorId !== creatorId) return false;
        if (assignedStaffId && t.assignedStaffId !== assignedStaffId) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 15));
    return {
      items: all.slice((safePage - 1) * safeLimit, safePage * safeLimit).map(deepCloneRecord),
      total: all.length,
      page: safePage,
      limit: safeLimit,
    };
  }
}

export class JsonDisputeRepository {
  /**
   * @param {import('../jsonStore.js').JsonDatabase} db
   */
  constructor(db) {
    this.db = db;
  }

  async create(disputeData) {
    return this.db.withDocLock(`dispute:${disputeData.disputeId}`, async () => {
      this.db.checkHealthy();
      if (this.db.store.disputes[disputeData.disputeId]) {
        const dup = new ConflictError(`Duplicate disputeId rejected: ${disputeData.disputeId}`);
        dup.code = 11000;
        throw dup;
      }
      const now = new Date();
      const validated = DisputeModel.validate({
        ...disputeData,
        createdAt: disputeData.createdAt || now,
        updatedAt: now,
      });
      this.db.store.disputes[validated.disputeId] = validated;
      await this.db.markModified('disputes');
      return deepCloneRecord(validated);
    });
  }

  async findByDisputeId(disputeId) {
    this.db.checkHealthy();
    const doc = this.db.store.disputes[disputeId];
    return doc ? deepCloneRecord(doc) : null;
  }

  async findActiveByTradeId(tradeId) {
    this.db.checkHealthy();
    const hit = Object.values(this.db.store.disputes).find(
      (d) => d.tradeId === tradeId && ['OPEN', 'UNDER_REVIEW', 'ESCALATED'].includes(d.status),
    );
    return hit ? deepCloneRecord(hit) : null;
  }

  async updateDispute(disputeId, { set = {}, push = {} }) {
    return this.db.withDocLock(`dispute:${disputeId}`, async () => {
      this.db.checkHealthy();
      const current = this.db.store.disputes[disputeId];
      if (!current) return null;

      const candidate = deepCloneRecord(current);
      for (const [k, v] of Object.entries(set)) {
        setByDotPath(candidate, k, v);
      }
      for (const [k, v] of Object.entries(push)) {
        const arr = getByDotPath(candidate, k) || [];
        arr.push(v);
        setByDotPath(candidate, k, arr);
      }
      candidate.updatedAt = new Date();

      const validated = DisputeModel.validate(candidate);
      validated.createdAt = current.createdAt;
      this.db.store.disputes[disputeId] = validated;
      await this.db.markModified('disputes');
      return deepCloneRecord(validated);
    });
  }

  async listDisputes({ serverId, statuses, page = 1, limit = 15 } = {}) {
    this.db.checkHealthy();
    const all = Object.values(this.db.store.disputes)
      .filter((d) => {
        if (serverId && d.serverId !== serverId) return false;
        if (Array.isArray(statuses) && statuses.length > 0 && !statuses.includes(d.status)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 15));
    return {
      items: all.slice((safePage - 1) * safeLimit, safePage * safeLimit).map(deepCloneRecord),
      total: all.length,
      page: safePage,
      limit: safeLimit,
    };
  }
}

export class JsonReportRepository {
  /**
   * @param {import('../jsonStore.js').JsonDatabase} db
   */
  constructor(db) {
    this.db = db;
  }

  async create(reportData) {
    return this.db.withDocLock(`report:${reportData.reportId}`, async () => {
      this.db.checkHealthy();
      const now = new Date();
      const validated = ReportModel.validate({
        ...reportData,
        createdAt: reportData.createdAt || now,
        updatedAt: now,
      });
      this.db.store.reports[validated.reportId] = validated;
      await this.db.markModified('reports');
      return deepCloneRecord(validated);
    });
  }

  async findByReportId(reportId) {
    this.db.checkHealthy();
    const doc = this.db.store.reports[reportId];
    return doc ? deepCloneRecord(doc) : null;
  }

  async updateReport(reportId, set = {}) {
    return this.db.withDocLock(`report:${reportId}`, async () => {
      this.db.checkHealthy();
      const current = this.db.store.reports[reportId];
      if (!current) return null;

      const candidate = deepCloneRecord(current);
      for (const [k, v] of Object.entries(set)) {
        setByDotPath(candidate, k, v);
      }
      candidate.updatedAt = new Date();

      const validated = ReportModel.validate(candidate);
      validated.createdAt = current.createdAt;
      this.db.store.reports[reportId] = validated;
      await this.db.markModified('reports');
      return deepCloneRecord(validated);
    });
  }

  async listReports({ serverId, status, targetUserId, page = 1, limit = 15 } = {}) {
    this.db.checkHealthy();
    const all = Object.values(this.db.store.reports)
      .filter((r) => {
        if (serverId && r.serverId !== serverId) return false;
        if (status && r.status !== status) return false;
        if (targetUserId && r.targetUserId !== targetUserId) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 15));
    return {
      items: all.slice((safePage - 1) * safeLimit, safePage * safeLimit).map(deepCloneRecord),
      total: all.length,
      page: safePage,
      limit: safeLimit,
    };
  }
}
