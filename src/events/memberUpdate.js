export function createMemberUpdateListener({ permissionsApi, logger }) {
  return async function onMemberEvent(event, type) {
    if (event?.server_id) {
      permissionsApi.clearCache();
      logger.debug({ serverId: event.server_id, eventType: type }, 'Cleared RBAC cache on member event');
    }
  };
}
