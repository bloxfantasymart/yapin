import { z } from 'zod';
import { MM2_ALIGNMENTS } from '../../config/settings.js';
import {
  dateField,
  defaultedObject,
  nullableDateField,
  validateWithSchema,
} from './schemaHelpers.js';

const CharacterSubSchema = z.object({
  characterId: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  codename: z.string().trim().max(40).default(''),
  alignment: z.enum(MM2_ALIGNMENTS).default('INNOCENT'),
  weapon: z.string().trim().max(60).default('Flashlight'),
  bio: z.string().trim().max(500).default('A mysterious resident of MurderMystery2.'),
  createdAt: dateField(true),
});

export const UserSchema = z.object({
  yapinUserId: z.string().trim().min(1).max(64),
  lastKnownUsername: z.string().trim().max(64).nullable().default(null),
  joinedAt: nullableDateField(),

  verification: defaultedObject({
    verified: z.boolean().default(false),
    verifiedAt: nullableDateField(),
    verifiedBy: z.string().nullable().default(null),
    pendingCode: z.string().nullable().default(null),
    codeExpiresAt: nullableDateField(),
    attempts: z.number().int().min(0).default(0),
  }),

  leveling: defaultedObject({
    xp: z.number().int().min(0).default(0),
    level: z.number().int().min(1).default(1),
    totalXp: z.number().int().min(0).default(0),
    prestige: z.number().int().min(0).default(0),
    messagesCount: z.number().int().min(0).default(0),
    rpPostsCount: z.number().int().min(0).default(0),
    coins: z.number().int().min(0).default(0),
    dailyStreak: z.number().int().min(0).default(0),
    lastDailyAt: nullableDateField(),
    lastXpAt: nullableDateField(),
    badges: z.array(z.string()).default([]),
  }),

  characters: z.array(CharacterSubSchema).default([]),
  activeCharacterId: z.string().nullable().default(null),

  moderation: defaultedObject({
    activeWarnCount: z.number().int().min(0).default(0),
    totalCases: z.number().int().min(0).default(0),
    openReportsCount: z.number().int().min(0).default(0),
    activeMute: defaultedObject({
      active: z.boolean().default(false),
      caseId: z.string().nullable().default(null),
      reason: z.string().max(1000).nullable().default(null),
      mutedBy: z.string().nullable().default(null),
      mutedAt: nullableDateField(),
      expiresAt: nullableDateField(),
    }),
    activeBan: defaultedObject({
      active: z.boolean().default(false),
      caseId: z.string().nullable().default(null),
      reason: z.string().max(1000).nullable().default(null),
      bannedBy: z.string().nullable().default(null),
      bannedAt: nullableDateField(),
      expiresAt: nullableDateField(),
    }),
  }),

  lastApplicationAt: nullableDateField(),
  createdAt: dateField(true),
  updatedAt: dateField(true),
});

export const UserModel = {
  modelName: 'User',
  primaryKey: 'yapinUserId',
  schema: UserSchema,
  validate: (data) => validateWithSchema(UserSchema, 'User', data),
};
