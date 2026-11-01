import { createReadyListener } from '../events/ready.js';
import { createMessageCreateListener } from '../events/messageCreate.js';
import { createInteractionCreateListener } from '../events/interactionCreate.js';
import { createMemberUpdateListener } from '../events/memberUpdate.js';
import { sanitizeErrorMessage } from '../utils/errors.js';

/**
 * Wires YapinClient event stream (`ready`, `message`, `interaction`, `member_join`, `member_leave`, `rawEvent`)
 * to modular handlers and persists the monotonic event cursor for crash/restart recovery.
 */
export function registerEventHandlers({
  client,
  commandHandler,
  interactionHandler,
  permissionsApi,
  operationalRepo,
  logger,
}) {
  const onReady = createReadyListener({ logger });
  const onMessage = createMessageCreateListener({ commandHandler });
  const onInteraction = createInteractionCreateListener({ interactionHandler });
  const onMemberEvent = createMemberUpdateListener({ permissionsApi, logger });

  client.on('ready', (payload) => {
    Promise.resolve(onReady(payload)).catch((err) => {
      logger.warn({ errMessage: sanitizeErrorMessage(err.message) }, 'Error in ready listener');
    });
  });

  client.on('message', (data) => {
    Promise.resolve(onMessage(data)).catch((err) => {
      logger.error({ errMessage: sanitizeErrorMessage(err.message) }, 'Unhandled message listener error');
    });
  });

  client.on('interaction', (data) => {
    Promise.resolve(onInteraction(data)).catch((err) => {
      logger.error({ errMessage: sanitizeErrorMessage(err.message) }, 'Unhandled interaction listener error');
    });
  });

  client.on('member_join', (data) => {
    Promise.resolve(onMemberEvent(data, 'member_join')).catch(() => undefined);
  });

  client.on('member_leave', (data) => {
    Promise.resolve(onMemberEvent(data, 'member_leave')).catch(() => undefined);
  });

  if (operationalRepo) {
    let pendingSeq = null;
    let flushTimer = null;

    client.on('rawEvent', ({ seq }) => {
      if (typeof seq !== 'number' || seq <= 0) return;
      if (pendingSeq === null || seq > pendingSeq) {
        pendingSeq = seq;
      }
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          const seqToSave = pendingSeq;
          flushTimer = null;
          if (seqToSave !== null) {
            operationalRepo.saveGatewayCursor('default', seqToSave).catch((err) => {
              logger.debug(
                { errMessage: sanitizeErrorMessage(err.message) },
                'Deferred cursor checkpoint save failed',
              );
            });
          }
        }, 1500);
        if (flushTimer.unref) flushTimer.unref();
      }
    });
  }
}
