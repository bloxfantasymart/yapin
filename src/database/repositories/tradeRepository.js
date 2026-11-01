import { TradeModel } from '../models/Trade.js';

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

export class MongooseTradeRepository {
  async create(tradeData, session = null) {
    const [created] = await TradeModel.create([tradeData], session ? { session } : undefined);
    return created.toObject();
  }

  async findByTradeId(tradeId, session = null) {
    return TradeModel.findOne({ tradeId }).session(session).lean();
  }

  async findActiveDuplicate(serverId, dedupeFingerprint, session = null) {
    return TradeModel.findOne({
      serverId,
      dedupeFingerprint,
      state: { $in: ACTIVE_TRADE_STATES },
    })
      .session(session)
      .lean();
  }

  async countActiveForParticipant(serverId, userId, session = null) {
    return TradeModel.countDocuments({
      serverId,
      state: { $in: ACTIVE_TRADE_STATES },
      $or: [{ traderAId: userId }, { traderBId: userId }],
    }).session(session);
  }

  async countActiveForMiddleman(serverId, middlemanId, session = null) {
    return TradeModel.countDocuments({
      serverId,
      assignedMiddlemanId: middlemanId,
      state: { $in: ACTIVE_TRADE_STATES },
    }).session(session);
  }

  /**
   * Atomically updates a trade ONLY if `tradeId`, `version`, and (optionally) `expectedState`
   * match. Increments `version` by 1 to prevent lost updates and concurrent completion races.
   *
   * Returns `null` when a concurrent writer modified the trade first.
   */
  async atomicUpdate(
    tradeId,
    { expectedVersion, expectedStates = null, set = {}, push = {} },
    session = null,
  ) {
    const filter = {
      tradeId,
      version: expectedVersion,
    };
    if (Array.isArray(expectedStates) && expectedStates.length > 0) {
      filter.state = { $in: expectedStates };
    }

    const updateDoc = {
      $inc: { version: 1 },
    };
    if (Object.keys(set).length > 0) {
      updateDoc.$set = set;
    }
    if (Object.keys(push).length > 0) {
      updateDoc.$push = push;
    }

    return TradeModel.findOneAndUpdate(filter, updateDoc, {
      returnDocument: 'after',
      runValidators: true,
      session,
    }).lean();
  }

  async listTrades(
    { serverId, participantId, middlemanId, states, page = 1, limit = 15 } = {},
  ) {
    const filter = {};
    if (serverId) filter.serverId = serverId;
    if (participantId) {
      filter.$or = [{ traderAId: participantId }, { traderBId: participantId }];
    }
    if (middlemanId) filter.assignedMiddlemanId = middlemanId;
    if (Array.isArray(states) && states.length > 0) {
      filter.state = { $in: states };
    }

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 15));
    const skip = (safePage - 1) * safeLimit;

    const [items, total] = await Promise.all([
      TradeModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean(),
      TradeModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    };
  }

  async findExpiredCandidates(now = new Date(), limit = 50) {
    return TradeModel.find({
      state: { $in: ['CREATED', 'WAITING_FOR_PARTICIPANTS', 'WAITING_FOR_MIDDLEMAN'] },
      expiresAt: { $lte: now },
    })
      .limit(limit)
      .lean();
  }

  async getServerStats(serverId) {
    const rows = await TradeModel.aggregate([
      { $match: { serverId } },
      { $group: { _id: '$state', count: { $sum: 1 } } },
    ]);
    const countsByState = {};
    let total = 0;
    for (const row of rows) {
      countsByState[row._id] = row.count;
      total += row.count;
    }
    return { total, countsByState };
  }
}
