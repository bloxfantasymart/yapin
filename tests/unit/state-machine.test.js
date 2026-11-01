import { describe, expect, it } from 'vitest';
import {
  assertValidTradeTransition,
  canParticipantSelfCancel,
  canTransitionTrade,
  isTerminalTradeState,
} from '../../src/middleman/tradeStateMachine.js';

describe('Stage 3 — Strict Trade State Machine', () => {
  it('enforces explicit forward progression and rejects step-skipping', () => {
    expect(canTransitionTrade('CREATED', 'WAITING_FOR_PARTICIPANTS')).toBe(true);
    expect(canTransitionTrade('CREATED', 'WAITING_FOR_MIDDLEMAN')).toBe(false);
    expect(canTransitionTrade('CREATED', 'COMPLETED')).toBe(false);
    expect(canTransitionTrade('WAITING_FOR_PARTICIPANTS', 'WAITING_FOR_DEPOSITS')).toBe(false);
    expect(canTransitionTrade('WAITING_FOR_DEPOSITS', 'COMPLETED')).toBe(false);
    expect(canTransitionTrade('DEPOSIT_CONFIRMATION', 'COMPLETED')).toBe(false);
  });

  it('blocks terminal states from transitioning anywhere', () => {
    for (const terminal of ['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED']) {
      expect(isTerminalTradeState(terminal)).toBe(true);
      expect(canTransitionTrade(terminal, 'WAITING_FOR_MIDDLEMAN')).toBe(false);
      expect(canTransitionTrade(terminal, 'DISPUTED')).toBe(false);
    }
  });

  it('rejects WAITING_FOR_MIDDLEMAN unless BOTH traders independently accepted and confirmed details', () => {
    const partialTrade = {
      state: 'WAITING_FOR_PARTICIPANTS',
      confirmations: {
        traderA: { acceptedInvite: true, detailsConfirmed: true },
        traderB: { acceptedInvite: false, detailsConfirmed: false },
      },
    };
    expect(() => assertValidTradeTransition(partialTrade, 'WAITING_FOR_MIDDLEMAN')).toThrow(
      /Both Trader A and Trader B/i,
    );

    partialTrade.confirmations.traderB = { acceptedInvite: true, detailsConfirmed: true };
    expect(assertValidTradeTransition(partialTrade, 'WAITING_FOR_MIDDLEMAN')).toBe(true);
  });

  it('rejects WAITING_FOR_FINAL_CONFIRMATION or COMPLETED when deposits are unverified or active dispute exists', () => {
    const unverifiedTrade = {
      state: 'DEPOSIT_CONFIRMATION',
      deposits: {
        traderA: { status: 'CONFIRMED' },
        traderB: { status: 'REPORTED_SENT' },
      },
    };
    expect(() =>
      assertValidTradeTransition(unverifiedTrade, 'WAITING_FOR_FINAL_CONFIRMATION'),
    ).toThrow(/CONFIRMED or NOT_REQUIRED/i);

    const disputedReadyTrade = {
      state: 'WAITING_FOR_FINAL_CONFIRMATION',
      activeDisputeId: 'DSP-1234',
      confirmations: {
        traderA: { finalReleaseConfirmed: true },
        traderB: { finalReleaseConfirmed: true },
      },
      deposits: {
        traderA: { status: 'CONFIRMED' },
        traderB: { status: 'CONFIRMED' },
      },
    };
    expect(() => assertValidTradeTransition(disputedReadyTrade, 'COMPLETED')).toThrow(/frozen/i);
  });

  it('blocks participant self-cancellation once any deposit is REPORTED_SENT or CONFIRMED', () => {
    expect(
      canParticipantSelfCancel({
        state: 'WAITING_FOR_DEPOSITS',
        deposits: { traderA: { status: 'PENDING' }, traderB: { status: 'PENDING' } },
      }),
    ).toBe(true);

    expect(
      canParticipantSelfCancel({
        state: 'WAITING_FOR_DEPOSITS',
        deposits: { traderA: { status: 'REPORTED_SENT' }, traderB: { status: 'PENDING' } },
      }),
    ).toBe(false);
  });
});
