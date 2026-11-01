import { z } from 'zod';
import { dateField, nullableDateField, validateWithSchema } from './schemaHelpers.js';

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

export const ReportSchema = z.object({
  reportId: z.string().trim().min(1),
  serverId: z.string().min(1),
  reporterId: z.string().min(1),
  targetUserId: z.string().min(1),
  tradeId: z.string().nullable().default(null),
  ticketId: z.string().nullable().default(null),
  category: z.enum(REPORT_CATEGORIES).default('OTHER_SUSPICIOUS'),
  description: z.string().min(10).max(2000),
  evidenceRefs: z.array(z.string()).default([]),
  status: z.enum(REPORT_STATUSES).default('PENDING_REVIEW'),
  reviewedBy: z.string().nullable().default(null),
  reviewNotes: z.string().max(1000).nullable().default(null),
  reviewedAt: nullableDateField(),
  retainUntil: nullableDateField(),
  createdAt: dateField(true),
  updatedAt: dateField(true),
});

export const ReportModel = {
  modelName: 'Report',
  primaryKey: 'reportId',
  schema: ReportSchema,
  validate: (data) => validateWithSchema(ReportSchema, 'Report', data),
};
