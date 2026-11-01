import { z } from 'zod';
import { dateField, nullableDateField, validateWithSchema } from './schemaHelpers.js';

export const REPORT_CATEGORIES = Object.freeze([
  'RDM_FAILRP',
  'METAGAMING',
  'HARASSMENT',
  'EXPLOITING_SCAM',
  'STAFF_MISCONDUCT',
  'OTHER',
]);

export const REPORT_STATUSES = Object.freeze([
  'PENDING_REVIEW',
  'UNDER_INVESTIGATION',
  'ACTION_TAKEN',
  'DISMISSED',
]);

export const ReportSchema = z.object({
  reportId: z.string().trim().min(1),
  serverId: z.string().min(1),
  reporterId: z.string().min(1),
  targetUserId: z.string().min(1),
  ticketId: z.string().nullable().default(null),
  category: z.enum(REPORT_CATEGORIES).default('RDM_FAILRP'),
  description: z.string().min(8).max(2000),
  evidenceRefs: z.array(z.string()).default([]),
  status: z.enum(REPORT_STATUSES).default('PENDING_REVIEW'),
  reviewedBy: z.string().nullable().default(null),
  reviewNotes: z.string().max(1000).nullable().default(null),
  reviewedAt: nullableDateField(),
  createdAt: dateField(true),
  updatedAt: dateField(true),
});

export const ReportModel = {
  modelName: 'Report',
  primaryKey: 'reportId',
  schema: ReportSchema,
  validate: (data) => validateWithSchema(ReportSchema, 'Report', data),
};
