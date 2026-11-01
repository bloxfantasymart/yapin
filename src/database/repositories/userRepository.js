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

  /**
   * Atomically reads, mutates via `mutator(draft)`, validates with Zod, and persists a user record.
   */
  async updateUser(yapinUserId, mutator, username = null) {
    await this.getOrCreate(yapinUserId, username);
    return this.db.withDocLock(`user:${yapinUserId}`, async () => {
      this.db.checkHealthy();
      const draft = deepCloneRecord(this.db.store.users[yapinUserId]);
      await mutator(draft);
      draft.updatedAt = new Date();
      const validated = UserModel.validate(draft);
      validated.createdAt = this.db.store.users[yapinUserId].createdAt;
      this.db.store.users[yapinUserId] = validated;
      await this.db.markModified('users');
      return deepCloneRecord(validated);
    });
  }

  async listLeaderboard({ page = 1, limit = 10 } = {}) {
    this.db.checkHealthy();
    const all = Object.values(this.db.store.users)
      .filter((u) => (u.leveling?.totalXp || 0) > 0 || (u.leveling?.messagesCount || 0) > 0)
      .sort((a, b) => {
        const xpDiff = (b.leveling?.totalXp || 0) - (a.leveling?.totalXp || 0);
        if (xpDiff !== 0) return xpDiff;
        return (b.leveling?.messagesCount || 0) - (a.leveling?.messagesCount || 0);
      });

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(25, Math.max(1, Number(limit) || 10));
    const offset = (safePage - 1) * safeLimit;
    return {
      items: all.slice(offset, offset + safeLimit).map((u, idx) => ({
        rankPosition: offset + idx + 1,
        ...deepCloneRecord(u),
      })),
      total: all.length,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(all.length / safeLimit)),
    };
  }

  async getRankPosition(yapinUserId) {
    this.db.checkHealthy();
    const sorted = Object.values(this.db.store.users).sort(
      (a, b) => (b.leveling?.totalXp || 0) - (a.leveling?.totalXp || 0),
    );
    const index = sorted.findIndex((u) => u.yapinUserId === yapinUserId);
    return index === -1 ? null : index + 1;
  }

  async listExpiredMutes(now = new Date(), limit = 50) {
    this.db.checkHealthy();
    const cutoff = now.getTime();
    return Object.values(this.db.store.users)
      .filter(
        (u) =>
          u.moderation?.activeMute?.active === true &&
          u.moderation?.activeMute?.expiresAt &&
          new Date(u.moderation.activeMute.expiresAt).getTime() <= cutoff,
      )
      .slice(0, limit)
      .map(deepCloneRecord);
  }

  async getCommunityStats() {
    this.db.checkHealthy();
    const users = Object.values(this.db.store.users);
    let verifiedCount = 0;
    let totalMessages = 0;
    let totalRpPosts = 0;
    let totalCharacters = 0;

    for (const u of users) {
      if (u.verification?.verified) verifiedCount += 1;
      totalMessages += u.leveling?.messagesCount || 0;
      totalRpPosts += u.leveling?.rpPostsCount || 0;
      totalCharacters += Array.isArray(u.characters) ? u.characters.length : 0;
    }

    return {
      trackedMembers: users.length,
      verifiedCount,
      totalMessages,
      totalRpPosts,
      totalCharacters,
    };
  }

  async countVerified() {
    const stats = await this.getCommunityStats();
    return stats.verifiedCount;
  }

  async getLeaderboard(opts = {}) {
    return this.listLeaderboard(opts);
  }
}
