import { randomBytes, randomInt, randomUUID } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Generates a collision-resistant, human-readable entity ID (e.g. CASE-8F4K2M, APP-9P1Q7W).
 */
export function generateEntityId(prefix, length = 8) {
  const bytes = randomBytes(length);
  let body = '';
  for (let i = 0; i < length; i++) {
    body += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `${prefix}-${body}`;
}

export const generateCaseId = () => generateEntityId('CASE', 6);
export const generateApplicationId = () => generateEntityId('APP', 6);
export const generateTicketId = () => generateEntityId('TKT', 8);
export const generateReportId = () => generateEntityId('RPT', 8);
export const generateCharacterId = () => generateEntityId('CHR', 6);
export const generateRoundId = () => generateEntityId('RND', 6);
export const generateAuditId = () => generateEntityId('AUD', 12);
export const generateVerificationCode = () => `MM2-${generateEntityId('SHF', 4).slice(4)}`;
export const generateCorrelationId = () => `cor_${randomUUID()}`;
export const secureRandomInt = (min, maxInclusive) => randomInt(min, maxInclusive + 1);

const YAPIN_ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

export function isValidYapinId(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return UUID_PATTERN.test(trimmed) || YAPIN_ID_PATTERN.test(trimmed);
}

/**
 * Extracts a stable Yapin User ID from `<@user_id>` or a raw user ID string.
 * Rejects mutable `@username` guesses so callers never trust display names.
 */
export function parseYapinUserId(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const mentionMatch = /^<@!?([A-Za-z0-9_-]{4,64})>$/.exec(trimmed);
  if (mentionMatch) return mentionMatch[1];
  if (trimmed.startsWith('@')) return null;
  return isValidYapinId(trimmed) ? trimmed : null;
}

export function parseYapinChannelId(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = /^<#([A-Za-z0-9_-]{4,64})>$/.exec(trimmed);
  if (match) return match[1];
  return isValidYapinId(trimmed) ? trimmed : null;
}

export function parseYapinRoleId(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = /^<@&([A-Za-z0-9_-]{4,64})>$/.exec(trimmed);
  if (match) return match[1];
  return isValidYapinId(trimmed) ? trimmed : null;
}

/**
 * Parses human duration strings such as `15m`, `2h`, `7d`, `90s`, or plain minutes (`30`).
 * Returns duration in milliseconds, or `null` if invalid.
 */
export function parseDurationMs(input) {
  if (input === null || input === undefined || input === '') return null;
  const str = String(input).trim().toLowerCase();
  const m = /^(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hr|d|day|w)?$/.exec(str);
  if (!m) return null;
  const val = Number(m[1]);
  if (!Number.isFinite(val) || val <= 0) return null;
  const unit = m[2] || 'm';
  const multipliers = {
    s: 1000,
    sec: 1000,
    m: 60_000,
    min: 60_000,
    h: 3_600_000,
    hr: 3_600_000,
    d: 86_400_000,
    day: 86_400_000,
    w: 7 * 86_400_000,
  };
  return Math.round(val * multipliers[unit]);
}

export const userMention = (userId) => `<@${userId}>`;
export const channelMention = (channelId) => `<#${channelId}>`;
export const extractYapinUserId = parseYapinUserId;
export const roleMention = (roleId) => `<@&${roleId}>`;

export function buildYapinCdnUrl(bucket, filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  if (filePath.startsWith('https://') || filePath.startsWith('http://')) return filePath;
  if (filePath.startsWith('/')) return `https://www.yapin.gg${filePath}`;
  return `https://files.yapper.website/${bucket}/${filePath}`;
}
