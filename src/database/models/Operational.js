import { z } from 'zod';
import { dateField, validateWithSchema } from './schemaHelpers.js';

export const EventCursorSchema = z.object({
  botKey: z.string().min(1),
  lastEventId: z.number().int().min(0).default(0),
  createdAt: dateField(true),
  updatedAt: dateField(true),
});

export const EventCursorModel = {
  modelName: 'EventCursor',
  primaryKey: 'botKey',
  schema: EventCursorSchema,
  validate: (data) => validateWithSchema(EventCursorSchema, 'EventCursor', data),
};

export const IdempotencyRecordSchema = z.object({
  key: z.string().min(1),
  scope: z.string().min(1),
  actorId: z.string().min(1),
  resultSnapshot: z.unknown().default(null),
  expiresAt: dateField(false),
  createdAt: dateField(true),
  updatedAt: dateField(true),
});

export const IdempotencyRecordModel = {
  modelName: 'IdempotencyRecord',
  primaryKey: 'key',
  schema: IdempotencyRecordSchema,
  validate: (data) => validateWithSchema(IdempotencyRecordSchema, 'IdempotencyRecord', data),
};

export const DashboardSessionSchema = z.object({
  sessionIdHash: z.string().min(1),
  yapinUserId: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string().nullable().default(null),
  serverId: z.string().min(1),
  staffTier: z.number().int(),
  csrfToken: z.string().min(1),
  expiresAt: dateField(false),
  createdAt: dateField(true),
  updatedAt: dateField(true),
});

export const DashboardSessionModel = {
  modelName: 'DashboardSession',
  primaryKey: 'sessionIdHash',
  schema: DashboardSessionSchema,
  validate: (data) => validateWithSchema(DashboardSessionSchema, 'DashboardSession', data),
};
