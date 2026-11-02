import { fileURLToPath } from 'node:url';
import { YapinClient } from './api/YapinClient.js';
import { YapinOAuth2Client } from './api/authentication.js';
import { YapinChannelsApi } from './api/channels.js';
import { YapinCommandsApi } from './api/commands.js';
import { YapinMessagesApi } from './api/messages.js';
import { YapinPermissionsApi } from './api/permissions.js';
import { createCommandRegistry } from './commands/index.js';
import { loadEnv } from './config/env.js';
import { BOT_BRAND, BOT_PREFIX } from './config/settings.js';
import { createDashboardServer } from './dashboard/server.js';
import { connectDatabase, disconnectDatabase } from './database/connection.js';
import { createJsonRepositories } from './database/repositories/index.js';
import { CommandHandler } from './handlers/commandHandler.js';
import { registerEventHandlers } from './handlers/eventHandler.js';
import { InteractionHandler } from './handlers/interactionHandler.js';
import { createApplicationServices } from './systems/createServices.js';
import { sanitizeErrorMessage } from './utils/errors.js';
import { createLogger } from './utils/logger.js';

/**
 * Bootstraps and runs **MM2 Helper** for the **MurderMystery2** server on Yapin.gg,
 * backed by crash-safe local atomic JSON storage (`./data/*.json`).
 */
