import mongoose from 'mongoose';

export const REPORT_CATEGORIES = Object.freeze([
  'IMPERSONATION',
  'FAKE_PROOF',
  'OFF_PLATFORM_LURE',
  'REFUSAL_TO_HONOR_TERMS',
  'STAFF_MISCONDUCT',
  'OTHER_SUSPICIOUS',
]);

export const REPORT_STATUSES = Object.freeze([
  'PENDING_REVIEW',
  'UNDER_INVESTIGATION',
  'SUBSTANTIATED',
  'DISMISSED',
]);

const ReportSchema = new mongoose.Schema(
  {
    reportId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    serverId: {
      type: String,
      required: true,
      index: true,
    },
    reporterId: {
      type: String,
      required: true,
      index: true,
    },
    targetUserId: {
      type: String,
      required: true,
      index: true,
    },
    tradeId: {
      type: String,
      default: null,
    },
    ticketId: {
      type: String,
      default: null,
    },
    category: {
      type: String,
      enum: REPORT_CATEGORIES,
      default: 'OTHER_SUSPICIOUS',
    },
    description: {
      type: String,
      required: true,
      minlength: 10,
      maxlength: 2000,
    },
    evidenceRefs: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: REPORT_STATUSES,
      default: 'PENDING_REVIEW',
      index: true,
    },
    reviewedBy: {
      type: String,
      default: null,
    },
    reviewNotes: {
      type: String,
      default: null,
      maxlength: 1000,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    retainUntil: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

ReportSchema.index({ serverId: 1, status: 1, createdAt: -1 });
ReportSchema.index({ serverId: 1, targetUserId: 1, status: 1 });

export const ReportModel = mongoose.models.Report || mongoose.model('Report', ReportSchema);
