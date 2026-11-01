import mongoose from 'mongoose';

const EventCursorSchema = new mongoose.Schema(
  {
    botKey: {
      type: String,
      required: true,
      unique: true,
    },
    lastEventId: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  },
);

export const EventCursorModel =
  mongoose.models.EventCursor || mongoose.model('EventCursor', EventCursorSchema);

/**
 * Ephemeral idempotency cache record.
 * Safe to use TTL index here because idempotency keys are short-lived replay guards,
 * NOT business-critical trade state records.
 */
const IdempotencyRecordSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
    },
    scope: {
      type: String,
      required: true,
    },
    actorId: {
      type: String,
      required: true,
    },
    resultSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  {
    timestamps: true,
  },
);

export const IdempotencyRecordModel =
  mongoose.models.IdempotencyRecord ||
  mongoose.model('IdempotencyRecord', IdempotencyRecordSchema);

/**
 * Ephemeral OAuth2 Staff Dashboard Session record (TTL-indexed on session expiry).
 * Raw session tokens are never stored in the database — only SHA-256 digests (`sessionIdHash`).
 */
const DashboardSessionSchema = new mongoose.Schema(
  {
    sessionIdHash: {
      type: String,
      required: true,
      unique: true,
    },
    yapinUserId: {
      type: String,
      required: true,
      index: true,
    },
    username: {
      type: String,
      required: true,
    },
    displayName: {
      type: String,
      default: null,
    },
    serverId: {
      type: String,
      required: true,
    },
    staffTier: {
      type: Number,
      required: true,
    },
    csrfToken: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  {
    timestamps: true,
  },
);

export const DashboardSessionModel =
  mongoose.models.DashboardSession || mongoose.model('DashboardSession', DashboardSessionSchema);
