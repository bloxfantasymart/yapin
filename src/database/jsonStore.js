import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseUnavailableError, SecurityError } from '../utils/errors.js';
import {
  AuditLogModel,
  DashboardSessionModel,
  EventCursorModel,
  IdempotencyRecordModel,
  ModApplicationModel,
  ModCaseModel,
  ReportModel,
  ServerConfigModel,
  TicketModel,
  UserModel,
} from './models/index.js';
import { deepCloneRecord } from './models/schemaHelpers.js';

const COLLECTION_FILES = Object.freeze({
  users: 'users.json',
  cases: 'cases.json',
  applications: 'applications.json',
  tickets: 'tickets.json',
  reports: 'reports.json',
  auditLogs: 'audit_logs.json',
  serverConfigs: 'server_configs.json',
  operational: 'operational.json',
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function setByDotPath(target, dotPath, value) {
  const parts = String(dotPath).split('.');
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new SecurityError(`Unsafe property path rejected: ${dotPath}`);
    }
    if (cur[key] === null || typeof cur[key] !== 'object') {
      cur[key] = {};
    }
    cur = cur[key];
  }
  const leaf = parts[parts.length - 1];
  if (leaf === '__proto__' || leaf === 'constructor' || leaf === 'prototype') {
    throw new SecurityError(`Unsafe property path rejected: ${dotPath}`);
  }
  cur[leaf] = value;
}

export function getByDotPath(target, dotPath) {
  const parts = String(dotPath).split('.');
  let cur = target;
  for (const key of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[key];
  }
  return cur;
}

/**
 * Crash-Safe, ACID-Transactional Atomic JSON Storage Engine for **MM2 Helper**.
 */
export class JsonDatabase {
  constructor(options = {}) {
    this.inMemory = Boolean(options.inMemory || !options.dataDir);
    this.dataDir = options.dataDir ? path.resolve(options.dataDir) : null;
    this.logger = options.logger || null;
    this.initialized = false;
    this.simulateFailure = false;

    this.store = this._createEmptyState();
    this._txContext = new AsyncLocalStorage();
    this._txQueue = Promise.resolve();
    this._docLocks = new Map();
    this._writeQueues = new Map();
    this._tmpCounter = 0;
  }

  _createEmptyState() {
    return {
      users: {},
      cases: {},
      applications: {},
      tickets: {},
      reports: {},
      auditLogs: [],
      serverConfigs: {},
      operational: {
        cursors: {},
        idempotency: {},
        sessions: {},
        counters: {},
      },
    };
  }

  checkHealthy() {
    if (this.simulateFailure) {
      const err = new DatabaseUnavailableError(
        'JsonStorageError: disk store unavailable (simulated outage)',
      );
      err.name = 'JsonStorageError';
      throw err;
    }
  }

  setSimulateFailure(flag) {
    this.simulateFailure = Boolean(flag);
  }

