import { InvalidStateTransitionError, ValidationError } from '../utils/errors.js';

export const TERMINAL_TRADE_STATES = Object.freeze([
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'EXPIRED',
]);

export const RESUMABLE_TRADE_STATES = Object.freeze([
  'WAITING_FOR_PARTICIPANTS',
  'WAITING_FOR_MIDDLEMAN',
  'MIDDLEMAN_ASSIGNED',
  'WAITING_FOR_DEPOSITS',
  'DEPOSIT_CONFIRMATION',
  'WAITING_FOR_FINAL_CONFIRMATION',
]);

/**
 * Explicit Allowed State Transition Matrix.
 * Skipping intermediate verification stages is impossible.
 */
export const ALLOWED_TRANSITIONS = Object.freeze({
  CREATED: Object.freeze(['WAITING_FOR_PARTICIPANTS', 'CANCELLED', 'EXPIRED']),
  WAITING_FOR_PARTICIPANTS: Object.freeze([
    'WAITING_FOR_MIDDLEMAN',
    'REJECTED',
    'CANCELLED',
    'EXPIRED',
    'UNDER_REVIEW',
  ]),
  WAITING_FOR_MIDDLEMAN: Object.freeze([
    'MIDDLEMAN_ASSIGNED',
    'CANCELLED',
    'EXPIRED',
    'DISPUTED',
    'UNDER_REVIEW',
  ]),
  MIDDLEMAN_ASSIGNED: Object.freeze([
    'WAITING_FOR_DEPOSITS',
    'WAITING_FOR_MIDDLEMAN',
    'CANCELLED',
    'DISPUTED',
    'UNDER_REVIEW',
  ]),
  WAITING_FOR_DEPOSITS: Object.freeze([
    'DEPOSIT_CONFIRMATION',
    'WAITING_FOR_FINAL_CONFIRMATION',
    'CANCELLED',
    'DISPUTED',
    'UNDER_REVIEW',
  ]),
  DEPOSIT_CONFIRMATION: Object.freeze([
    'WAITING_FOR_FINAL_CONFIRMATION',
    'WAITING_FOR_DEPOSITS',
    'CANCELLED',
    'DISPUTED',
    'UNDER_REVIEW',
  ]),
  WAITING_FOR_FINAL_CONFIRMATION: Object.freeze([
    'COMPLETED',
    'CANCELLED',
    'DISPUTED',
    'UNDER_REVIEW',
  ]),
  DISPUTED: Object.freeze([
    ...RESUMABLE_TRADE_STATES,
    'UNDER_REVIEW',
    'CANCELLED',
  ]),
  UNDER_REVIEW: Object.freeze([
    ...RESUMABLE_TRADE_STATES,
    'DISPUTED',
    'CANCELLED',
  ]),
  COMPLETED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
  REJECTED: Object.freeze([]),
  EXPIRED: Object.freeze([]),
});

export function isTerminalTradeState(state) {
  return TERMINAL_TRADE_STATES.includes(state);
}

export function canTransitionTrade(fromState, toState) {
  const allowed = ALLOWED_TRANSITIONS[fromState];
  if (!allowed) return false;
  return allowed.includes(toState);
}

/**
 * Validates both structural transition legality AND business invariant guards
 * for the target state.
 *
 * @param {object} trade
 * @param {string} toState
 * @param {{ isStaff?: boolean, resumeTarget?: string }} [context]
 */
