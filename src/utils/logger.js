import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';
import { redactSensitiveText } from './errors.js';

const correlationStorage = new AsyncLocalStorage();

const REDACT_PATHS = [
  'token',
  'botToken',
  'accessToken',
  'access_token',
  'clientSecret',
  'client_secret',
  'webhookSecret',
  'sessionSecret',
  'mongodbUri',
  'password',
  'authorization',
  'headers.authorization',
  'headers.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  '*.token',
  '*.secret',
  '*.password',
];

/**
 * Runs an async/sync function within a correlation ID context.
 *
 * @template T
 * @param {string} correlationId
 * @param {() => T} fn
 * @returns {T}
 */
export function withCorrelationId(correlationId, fn) {
  return correlationStorage.run({ correlationId }, fn);
}

/**
 * Returns the active correlation ID if inside a request/event context.
 * @returns {string | undefined}
 */
export function getCorrelationId() {
  return correlationStorage.getStore()?.correlationId;
}

/**
 * Recursively sanitizes an object for audit metadata or structured logging.
 * Never allows tokens, secrets, passwords, or raw cookies to pass through.
 *
 * @param {unknown} value
 * @param {number} [depth=0]
 * @returns {unknown}
 */
export function sanitizeForLog(value, depth = 0) {
  if (depth > 6) return '[MAX_DEPTH]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactSensitiveText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveText(value.message),
      code: value.code,
      status: value.status ?? value.statusCode,
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeForLog(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/(token|secret|password|cookie|authorization|mongodb_?uri)/i.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeForLog(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

/**
 * Creates a structured Pino logger instance with automatic secret redaction
 * and correlation ID injection.
 *
 * @param {{ level?: string, name?: string, destination?: pino.DestinationStream }} [options]
 */
export function createLogger(options = {}) {
  const level = options.level || process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info');
  return pino(
    {
      name: options.name || 'mm2-helper',
      level,
      redact: {
        paths: REDACT_PATHS,
        censor: '[REDACTED]',
      },
      mixin() {
        const correlationId = getCorrelationId();
        return correlationId ? { correlationId } : {};
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    options.destination,
  );
}

export const logger = createLogger();

export function withCorrelationLogger(correlationId, bindings = {}) {
  return logger.child({ correlationId, ...bindings });
}
