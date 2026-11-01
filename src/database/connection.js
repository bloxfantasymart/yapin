import mongoose from 'mongoose';
import { logger as defaultLogger } from '../utils/logger.js';

let replicaSetSupported = null;

/**
 * Connects to MongoDB using Mongoose with bounded timeouts, structured logging,
 * and automatic reconnection monitoring.
 *
 * @param {string} uri
 * @param {{ logger?: import('pino').Logger, maxPoolSize?: number, serverSelectionTimeoutMS?: number }} [options]
 */
export async function connectDatabase(uri, options = {}) {
  const log = options.logger || defaultLogger;

  mongoose.set('strictQuery', true);

  mongoose.connection.removeAllListeners('connected');
  mongoose.connection.removeAllListeners('disconnected');
  mongoose.connection.removeAllListeners('reconnected');
  mongoose.connection.removeAllListeners('error');

  mongoose.connection.on('connected', () => log.info('MongoDB connection established'));
  mongoose.connection.on('disconnected', () => log.warn('MongoDB connection disconnected'));
  mongoose.connection.on('reconnected', () => log.info('MongoDB connection re-established'));
  mongoose.connection.on('error', (err) => log.error({ err }, 'MongoDB connection error'));

  await mongoose.connect(uri, {
    maxPoolSize: options.maxPoolSize ?? 15,
    serverSelectionTimeoutMS: options.serverSelectionTimeoutMS ?? 10_000,
    socketTimeoutMS: 45_000,
  });

  replicaSetSupported = await detectTransactionSupport(log);
  return mongoose.connection;
}

async function detectTransactionSupport(log) {
  try {
    if (!mongoose.connection.db) return false;
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    const supported = Boolean(hello?.setName || hello?.msg === 'isdbgrid');
    log.info(
      { transactionsSupported: supported },
      supported
        ? 'MongoDB replica set / sharded cluster detected; multi-document transactions enabled'
        : 'Standalone MongoDB detected; using atomic single-document CAS concurrency fallback',
    );
    return supported;
  } catch {
    return false;
  }
}

/**
 * Executes `work(session)` inside a MongoDB multi-document transaction when supported
 * by the topology (Replica Set / Atlas), or falls back cleanly to `work(null)` where
 * repositories still enforce atomic `findOneAndUpdate` state + version CAS guards.
 *
 * @template T
 * @param {(session: import('mongoose').ClientSession | null) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withTransaction(work) {
  if (mongoose.connection.readyState !== 1 || replicaSetSupported === false) {
    return work(null);
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (err) {
    // Handle standalone topology error code 20 (IllegalOperation: Transaction numbers are only allowed on a replica set member)
    if (
      err?.code === 20 ||
      /Transaction numbers are only allowed on a replica set/i.test(err?.message || '')
    ) {
      replicaSetSupported = false;
      return work(null);
    }
    throw err;
  } finally {
    await session.endSession().catch(() => undefined);
  }
}

/**
 * Performs a live ping check against MongoDB (`db.admin().ping()`).
 */
export async function checkDatabaseHealth() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return { healthy: false, readyState: mongoose.connection.readyState, latencyMs: null };
  }
  const started = performance.now();
  await mongoose.connection.db.admin().ping();
  return {
    healthy: true,
    readyState: mongoose.connection.readyState,
    latencyMs: Math.round(performance.now() - started),
    transactionsSupported: Boolean(replicaSetSupported),
  };
}

/**
 * Cleanly closes the Mongoose connection during graceful shutdown.
 */
export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  replicaSetSupported = null;
}
