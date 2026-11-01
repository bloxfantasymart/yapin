import { RateLimitExceededError } from '../utils/errors.js';

/**
 * Per-user, per-action cooldown & burst anti-spam guard.
 */
export class CooldownManager {
  /**
   * @param {{ burstLimit?: number, burstWindowMs?: number }} [options]
   */
  constructor(options = {}) {
    /** @type {Map<string, number>} */
    this._cooldowns = new Map();
    /** @type {Map<string, number[]>} */
    this._userBursts = new Map();
    this.burstLimit = options.burstLimit ?? 12;
    this.burstWindowMs = options.burstWindowMs ?? 10_000;
  }

  /**
   * Enforces action cooldown and per-user anti-spam burst threshold.
   * Returns `{ triggeredBurstAlert: boolean }` when accepted, or throws `RateLimitExceededError`.
   *
   * @param {{ userId: string, actionKey: string, cooldownMs: number, now?: number }} params
   */
  enforce({ userId, actionKey, cooldownMs, now = Date.now() }) {
    const bucketKey = `${userId}:${actionKey}`;
    const expiresAt = this._cooldowns.get(bucketKey) || 0;

    if (expiresAt > now) {
      const remainingMs = expiresAt - now;
      const secs = Math.max(1, Math.ceil(remainingMs / 1000));
      throw new RateLimitExceededError(
        `Please wait ${secs}s before using \`${actionKey}\` again.`,
        remainingMs,
      );
    }

    // Track burst rate across all commands/clicks by this user
    const recent = (this._userBursts.get(userId) || []).filter(
      (ts) => now - ts < this.burstWindowMs,
    );
    recent.push(now);
    this._userBursts.set(userId, recent);

    if (recent.length > this.burstLimit) {
      const retryMs = this.burstWindowMs;
      throw new RateLimitExceededError(
        'Anti-spam protection triggered: too many requests in a short window. Please slow down.',
        retryMs,
      );
    }

    if (cooldownMs > 0) {
      this._cooldowns.set(bucketKey, now + cooldownMs);
    }

    if (this._cooldowns.size > 5000) {
      this.prune(now);
    }

    return {
      triggeredBurstAlert: recent.length === this.burstLimit,
    };
  }

  prune(now = Date.now()) {
    for (const [k, exp] of this._cooldowns.entries()) {
      if (exp <= now) this._cooldowns.delete(k);
    }
    for (const [uid, list] of this._userBursts.entries()) {
      const kept = list.filter((ts) => now - ts < this.burstWindowMs);
      if (kept.length === 0) this._userBursts.delete(uid);
      else this._userBursts.set(uid, kept);
    }
  }
}
