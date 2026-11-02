import { loadEnv } from '../src/config/env.js';
import { YapinClient } from '../src/api/YapinClient.js';
import { YapinCommandsApi } from '../src/api/commands.js';
import { YapinPermissionsApi } from '../src/api/permissions.js';

/**
 * Minimal Verified Yapin API Connection Test (`npm run test:connection`)
 *
 * Verifies:
 * 1. Environment variables (.env) are valid.
 * 2. `GET /me` succeeds with `Authorization: Bot yb_...`.
 * 3. `GET /servers/:id` confirms the bot has been added to `YAPIN_SERVER_ID`.
 * 4. `GET /events?after=0&wait=0` returns the current event sequence cursor.
 * 5. `GET /commands` reads registered slash commands.
 */
async function main() {
  const env = loadEnv(process.env, { exitOnError: true });
  const client = new YapinClient({
    token: env.YAPIN_BOT_TOKEN,
    baseUrl: env.YAPIN_API_BASE_URL,
    enableGateway: false,
  });
  const commandsApi = new YapinCommandsApi(client);
  const permissionsApi = new YapinPermissionsApi(client);

  console.log('1. Testing Yapin authentication via GET /me ...');
  const { profile, latencyMs } = await client.getMe();
  console.log(
    `   OK (${latencyMs} ms) — Authenticated as "${profile.username || profile.bot?.name}" (id=${profile.id})`,
  );

  console.log(`2. Verifying server membership for YAPIN_SERVER_ID=${env.YAPIN_SERVER_ID} ...`);
  const server = await permissionsApi.fetchServer(env.YAPIN_SERVER_ID, { forceRefresh: true });
  console.log(`   OK — Connected to server "${server.name}" (owner_id=${server.owner_id})`);

  console.log('3. Testing event stream cursor via GET /events?after=0&wait=0 ...');
  const eventsRes = await client.request('GET', '/events', { query: { after: 0, wait: 0 } });
  console.log(`   OK — Latest Yapin event cursor: ${eventsRes.last ?? 0}`);

  console.log('4. Reading registered slash commands via GET /commands ...');
  const commands = await commandsApi.listRegisteredCommands();
  console.log(`   OK — Currently registered commands: ${commands.length}`);

  console.log('\nYapin API connection test PASSED.');
}

main().catch((err) => {
  console.error('\n[CONNECTION TEST FAILED]', err.message);
  process.exit(1);
});
