import mongoose from 'mongoose';

export const DISPUTE_STATUSES = Object.freeze([
  'OPEN',
  'UNDER_REVIEW',
  'RESOLVED_RESUME',
  'RESOLVED_CANCELLED',
  'ESCALATED',
]);

const EvidenceRefSubSchema = new mongoose.Schema(
  {
    evidenceId: { type: String, required: true },
    submittedBy: { type: String, required: true },
    reference: { type: String, required: true, maxlength: 500 },
    url: { type: String, default: null, maxlength: 512 },
    description: { type: String, default: '', maxlength: 1000 },
    restrictedToStaff: { type: Boolean, default: true },
    submittedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const DisputeSchema = new mongoose.Schema(
  {
    disputeId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    serverId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    tradeId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    ticketId: {
      type: String,
      default: null,
    },
    reporterId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      minlength: 5,
      maxlength: 2000,
    },
    evidence: {
      type: [EvidenceRefSubSchema],
      default: [],
    },
    assignedReviewerId: {
      type: String,
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: DISPUTE_STATUSES,
      required: true,
      default: 'OPEN',
      index: true,
    },
    resolution: {
      outcome: {
        type: String,
        enum: ['RESUME_TRADE', 'CANCEL_TRADE', 'UNDER_REVIEW', null],
        default: null,
      },
      decisionSummary: { type: String, default: null, maxlength: 2000 },
      decidedBy: { type: String, default: null },
      decidedAt: { type: Date, default: null },
    },
  },
  {
    timestamps: true,
  },
);

DisputeSchema.index({ serverId: 1, status: 1, createdAt: -1 });
DisputeSchema.index({ tradeId: 1, status: 1 });

export const DisputeModel = mongoose.models.Dispute || mongoose.model('Dispute', DisputeSchema);
