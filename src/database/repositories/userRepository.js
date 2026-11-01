import { UserModel } from '../models/User.js';
import { deepCloneRecord } from '../models/schemaHelpers.js';

export class JsonUserRepository {
  /**
   * @param {import('../jsonStore.js').JsonDatabase} db
   */
  constructor(db) {
    this.db = db;
  }

  async findByYapinId(yapinUserId) {
    this.db.checkHealthy();
    const doc = this.db.store.users[yapinUserId];
    return doc ? deepCloneRecord(doc) : null;
  }

  async getOrCreate(yapinUserId, username = null) {
    return this.db.withDocLock(`user:${yapinUserId}`, async () => {
      this.db.checkHealthy();
      let doc = this.db.store.users[yapinUserId];
      if (!doc) {
        doc = UserModel.validate({
          yapinUserId,
          lastKnownUsername: username ? String(username).slice(0, 64) : null,
        });
        this.db.store.users[yapinUserId] = doc;
        await this.db.markModified('users');
      } else if (username && doc.lastKnownUsername !== String(username).slice(0, 64)) {
        const updated = deepCloneRecord(doc);
        updated.lastKnownUsername = String(username).slice(0, 64);
        updated.updatedAt = new Date();
        this.db.store.users[yapinUserId] = UserModel.validate(updated);
        await this.db.markModified('users');
      }
      return deepCloneRecord(this.db.store.users[yapinUserId]);
    });
  }

  async incrementStats(yapinUserId, increments = {}) {
    await this.getOrCreate(yapinUserId);
    return this.db.withDocLock(`user:${yapinUserId}`, async () => {
      this.db.checkHealthy();
      const doc = deepCloneRecord(this.db.store.users[yapinUserId]);
      for (const [k, v] of Object.entries(increments)) {
        if (typeof v === 'number' && v !== 0) {
          doc.tradeStats[k] = (doc.tradeStats[k] || 0) + v;
        }
      }
      if (doc.tradeStats.activeMiddlemanLoad < 0) {
        doc.tradeStats.activeMiddlemanLoad = 0;
      }
      doc.updatedAt = new Date();
      this.db.store.users[yapinUserId] = UserModel.validate(doc);
      await this.db.markModified('users');
      return deepCloneRecord(this.db.store.users[yapinUserId]);
    });
  }

  async setAvailability(yapinUserId, { available, note = '' }) {
    await this.getOrCreate(yapinUserId);
    return this.db.withDocLock(`user:${yapinUserId}`, async () => {
      this.db.checkHealthy();
      const doc = deepCloneRecord(this.db.store.users[yapinUserId]);
      doc.staffAvailability = {
        available: Boolean(available),
        note: String(note || '').slice(0, 200),
        updatedAt: new Date(),
      };
      doc.updatedAt = new Date();
      this.db.store.users[yapinUserId] = UserModel.validate(doc);
      await this.db.markModified('users');
      return deepCloneRecord(this.db.store.users[yapinUserId]);
    });
  }

  async listAvailableMiddlemen({ maxWorkload = 5 } = {}) {
    this.db.checkHealthy();
    return Object.values(this.db.store.users)
      .filter(
        (u) =>
          u.staffAvailability?.available === true &&
          (u.tradeStats?.activeMiddlemanLoad || 0) < maxWorkload &&
          u.suspension?.active !== true,
      )
      .sort((a, b) => {
        const loadDiff =
          (a.tradeStats?.activeMiddlemanLoad || 0) - (b.tradeStats?.activeMiddlemanLoad || 0);
        if (loadDiff !== 0) return loadDiff;
        return (
          (b.tradeStats?.asMiddlemanCompleted || 0) - (a.tradeStats?.asMiddlemanCompleted || 0)
        );
      })
      .slice(0, 25)
      .map(deepCloneRecord);
  }

  async addWarning(yapinUserId, warning) {
    await this.getOrCreate(yapinUserId);
    return this.db.withDocLock(`user:${yapinUserId}`, async () => {
      this.db.checkHealthy();
      const doc = deepCloneRecord(this.db.store.users[yapinUserId]);
      doc.warnings.push({
        ...warning,
        createdAt: warning.createdAt || new Date(),
      });
      doc.updatedAt = new Date();
      this.db.store.users[yapinUserId] = UserModel.validate(doc);
      await this.db.markModified('users');
      return deepCloneRecord(this.db.store.users[yapinUserId]);
    });
  }

  async suspendUser(yapinUserId, { reason, suspendedBy, expiresAt = null }) {
    await this.getOrCreate(yapinUserId);
    return this.db.withDocLock(`user:${yapinUserId}`, async () => {
      this.db.checkHealthy();
      const doc = deepCloneRecord(this.db.store.users[yapinUserId]);
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
      this.db.store.users[yapinUserId] = UserModel.validate(doc);
      await this.db.markModified('users');
      return deepCloneRecord(this.db.store.users[yapinUserId]);
    });
  }

  async unsuspendUser(yapinUserId, { liftedBy }) {
    await this.getOrCreate(yapinUserId);
    return this.db.withDocLock(`user:${yapinUserId}`, async () => {
      this.db.checkHealthy();
      const doc = deepCloneRecord(this.db.store.users[yapinUserId]);
      doc.suspension.active = false;
      doc.suspension.liftedBy = liftedBy;
      doc.suspension.liftedAt = new Date();
      doc.updatedAt = new Date();
      this.db.store.users[yapinUserId] = UserModel.validate(doc);
      await this.db.markModified('users');
      return deepCloneRecord(this.db.store.users[yapinUserId]);
    });
  }

  async updateRiskFlags(
    yapinUserId,
    { incOpenReports = 0, incSubstantiated = 0, underStaffReview },
  ) {
    await this.getOrCreate(yapinUserId);
    return this.db.withDocLock(`user:${yapinUserId}`, async () => {
      this.db.checkHealthy();
      const doc = deepCloneRecord(this.db.store.users[yapinUserId]);
      doc.riskFlags.openReportsCount = Math.max(
        0,
        (doc.riskFlags.openReportsCount || 0) + incOpenReports,
      );
      doc.riskFlags.substantiatedReportsCount = Math.max(
        0,
        (doc.riskFlags.substantiatedReportsCount || 0) + incSubstantiated,
      );
      if (typeof underStaffReview === 'boolean') {
        doc.riskFlags.underStaffReview = underStaffReview;
      }
      doc.updatedAt = new Date();
      this.db.store.users[yapinUserId] = UserModel.validate(doc);
      await this.db.markModified('users');
      return deepCloneRecord(this.db.store.users[yapinUserId]);
    });
  }

  async listStaffLeaderboard({ limit = 20 } = {}) {
    this.db.checkHealthy();
    return Object.values(this.db.store.users)
      .filter(
        (u) =>
          (u.tradeStats?.asMiddlemanClaimed || 0) > 0 ||
          (u.tradeStats?.asMiddlemanCompleted || 0) > 0 ||
          u.staffAvailability?.updatedAt !== null,
      )
      .sort((a, b) => {
        const compDiff =
          (b.tradeStats?.asMiddlemanCompleted || 0) - (a.tradeStats?.asMiddlemanCompleted || 0);
        if (compDiff !== 0) return compDiff;
        return (
          (a.tradeStats?.activeMiddlemanLoad || 0) - (b.tradeStats?.activeMiddlemanLoad || 0)
        );
      })
      .slice(0, limit)
      .map(deepCloneRecord);
  }
}
