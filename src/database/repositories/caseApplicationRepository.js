import { ConflictError } from '../../utils/errors.js';
import { setByDotPath } from '../jsonStore.js';
import { ModApplicationModel } from '../models/ModApplication.js';
import { ModCaseModel } from '../models/ModCase.js';
import { deepCloneRecord } from '../models/schemaHelpers.js';

export class JsonModCaseRepository {
  /**
   * @param {import('../jsonStore.js').JsonDatabase} db
   */
  constructor(db) {
    this.db = db;
  }

  async nextCaseNumber(serverId) {
    return this.db.withDocLock(`counter:case:${serverId}`, async () => {
      this.db.checkHealthy();
      const key = `case:${serverId}`;
      const next = (this.db.store.operational.counters[key] || 0) + 1;
      this.db.store.operational.counters[key] = next;
      await this.db.markModified('operational');
      return next;
    });
  }

  async create(caseData) {
    return this.db.withDocLock(`case:${caseData.caseId}`, async () => {
      this.db.checkHealthy();
      if (this.db.store.cases[caseData.caseId]) {
        throw new ConflictError(`Duplicate caseId rejected: ${caseData.caseId}`);
      }
      const now = new Date();
      const validated = ModCaseModel.validate({
        ...caseData,
        createdAt: caseData.createdAt || now,
        updatedAt: now,
      });
      this.db.store.cases[validated.caseId] = validated;
      await this.db.markModified('cases');
      return deepCloneRecord(validated);
    });
  }

  async findByCaseId(caseId) {
    this.db.checkHealthy();
    const doc = this.db.store.cases[String(caseId || '').toUpperCase()];
    return doc ? deepCloneRecord(doc) : null;
  }

  async updateCase(caseId, setFields = {}) {
    const normalizedId = String(caseId || '').toUpperCase();
    return this.db.withDocLock(`case:${normalizedId}`, async () => {
      this.db.checkHealthy();
      const current = this.db.store.cases[normalizedId];
      if (!current) return null;

      const candidate = deepCloneRecord(current);
      for (const [k, v] of Object.entries(setFields)) {
        setByDotPath(candidate, k, v);
      }
      candidate.updatedAt = new Date();

      const validated = ModCaseModel.validate(candidate);
      validated.createdAt = current.createdAt;
      this.db.store.cases[normalizedId] = validated;
      await this.db.markModified('cases');
      return deepCloneRecord(validated);
    });
  }

  async listCases({
    serverId,
    targetUserId,
    moderatorId,
    action,
    activeOnly = false,
    page = 1,
    limit = 15,
  } = {}) {
    this.db.checkHealthy();
    const all = Object.values(this.db.store.cases)
      .filter((c) => {
        if (serverId && c.serverId !== serverId) return false;
        if (targetUserId && c.targetUserId !== targetUserId) return false;
        if (moderatorId && c.moderatorId !== moderatorId) return false;
        if (action && c.action !== action) return false;
        if (activeOnly && !c.active) return false;
        return true;
      })
      .sort((a, b) => (b.caseNumber || 0) - (a.caseNumber || 0));

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 15));
    return {
      items: all.slice((safePage - 1) * safeLimit, safePage * safeLimit).map(deepCloneRecord),
      total: all.length,
      page: safePage,
      limit: safeLimit,
    };
  }

  async listRecentByServer(serverId, { page = 1, limit = 15 } = {}) {
    return this.listCases({ serverId, page, limit });
  }

  async listByTarget(serverId, targetUserId, { limit = 15 } = {}) {
    const out = await this.listCases({ serverId, targetUserId, limit });
    return out.items;
  }
}

export class JsonModApplicationRepository {
  /**
   * @param {import('../jsonStore.js').JsonDatabase} db
   */
  constructor(db) {
    this.db = db;
  }

  async create(appData) {
    return this.db.withDocLock(`app:${appData.applicationId}`, async () => {
      this.db.checkHealthy();
      if (this.db.store.applications[appData.applicationId]) {
        throw new ConflictError(`Duplicate applicationId rejected: ${appData.applicationId}`);
      }
      const now = new Date();
      const validated = ModApplicationModel.validate({
        ...appData,
        createdAt: appData.createdAt || now,
        updatedAt: now,
      });
      this.db.store.applications[validated.applicationId] = validated;
      await this.db.markModified('applications');
      return deepCloneRecord(validated);
    });
  }

  async findByApplicationId(applicationId) {
    this.db.checkHealthy();
    const doc = this.db.store.applications[String(applicationId || '').toUpperCase()];
    return doc ? deepCloneRecord(doc) : null;
  }

  async findOpenByApplicant(serverId, applicantId) {
    this.db.checkHealthy();
    const hit = Object.values(this.db.store.applications).find(
      (a) =>
        a.serverId === serverId &&
        a.applicantId === applicantId &&
        ['PENDING', 'UNDER_REVIEW'].includes(a.status),
    );
    return hit ? deepCloneRecord(hit) : null;
  }

  async atomicUpdate(applicationId, { expectedVersion, set = {} }) {
    const normalizedId = String(applicationId || '').toUpperCase();
    return this.db.withDocLock(`app:${normalizedId}`, async () => {
      this.db.checkHealthy();
      const current = this.db.store.applications[normalizedId];
      if (!current) return null;
      if (expectedVersion !== undefined && current.version !== expectedVersion) {
        return null;
      }

      const candidate = deepCloneRecord(current);
      for (const [k, v] of Object.entries(set)) {
        setByDotPath(candidate, k, v);
      }
      candidate.version = current.version + 1;
      candidate.updatedAt = new Date();

      const validated = ModApplicationModel.validate(candidate);
      validated.createdAt = current.createdAt;
      this.db.store.applications[normalizedId] = validated;
      await this.db.markModified('applications');
      return deepCloneRecord(validated);
    });
  }

  async listApplications({ serverId, status, applicantId, page = 1, limit = 15 } = {}) {
    this.db.checkHealthy();
    const allowedStatuses = status ? (Array.isArray(status) ? status : [status]) : null;
    const all = Object.values(this.db.store.applications)
      .filter((a) => {
        if (serverId && a.serverId !== serverId) return false;
        if (allowedStatuses && !allowedStatuses.includes(a.status)) return false;
        if (applicantId && a.applicantId !== applicantId) return false;
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

  async listByServer(serverId, { status = null, page = 1, limit = 15 } = {}) {
    return this.listApplications({ serverId, status, page, limit });
  }
}
