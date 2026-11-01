import { ValidationError } from '../utils/errors.js';

// Control chars (except \n and \t) + Unicode BiDi / zero-width spoofing characters
const UNSAFE_UNICODE_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

const STAFF_SPOOF_PATTERNS = [
  /\[\s*(?:system|official|verified\s+middleman|admin\s+override|escrow\s+verified)\s*\]/i,
  /deposit\s+already\s+confirmed\s+by\s+system/i,
];

/**
 * Sanitizes user-supplied text to prevent BiDi spoofing, control-character injection,
 * and unauthorized @everyone / @here / role mass pings when echoed in embeds.
 *
 * @param {string} raw
 * @param {{ maxLength?: number, fieldName?: string, allowNewlines?: boolean }} [options]
 * @returns {string}
 */
export function sanitizeUserText(raw, options = {}) {
  const maxLength = options.maxLength ?? 1000;
  const fieldName = options.fieldName || 'Input';

  if (typeof raw !== 'string') {
    throw new ValidationError(`${fieldName} must be text.`);
  }

  let cleaned = raw.replace(UNSAFE_UNICODE_REGEX, '');
  if (options.allowNewlines === false) {
    cleaned = cleaned.replace(/[\r\n]+/g, ' ');
  }

  // Neutralize mass-mention attempts inside user-provided fields
  cleaned = cleaned
    .replace(/@everyone/gi, '@\u0435veryone') // safe lookalike / escaped display? Better: explicit `[everyone]`!
    .replace(/@\u0435veryone/g, '[at-everyone]')
    .replace(/@here/gi, '[at-here]')
    .replace(/<@&[A-Za-z0-9_-]+>/g, '[role-mention]')
    .trim();

  if (cleaned.length > maxLength) {
    throw new ValidationError(`${fieldName} cannot exceed ${maxLength} characters.`);
  }

  return cleaned;
}

/**
 * Detects attempts by users to embed fake system/staff verification banners inside trade notes/items.
 * @param {string} text
 * @returns {boolean}
 */
export function containsSpoofedSystemBanner(text) {
  if (!text || typeof text !== 'string') return false;
  return STAFF_SPOOF_PATTERNS.some((re) => re.test(text));
}

/**
 * Validates optional evidence URLs submitted for deposits, disputes, or reports.
 * Requires `https://` and blocks javascript:/data:/local-network SSRF targets.
 *
 * @param {string} urlStr
 * @returns {string}
 */
export function validateSafeEvidenceUrl(urlStr) {
  let parsed;
  try {
    parsed = new URL(String(urlStr).trim());
  } catch {
    throw new ValidationError(`Invalid evidence URL: "${urlStr}"`);
  }
  if (parsed.protocol !== 'https:') {
    throw new ValidationError('Evidence URLs must use https://.');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new ValidationError('Evidence URLs cannot reference private or local network hosts.');
  }
  if (parsed.href.length > 512) {
    throw new ValidationError('Evidence URL cannot exceed 512 characters.');
  }
  return parsed.href;
}
