import { z } from 'zod';
import {
  dateField,
  defaultedObject,
  nullableDateField,
  validateWithSchema,
} from './schemaHelpers.js';

const WarningSubSchema = z.object({
  warningId: z.string().trim().min(1),
  serverId: z.string().trim().min(1),
  issuedBy: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(1000),
  tradeId: z.string().nullable().default(null),
  createdAt: dateField(true),
});

export const UserSchema = z.object({
  yapinUserId: z.string().trim().min(1).max(64),
  lastKnownUsername: z.string().trim().max(64).nullable().default(null),
  tradeStats: defaultedObject({
    created: z.number().min(0).default(0),
    completed: z.number().min(0).default(0),
    cancelled: z.number().min(0).default(0),
    disputed: z.number().min(0).default(0),
    rejected: z.number().min(0).default(0),
    asMiddlemanClaimed: z.number().min(0).default(0),
    asMiddlemanCompleted: z.number().min(0).default(0),
    activeMiddlemanLoad: z.number().min(0).default(0),
  }),
  staffAvailability: defaultedObject({
    available: z.boolean().default(false),
    note: z.string().max(200).default(''),
    updatedAt: nullableDateField(),
  }),
  warnings: z.array(WarningSubSchema).default([]),
  suspension: defaultedObject({
    active: z.boolean().default(false),
    reason: z.string().max(1000).nullable().default(null),
    suspendedBy: z.string().nullable().default(null),
    suspendedAt: nullableDateField(),
    expiresAt: nullableDateField(),
    liftedBy: z.string().nullable().default(null),
    liftedAt: nullableDateField(),
  }),
  // Reports never auto-label a user a scammer; they track review counts & explicit staff restrictions only.
  riskFlags: defaultedObject({
    openReportsCount: z.number().min(0).default(0),
    substantiatedReportsCount: z.number().min(0).default(0),
    underStaffReview: z.boolean().default(false),
  }),
  createdAt: dateField(true),
  updatedAt: dateField(true),
});

export const UserModel = {
  modelName: 'User',
  primaryKey: 'yapinUserId',
  schema: UserSchema,
  validate: (data) => validateWithSchema(UserSchema, 'User', data),
};
