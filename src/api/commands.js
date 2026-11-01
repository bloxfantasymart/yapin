import { z } from 'zod';
import { YAPIN_LIMITS } from '../config/settings.js';
import { ValidationError } from '../utils/errors.js';

/**
 * Verified Yapin Command Registration Schema
 * Source: https://www.yapin.gg/developers#rest-api
 *   - Endpoint: GET /commands, PUT /commands
 *   - Payload:  { "commands": [{ "name": "ping", "description": "..." }] }
 *   - Rules:    1-32 lowercase letters, digits, '-' or '_'; description <= 100 chars;
 *               max 100 commands; no duplicate names.
 *   - Platform note: Yapin PUT /commands does NOT accept Discord-style typed options/subcommand trees;
 *               slash/prefix invocations deliver `data.command` and `data.args` (string) in `message` events.
 */
export const YapinCommandRegistrationSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(
      /^[a-z0-9_-]{1,32}$/,
      'Yapin command name must be 1-32 characters of lowercase letters, numbers, "-" or "_"',
    ),
  description: z
    .string()
    .trim()
    .min(1, 'Yapin command description cannot be empty')
    .max(
      YAPIN_LIMITS.COMMAND_DESCRIPTION_MAX,
      `Yapin command description cannot exceed ${YAPIN_LIMITS.COMMAND_DESCRIPTION_MAX} characters`,
    ),
});

export class YapinCommandsApi {
  /**
   * @param {import('./YapinClient.js').YapinClient} client
   */
  constructor(client) {
    this.client = client;
  }

  /**
   * Validates a command list against Yapin's documented schema before sending over the wire.
   * @param {Array<{ name: string, description: string }>} definitions
   */
  validateDefinitions(definitions) {
    if (!Array.isArray(definitions)) {
      throw new ValidationError('Command definitions must be an array.');
    }
    if (definitions.length > YAPIN_LIMITS.MAX_COMMANDS) {
      throw new ValidationError(
        `Yapin supports at most ${YAPIN_LIMITS.MAX_COMMANDS} commands per bot (received ${definitions.length}).`,
      );
    }

    const seen = new Set();
    const normalized = [];

    for (const raw of definitions) {
      const candidate = {
        name: String(raw?.name || '').toLowerCase().replace(/^[/!]+/, '').trim(),
        description: String(raw?.description || '').trim().slice(0, YAPIN_LIMITS.COMMAND_DESCRIPTION_MAX),
      };
      const result = YapinCommandRegistrationSchema.safeParse(candidate);
      if (!result.success) {
        throw new ValidationError(
          `Invalid Yapin command definition "${raw?.name}": ${result.error.issues[0]?.message}`,
        );
      }
      if (seen.has(result.data.name)) {
        throw new ValidationError(`Duplicate Yapin command name "/${result.data.name}".`);
      }
      seen.add(result.data.name);
      normalized.push(result.data);
    }

    return normalized;
  }

  /**
   * Fetches currently registered slash commands (`GET /commands`).
   */
  async listRegisteredCommands() {
    const out = await this.client.request('GET', '/commands');
    return Array.isArray(out.commands) ? out.commands : [];
  }

  /**
   * Replaces the bot's slash command list (`PUT /commands`).
   * Never claims success if the API rejects the payload.
   *
   * @param {Array<{ name: string, description: string }>} definitions
   */
  async syncCommands(definitions) {
    const commands = this.validateDefinitions(definitions);
    const out = await this.client.request('PUT', '/commands', {
      body: { commands },
    });
    return {
      registeredCount: commands.length,
      commands: out?.commands || commands,
    };
  }
}
