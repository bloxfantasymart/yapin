import { ConflictError } from '../../utils/errors.js';
import { setByDotPath } from '../jsonStore.js';
import { AuditLogModel } from '../models/AuditLog.js';
import {
  DashboardSessionModel,
  EventCursorModel,
  IdempotencyRecordModel,
} from '../models/Operational.js';
import { ServerConfigModel } from '../models/ServerConfig.js';
import { deepCloneRecord } from '../models/schemaHelpers.js';

/**
 * Append-Only JSON Audit Repository.
 * Deliberately exposes NO update or delete methods, and stores frozen `AuditLog` entries.
 */
export class JsonAuditRepository {
  /**
   * @param {import('../jsonStore.js').JsonDatabase} db
   */
  constructor(db) {
    this.db = db;
  }

  async append(entry) {
    return this.db.withDocLock('audit:append', async () => {
      this.db.checkHealthy();
      if (this.db.store.auditLogs.some((a) => a.auditId === entry.auditId)) {
        const dup = new ConflictError(`Duplicate auditId rejected: ${entry.auditId}`);
        dup.code = 11000;
        throw dup;
      }
      const frozen = AuditLogModel.validate({
        ...entry,
        timestamp: entry.timestamp || new Date(),
      });
      this.db.store.auditLogs.push(frozen);
      await this.db.markModified('auditLogs');
      return deepCloneRecord(frozen);
    });
  }

  async query({
    serverId,
    actorId,
    action,
    targetType,
    targetId,
    correlationId,
    page = 1,
    limit = 25,
  } = {}) {
    this.db.checkHealthy();
    const filtered = this.db.store.auditLogs
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
      items: filtered
        .slice((safePage - 1) * safeLimit, safePage * safeLimit)
        .map(deepCloneRecord),
      total: filtered.length,
      page: safePage,
      limit: safeLimit,
    };
  }

  async updateOne() {
    return AuditLogModel.updateOne();
  }

  async deleteOne() {
    return AuditLogModel.deleteOne();
  }
}

export class JsonServerConfigRepository {
  /**
   * @param {import('../jsonStore.js').JsonDatabase} db
   */
  constructor(db) {
    this.db = db;
  }

  async getOrCreate(serverId) {
    return this.db.withDocLock(`config:${serverId}`, async () => {
      this.db.checkHealthy();
      if (!this.db.store.serverConfigs[serverId]) {
        this.db.store.serverConfigs[serverId] = ServerConfigModel.validate({ serverId });
        await this.db.markModified('serverConfigs');
      }
      return deepCloneRecord(this.db.store.serverConfigs[serverId]);
    });
  }

  async updateConfig(serverId, setFields = {}) {
    await this.getOrCreate(serverId);
    return this.db.withDocLock(`config:${serverId}`, async () => {
      this.db.checkHealthy();
      const candidate = deepCloneRecord(this.db.store.serverConfigs[serverId]);
      for (const [k, v] of Object.entries(setFields)) {
        setByDotPath(candidate, k, v);
      }
      candidate.updatedAt = new Date();
      this.db.store.serverConfigs[serverId] = ServerConfigModel.validate(candidate);
      await this.db.markModified('serverConfigs');
      return deepCloneRecord(this.db.store.serverConfigs[serverId]);
    });
  }
}

export class JsonOperationalRepository {
  /**
   * @param {import('../jsonStore.js').JsonDatabase} db
   */
  constructor(db) {
    this.db = db;
  }

  async getCursor(botKey = 'default') {
    this.db.checkHealthy();
    return this.db.store.operational.cursors[botKey]?.lastEventId || 0;
  }

  async getGatewayCursor(botKey = 'default') {
    return this.getCursor(botKey);
  }

  async setCursor(botKey = 'default', lastEventId = 0) {
    return this.db.withDocLock(`cursor:${botKey}`, async () => {
      this.db.checkHealthy();
      const prev = this.db.store.operational.cursors[botKey]?.lastEventId || 0;
      const next = Math.max(prev, Number(lastEventId) || 0);
      this.db.store.operational.cursors[botKey] = EventCursorModel.validate({
        botKey,
        lastEventId: next,
      });
      await this.db.markModified('operational');
    });
  }

  async saveGatewayCursor(botKey = 'default', lastEventId = 0) {
    return this.setCursor(botKey, lastEventId);
  }

  async claimIdempotencyKey({ key, scope, actorId, ttlMs = 300_000 }) {
    return this.db.withDocLock(`idem:${key}`, async () => {
      this.db.checkHealthy();
      const existing = this.db.store.operational.idempotency[key];
      if (existing && new Date(existing.expiresAt).getTime() > Date.now()) {
        return { duplicate: true, record: deepCloneRecord(existing) };
      }
      const created = IdempotencyRecordModel.validate({
        key,
        scope,
        actorId,
        expiresAt: new Date(Date.now() + ttlMs),
      });
      this.db.store.operational.idempotency[key] = created;
      await this.db.markModified('operational');
      return { duplicate: false, record: deepCloneRecord(created) };
    });
  }

  async saveIdempotencyResult(key, resultSnapshot) {
    return this.db.withDocLock(`idem:${key}`, async () => {
      this.db.checkHealthy();
      const rec = this.db.store.operational.idempotency[key];
      if (rec) {
        rec.resultSnapshot = deepCloneRecord(resultSnapshot);
        rec.updatedAt = new Date();
        await this.db.markModified('operational');
      }
    });
  }

  async createSession(sessionDoc) {
    return this.db.withDocLock(`sess:${sessionDoc.sessionIdHash}`, async () => {
      this.db.checkHealthy();
      const validated = DashboardSessionModel.validate(sessionDoc);
      this.db.store.operational.sessions[validated.sessionIdHash] = validated;
      await this.db.markModified('operational');
      return deepCloneRecord(validated);
    });
  }

  async findValidSession(sessionIdHash) {
    this.db.checkHealthy();
    const sess = this.db.store.operational.sessions[sessionIdHash];
    if (!sess || new Date(sess.expiresAt).getTime() <= Date.now()) {
      return null;
    }
    return deepCloneRecord(sess);
  }

  async deleteSession(sessionIdHash) {
    return this.db.withDocLock(`sess:${sessionIdHash}`, async () => {
      this.db.checkHealthy();
      delete this.db.store.operational.sessions[sessionIdHash];
      await this.db.markModified('operational');
    });
  }
}
