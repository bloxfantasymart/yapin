import { createHash } from 'node:crypto';
import { ConflictError } from '../utils/errors.js';

/**
 * Provides replay protection and idempotent execution for sensitive state-mutating operations
 * (trade creation, deposit verification, dispute resolution, final trade completion).
 */
export class IdempotencyGuard {
  /**
   * @param {{ operationalRepo?: { claimIdempotencyKey: Function, saveIdempotencyResult: Function } }} [deps]
   */
  constructor(deps = {}) {
    this.operationalRepo = deps.operationalRepo || null;
    /** @type {Map<string, Promise<unknown>>} */
    this._inFlight = new Map();
    /** @type {Map<string, { expiresAt: number, result: unknown }>} */
    this._localCompleted = new Map();
  }

  static buildKey(scope, actorId, parts = []) {
    const raw = [scope, actorId, ...parts.map((p) => String(p ?? ''))].join('|');
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Runs `fn()` at most once per `(scope, actorId, key)` within `ttlMs`.
   * Concurrent duplicate requests wait or throw `ConflictError`.
   *
   * @template T
   * @param {{ key: string, scope: string, actorId: string, ttlMs?: number }} meta
   * @param {() => Promise<T>} fn
   * @returns {Promise<{ deduplicated: boolean, result: T }>}
   */
  async runOnce({ key, scope, actorId, ttlMs = 120_000 }, fn) {
    const now = Date.now();
    const localHit = this._localCompleted.get(key);
    if (localHit && localHit.expiresAt > now) {
      return { deduplicated: true, result: localHit.result };
    }

    if (this._inFlight.has(key)) {
      throw new ConflictError('This action is already being processed. Please do not double-submit.');
    }

    const workPromise = (async () => {
      if (this.operationalRepo) {
        const claimed = await this.operationalRepo.claimIdempotencyKey({
          key,
          scope,
          actorId,
          ttlMs,
        });
        if (claimed.duplicate) {
          if (claimed.record?.resultSnapshot !== null && claimed.record?.resultSnapshot !== undefined) {
            return { deduplicated: true, result: claimed.record.resultSnapshot };
          }
          throw new ConflictError('Duplicate request rejected by replay protection.');
        }
      }

      const result = await fn();
      this._localCompleted.set(key, { expiresAt: Date.now() + ttlMs, result });
      if (this.operationalRepo) {
        await this.operationalRepo.saveIdempotencyResult(key, { ok: true }).catch(() => undefined);
      }
      return { deduplicated: false, result };
    })();

    this._inFlight.set(key, workPromise);
    try {
      return await workPromise;
    } finally {
      this._inFlight.delete(key);
    }
  }
}