export function assertValidTradeTransition(trade, toState, context = {}) {
  const fromState = trade?.state;
  if (!fromState || !ALLOWED_TRANSITIONS[fromState]) {
    throw new ValidationError(`Unknown current trade state: "${fromState}"`);
  }

  if (!canTransitionTrade(fromState, toState)) {
    throw new InvalidStateTransitionError(
      fromState,
      toState,
      `Transition ${fromState} -> ${toState} is not permitted by the trade state machine`,
    );
  }

  // Guard 1: Resuming from DISPUTED or UNDER_REVIEW may only return to the exact preDisputeState
  if (
    (fromState === 'DISPUTED' || fromState === 'UNDER_REVIEW') &&
    RESUMABLE_TRADE_STATES.includes(toState)
  ) {
    if (!context.isStaff) {
      throw new InvalidStateTransitionError(
        fromState,
        toState,
        'Only authorized staff can unfreeze a disputed or under-review trade',
      );
    }
    const allowedResume = trade.preDisputeState || 'WAITING_FOR_MIDDLEMAN';
    if (toState !== allowedResume) {
      throw new InvalidStateTransitionError(
        fromState,
        toState,
        `Frozen trade can only resume to its prior state (${allowedResume}), not ${toState}`,
      );
    }
  }

  // Guard 2: WAITING_FOR_MIDDLEMAN from WAITING_FOR_PARTICIPANTS requires BOTH participants' invite + details confirmation
  if (fromState === 'WAITING_FOR_PARTICIPANTS' && toState === 'WAITING_FOR_MIDDLEMAN') {
    const a = trade.confirmations?.traderA;
    const b = trade.confirmations?.traderB;
    if (!a?.acceptedInvite || !a?.detailsConfirmed || !b?.acceptedInvite || !b?.detailsConfirmed) {
      throw new InvalidStateTransitionError(
        fromState,
        toState,
        'Both Trader A and Trader B must independently accept and confirm trade details first',
      );
    }
  }

  // Guard 3: MIDDLEMAN_ASSIGNED -> WAITING_FOR_DEPOSITS requires assignedMiddlemanId + both middleman confirmations
  if (fromState === 'MIDDLEMAN_ASSIGNED' && toState === 'WAITING_FOR_DEPOSITS') {
    if (!trade.assignedMiddlemanId) {
      throw new InvalidStateTransitionError(fromState, toState, 'No middleman is currently assigned');
    }
    const a = trade.confirmations?.traderA;
    const b = trade.confirmations?.traderB;
    if (!a?.middlemanConfirmed || !b?.middlemanConfirmed) {
      throw new InvalidStateTransitionError(
        fromState,
        toState,
        'Both traders must confirm the assigned middleman before deposits begin',
      );
    }
  }

  // Guard 4: Entering WAITING_FOR_FINAL_CONFIRMATION from normal flow requires verified deposits
  if (
    (fromState === 'WAITING_FOR_DEPOSITS' || fromState === 'DEPOSIT_CONFIRMATION') &&
    toState === 'WAITING_FOR_FINAL_CONFIRMATION'
  ) {
    const validDepositStates = new Set(['CONFIRMED', 'NOT_REQUIRED']);
    const depA = trade.deposits?.traderA?.status;
    const depB = trade.deposits?.traderB?.status;
    if (!validDepositStates.has(depA) || !validDepositStates.has(depB)) {
      throw new InvalidStateTransitionError(
        fromState,
        toState,
        `Both trader deposits must be CONFIRMED or NOT_REQUIRED by staff (current: A=${depA}, B=${depB})`,
      );
    }
  }

  // Guard 5: Entering COMPLETED requires activeDisputeId == null, both finalReleaseConfirmed, and verified deposits
  if (toState === 'COMPLETED') {
    if (trade.activeDisputeId) {
      throw new InvalidStateTransitionError(
        fromState,
        toState,
        `Trade has an active dispute (${trade.activeDisputeId}) and is frozen`,
      );
    }
    const a = trade.confirmations?.traderA;
    const b = trade.confirmations?.traderB;
    if (!a?.finalReleaseConfirmed || !b?.finalReleaseConfirmed) {
      throw new InvalidStateTransitionError(
        fromState,
        toState,
        'Both participants must submit their final release confirmation before completion',
      );
    }
    const validDepositStates = new Set(['CONFIRMED', 'NOT_REQUIRED']);
    if (
      !validDepositStates.has(trade.deposits?.traderA?.status) ||
      !validDepositStates.has(trade.deposits?.traderB?.status)
    ) {
      throw new InvalidStateTransitionError(
        fromState,
        toState,
        'Required deposits are not in CONFIRMED or NOT_REQUIRED state',
      );
    }
  }

  return true;
}

/**
 * Determines whether a regular participant (non-staff) may cancel the trade in its current state.
 * Participants may cancel ONLY before any deposit has been reported or confirmed and while not frozen.
 */
export function canParticipantSelfCancel(trade) {
  const preDepositStates = new Set([
    'CREATED',
    'WAITING_FOR_PARTICIPANTS',
    'WAITING_FOR_MIDDLEMAN',
    'MIDDLEMAN_ASSIGNED',
    'WAITING_FOR_DEPOSITS',
  ]);
  if (!preDepositStates.has(trade.state)) {
    return false;
  }
  const lockedDepositStatuses = new Set(['REPORTED_SENT', 'CONFIRMED', 'UNDER_REVIEW']);
  if (
    lockedDepositStatuses.has(trade.deposits?.traderA?.status) ||
    lockedDepositStatuses.has(trade.deposits?.traderB?.status)
  ) {
    return false;
  }
  return true;
}
