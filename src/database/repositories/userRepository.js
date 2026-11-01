import { UserModel } from '../models/User.js';

export class MongooseUserRepository {
  async findByYapinId(yapinUserId, session = null) {
    return UserModel.findOne({ yapinUserId }).session(session).lean();
  }

  async getOrCreate(yapinUserId, username = null, session = null) {
    const update = {
      $setOnInsert: { yapinUserId },
      ...(username ? { $set: { lastKnownUsername: String(username).slice(0, 64) } } : {}),
    };
    return UserModel.findOneAndUpdate({ yapinUserId }, update, {
      upsert: true,
      returnDocument: 'after',
      session,
    }).lean();
  }

  async incrementStats(yapinUserId, increments = {}, session = null) {
    const inc = {};
    for (const [k, v] of Object.entries(increments)) {
      if (typeof v === 'number' && v !== 0) {
        inc[`tradeStats.${k}`] = v;
      }
    }
    if (Object.keys(inc).length === 0) {
      return this.getOrCreate(yapinUserId, null, session);
    }
    const updated = await UserModel.findOneAndUpdate(
      { yapinUserId },
      {
        $setOnInsert: { yapinUserId },
        $inc: inc,
      },
      { upsert: true, returnDocument: 'after', session },
    ).lean();

    // Prevent activeMiddlemanLoad from ever dipping below 0
    if (updated?.tradeStats?.activeMiddlemanLoad < 0) {
      return UserModel.findOneAndUpdate(
        { yapinUserId },
        { $set: { 'tradeStats.activeMiddlemanLoad': 0 } },
        { returnDocument: 'after', session },
      ).lean();
    }
    return updated;
  }

  async setAvailability(yapinUserId, { available, note = '' }, session = null) {
    return UserModel.findOneAndUpdate(
      { yapinUserId },
      {
        $setOnInsert: { yapinUserId },
        $set: {
          'staffAvailability.available': Boolean(available),
          'staffAvailability.note': String(note).slice(0, 200),
          'staffAvailability.updatedAt': new Date(),
        },
      },
      { upsert: true, returnDocument: 'after', session },
    ).lean();
  }

  async listAvailableMiddlemen({ maxWorkload = 5 } = {}) {
    return UserModel.find({
      'staffAvailability.available': true,
      'tradeStats.activeMiddlemanLoad': { $lt: maxWorkload },
      'suspension.active': { $ne: true },
    })
      .sort({ 'tradeStats.activeMiddlemanLoad': 1, 'tradeStats.asMiddlemanCompleted': -1 })
      .limit(25)
      .lean();
  }

  async addWarning(yapinUserId, warning, session = null) {
    return UserModel.findOneAndUpdate(
      { yapinUserId },
      {
        $setOnInsert: { yapinUserId },
        $push: { warnings: warning },
      },
      { upsert: true, returnDocument: 'after', session },
    ).lean();
  }

  async suspendUser(yapinUserId, { reason, suspendedBy, expiresAt = null }, session = null) {
    return UserModel.findOneAndUpdate(
      { yapinUserId },
      {
        $setOnInsert: { yapinUserId },
        $set: {
          'suspension.active': true,
          'suspension.reason': reason,
          'suspension.suspendedBy': suspendedBy,
          'suspension.suspendedAt': new Date(),
          'suspension.expiresAt': expiresAt,
          'suspension.liftedBy': null,
          'suspension.liftedAt': null,
        },
      },
      { upsert: true, returnDocument: 'after', session },
    ).lean();
  }

  async unsuspendUser(yapinUserId, { liftedBy }, session = null) {
    return UserModel.findOneAndUpdate(
      { yapinUserId },
      {
        $setOnInsert: { yapinUserId },
        $set: {
          'suspension.active': false,
          'suspension.liftedBy': liftedBy,
          'suspension.liftedAt': new Date(),
        },
      },
      { upsert: true, returnDocument: 'after', session },
    ).lean();
  }

  async updateRiskFlags(yapinUserId, { incOpenReports = 0, incSubstantiated = 0, underStaffReview }, session = null) {
    const update = { $setOnInsert: { yapinUserId } };
    if (incOpenReports !== 0 || incSubstantiated !== 0) {
      update.$inc = {};
      if (incOpenReports !== 0) update.$inc['riskFlags.openReportsCount'] = incOpenReports;
      if (incSubstantiated !== 0) update.$inc['riskFlags.substantiatedReportsCount'] = incSubstantiated;
    }
    if (typeof underStaffReview === 'boolean') {
      update.$set = { 'riskFlags.underStaffReview': underStaffReview };
    }
    return UserModel.findOneAndUpdate({ yapinUserId }, update, {
      upsert: true,
      returnDocument: 'after',
      session,
    }).lean();
  }

  async listStaffLeaderboard({ limit = 20 } = {}) {
    return UserModel.find({
      $or: [
        { 'tradeStats.asMiddlemanClaimed': { $gt: 0 } },
        { 'tradeStats.asMiddlemanCompleted': { $gt: 0 } },
        { 'staffAvailability.updatedAt': { $ne: null } },
      ],
    })
      .sort({ 'tradeStats.asMiddlemanCompleted': -1, 'tradeStats.activeMiddlemanLoad': 1 })
      .limit(limit)
      .lean();
  }
}
