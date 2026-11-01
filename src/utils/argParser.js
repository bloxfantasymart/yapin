/**
 * Command Argument Parser for Yapin.gg
 *
 * Verified Yapin behavior: PUT /commands registers `{ name, description }` only.
 * When a user runs `/middleman partner=<@id> item="Dragon Lore" giving="100 keys" receiving="Dragon Lore" rules=yes`,
 * Yapin delivers `data.command = "middleman"` and `data.args = 'partner=<@id> ...'` as a raw string.
 *
 * This parser safely tokenizes quoted strings, `key=value` pairs, `--key value` flags,
 * and positional tokens while enforcing strict input bounds.
 */

const MAX_ARGS_LENGTH = 2000;
const MAX_TOKENS = 64;

/**
 * Tokenizes a raw argument string respecting double and single quotes.
 *
 * @param {string} rawArgs
 * @returns {string[]}
 */
export function tokenizeArgs(rawArgs) {
  if (!rawArgs || typeof rawArgs !== 'string') return [];
  const bounded = rawArgs.slice(0, MAX_ARGS_LENGTH).trim();
  if (!bounded) return [];

  const tokens = [];
  let current = '';
  let quoteChar = null;
  let escaped = false;

  for (let i = 0; i < bounded.length; i++) {
    const ch = bounded[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (quoteChar) {
      if (ch === quoteChar) {
        quoteChar = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quoteChar = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
        if (tokens.length >= MAX_TOKENS) break;
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0 && tokens.length < MAX_TOKENS) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Parses raw command arguments into `{ positional: string[], flags: Record<string, string | boolean>, raw: string }`.
 * Supports both `key=value` (`partner=<@uuid> item="Rare Sword"`) and `--key value` / `--booleanFlag`.
 *
 * @param {string} rawArgs
 */
export function parseCommandArgs(rawArgs = '') {
  const tokens = tokenizeArgs(rawArgs);
  const positional = [];
  const flags = Object.create(null);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    // --key=value or --key value
    if (token.startsWith('--') && token.length > 2) {
      const stripped = token.slice(2);
      const eqIdx = stripped.indexOf('=');
      if (eqIdx > 0) {
        const key = stripped.slice(0, eqIdx).toLowerCase();
        const val = stripped.slice(eqIdx + 1);
        if (!isForbiddenPrototypeKey(key)) flags[key] = val;
      } else {
        const key = stripped.toLowerCase();
        const next = tokens[i + 1];
        if (next !== undefined && !next.startsWith('--') && !/^[a-z0-9_-]+=/i.test(next)) {
          if (!isForbiddenPrototypeKey(key)) flags[key] = next;
          i++;
        } else if (!isForbiddenPrototypeKey(key)) {
          flags[key] = true;
        }
      }
      continue;
    }

    // key=value (only when key is a safe identifier and not a URL)
    const kvMatch = /^([a-zA-Z][a-zA-Z0-9_-]{0,31})=([\s\S]*)$/.exec(token);
    if (kvMatch) {
      const key = kvMatch[1].toLowerCase();
      const val = kvMatch[2];
      if (!isForbiddenPrototypeKey(key)) {
        flags[key] = val;
        continue;
      }
    }

    positional.push(token);
  }

  return {
    raw: typeof rawArgs === 'string' ? rawArgs.trim() : '',
    tokens,
    positional,
    flags,
    kv: flags,
  };
}

function isForbiddenPrototypeKey(key) {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

/**
 * Parses boolean-like user answers (`yes`, `true`, `agree`, `1`, `confirm`).
 * @param {unknown} val
 * @returns {boolean}
 */
export function parseBooleanInput(val) {
  if (typeof val === 'boolean') return val;
  if (typeof val !== 'string') return false;
  return ['true', 'yes', 'y', '1', 'agree', 'agreed', 'confirm', 'confirmed'].includes(
    val.trim().toLowerCase(),
  );
}

export const parseYesBoolean = parseBooleanInput;
