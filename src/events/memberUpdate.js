export function createMemberUpdateListener({ permissionsApi, services = null, logger }) {
  return async function onMemberEvent(event, type) {
    if (!event?.server_id) return;

    permissionsApi.clearCache();
    const userId = event.user_id || event.member_id || event.id;

    if (type === 'member_join' && userId && services?.verification) {
      await services.verification
        .handleMemberJoin({
          serverId: event.server_id,
          userId,
          username: event.username || null,
        })
        .catch(() => undefined);
    } else if (type === 'member_leave' && userId && services?.log) {
      await services.log
        .record({
          serverId: event.server_id,
          actorId: userId,
          actorType: 'USER',
          action: 'MEMBER_LEFT',
          targetType: 'USER',
          targetId: userId,
          stream: 'member',
        })
        .catch(() => undefined);
    }

    logger?.debug?.({ serverId: event.server_id, eventType: type }, 'Processed member event');
  };
}