  async withDocLock(lockKey, fn) {
    const prev = this._docLocks.get(lockKey) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const chained = prev.then(() => gate);
    this._docLocks.set(lockKey, chained);

    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this._docLocks.get(lockKey) === chained) {
        this._docLocks.delete(lockKey);
      }
    }
  }

  async init() {
    this.checkHealthy();
    if (this.inMemory) {
      this.initialized = true;
      return;
    }

    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });

    const existingEntries = await fs.readdir(this.dataDir).catch(() => []);
    for (const name of existingEntries) {
      if (name.endsWith('.tmp')) {
        await fs.unlink(path.join(this.dataDir, name)).catch(() => undefined);
      }
    }

    await this._loadAllFromDisk();
    this.initialized = true;
  }

  async _readJsonWithBackup(filePath, defaultVal) {
    const bakPath = `${filePath}.bak`;
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err?.code === 'ENOENT') {
        await this._atomicWriteFile(filePath, defaultVal);
        return deepCloneRecord(defaultVal);
      }
      try {
        const bakRaw = await fs.readFile(bakPath, 'utf8');
        const recovered = JSON.parse(bakRaw);
        this.logger?.warn?.(
          { filePath },
          'Recovered corrupted primary JSON file from .bak backup',
        );
        await this._atomicWriteFile(filePath, recovered);
        return recovered;
      } catch {
        throw new Error(`Failed to parse JSON database file ${path.basename(filePath)}: ${err.message}`);
      }
    }
  }

  async _loadAllFromDisk() {
    const nextState = this._createEmptyState();

    const loadMapCollection = async (collectionKey, model) => {
      const filePath = path.join(this.dataDir, COLLECTION_FILES[collectionKey]);
      const rawObj = await this._readJsonWithBackup(filePath, {});
      if (!rawObj || typeof rawObj !== 'object' || Array.isArray(rawObj)) {
        throw new Error(`${COLLECTION_FILES[collectionKey]} must contain a JSON object map.`);
      }
      const out = {};
      for (const [id, doc] of Object.entries(rawObj)) {
        const validated = model.validate(doc);
        out[validated[model.primaryKey] || id] = validated;
      }
      nextState[collectionKey] = out;
    };

    await loadMapCollection('users', UserModel);
    await loadMapCollection('cases', ModCaseModel);
    await loadMapCollection('applications', ModApplicationModel);
    await loadMapCollection('tickets', TicketModel);
    await loadMapCollection('reports', ReportModel);
    await loadMapCollection('serverConfigs', ServerConfigModel);

    const auditPath = path.join(this.dataDir, COLLECTION_FILES.auditLogs);
    const rawAudits = await this._readJsonWithBackup(auditPath, []);
    if (!Array.isArray(rawAudits)) {
      throw new Error('audit_logs.json must contain a JSON array.');
    }
    nextState.auditLogs = rawAudits.map((entry) => AuditLogModel.validate(entry));

    const opPath = path.join(this.dataDir, COLLECTION_FILES.operational);
    const rawOp = await this._readJsonWithBackup(opPath, {
      cursors: {},
      idempotency: {},
      sessions: {},
      counters: {},
    });
    const nowMs = Date.now();

    for (const [botKey, cur] of Object.entries(rawOp?.cursors || {})) {
      nextState.operational.cursors[botKey] = EventCursorModel.validate(cur);
    }
    for (const [key, rec] of Object.entries(rawOp?.idempotency || {})) {
      const validated = IdempotencyRecordModel.validate(rec);
      if (validated.expiresAt.getTime() > nowMs) {
        nextState.operational.idempotency[key] = validated;
      }
    }
    for (const [hash, sess] of Object.entries(rawOp?.sessions || {})) {
      const validated = DashboardSessionModel.validate(sess);
      if (validated.expiresAt.getTime() > nowMs) {
        nextState.operational.sessions[hash] = validated;
      }
    }
    for (const [counterKey, num] of Object.entries(rawOp?.counters || {})) {
      if (typeof num === 'number' && Number.isFinite(num)) {
        nextState.operational.counters[counterKey] = num;
      }
    }

    this.store = nextState;
  }

  async _atomicWriteFile(filePath, data) {
    const serialized = `${JSON.stringify(data, null, 2)}\n`;
    const tmpName = `${path.basename(filePath)}.${process.pid}.${++this._tmpCounter}.tmp`;
    const tmpPath = path.join(path.dirname(filePath), tmpName);
    const bakPath = `${filePath}.bak`;

    const handle = await fs.open(tmpPath, 'w', 0o600);
    try {
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await fs.copyFile(filePath, bakPath);
    } catch {
      // Ignore if filePath does not exist yet
    }

    let lastErr = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await fs.rename(tmpPath, filePath);
        return;
      } catch (err) {
        lastErr = err;
        if ((err?.code === 'EPERM' || err?.code === 'EACCES' || err?.code === 'EBUSY') && attempt < 4) {
          await sleep(15 * attempt);
          continue;
        }
        await fs.unlink(tmpPath).catch(() => undefined);
        throw err;
      }
    }
    throw lastErr;
  }

  _pruneExpiredOperational() {
    const nowMs = Date.now();
    for (const [k, v] of Object.entries(this.store.operational.idempotency)) {
      if (new Date(v.expiresAt).getTime() <= nowMs) {
        delete this.store.operational.idempotency[k];
      }
    }
    for (const [k, v] of Object.entries(this.store.operational.sessions)) {
      if (new Date(v.expiresAt).getTime() <= nowMs) {
        delete this.store.operational.sessions[k];
      }
    }
  }

  async markModified(collectionName) {
    this.checkHealthy();
    const activeTx = this._txContext.getStore();
    if (activeTx) {
      activeTx.dirtyCollections.add(collectionName);
      return;
    }
    await this._enqueueFlush(collectionName);
  }

  _enqueueFlush(collectionName) {
    if (this.inMemory) return Promise.resolve();
    const fileName = COLLECTION_FILES[collectionName];
    if (!fileName) throw new Error(`Unknown JSON collection: ${collectionName}`);

    const filePath = path.join(this.dataDir, fileName);
    const prev = this._writeQueues.get(collectionName) || Promise.resolve();

    const next = prev.then(async () => {
      this.checkHealthy();
      if (collectionName === 'operational') {
        this._pruneExpiredOperational();
      }
      const snapshot = deepCloneRecord(this.store[collectionName]);
      await this._atomicWriteFile(filePath, snapshot);
    });

    this._writeQueues.set(
      collectionName,
      next.catch(() => undefined),
    );
    return next;
  }

  async withTransaction(work) {
    this.checkHealthy();

    const parentTx = this._txContext.getStore();
    if (parentTx) {
      return work(parentTx);
    }

    const prevTx = this._txQueue;
    let releaseTx;
    const txGate = new Promise((resolve) => {
      releaseTx = resolve;
    });
    this._txQueue = prevTx.then(() => txGate);

    await prevTx;
    const preSnapshot = {
      users: deepCloneRecord(this.store.users),
      cases: deepCloneRecord(this.store.cases),
      applications: deepCloneRecord(this.store.applications),
      tickets: deepCloneRecord(this.store.tickets),
      reports: deepCloneRecord(this.store.reports),
      auditLogs: [...this.store.auditLogs],
      serverConfigs: deepCloneRecord(this.store.serverConfigs),
      operational: deepCloneRecord(this.store.operational),
    };

    const txState = { dirtyCollections: new Set() };
    try {
      const result = await this._txContext.run(txState, () => work(txState));
      if (!this.inMemory && txState.dirtyCollections.size > 0) {
        await Promise.all([...txState.dirtyCollections].map((col) => this._enqueueFlush(col)));
      }
      return result;
    } catch (err) {
      this.store = preSnapshot;
      throw err;
    } finally {
      releaseTx();
    }
  }

  async flushAll() {
    await Promise.all([...this._writeQueues.values()]);
  }

  exportSnapshot() {
    return deepCloneRecord(this.store);
  }
}
