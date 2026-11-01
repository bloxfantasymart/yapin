import { z } from 'zod';
import {
  dateField,
  defaultedObject,
  nullableDateField,
  validateWithSchema,
} from './schemaHelpers.js';

export const TRADE_STATES = Object.freeze([
  'CREATED',
  'WAITING_FOR_PARTICIPANTS',
  'WAITING_FOR_MIDDLEMAN',
  'MIDDLEMAN_ASSIGNED',
  'WAITING_FOR_DEPOSITS',
  'DEPOSIT_CONFIRMATION',
  'WAITING_FOR_FINAL_CONFIRMATION',
  'COMPLETED',
  'CANCELLED',
  'DISPUTED',
  'REJECTED',
  'EXPIRED',
  'UNDER_REVIEW',
]);

export const DEPOSIT_STATES = Object.freeze([
  'NOT_REQUIRED',
  'PENDING',
  'REPORTED_SENT',
  'CONFIRMED',
  'REJECTED',
  'UNDER_REVIEW',
]);

const ParticipantConfirmationSubSchema = defaultedObject({
  acceptedInvite: z.boolean().default(false),
  acceptedInviteAt: nullableDateField(),
  detailsConfirmed: z.boolean().default(false),
  detailsConfirmedAt: nullableDateField(),
  middlemanConfirmed: z.boolean().default(false),
  middlemanConfirmedAt: nullableDateField(),
  finalReleaseConfirmed: z.boolean().default(false),
  finalReleaseConfirmedAt: nullableDateField(),
});

const DepositRecordSubSchema = defaultedObject({
  status: z.enum(DEPOSIT_STATES).default('PENDING'),
  reference: z.string().max(500).nullable().default(null),
  evidenceUrls: z.array(z.string()).default([]),
  notes: z.string().max(1000).nullable().default(null),
  reportedAt: nullableDateField(),
  verifiedBy: z.string().nullable().default(null),
  verifiedAt: nullableDateField(),
  verificationNotes: z.string().max(1000).nullable().default(null),
});

const AssignmentEntrySubSchema = z.object({
  action: z.enum(['CLAIM', 'ASSIGN', 'UNASSIGN', 'REASSIGN', 'AUTO_ASSIGN']),
  middlemanId: z.string().nullable().default(null),
  previousMiddlemanId: z.string().nullable().default(null),
  actorId: z.string().min(1),
  reason: z.string().max(500).default(''),
  timestamp: dateField(true),
});

const StateTransitionEntrySubSchema = z.object({
  fromState: z.string().nullable().default(null),
  toState: z.enum(TRADE_STATES),
  actorId: z.string().min(1),
  reason: z.string().max(500).default(''),
  correlationId: z.string().nullable().default(null),
  timestamp: dateField(true),
});

export const TradeSchema = z.object({
  tradeId: z.string().trim().min(1).max(32),
  serverId: z.string().trim().min(1),
  channelId: z.string().trim().min(1),
  tradeChannelId: z.string().nullable().default(null),
  panelMessageId: z.string().nullable().default(null),
  traderAId: z.string().trim().min(1),
  traderBId: z.string().trim().min(1),
  createdBy: z.string().trim().min(1),
  dedupeFingerprint: z.string().min(1),
  items: z.object({
    primaryAsset: z.string().trim().min(1).max(300),
    traderAGiving: z.string().trim().min(1).max(500),
    traderBGiving: z.string().trim().min(1).max(500),
    cashComponent: defaultedObject({
      amount: z.number().min(0).default(0),
      currency: z.string().max(16).default('USD'),
      payer: z.enum(['NONE', 'TRADER_A', 'TRADER_B']).default('NONE'),
    }),
    notes: z.string().max(1000).default(''),
  }),
  preferredMiddlemanId: z.string().nullable().default(null),
  rulesAccepted: z
    .boolean()
    .refine((v) => v === true, 'Trade creator must explicitly accept the server trading rules.'),
  assignedMiddlemanId: z.string().nullable().default(null),
  assignmentHistory: z.array(AssignmentEntrySubSchema).default([]),
  state: z.enum(TRADE_STATES).default('CREATED'),
  preDisputeState: z.enum(TRADE_STATES).nullable().default(null),
  stateHistory: z.array(StateTransitionEntrySubSchema).default([]),
  confirmations: defaultedObject({
    traderA: ParticipantConfirmationSubSchema,
    traderB: ParticipantConfirmationSubSchema,
  }),
  deposits: defaultedObject({
    traderA: DepositRecordSubSchema,
    traderB: DepositRecordSubSchema,
  }),
  activeDisputeId: z.string().nullable().default(null),
  disputeIds: z.array(z.string()).default([]),
  completionRecord: defaultedObject({
    completedAt: nullableDateField(),
    completedBy: z.string().nullable().default(null),
    decisionNotes: z.string().max(1000).nullable().default(null),
    evidenceSummary: z.string().max(1000).nullable().default(null),
  }),
  cancellationRecord: defaultedObject({
    cancelledAt: nullableDateField(),
    cancelledBy: z.string().nullable().default(null),
    reason: z.string().max(1000).nullable().default(null),
  }),
  auditLogIds: z.array(z.string()).default([]),
  // Explicit expiration timestamp (swept by audited job — NEVER silently deleted!)
  expiresAt: dateField(false),
  version: z.number().int().min(1).default(1),
  createdAt: dateField(true),
  updatedAt: dateField(true),
});

export const TradeModel = {
  modelName: 'Trade',
  primaryKey: 'tradeId',
  schema: TradeSchema,
  validate: (data) => validateWithSchema(TradeSchema, 'Trade', data),
};
