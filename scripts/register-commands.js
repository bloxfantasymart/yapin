import dotenv from 'dotenv';
import { YapinClient } from '../src/api/YapinClient.js';
import { YapinCommandsApi } from '../src/api/commands.js';
import { createCommandRegistry } from '../src/commands/index.js';
import { sanitizeErrorMessage } from '../src/utils/errors.js';

dotenv.config({ quiet: true });

async function main() {
  const token = process.env.YAPIN_BOT_TOKEN || process.env.YAPPER_BOT_TOKEN;
  const baseUrl = process.env.YAPIN_API_BASE_URL || 'https://www.yapin.gg/api/bot/v1';

  if (!token || !token.startsWith('yb_')) {
    console.error('[ERROR] Missing or invalid YAPIN_BOT_TOKEN (must start with "yb_").');
    process.exit(1);
  }

  const client = new YapinClient({
    token,
    baseUrl,
    enableGateway: false,
  });

  try {
    const { profile } = await client.getMe();
    const registry = createCommandRegistry();
    const commandsApi = new YapinCommandsApi(client);
    const definitions = registry.toYapinDefinitions();

    const result = await commandsApi.syncCommands(definitions);
    console.log(
      `[OK] Synced ${result.registeredCount} commands for bot @${profile.username || profile.id} via PUT /commands.`,
    );
  } catch (err) {
    console.error(`[ERROR] Command registration failed: ${sanitizeErrorMessage(err.message)}`);
    process.exit(1);
  } finally {
    await client.stop();
  }
}

main();
