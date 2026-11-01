import { ConflictError } from '../../utils/errors.js';
import { getByDotPath, setByDotPath } from '../jsonStore.js';
import { TradeModel } from '../models/Trade.js';
import { deepCloneRecord } from '../models/schemaHelpers.js';

export const ACTIVE_TRADE_STATES = Object.freeze([
  'CREATED',
  'WAITING_FOR_PARTICIPANTS',
  'WAITING_FOR_MIDDLEMAN',
  'MIDDLEMAN_ASSIGNED',
  'WAITING_FOR_DEPOSITS',
  'DEPOSIT_CONFIRMATION',
  'WAITING_FOR_FINAL_CONFIRMATION',
  'DISPUTED',
  'UNDER_REVIEW',
]);

export class JsonTradeRepository {
  /**
   * @param {import('../jsonStore.js').JsonDatabase} db
   */
  constructor(db) {
    this.db = db;
  }

  async create(tradeData) {
    return this.db.withDocLock(`trade:${tradeData.tradeId}`, async () => {
      this.db.checkHealthy();
      if (this.db.store.trades[tradeData.tradeId]) {
        const dup = new ConflictError(`Duplicate tradeId rejected: ${tradeData.tradeId}`);
        dup.code = 11000;
        throw dup;
      }
      const now = new Date();
      const validated = TradeModel.validate({
        ...tradeData,
        createdAt: tradeData.createdAt || now,
        updatedAt: now,
      });
      this.db.store.trades[validated.tradeId] = validated;
      await this.db.markModified('trades');
      return deepCloneRecord(validated);
    });
  }

  async findByTradeId(tradeId) {
    this.db.checkHealthy();
    const doc = this.db.store.trades[tradeId];
    return doc ? deepCloneRecord(doc) : null;
  }

  async findActiveDuplicate(serverId, dedupeFingerprint) {
    this.db.checkHealthy();
    const hit = Object.values(this.db.store.trades).find(
      (t) =>
        t.serverId === serverId &&
        t.dedupeFingerprint === dedupeFingerprint &&
        ACTIVE_TRADE_STATES.includes(t.state),
    );
    return hit ? deepCloneRecord(hit) : null;
  }

  async countActiveForParticipant(serverId, userId) {
    this.db.checkHealthy();
    return Object.values(this.db.store.trades).filter(
      (t) =>
        t.serverId === serverId &&
        ACTIVE_TRADE_STATES.includes(t.state) &&
        (t.traderAId === userId || t.traderBId === userId),
    ).length;
  }

  async countActiveForMiddleman(serverId, middlemanId) {
    this.db.checkHealthy();
    return Object.values(this.db.store.trades).filter(
      (t) =>
        t.serverId === serverId &&
        t.assignedMiddlemanId === middlemanId &&
        ACTIVE_TRADE_STATES.includes(t.state),
    ).length;
  }

  /**
   * Atomically updates a trade ONLY if `tradeId`, `version`, and (optionally) `expectedStates`
   * match. Increments `version` by 1 under a per-trade mutex so concurrent completion races
   * never double-complete.
   */
  async atomicUpdate(tradeId, { expectedVersion, expectedStates = null, set = {}, push = {} }) {
    return this.db.withDocLock(`trade:${tradeId}`, async () => {
      this.db.checkHealthy();
      const current = this.db.store.trades[tradeId];
      if (!current) return null;
      if (current.version !== expectedVersion) return null;
      if (
        Array.isArray(expectedStates) &&
        expectedStates.length > 0 &&
        !expectedStates.includes(current.state)
      ) {
        return null;
      }

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

      const validated = TradeModel.validate(candidate);
      validated.createdAt = current.createdAt;
      this.db.store.trades[tradeId] = validated;
      await this.db.markModified('trades');
      return deepCloneRecord(validated);
    });
  }

  async listTrades({
    serverId,
    participantId,
    middlemanId,
    state,
    states,
    page = 1,
    limit = 15,
  } = {}) {
    this.db.checkHealthy();
    const stateList = Array.isArray(states) && states.length > 0 ? states : state ? [state] : null;

    const all = Object.values(this.db.store.trades)
      .filter((t) => {
        if (serverId && t.serverId !== serverId) return false;
        if (participantId && t.traderAId !== participantId && t.traderBId !== participantId) {
          return false;
        }
        if (middlemanId && t.assignedMiddlemanId !== middlemanId) return false;
        if (stateList && !stateList.includes(t.state)) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 15));
    const items = all
      .slice((safePage - 1) * safeLimit, safePage * safeLimit)
      .map(deepCloneRecord);

    return {
      items,
      total: all.length,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(all.length / safeLimit)),
    };
  }

  async findExpiredCandidates(now = new Date(), limit = 50) {
    this.db.checkHealthy();
    const cutoff = now.getTime();
    return Object.values(this.db.store.trades)
      .filter(
        (t) =>
          ['CREATED', 'WAITING_FOR_PARTICIPANTS', 'WAITING_FOR_MIDDLEMAN'].includes(t.state) &&
          new Date(t.expiresAt).getTime() <= cutoff,
      )
      .slice(0, limit)
      .map(deepCloneRecord);
  }

  async getServerStats(serverId) {
    this.db.checkHealthy();
    const countsByState = {};
    let total = 0;
    for (const t of Object.values(this.db.store.trades)) {
      if (t.serverId !== serverId) continue;
      countsByState[t.state] = (countsByState[t.state] || 0) + 1;
      total += 1;
    }
    return { total, countsByState };
  }
}
