import { z } from 'zod';
import {
  dateField,
  defaultedObject,
  nullableDateField,
  validateWithSchema,
} from './schemaHelpers.js';

export const DISPUTE_STATUSES = Object.freeze([
  'OPEN',
  'UNDER_REVIEW',
  'RESOLVED_RESUME',
  'RESOLVED_CANCELLED',
  'ESCALATED',
]);

const EvidenceRefSubSchema = z.object({
  evidenceId: z.string().min(1),
  submittedBy: z.string().min(1),
  reference: z.string().min(1).max(500),
  url: z.string().max(512).nullable().default(null),
  description: z.string().max(1000).default(''),
  restrictedToStaff: z.boolean().default(true),
  submittedAt: dateField(true),
});

export const DisputeSchema = z.object({
  disputeId: z.string().trim().min(1),
  serverId: z.string().trim().min(1),
  tradeId: z.string().trim().min(1),
  ticketId: z.string().nullable().default(null),
  reporterId: z.string().trim().min(1),
  reason: z.string().trim().min(5).max(2000),
  evidence: z.array(EvidenceRefSubSchema).default([]),
  assignedReviewerId: z.string().nullable().default(null),
  status: z.enum(DISPUTE_STATUSES).default('OPEN'),
  resolution: defaultedObject({
    outcome: z.enum(['RESUME_TRADE', 'CANCEL_TRADE', 'UNDER_REVIEW']).nullable().default(null),
    decisionSummary: z.string().max(2000).nullable().default(null),
    decidedBy: z.string().nullable().default(null),
    decidedAt: nullableDateField(),
  }),
  createdAt: dateField(true),
  updatedAt: dateField(true),
});

export const DisputeModel = {
  modelName: 'Dispute',
  primaryKey: 'disputeId',
  schema: DisputeSchema,
  validate: (data) => validateWithSchema(DisputeSchema, 'Dispute', data),
};
