import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuthorizationError, RateLimitExceededError, SecurityError } from '../utils/errors.js';

export const SESSION_COOKIE_NAME = 'mm2_helper_session';
export const OAUTH_STATE_COOKIE_NAME = 'mm2_helper_oauth';

export function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function generateRandomToken(byteLen = 32) {
  return randomBytes(byteLen).toString('base64url');
}

export function signValue(rawValue, secret) {
  const mac = createHmac('sha256', secret).update(rawValue, 'utf8').digest('base64url');
  return `${rawValue}.${mac}`;
}

export function unsignValue(signedValue, secret) {
  if (!signedValue || typeof signedValue !== 'string') return null;
  const idx = signedValue.lastIndexOf('.');
  if (idx <= 0) return null;
  const rawValue = signedValue.slice(0, idx);
  const providedMac = signedValue.slice(idx + 1);
  const expectedMac = createHmac('sha256', secret).update(rawValue, 'utf8').digest('base64url');
  if (providedMac.length !== expectedMac.length) return null;
  const ok = timingSafeEqual(Buffer.from(providedMac, 'utf8'), Buffer.from(expectedMac, 'utf8'));
  return ok ? rawValue : null;
}

export function verifyCsrfToken(sessionCsrf, providedCsrf) {
  if (!sessionCsrf || !providedCsrf || typeof providedCsrf !== 'string') {
    throw new SecurityError('Missing or invalid CSRF token.');
  }
  const a = Buffer.from(String(sessionCsrf), 'utf8');
  const b = Buffer.from(String(providedCsrf), 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new SecurityError('CSRF token validation failed.');
  }
  return true;
}

/**
 * Validates that browser `Origin` / `Sec-Fetch-Site` headers (when sent) match the dynamic host
 * serving the dashboard (supports localhost, custom domains, and proxied preview hosts).
 */
export function verifySameOriginRequest(req) {
  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite && !['same-origin', 'none'].includes(String(secFetchSite).toLowerCase())) {
    throw new SecurityError('Cross-site state-mutating request blocked.');
  }

  const origin = req.headers.origin;
  if (!origin) return true;

  let originHost;
  try {
    originHost = new URL(String(origin)).host.toLowerCase();
  } catch {
    throw new SecurityError('Malformed Origin header.');
  }

  const forwardedHost = String(req.headers['x-forwarded-host'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const directHost = String(req.headers.host || '').trim().toLowerCase();

  if (originHost !== directHost && (!forwardedHost || originHost !== forwardedHost)) {
    throw new SecurityError('Cross-origin POST request rejected.');
  }
  return true;
}

export function parseCookies(cookieHeader = '') {
  const out = Object.create(null);
  if (!cookieHeader || typeof cookieHeader !== 'string') return out;
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key && key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

export function serializeCookie(
  name,
  value,
  { maxAgeSeconds = 28800, secure = false, httpOnly = true, sameSite = 'Lax', path = '/' } = {},
) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    `Max-Age=${maxAgeSeconds}`,
    `SameSite=${sameSite}`,
  ];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Short-lived server-side store for OAuth2 PKCE code verifiers keyed by random `state` (5-minute TTL).
 */
export class PendingOAuthStore {
  constructor(ttlMs = 300_000) {
    this.ttlMs = ttlMs;
    this._pending = new Map();
  }

  create(state, codeVerifier) {
    this._prune();
    this._pending.set(state, {
      codeVerifier,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  consume(state) {
    this._prune();
    const record = this._pending.get(state);
    this._pending.delete(state);
    if (!record || record.expiresAt <= Date.now()) {
      return null;
    }
    return record;
  }

  _prune() {
    const now = Date.now();
    for (const [k, v] of this._pending.entries()) {
      if (v.expiresAt <= now) this._pending.delete(k);
    }
  }
}

/**
 * Per-IP / per-actor sliding-window HTTP rate limiter for Dashboard routes.
 */
export class HttpRateLimiter {
  constructor({ maxRequests = 60, windowMs = 60_000 } = {}) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this._hits = new Map();
  }

  check(key) {
    const now = Date.now();
    const list = (this._hits.get(key) || []).filter((ts) => now - ts < this.windowMs);
    list.push(now);
    this._hits.set(key, list);
    if (this._hits.size > 4000) {
      for (const [k, arr] of this._hits.entries()) {
        const filtered = arr.filter((ts) => now - ts < this.windowMs);
        if (filtered.length === 0) this._hits.delete(k);
        else this._hits.set(k, filtered);
      }
    }
    if (list.length > this.maxRequests) {
      throw new RateLimitExceededError('Too many dashboard requests. Please wait a moment.', this.windowMs);
    }
  }
}

export function assertSessionTier(session, minTier) {
  if (!session || typeof session.staffTier !== 'number' || session.staffTier < minTier) {
    throw new AuthorizationError('Insufficient staff tier for this dashboard operation.');
  }
}
