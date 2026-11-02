/**
 * Routes Yapin `message` events through:
 * 1. Native Yapin command events and MM2 Helper `$` prefix messages
 * 2. Smart Auto-Moderation (`AutoModService`) for regular member messages
 * 3. MurderMystery2 Leveling & XP engine (`LevelingService`) if message is clean
 */
export function createMessageCreateListener({ commandHandler, services = null }) {
  return async function onMessageCreate(event) {
    if (!event || event.author_bot) return false;

    if (event.command) return commandHandler.handleMessage(event);

    const commandHandled = await commandHandler.handleMessage(event);
    if (commandHandled) return true;

    const activeServices = services || commandHandler?.services;
    if (event.server_id && activeServices) {
      if (activeServices.autoMod) {
        const modCheck = await activeServices.autoMod.inspectMessage(event);
        if (modCheck?.triggered) {
          return true;
        }
      }
      if (activeServices.leveling) {
        await activeServices.leveling.awardChatXp(event);
      }
    }

    return false;
  };
}