export async function startApplication(rawEnv = process.env, options = {}) {
  const env = loadEnv(rawEnv, { exitOnError: options.exitOnError ?? true });
  const logger = createLogger({ level: env.LOG_LEVEL });

  logger.info(
    {
      botName: BOT_BRAND.botName,
      serverName: BOT_BRAND.serverName,
      nodeVersion: process.version,
      env: env.NODE_ENV,
      serverId: env.YAPIN_SERVER_ID,
      dataDir: env.DATA_DIR,
      gatewayEnabled: env.YAPIN_ENABLE_GATEWAY,
      dashboardEnabled: env.DASHBOARD_ENABLED,
    },
    `Starting ${BOT_BRAND.botName} for ${BOT_BRAND.serverName}...`,
  );

  // 1. Initialize local crash-safe JSON storage & repositories
  const db = await connectDatabase(env.DATA_DIR, { logger });
  const repositories = createJsonRepositories(db);
  await repositories.serverConfigs.getOrCreate(env.YAPIN_SERVER_ID);

  // 2. Initialize isolated Yapin API Client + Adapter Layer
  const cursorStore = {
    getCursor: () => repositories.operational.getGatewayCursor('default'),
    setCursor: (seq) => repositories.operational.saveGatewayCursor('default', seq),
  };

  const client = new YapinClient({
    token: env.YAPIN_BOT_TOKEN,
    baseUrl: env.YAPIN_API_BASE_URL,
    gatewayUrl: env.YAPIN_GATEWAY_URL,
    enableGateway: env.YAPIN_ENABLE_GATEWAY,
    prefixes: [BOT_PREFIX],
    fetchImpl: options.fetchImpl,
    cursorStore,
    logger,
  });

  const commandsApi = new YapinCommandsApi(client);
  const messagesApi = new YapinMessagesApi(client);
  const channelsApi = new YapinChannelsApi(client);
  const permissionsApi = new YapinPermissionsApi(client);

  // 3. Build MM2 Helper Domain Services, Command Registry & Event Dispatchers
  const { services, cooldowns } = createApplicationServices({
    repositories,
    permissionsApi,
    channelsApi,
    messagesApi,
    logger,
  });

  const commandRegistry = createCommandRegistry();
  const commandHandler = new CommandHandler({
    client,
    commandRegistry,
    messagesApi,
    channelsApi,
    permissionsApi,
    repositories,
    services,
    cooldowns,
    logger,
  });

  const interactionHandler = new InteractionHandler({
    client,
    messagesApi,
    permissionsApi,
    repositories,
    services,
    cooldowns,
    logger,
  });

  registerEventHandlers({
    client,
    commandHandler,
    interactionHandler,
    permissionsApi,
    services,
    operationalRepo: repositories.operational,
    logger,
  });

  // 4. Sync slash commands & start real-time Gateway / Long-Polling ingestion
  await commandsApi.syncCommands(commandRegistry.toYapinDefinitions());
  await client.start();
  await client.setStatus('online', BOT_BRAND.statusText).catch(() => undefined);

  // 5. Optional Event Webhook Server
  if (env.YAPIN_WEBHOOK_ENABLED) {
    await client.startWebhookServer({
      port: env.YAPIN_WEBHOOK_PORT,
      path: env.YAPIN_WEBHOOK_PATH,
      secret: env.YAPIN_WEBHOOK_SECRET,
    });
    logger.info(
      { port: env.YAPIN_WEBHOOK_PORT, path: env.YAPIN_WEBHOOK_PATH },
      'Yapin HMAC-verified webhook listener active',
    );
  }

  // 6. Optional OAuth2 Staff Web Console ("Sheriff HQ")
  let dashboard = null;
  if (env.DASHBOARD_ENABLED) {
    const oauthClient = new YapinOAuth2Client({
      clientId: env.YAPIN_OAUTH_CLIENT_ID,
      clientSecret: env.YAPIN_OAUTH_CLIENT_SECRET,
      redirectUri: env.YAPIN_OAUTH_REDIRECT_URI,
      siteUrl: env.YAPIN_SITE_URL,
    });

    dashboard = createDashboardServer({
      oauthClient,
      serverId: env.YAPIN_SERVER_ID,
      sessionSecret: env.DASHBOARD_SESSION_SECRET,
      secureCookies: env.NODE_ENV === 'production',
      permissionsApi,
      repositories,
      services,
      logger,
    });

    const boundPort = await dashboard.listen(env.DASHBOARD_PORT, env.DASHBOARD_HOST);
    logger.info(
      { host: env.DASHBOARD_HOST, port: boundPort },
      `${BOT_BRAND.botName} Sheriff HQ OAuth2 Web Console listening`,
    );
  }

  // 7. Periodic Expired Timed-Mute Sweep (every 60 seconds; audited automatic unmutes)
  const sweepInterval = setInterval(() => {
    services.moderation.sweepExpiredMutes(env.YAPIN_SERVER_ID).catch((err) => {
      logger.warn(
        { errMessage: sanitizeErrorMessage(err?.message || String(err)) },
        'Background expired-mute sweep warning',
      );
    });
  }, 60_000);
  if (sweepInterval.unref) sweepInterval.unref();

  // 8. Graceful Shutdown Handler
  let shuttingDown = false;
  async function shutdown(signal = 'SIGTERM') {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown initiated...');
    clearInterval(sweepInterval);

    try {
      if (dashboard) await dashboard.close();
      await client.stop();
      if (client.lastEventId > 0) {
        await repositories.operational
          .saveGatewayCursor('default', client.lastEventId)
          .catch(() => undefined);
      }
      await disconnectDatabase({ logger });
      logger.info(`${BOT_BRAND.botName} stopped cleanly.`);
    } catch (err) {
      logger.error(
        { errMessage: sanitizeErrorMessage(err?.message || String(err)) },
        'Error during graceful shutdown',
      );
    }
  }

  const onSigInt = () => shutdown('SIGINT').finally(() => process.exit(0));
  const onSigTerm = () => shutdown('SIGTERM').finally(() => process.exit(0));
  process.once('SIGINT', onSigInt);
  process.once('SIGTERM', onSigTerm);

  return {
    client,
    dashboard,
    repositories,
    services,
    shutdown,
  };
}

const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  startApplication().catch((err) => {
    process.stderr.write(
      `[FATAL] Startup failed: ${sanitizeErrorMessage(err?.message || String(err))}\n`,
    );
    process.exit(1);
  });
}
