import mongoose from 'mongoose';
import { SecurityError } from '../../utils/errors.js';

/**
 * Append-Only AuditLog Schema
 *
 * Security invariant (Requirement 10):
 * Audit entries are strictly append-only at the application and Mongoose middleware level.
 * Update and delete operations are unconditionally blocked.
 */
const AuditLogSchema = new mongoose.Schema(
  {
    auditId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
    },
    serverId: {
      type: String,
      required: true,
      immutable: true,
      index: true,
    },
    actorId: {
      type: String,
      required: true,
      immutable: true,
      index: true,
    },
    actorType: {
      type: String,
      enum: ['USER', 'STAFF', 'SYSTEM'],
      required: true,
      immutable: true,
    },
    action: {
      type: String,
      required: true,
      immutable: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: ['TRADE', 'TICKET', 'DISPUTE', 'USER', 'REPORT', 'SERVER_CONFIG', 'SYSTEM'],
      required: true,
      immutable: true,
    },
    targetId: {
      type: String,
      required: true,
      immutable: true,
      index: true,
    },
    beforeState: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      immutable: true,
    },
    afterState: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      immutable: true,
    },
    correlationId: {
      type: String,
      default: null,
      immutable: true,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      immutable: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      required: true,
      immutable: true,
      index: true,
    },
  },
  {
    versionKey: false,
  },
);

AuditLogSchema.index({ serverId: 1, timestamp: -1 });
AuditLogSchema.index({ targetType: 1, targetId: 1, timestamp: -1 });
AuditLogSchema.index({ actorId: 1, timestamp: -1 });
AuditLogSchema.index({ serverId: 1, action: 1, timestamp: -1 });

const blockMutation = function () {
  throw new SecurityError('AuditLog entries are append-only and cannot be modified or deleted.');
};

for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
]) {
  AuditLogSchema.pre(op, blockMutation);
}

export const AuditLogModel =
  mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);
