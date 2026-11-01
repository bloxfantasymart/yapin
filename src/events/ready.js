export function createReadyListener({ logger }) {
  return async function onReady(payload) {
    logger.info(
      { transport: payload?.transport || 'gateway' },
      'Yapin Middleman Bot gateway/event stream ready',
    );
  };
}
