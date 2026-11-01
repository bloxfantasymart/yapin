import {
  AuditLogModel,
  DashboardSessionModel,
  DisputeModel,
  EventCursorModel,
  IdempotencyRecordModel,
  ReportModel,
  ServerConfigModel,
  TicketModel,
  TradeModel,
  UserModel,
} from '../../src/database/models/index.js';
import {
  ACTIVE_TRADE_STATES,
  OPEN_TICKET_STATUSES,
} from '../../src/database/repositories/index.js';
import { SecurityError } from '../../src/utils/errors.js';

function clone(obj) {
  return obj === undefined ? undefined : structuredClone(obj);
}

/**
 * Validates `data` using the real Mongoose Model (`await doc.validate()`) and returns a plain object
 * with Mongoose schema defaults applied!
 */
async function validateWithModel(Model, data) {
  const doc = new Model(data);
  await doc.validate();
  const plain = doc.toObject({ depopulate: true });
  delete plain._id;
  delete plain.__v;
  return clone(plain);
}

function setByDotPath(target, path, value) {
  const parts = path.split('.');
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function getByDotPath(target, path) {
  return path.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), target);
}

/**
 * Transactional, CAS-enforcing In-Memory Repository Suite backed by REAL Mongoose Schema Validation.
 * Supports:
 * - Optimistic concurrency (`version` atomic compare-and-swap)
 * - Append-only `AuditLog` immutability
 * - Database outage injection (`setSimulateFailure(true)`)
 * - Snapshot export/import to simulate full process restarts against persisted state
 */
