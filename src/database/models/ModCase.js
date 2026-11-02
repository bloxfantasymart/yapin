import { z } from 'zod';
import {
  dateField,
  nullableDateField,
  validateWithSchema,
} from './schemaHelpers.js';

export const MOD_ACTIONS = Object.freeze([
  'WARN',
  'MUTE',
  'UNMUTE',
  'KICK',
  'BAN',
  'UNBAN',
  'AUTOMOD_WARN',
  'AUTOMOD_MUTE',
]);

export const ModCaseSchema = z.object({
  caseId: z.string().trim().min(1),
  caseNumber: z.number().int().min(1),
  serverId: z.string().trim().min(1),
  action: z.enum(MOD_ACTIONS),
  targetUserId: z.string().trim().min(1),
  moderatorId: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(1000),
  durationMs: z.number().int().min(0).nullable().default(null),
  expiresAt: nullableDateField(),
  active: z.boolean().default(true),
  voidedBy: z.string().nullable().default(null),
  voidReason: z.string().max(500).nullable().default(null),
  voidedAt: nullableDateField(),
  createdAt: dateField(true),
  updatedAt: dateField(true),
});

export const ModCaseModel = {
  modelName: 'ModCase',
  primaryKey: 'caseId',
  schema: ModCaseSchema,
  validate: (data) => validateWithSchema(ModCaseSchema, 'ModCase', data),
};
