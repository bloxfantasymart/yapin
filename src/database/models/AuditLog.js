import { z } from 'zod';
import { SecurityError } from '../../utils/errors.js';
import { dateField, deepFreezeRecord, validateWithSchema } from './schemaHelpers.js';

/**
 * Append-Only AuditLog Schema (JSON Storage Edition)
 *
 * Security invariant:
 * Audit entries are frozen (`Object.freeze`) and strictly append-only.
 * Update and delete operations are unconditionally blocked at both model and store levels.
 */
export const AuditLogSchema = z.object({
  auditId: z.string().min(1),
  serverId: z.string().min(1),
  actorId: z.string().min(1),
  actorType: z.enum(['USER', 'STAFF', 'SYSTEM']),
  action: z.string().min(1),
  targetType: z.enum([
    'TRADE',
    'TICKET',
    'DISPUTE',
    'USER',
    'REPORT',
    'SERVER_CONFIG',
    'SYSTEM',
  ]),
  targetId: z.string().min(1),
  beforeState: z.unknown().default(null),
  afterState: z.unknown().default(null),
  correlationId: z.string().nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).default({}),
  timestamp: dateField(true),
});

const rejectAuditMutation = async () => {
  throw new SecurityError('AuditLog entries are append-only and cannot be modified or deleted.');
};

export const AuditLogModel = Object.freeze({
  modelName: 'AuditLog',
  primaryKey: 'auditId',
  appendOnly: true,
  schema: AuditLogSchema,
  validate: (data) => deepFreezeRecord(validateWithSchema(AuditLogSchema, 'AuditLog', data)),
  updateOne: rejectAuditMutation,
  updateMany: rejectAuditMutation,
  findOneAndUpdate: rejectAuditMutation,
  replaceOne: rejectAuditMutation,
  deleteOne: rejectAuditMutation,
  deleteMany: rejectAuditMutation,
  findOneAndDelete: rejectAuditMutation,
});
