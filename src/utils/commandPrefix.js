import { BOT_PREFIX } from '../config/settings.js';

const COMMAND_NAME = /^[a-z][a-z0-9_-]{0,31}$/i;

/**
 * Parses an explicit prefix command from a Yapin message event. Native platform command
 * events remain supported separately; ordinary chat is never interpreted as a command.
 *
 * Accepted forms: `$help`, `$ help`, and `$ticket open ...`.
 * @param {string} content
 * @returns {{ command: string, args: string } | null}
 */
export function parsePrefixedCommand(content) {
  if (typeof content !== 'string') return null;
  const message = content.trimStart();
  if (!message.startsWith(BOT_PREFIX)) return null;

  const input = message.slice(BOT_PREFIX.length).trim();
  const separator = input.search(/\s/);
  const command = (separator === -1 ? input : input.slice(0, separator)).toLowerCase();
  if (!command || !COMMAND_NAME.test(command)) {
    return { command: '', args: '' };
  }

  return {
    command,
    args: separator === -1 ? '' : input.slice(separator).trim(),
  };
}
