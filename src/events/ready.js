import { BOT_BRAND } from '../config/settings.js';

export function createReadyListener({ logger }) {
  return async function onReady(payload) {
    logger.info(
      {
        botName: BOT_BRAND.botName,
        serverName: BOT_BRAND.serverName,
        transport: payload?.transport || 'gateway',
      },
      `${BOT_BRAND.botName} (${BOT_BRAND.serverName}) gateway/event stream ready`,
    );
  };
}
