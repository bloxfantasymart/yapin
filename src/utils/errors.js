/**
 * Redacts sensitive tokens and credentials from any string.
 * Covers Yapin bot tokens (yb_*), OAuth tokens (yo_*), Bearer/Bot headers, and MongoDB URIs.
 *
 * @param {unknown} input
 * @returns {string}
 */
export function redactSensitiveText(input) {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/\byb_[A-Za-z0-9._-]+\b/g, 'yb_[REDACTED]')
    .replace(/\byo_[A-Za-z0-9._-]+\b/g, 'yo_[REDACTED]')
    .replace(/\b(Bot|Bearer)\s+[A-Za-z0-9._-]+\b/gi, '$1 [REDACTED]')
    .replace(/mongodb(\+srv)?:\/\/([^/\s@]+)@/gi, 'mongodb$1://[REDACTED]@')
    .replace(/(\/interactions\/[^/\s]+\/)([^/\s]+)(\/callback)/gi, '$1[REDACTED_TOKEN]$3')
    .replace(/(\/webhooks\/[^/\s]+\/)([^/?#\s]+)/gi, '$1[REDACTED_TOKEN]');
}

export const sanitizeErrorMessage = redactSensitiveText;

export class AppError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, statusCode?: number, expose?: boolean, metadata?: Record<string, unknown>, cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(redactSensitiveText(message), options.cause ? { cause: options.cause } : undefined);
    this.name = this.constructor.name;
    this.code = options.code || 'APP_ERROR';
    this.statusCode = options.statusCode || 400;
    this.expose = options.expose ?? true;
    this.metadata = options.metadata || {};
  }
}

export class ValidationError extends AppError {
  constructor(message, metadata = {}) {
    super(message, { code: 'VALIDATION_ERROR', statusCode: 400, expose: true, metadata });
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'You do not have permission to perform this action.', metadata = {}) {
    super(message, { code: 'UNAUTHORIZED', statusCode: 403, expose: true, metadata });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Requested resource was not found.', metadata = {}) {
    super(message, { code: 'NOT_FOUND', statusCode: 404, expose: true, metadata });
  }
}

export class ConflictError extends AppError {
  constructor(message, metadata = {}) {
    super(message, { code: 'CONFLICT', statusCode: 409, expose: true, metadata });
  }
}

export class InvalidStateTransitionError extends AppError {
  constructor(fromState, toState, reason = '') {
    const suffix = reason ? `: ${reason}` : '';
    super(`Invalid trade state transition from ${fromState} to ${toState}${suffix}`, {
      code: 'INVALID_STATE_TRANSITION',
      statusCode: 409,
      expose: true,
      metadata: { fromState, toState, reason },
    });
  }
}

export class RateLimitExceededError extends AppError {
  constructor(message, retryAfterMs = 1000) {
    super(message, {
      code: 'RATE_LIMITED',
      statusCode: 429,
      expose: true,
      metadata: { retryAfterMs },
    });
    this.retryAfterMs = retryAfterMs;
  }
}

export class SecurityError extends AppError {
  constructor(message, metadata = {}) {
    super(message, { code: 'SECURITY_VIOLATION', statusCode: 403, expose: false, metadata });
  }
}

export class DatabaseUnavailableError extends AppError {
  constructor(message = 'Local JSON storage is temporarily unavailable.', metadata = {}) {
    super(message, { code: 'STORAGE_UNAVAILABLE', statusCode: 503, expose: false, metadata });
  }
}

export class YapinApiError extends AppError {
  /**
   * @param {{ message: string, status: number, method: string, path: string, retryAfter?: number | null, body?: unknown }} details
   */
  constructor({ message, status, method, path, retryAfter = null, body = null }) {
    const safePath = redactSensitiveText(path);
    super(message || `${method} ${safePath} failed with status ${status}`, {
      code: status === 429 ? 'YAPIN_RATE_LIMIT' : `YAPIN_HTTP_${status}`,
      statusCode: status,
      expose: false,
      metadata: {
        status,
        method,
        path: safePath,
        retryAfter,
      },
    });
    this.status = status;
    this.method = method;
    this.path = safePath;
    this.retryAfter = retryAfter;
    this.body = body;
  }

  get isRateLimit() {
    return this.status === 429;
  }

  get isUnauthorized() {
    return this.status === 401;
  }

  get isMissingPermissions() {
    return this.status === 403;
  }

  get isNotFound() {
    return this.status === 404;
  }
}
