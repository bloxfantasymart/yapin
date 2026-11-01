import mongoose from 'mongoose';

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

const ParticipantConfirmationSubSchema = new mongoose.Schema(
  {
    acceptedInvite: { type: Boolean, default: false },
    acceptedInviteAt: { type: Date, default: null },
    detailsConfirmed: { type: Boolean, default: false },
    detailsConfirmedAt: { type: Date, default: null },
    middlemanConfirmed: { type: Boolean, default: false },
    middlemanConfirmedAt: { type: Date, default: null },
    finalReleaseConfirmed: { type: Boolean, default: false },
    finalReleaseConfirmedAt: { type: Date, default: null },
  },
  { _id: false },
);

const DepositRecordSubSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: DEPOSIT_STATES,
      default: 'PENDING',
      required: true,
    },
    reference: { type: String, default: null, maxlength: 500 },
    evidenceUrls: { type: [String], default: [] },
    notes: { type: String, default: null, maxlength: 1000 },
    reportedAt: { type: Date, default: null },
    verifiedBy: { type: String, default: null },
    verifiedAt: { type: Date, default: null },
    verificationNotes: { type: String, default: null, maxlength: 1000 },
  },
  { _id: false },
);

const AssignmentEntrySubSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ['CLAIM', 'ASSIGN', 'UNASSIGN', 'REASSIGN', 'AUTO_ASSIGN'],
      required: true,
    },
    middlemanId: { type: String, default: null },
    previousMiddlemanId: { type: String, default: null },
    actorId: { type: String, required: true },
    reason: { type: String, default: '', maxlength: 500 },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false },
);

const StateTransitionEntrySubSchema = new mongoose.Schema(
  {
    fromState: { type: String, default: null },
    toState: { type: String, enum: TRADE_STATES, required: true },
    actorId: { type: String, required: true },
    reason: { type: String, default: '', maxlength: 500 },
    correlationId: { type: String, default: null },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false },
);

const TradeSchema = new mongoose.Schema(
  {
    tradeId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 32,
    },
    serverId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    channelId: {
      type: String,
      required: true,
      trim: true,
    },
    tradeChannelId: {
      type: String,
      default: null,
    },
    panelMessageId: {
      type: String,
      default: null,
    },
    traderAId: {
      type: String,
      required: true,
      trim: true,
    },
    traderBId: {
      type: String,
      required: true,
      trim: true,
    },
    createdBy: {
      type: String,
      required: true,
      trim: true,
    },
    dedupeFingerprint: {
      type: String,
      required: true,
      index: true,
    },
    items: {
      primaryAsset: { type: String, required: true, trim: true, maxlength: 300 },
      traderAGiving: { type: String, required: true, trim: true, maxlength: 500 },
      traderBGiving: { type: String, required: true, trim: true, maxlength: 500 },
      cashComponent: {
        amount: { type: Number, default: 0, min: 0 },
        currency: { type: String, default: 'USD', maxlength: 16 },
        payer: { type: String, enum: ['NONE', 'TRADER_A', 'TRADER_B'], default: 'NONE' },
      },
      notes: { type: String, default: '', maxlength: 1000 },
    },
    preferredMiddlemanId: {
      type: String,
      default: null,
    },
    rulesAccepted: {
      type: Boolean,
      required: true,
      validate: {
        validator: (v) => v === true,
        message: 'Trade creator must explicitly accept the server trading rules.',
      },
    },
    assignedMiddlemanId: {
      type: String,
      default: null,
      index: true,
    },
    assignmentHistory: {
      type: [AssignmentEntrySubSchema],
      default: [],
    },
    state: {
      type: String,
      enum: TRADE_STATES,
      required: true,
      default: 'CREATED',
      index: true,
    },
    preDisputeState: {
      type: String,
      enum: [...TRADE_STATES, null],
      default: null,
    },
    stateHistory: {
      type: [StateTransitionEntrySubSchema],
      default: [],
    },
    confirmations: {
      traderA: { type: ParticipantConfirmationSubSchema, default: () => ({}) },
      traderB: { type: ParticipantConfirmationSubSchema, default: () => ({}) },
    },
    deposits: {
      traderA: { type: DepositRecordSubSchema, default: () => ({ status: 'PENDING' }) },
      traderB: { type: DepositRecordSubSchema, default: () => ({ status: 'PENDING' }) },
    },
    activeDisputeId: {
      type: String,
      default: null,
    },
    disputeIds: {
      type: [String],
      default: [],
    },
    completionRecord: {
      completedAt: { type: Date, default: null },
      completedBy: { type: String, default: null },
      decisionNotes: { type: String, default: null, maxlength: 1000 },
      evidenceSummary: { type: String, default: null, maxlength: 1000 },
    },
    cancellationRecord: {
      cancelledAt: { type: Date, default: null },
      cancelledBy: { type: String, default: null },
      reason: { type: String, default: null, maxlength: 1000 },
    },
    auditLogIds: {
      type: [String],
      default: [],
    },
    // Explicit expiration timestamp (swept by audited job — NEVER a silent MongoDB TTL deletion!)
    expiresAt: {
      type: Date,
      required: true,
    },
    version: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
  },
  {
    timestamps: true,
  },
);

TradeSchema.index({ serverId: 1, state: 1, createdAt: -1 });
TradeSchema.index({ traderAId: 1, state: 1, createdAt: -1 });
TradeSchema.index({ traderBId: 1, state: 1, createdAt: -1 });
TradeSchema.index({ assignedMiddlemanId: 1, state: 1 });
TradeSchema.index({ state: 1, expiresAt: 1 });
TradeSchema.index({ serverId: 1, dedupeFingerprint: 1, state: 1 });

export const TradeModel = mongoose.models.Trade || mongoose.model('Trade', TradeSchema);
