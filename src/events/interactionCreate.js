export function createInteractionCreateListener({ interactionHandler }) {
  return async function onInteractionCreate(event) {
    return interactionHandler.handleInteraction(event);
  };
}