export function createInMemoryRepositories(initialSnapshot = null) {
  const store = initialSnapshot
    ? clone(initialSnapshot)
    : {
        users: {},
        trades: {},
        tickets: {},
        disputes: {},
        reports: {},
        audits: [],
        serverConfigs: {},
        cursors: {},
        idempotency: {},
        sessions: {},
      };

  let simulateDbFailure = false;
  const checkHealthy = () => {
    if (simulateDbFailure) {
      const err = new Error('MongoServerSelectionError: connection refused (simulated outage)');
      err.name = 'MongoServerSelectionError';
      throw err;
    }
  };

  // Document-level mutex matching MongoDB's atomic single-document lock on findOneAndUpdate
  const docLocks = new Map();
  const withDocLock = async (lockKey, fn) => {
    const prev = docLocks.get(lockKey) || Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    docLocks.set(lockKey, next);
    try {
      return await next;
    } finally {
      if (docLocks.get(lockKey) === next) docLocks.delete(lockKey);
    }
  };

  const users = {
    async findByYapinId(yapinUserId) {
      checkHealthy();
      return clone(store.users[yapinUserId] || null);
    },

    async getOrCreate(yapinUserId, username = null) {
      checkHealthy();
      let existing = store.users[yapinUserId];
      if (!existing) {
        const now = new Date();
        existing = await validateWithModel(UserModel, {
          yapinUserId,
          lastKnownUsername: username || null,
          createdAt: now,
          updatedAt: now,
        });
        existing.createdAt = now;
        existing.updatedAt = now;
        store.users[yapinUserId] = existing;
      } else if (username) {
        existing.lastKnownUsername = String(username).slice(0, 64);
        existing.updatedAt = new Date();
      }
      return clone(existing);
    },

    async incrementStats(yapinUserId, increments = {}) {
      checkHealthy();
      await this.getOrCreate(yapinUserId);
      const doc = store.users[yapinUserId];
      for (const [k, v] of Object.entries(increments)) {
        if (typeof v === 'number' && v !== 0) {
          doc.tradeStats[k] = Math.max(0, (doc.tradeStats[k] || 0) + v);
        }
      }
      doc.updatedAt = new Date();
      store.users[yapinUserId] = await validateWithModel(UserModel, doc);
      return clone(store.users[yapinUserId]);
    },

    async setAvailability(yapinUserId, { available, note = '' }) {
      checkHealthy();
      await this.getOrCreate(yapinUserId);
      const doc = store.users[yapinUserId];
      doc.staffAvailability = {
        available: Boolean(available),
        note: String(note).slice(0, 200),
        updatedAt: new Date(),
      };
      doc.updatedAt = new Date();
      store.users[yapinUserId] = await validateWithModel(UserModel, doc);
      return clone(store.users[yapinUserId]);
    },

    async listAvailableMiddlemen({ maxWorkload = 5 } = {}) {
      checkHealthy();
      return Object.values(store.users)
        .filter(
          (u) =>
            u.staffAvailability?.available === true &&
            (u.tradeStats?.activeMiddlemanLoad || 0) < maxWorkload &&
            u.suspension?.active !== true,
        )
        .sort(
          (a, b) =>
            (a.tradeStats?.activeMiddlemanLoad || 0) - (b.tradeStats?.activeMiddlemanLoad || 0) ||
            (b.tradeStats?.asMiddlemanCompleted || 0) - (a.tradeStats?.asMiddlemanCompleted || 0),
        )
        .map(clone);
    },

    async addWarning(yapinUserId, warning) {
      checkHealthy();
      await this.getOrCreate(yapinUserId);
      const doc = store.users[yapinUserId];
      doc.warnings.push(warning);
      doc.updatedAt = new Date();
      store.users[yapinUserId] = await validateWithModel(UserModel, doc);
      return clone(store.users[yapinUserId]);
    },

    async suspendUser(yapinUserId, { reason, suspendedBy, expiresAt = null }) {
      checkHealthy();
      await this.getOrCreate(yapinUserId);
      const doc = store.users[yapinUserId];
      doc.suspension = {
        active: true,
        reason,
        suspendedBy,
        suspendedAt: new Date(),
        expiresAt,
        liftedBy: null,
        liftedAt: null,
      };
      doc.updatedAt = new Date();
      store.users[yapinUserId] = await validateWithModel(UserModel, doc);
      return clone(store.users[yapinUserId]);
    },

    async unsuspendUser(yapinUserId, { liftedBy }) {
      checkHealthy();
      await this.getOrCreate(yapinUserId);
      const doc = store.users[yapinUserId];
      doc.suspension.active = false;
      doc.suspension.liftedBy = liftedBy;
      doc.suspension.liftedAt = new Date();
      doc.updatedAt = new Date();
      store.users[yapinUserId] = await validateWithModel(UserModel, doc);
      return clone(store.users[yapinUserId]);
    },

    async updateRiskFlags(yapinUserId, { incOpenReports = 0, incSubstantiated = 0, underStaffReview }) {
      checkHealthy();
      await this.getOrCreate(yapinUserId);
      const doc = store.users[yapinUserId];
      doc.riskFlags.openReportsCount = Math.max(0, (doc.riskFlags.openReportsCount || 0) + incOpenReports);
      doc.riskFlags.substantiatedReportsCount = Math.max(
        0,
        (doc.riskFlags.substantiatedReportsCount || 0) + incSubstantiated,
      );
      if (typeof underStaffReview === 'boolean') {
        doc.riskFlags.underStaffReview = underStaffReview;
      }
      doc.updatedAt = new Date();
      store.users[yapinUserId] = await validateWithModel(UserModel, doc);
      return clone(store.users[yapinUserId]);
    },

    async listStaffLeaderboard({ limit = 20 } = {}) {
      checkHealthy();
      return Object.values(store.users)
        .filter(
          (u) =>
            (u.tradeStats?.asMiddlemanClaimed || 0) > 0 ||
            (u.tradeStats?.asMiddlemanCompleted || 0) > 0 ||
            u.staffAvailability?.updatedAt !== null,
        )
        .sort(
          (a, b) =>
            (b.tradeStats?.asMiddlemanCompleted || 0) - (a.tradeStats?.asMiddlemanCompleted || 0),
        )
        .slice(0, limit)
        .map(clone);
    },
  };

  const trades = {
    async create(tradeData) {
      checkHealthy();
      if (store.trades[tradeData.tradeId]) {
        const dup = new Error(`E11000 duplicate key error tradeId: ${tradeData.tradeId}`);
        dup.code = 11000;
        throw dup;
      }
      const now = new Date();
      const validated = await validateWithModel(TradeModel, {
        ...tradeData,
        createdAt: now,
        updatedAt: now,
      });
      validated.createdAt = now;
      validated.updatedAt = now;
      store.trades[validated.tradeId] = validated;
      return clone(validated);
    },

    async findByTradeId(tradeId) {
      checkHealthy();
      return clone(store.trades[tradeId] || null);
    },

    async findActiveDuplicate(serverId, dedupeFingerprint) {
      checkHealthy();
      const hit = Object.values(store.trades).find(
        (t) =>
          t.serverId === serverId &&
          t.dedupeFingerprint === dedupeFingerprint &&
          ACTIVE_TRADE_STATES.includes(t.state),
      );
      return clone(hit || null);
    },

    async countActiveForParticipant(serverId, userId) {
      checkHealthy();
      return Object.values(store.trades).filter(
        (t) =>
          t.serverId === serverId &&
          ACTIVE_TRADE_STATES.includes(t.state) &&
          (t.traderAId === userId || t.traderBId === userId),
      ).length;
    },

    async countActiveForMiddleman(serverId, middlemanId) {
      checkHealthy();
      return Object.values(store.trades).filter(
        (t) =>
          t.serverId === serverId &&
          t.assignedMiddlemanId === middlemanId &&
          ACTIVE_TRADE_STATES.includes(t.state),
      ).length;
    },

    async atomicUpdate(tradeId, { expectedVersion, expectedStates = null, set = {}, push = {} }) {
      return withDocLock(`trade:${tradeId}`, async () => {
        checkHealthy();
        const current = store.trades[tradeId];
        if (!current) return null;
        if (current.version !== expectedVersion) return null;
        if (Array.isArray(expectedStates) && expectedStates.length > 0 && !expectedStates.includes(current.state)) {
          return null;
        }

        const candidate = clone(current);
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

        const validated = await validateWithModel(TradeModel, candidate);
        validated.createdAt = current.createdAt;
        validated.updatedAt = candidate.updatedAt;
        store.trades[tradeId] = validated;
        return clone(validated);
      });
    },

    async listTrades({ serverId, participantId, middlemanId, states, page = 1, limit = 15 } = {}) {
      checkHealthy();
      const all = Object.values(store.trades)
        .filter((t) => {
          if (serverId && t.serverId !== serverId) return false;
          if (participantId && t.traderAId !== participantId && t.traderBId !== participantId) return false;
          if (middlemanId && t.assignedMiddlemanId !== middlemanId) return false;
          if (Array.isArray(states) && states.length > 0 && !states.includes(t.state)) return false;
          return true;
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const safePage = Math.max(1, Number(page) || 1);
      const safeLimit = Math.min(50, Math.max(1, Number(limit) || 15));
      const items = all.slice((safePage - 1) * safeLimit, safePage * safeLimit).map(clone);
      return {
        items,
        total: all.length,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.max(1, Math.ceil(all.length / safeLimit)),
      };
    },

    async findExpiredCandidates(now = new Date(), limit = 50) {
      checkHealthy();
      const cutoff = now.getTime();
      return Object.values(store.trades)
        .filter(
          (t) =>
            ['CREATED', 'WAITING_FOR_PARTICIPANTS', 'WAITING_FOR_MIDDLEMAN'].includes(t.state) &&
            new Date(t.expiresAt).getTime() <= cutoff,
        )
        .slice(0, limit)
        .map(clone);
    },

    async getServerStats(serverId) {
      checkHealthy();
      const countsByState = {};
      let total = 0;
      for (const t of Object.values(store.trades)) {
        if (t.serverId !== serverId) continue;
        countsByState[t.state] = (countsByState[t.state] || 0) + 1;
        total += 1;
      }
      return { total, countsByState };
    },
  };

  const tickets = {
    async create(ticketData) {
      checkHealthy();
      const now = new Date();
      const validated = await validateWithModel(TicketModel, {
        ...ticketData,
        createdAt: now,
        updatedAt: now,
      });
      validated.createdAt = now;
      validated.updatedAt = now;
      store.tickets[validated.ticketId] = validated;
      return clone(validated);
    },

    async findByTicketId(ticketId) {
      checkHealthy();
      return clone(store.tickets[ticketId] || null);
    },

    async findByChannelId(channelId) {
      checkHealthy();
      const found = Object.values(store.tickets).find((t) => t.channelId === channelId);
      return clone(found || null);
    },

    async findOpenDuplicate({ serverId, creatorId, type, tradeId = null }) {
      checkHealthy();
      const found = Object.values(store.tickets).find(
        (t) =>
          t.serverId === serverId &&
          t.creatorId === creatorId &&
          t.type === type &&
          OPEN_TICKET_STATUSES.includes(t.status) &&
          (!tradeId || t.tradeId === tradeId),
      );
      return clone(found || null);
    },

    async countOpenByCreator(serverId, creatorId) {
      checkHealthy();
      return Object.values(store.tickets).filter(
        (t) =>
          t.serverId === serverId &&
          t.creatorId === creatorId &&
          OPEN_TICKET_STATUSES.includes(t.status),
      ).length;
    },

    async atomicUpdate(ticketId, { expectedVersion, set = {}, push = {} }) {
      return withDocLock(`ticket:${ticketId}`, async () => {
        checkHealthy();
        const current = store.tickets[ticketId];
        if (!current || current.version !== expectedVersion) return null;
        const candidate = clone(current);
        for (const [k, v] of Object.entries(set)) setByDotPath(candidate, k, v);
        for (const [k, v] of Object.entries(push)) {
          const arr = getByDotPath(candidate, k) || [];
          arr.push(v);
          setByDotPath(candidate, k, arr);
        }
        candidate.version = current.version + 1;
        candidate.updatedAt = new Date();
        const validated = await validateWithModel(TicketModel, candidate);
        validated.createdAt = current.createdAt;
        validated.updatedAt = candidate.updatedAt;
        store.tickets[ticketId] = validated;
        return clone(validated);
      });
    },

    async listTickets({ serverId, status, creatorId, assignedStaffId, page = 1, limit = 15 } = {}) {
      checkHealthy();
      const statusList = status ? (Array.isArray(status) ? status : [status]) : null;
      const all = Object.values(store.tickets)
        .filter((t) => {
          if (serverId && t.serverId !== serverId) return false;
          if (statusList && !statusList.includes(t.status)) return false;
          if (creatorId && t.creatorId !== creatorId) return false;
          if (assignedStaffId && t.assignedStaffId !== assignedStaffId) return false;
          return true;
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const safePage = Math.max(1, Number(page) || 1);
      const safeLimit = Math.min(50, Math.max(1, Number(limit) || 15));
      return {
        items: all.slice((safePage - 1) * safeLimit, safePage * safeLimit).map(clone),
        total: all.length,
        page: safePage,
        limit: safeLimit,
      };
    },
  };

  const disputes = {
    async create(disputeData) {
      checkHealthy();
      const now = new Date();
      const validated = await validateWithModel(DisputeModel, {
        ...disputeData,
        createdAt: now,
        updatedAt: now,
      });
      validated.createdAt = now;
      validated.updatedAt = now;
      store.disputes[validated.disputeId] = validated;
      return clone(validated);
    },

    async findByDisputeId(disputeId) {
      checkHealthy();
      return clone(store.disputes[disputeId] || null);
    },

    async findActiveByTradeId(tradeId) {
      checkHealthy();
      const found = Object.values(store.disputes).find(
        (d) => d.tradeId === tradeId && ['OPEN', 'UNDER_REVIEW', 'ESCALATED'].includes(d.status),
      );
      return clone(found || null);
    },

    async updateDispute(disputeId, { set = {}, push = {} }) {
      checkHealthy();
      const current = store.disputes[disputeId];
      if (!current) return null;
      const candidate = clone(current);
      for (const [k, v] of Object.entries(set)) setByDotPath(candidate, k, v);
      for (const [k, v] of Object.entries(push)) {
        const arr = getByDotPath(candidate, k) || [];
        arr.push(v);
        setByDotPath(candidate, k, arr);
      }
      candidate.updatedAt = new Date();
      const validated = await validateWithModel(DisputeModel, candidate);
      validated.createdAt = current.createdAt;
      validated.updatedAt = candidate.updatedAt;
      store.disputes[disputeId] = validated;
      return clone(validated);
    },

    async listDisputes({ serverId, statuses, page = 1, limit = 15 } = {}) {
      checkHealthy();
      const all = Object.values(store.disputes)
        .filter((d) => {
          if (serverId && d.serverId !== serverId) return false;
          if (Array.isArray(statuses) && statuses.length > 0 && !statuses.includes(d.status)) return false;
          return true;
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const safePage = Math.max(1, Number(page) || 1);
      const safeLimit = Math.min(50, Math.max(1, Number(limit) || 15));
      return {
        items: all.slice((safePage - 1) * safeLimit, safePage * safeLimit).map(clone),
        total: all.length,
        page: safePage,
        limit: safeLimit,
      };
    },
  };

  const reports = {
    async create(reportData) {
      checkHealthy();
      const now = new Date();
      const validated = await validateWithModel(ReportModel, {
        ...reportData,
        createdAt: now,
        updatedAt: now,
      });
      validated.createdAt = now;
      validated.updatedAt = now;
      store.reports[validated.reportId] = validated;
      return clone(validated);
    },

    async findByReportId(reportId) {
      checkHealthy();
      return clone(store.reports[reportId] || null);
    },

    async updateReport(reportId, set = {}) {
      checkHealthy();
      const current = store.reports[reportId];
      if (!current) return null;
      const candidate = clone(current);
      for (const [k, v] of Object.entries(set)) setByDotPath(candidate, k, v);
      candidate.updatedAt = new Date();
      const validated = await validateWithModel(ReportModel, candidate);
      validated.createdAt = current.createdAt;
      validated.updatedAt = candidate.updatedAt;
      store.reports[reportId] = validated;
      return clone(validated);
    },

    async listReports({ serverId, status, targetUserId, page = 1, limit = 15 } = {}) {
      checkHealthy();
      const all = Object.values(store.reports)
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
        items: all.slice((safePage - 1) * safeLimit, safePage * safeLimit).map(clone),
        total: all.length,
        page: safePage,
        limit: safeLimit,
      };
    },
  };

  const audits = {
    async append(entry) {
      checkHealthy();
      const validated = await validateWithModel(AuditLogModel, entry);
      Object.freeze(validated);
      store.audits.push(validated);
      return clone(validated);
    },

    async updateOne() {
      throw new SecurityError('AuditLog entries are append-only and cannot be modified or deleted.');
    },

    async deleteOne() {
      throw new SecurityError('AuditLog entries are append-only and cannot be modified or deleted.');
    },

    async query({ serverId, actorId, action, targetType, targetId, correlationId, page = 1, limit = 25 } = {}) {
      checkHealthy();
      const all = store.audits
        .filter((a) => {
          if (serverId && a.serverId !== serverId) return false;
          if (actorId && a.actorId !== actorId) return false;
          if (action && a.action !== action) return false;
          if (targetType && a.targetType !== targetType) return false;
          if (targetId && a.targetId !== targetId) return false;
          if (correlationId && a.correlationId !== correlationId) return false;
          return true;
        })
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      const safePage = Math.max(1, Number(page) || 1);
      const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
      return {
        items: all.slice((safePage - 1) * safeLimit, safePage * safeLimit).map(clone),
        total: all.length,
        page: safePage,
        limit: safeLimit,
      };
    },
  };

  const serverConfigs = {
    async getOrCreate(serverId) {
      checkHealthy();
      if (!store.serverConfigs[serverId]) {
        store.serverConfigs[serverId] = await validateWithModel(ServerConfigModel, { serverId });
      }
      return clone(store.serverConfigs[serverId]);
    },

    async updateConfig(serverId, setFields = {}) {
      checkHealthy();
      const current = await this.getOrCreate(serverId);
      for (const [k, v] of Object.entries(setFields)) {
        setByDotPath(current, k, v);
      }
      store.serverConfigs[serverId] = await validateWithModel(ServerConfigModel, current);
      return clone(store.serverConfigs[serverId]);
    },
  };

  const operational = {
    async getCursor(botKey = 'default') {
      checkHealthy();
      return store.cursors[botKey]?.lastEventId || 0;
    },

    async setCursor(botKey = 'default', lastEventId = 0) {
      checkHealthy();
      const prev = store.cursors[botKey]?.lastEventId || 0;
      const next = Math.max(prev, lastEventId);
      store.cursors[botKey] = await validateWithModel(EventCursorModel, { botKey, lastEventId: next });
    },

    async claimIdempotencyKey({ key, scope, actorId, ttlMs = 300_000 }) {
      checkHealthy();
      const existing = store.idempotency[key];
      if (existing && new Date(existing.expiresAt).getTime() > Date.now()) {
        return { duplicate: true, record: clone(existing) };
      }
      const created = await validateWithModel(IdempotencyRecordModel, {
        key,
        scope,
        actorId,
        expiresAt: new Date(Date.now() + ttlMs),
      });
      store.idempotency[key] = created;
      return { duplicate: false, record: clone(created) };
    },

    async saveIdempotencyResult(key, resultSnapshot) {
      checkHealthy();
      if (store.idempotency[key]) {
        store.idempotency[key].resultSnapshot = clone(resultSnapshot);
      }
    },

    async createSession(sessionDoc) {
      checkHealthy();
      const validated = await validateWithModel(DashboardSessionModel, sessionDoc);
      store.sessions[validated.sessionIdHash] = validated;
      return clone(validated);
    },

    async findValidSession(sessionIdHash) {
      checkHealthy();
      const s = store.sessions[sessionIdHash];
      if (!s || new Date(s.expiresAt).getTime() <= Date.now()) return null;
      return clone(s);
    },

    async deleteSession(sessionIdHash) {
      checkHealthy();
      delete store.sessions[sessionIdHash];
    },
  };

  return {
    users,
    trades,
    tickets,
    disputes,
    reports,
    audits,
    auditLogs: audits,
    serverConfigs,
    serverConfig: serverConfigs,
    operational,
    exportSnapshot: () => clone(store),
    setSimulateFailure: (flag) => {
      simulateDbFailure = Boolean(flag);
    },
  };
}
