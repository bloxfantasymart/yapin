import { z } from 'zod';
import {
  dateField,
  defaultedObject,
  nullableDateField,
  validateWithSchema,
} from './schemaHelpers.js';

export const APPLICATION_STATUSES = Object.freeze([
  'PENDING',
  'UNDER_REVIEW',
  'ACCEPTED',
  'DENIED',
]);

export const ModApplicationSchema = z.object({
  applicationId: z.string().trim().min(1),
  serverId: z.string().trim().min(1),
  applicantId: z.string().trim().min(1),
  applicantUsername: z.string().max(64).nullable().default(null),
  levelAtApply: z.number().int().min(1).default(1),
  answers: defaultedObject({
    age: z.string().trim().min(1).max(100),
    timezone: z.string().trim().min(1).max(100),
    hours: z.string().trim().min(1).max(150),
    experience: z.string().trim().min(3).max(1000),
    reason: z.string().trim().min(10).max(1500),
    scenario: z.string().trim().min(10).max(1500),
  }),
  status: z.enum(APPLICATION_STATUSES).default('PENDING'),
  reviewerId: z.string().nullable().default(null),
  reviewNotes: z.string().max(1000).nullable().default(null),
  reviewedAt: nullableDateField(),
  reviewMessageId: z.string().nullable().default(null),
  reviewChannelId: z.string().nullable().default(null),
  version: z.number().int().min(1).default(1),
  createdAt: dateField(true),
  updatedAt: dateField(true),
});

export const ModApplicationModel = {
  modelName: 'ModApplication',
  primaryKey: 'applicationId',
  schema: ModApplicationSchema,
  validate: (data) => validateWithSchema(ModApplicationSchema, 'ModApplication', data),
};
