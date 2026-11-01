export function createMessageCreateListener({ commandHandler }) {
  return async function onMessageCreate(event) {
    return commandHandler.handleMessage(event);
  };
}
