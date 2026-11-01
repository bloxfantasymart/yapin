import { randomBytes, randomUUID } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Generates a collision-resistant, human-readable entity ID such as TRD-8F4K2M9P1Q.
 * Uses Node's CSPRNG and an unambiguous uppercase Crockford-style alphabet.
 *
 * @param {string} prefix
 * @param {number} [length=10]
 * @returns {string}
 */
export function generateEntityId(prefix, length = 10) {
  const bytes = randomBytes(length);
  let body = '';
  for (let i = 0; i < length; i++) {
    body += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `${prefix}-${body}`;
}

export const generateTradeId = () => generateEntityId('TRD', 10);
export const generateTicketId = () => generateEntityId('TKT', 8);
export const generateDisputeId = () => generateEntityId('DSP', 8);
export const generateReportId = () => generateEntityId('RPT', 8);
export const generateAuditId = () => generateEntityId('AUD', 12);
export const generateCorrelationId = () => `cor_${randomUUID()}`;

/**
 * Yapin IDs are UUIDs (e.g. 550e8400-e29b-41d4-a716-446655440000),
 * though test harnesses may also use compact alphanumeric IDs.
 * Explicitly rejects spaces, mentions markup, display names with #, or control chars.
 */
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
 * Rejects plain @username guesses so callers never confuse mutable usernames with stable IDs.
 *
 * @param {string | undefined | null} raw
 * @returns {string | null}
 */
export function parseYapinUserId(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const mentionMatch = /^<@!?([A-Za-z0-9_-]{4,64})>$/.exec(trimmed);
  if (mentionMatch) return mentionMatch[1];
  if (trimmed.startsWith('@')) return null; // Never trust mutable @username!
  return isValidYapinId(trimmed) ? trimmed : null;
}

/**
 * Extracts a Yapin Channel ID from `<#channel_id>` or raw ID.
 * @param {string | undefined | null} raw
 * @returns {string | null}
 */
export function parseYapinChannelId(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = /^<#([A-Za-z0-9_-]{4,64})>$/.exec(trimmed);
  if (match) return match[1];
  return isValidYapinId(trimmed) ? trimmed : null;
}

/**
 * Extracts a Yapin Role ID from `<@&role_id>` or raw ID.
 * @param {string | undefined | null} raw
 * @returns {string | null}
 */
export function parseYapinRoleId(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = /^<@&([A-Za-z0-9_-]{4,64})>$/.exec(trimmed);
  if (match) return match[1];
  return isValidYapinId(trimmed) ? trimmed : null;
}

export const userMention = (userId) => `<@${userId}>`;
export const channelMention = (channelId) => `<#${channelId}>`;
export const extractYapinUserId = parseYapinUserId;
export const roleMention = (roleId) => `<@&${roleId}>`;

/**
 * Converts a Yapin file path into a full CDN URL per official documentation:
 * https://www.yapin.gg/developers#pictures-and-files
 *
 * @param {'avatars' | 'banners' | 'icons' | 'attachments'} bucket
 * @param {string | null | undefined} filePath
 * @returns {string | null}
 */
export function buildYapinCdnUrl(bucket, filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  if (filePath.startsWith('https://') || filePath.startsWith('http://')) return filePath;
  if (filePath.startsWith('/')) return `https://www.yapin.gg${filePath}`;
  return `https://files.yapper.website/${bucket}/${filePath}`;
}
