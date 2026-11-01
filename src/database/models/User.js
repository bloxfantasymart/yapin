import mongoose from 'mongoose';

const WarningSubSchema = new mongoose.Schema(
  {
    warningId: { type: String, required: true, trim: true },
    serverId: { type: String, required: true, trim: true },
    issuedBy: { type: String, required: true, trim: true },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    tradeId: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const UserSchema = new mongoose.Schema(
  {
    yapinUserId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 64,
    },
    lastKnownUsername: {
      type: String,
      default: null,
      trim: true,
      maxlength: 64,
    },
    tradeStats: {
      created: { type: Number, default: 0, min: 0 },
      completed: { type: Number, default: 0, min: 0 },
      cancelled: { type: Number, default: 0, min: 0 },
      disputed: { type: Number, default: 0, min: 0 },
      rejected: { type: Number, default: 0, min: 0 },
      asMiddlemanClaimed: { type: Number, default: 0, min: 0 },
      asMiddlemanCompleted: { type: Number, default: 0, min: 0 },
      activeMiddlemanLoad: { type: Number, default: 0, min: 0 },
    },
    staffAvailability: {
      available: { type: Boolean, default: false },
      note: { type: String, default: '', maxlength: 200 },
      updatedAt: { type: Date, default: null },
    },
    warnings: {
      type: [WarningSubSchema],
      default: [],
    },
    suspension: {
      active: { type: Boolean, default: false },
      reason: { type: String, default: null, maxlength: 1000 },
      suspendedBy: { type: String, default: null },
      suspendedAt: { type: Date, default: null },
      expiresAt: { type: Date, default: null },
      liftedBy: { type: String, default: null },
      liftedAt: { type: Date, default: null },
    },
    // Reports never auto-label a user a scammer; they track review counts & explicit staff restrictions only.
    riskFlags: {
      openReportsCount: { type: Number, default: 0, min: 0 },
      substantiatedReportsCount: { type: Number, default: 0, min: 0 },
      underStaffReview: { type: Boolean, default: false },
    },
  },
  {
    timestamps: true,
  },
);

UserSchema.index({ 'suspension.active': 1, 'suspension.expiresAt': 1 });
UserSchema.index({ 'staffAvailability.available': 1, 'tradeStats.activeMiddlemanLoad': 1 });
UserSchema.index({ 'tradeStats.completed': -1 });
UserSchema.index({ 'tradeStats.asMiddlemanCompleted': -1 });

export const UserModel = mongoose.models.User || mongoose.model('User', UserSchema);
