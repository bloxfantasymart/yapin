import { AuditLogModel } from '../models/AuditLog.js';
import { ServerConfigModel } from '../models/ServerConfig.js';
import {
  DashboardSessionModel,
  EventCursorModel,
  IdempotencyRecordModel,
} from '../models/Operational.js';

/**
 * Append-Only Audit Repository.
 * Deliberately exposes NO update or delete methods.
 */
export class MongooseAuditRepository {
  async append(entry, session = null) {
    const [created] = await AuditLogModel.create([entry], session ? { session } : undefined);
    return created.toObject();
  }

  async query(
    { serverId, actorId, action, targetType, targetId, correlationId, page = 1, limit = 25 } = {},
  ) {
    const filter = {};
    if (serverId) filter.serverId = serverId;
    if (actorId) filter.actorId = actorId;
    if (action) filter.action = action;
    if (targetType) filter.targetType = targetType;
    if (targetId) filter.targetId = targetId;
    if (correlationId) filter.correlationId = correlationId;

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));

    const [items, total] = await Promise.all([
      AuditLogModel.find(filter)
        .sort({ timestamp: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      AuditLogModel.countDocuments(filter),
    ]);

    return { items, total, page: safePage, limit: safeLimit };
  }
}

export class MongooseServerConfigRepository {
  async getOrCreate(serverId, session = null) {
    return ServerConfigModel.findOneAndUpdate(
      { serverId },
      { $setOnInsert: { serverId } },
      { upsert: true, returnDocument: 'after', session },
    ).lean();
  }

  async updateConfig(serverId, setFields = {}, session = null) {
    return ServerConfigModel.findOneAndUpdate(
      { serverId },
      {
        $setOnInsert: { serverId },
        $set: setFields,
      },
      { upsert: true, returnDocument: 'after', runValidators: true, session },
    ).lean();
  }
}

export class MongooseOperationalRepository {
  async getCursor(botKey = 'default') {
    const doc = await EventCursorModel.findOne({ botKey }).lean();
    return doc?.lastEventId || 0;
  }

  async setCursor(botKey = 'default', lastEventId = 0) {
    await EventCursorModel.findOneAndUpdate(
      { botKey },
      { $max: { lastEventId } },
      { upsert: true },
    );
  }

  async claimIdempotencyKey({ key, scope, actorId, ttlMs = 300_000 }) {
    const now = new Date();
    const existing = await IdempotencyRecordModel.findOne({
      key,
      expiresAt: { $gt: now },
    }).lean();
    if (existing) {
      return { duplicate: true, record: existing };
    }
    try {
      const [created] = await IdempotencyRecordModel.create([
        {
          key,
          scope,
          actorId,
          expiresAt: new Date(Date.now() + ttlMs),
        },
      ]);
      return { duplicate: false, record: created.toObject() };
    } catch (err) {
      if (err?.code === 11000) {
        const raced = await IdempotencyRecordModel.findOne({ key }).lean();
        return { duplicate: true, record: raced };
      }
      throw err;
    }
  }

  async saveIdempotencyResult(key, resultSnapshot) {
    await IdempotencyRecordModel.updateOne({ key }, { $set: { resultSnapshot } });
  }

  async createSession(sessionDoc) {
    const [created] = await DashboardSessionModel.create([sessionDoc]);
    return created.toObject();
  }

  async findValidSession(sessionIdHash) {
    return DashboardSessionModel.findOne({
      sessionIdHash,
      expiresAt: { $gt: new Date() },
    }).lean();
  }

  async deleteSession(sessionIdHash) {
    await DashboardSessionModel.deleteOne({ sessionIdHash });
  }
}
