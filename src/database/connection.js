import path from 'node:path';
import { logger as defaultLogger } from '../utils/logger.js';
import { JsonDatabase } from './jsonStore.js';

let activeDatabase = null;

/**
 * Initializes the local crash-safe JSON storage directory (`DATA_DIR`, default `./data`).
 *
 * @param {string} [dataDir='./data']
 * @param {{ logger?: import('pino').Logger }} [options]
 * @returns {Promise<JsonDatabase>}
 */
export async function connectDatabase(dataDir = './data', options = {}) {
  const log = options.logger || defaultLogger;
  const resolvedDir = path.resolve(dataDir || './data');

  const db = new JsonDatabase({
    dataDir: resolvedDir,
    logger: log,
  });
  await db.init();
  activeDatabase = db;

  log.info(
    { dataDir: resolvedDir, transactionsSupported: true, engine: 'json-atomic' },
    'Local atomic JSON database initialized',
  );
  return db;
}

export function getActiveDatabase() {
  return activeDatabase;
}

export function setActiveDatabase(db) {
  activeDatabase = db;
}

/**
 * Executes `work(session)` inside an ACID JSON transaction when a `JsonDatabase` is active,
 * or directly when running isolated stateless mocks.
 *
 * @template T
 * @param {(session: object | null) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withTransaction(work) {
  if (!activeDatabase) {
    return work(null);
  }
  return activeDatabase.withTransaction(work);
}

/**
 * Verifies the JSON database store is initialized and responsive.
 */
export async function pingDatabase() {
  if (!activeDatabase || !activeDatabase.initialized) {
    return { healthy: false, dataDir: null, latencyMs: null, transactionsSupported: true };
  }
  const start = performance.now();
  activeDatabase.checkHealthy();
  return {
    healthy: true,
    dataDir: activeDatabase.dataDir,
    latencyMs: Math.round(performance.now() * 100 - start * 100) / 100,
    transactionsSupported: true,
  };
}

/**
 * Flushes all pending JSON disk writes cleanly during graceful shutdown.
 */
export async function disconnectDatabase({ logger: log = defaultLogger } = {}) {
  if (activeDatabase) {
    await activeDatabase.flushAll();
    activeDatabase = null;
    log.info('Local JSON database flushed and closed cleanly');
  }
}
