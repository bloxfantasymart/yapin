import { z } from 'zod';
import {
  DEFAULT_COOLDOWNS,
  DEFAULT_SERVER_RULES,
} from '../../config/settings.js';
import { dateField, defaultedObject, validateWithSchema } from './schemaHelpers.js';

export const ServerConfigSchema = z.object({
  serverId: z.string().trim().min(1),

  staffRoles: defaultedObject({
    adminRoleIds: z.array(z.string()).default([]),
    moderatorRoleIds: z.array(z.string()).default([]),
    trialModRoleIds: z.array(z.string()).default([]),
    supportRoleIds: z.array(z.string()).default([]),
  }),

  roles: defaultedObject({
    verifiedRoleId: z.string().nullable().default(null),
    unverifiedRoleId: z.string().nullable().default(null),
    mutedRoleId: z.string().nullable().default(null),
    levelRewards: z.record(z.string(), z.string()).default({}), // e.g. { "5": "role_detective", "20": "role_sheriff" }
    selfRoles: z.record(z.string(), z.string()).default({}), // e.g. { "rp_ping": "role_rp", "events": "role_events" }
  }),

  channels: defaultedObject({
    welcomeChannelId: z.string().nullable().default(null),
    verifyChannelId: z.string().nullable().default(null),
    modLogChannelId: z.string().nullable().default(null),
    memberLogChannelId: z.string().nullable().default(null),
    ticketLogChannelId: z.string().nullable().default(null),
    modAppLogChannelId: z.string().nullable().default(null),
    levelUpChannelId: z.string().nullable().default(null),
    rpLogChannelId: z.string().nullable().default(null),
    alertChannelId: z.string().nullable().default(null),
    transcriptChannelId: z.string().nullable().default(null),
    ticketCategoryId: z.string().nullable().default(null),
  }),

  verification: defaultedObject({
    enabled: z.boolean().default(true),
    mode: z
      .preprocess((v) => String(v || 'code').trim().toLowerCase(), z.enum(['code', 'instant']))
      .default('code'),
    welcomeMessage: z
      .string()
      .max(1000)
      .default(
        'Welcome to **MurderMystery2 Roleplay**! Step through the Sheriff Checkpoint and run `/verify` to enter the city.',
      ),
  }),

  leveling: defaultedObject({
    enabled: z.boolean().default(true),
    xpMin: z.number().int().min(1).max(200).default(15),
    xpMax: z.number().int().min(1).max(500).default(28),
    rpBonusXp: z.number().int().min(0).max(100).default(8),
    cooldownMs: z.number().int().min(5000).default(DEFAULT_COOLDOWNS.xpGainCooldownMs),
    announceLevelUp: z.boolean().default(true),
  }),

  applications: defaultedObject({
    open: z.boolean().default(true),
    minLevel: z.number().int().min(1).max(100).default(1),
    reapplyCooldownHours: z.number().int().min(0).max(720).default(72),
    autoAssignTrialModOnAccept: z.boolean().default(true),
  }),

  autoMod: defaultedObject({
    enabled: z.boolean().default(true),
    blockInviteLinks: z.boolean().default(true),
    blockScamLinks: z.boolean().default(true),
    maxMentions: z.number().int().min(2).max(50).default(6),
    blockedWords: z.array(z.string()).default([]),
    autoWarnThreshold: z.number().int().min(2).max(20).default(3),
    autoMuteDurationMs: z.number().int().min(60_000).default(30 * 60_000),
  }),

  ticketConfig: defaultedObject({
    createDedicatedChannel: z.boolean().default(true),
    useScopedParticipantRole: z.boolean().default(false),
    maxOpenPerUser: z.number().int().min(1).max(10).default(2),
    requireCloseReason: z.boolean().default(true),
  }),

  cooldowns: defaultedObject({
    defaultCommandMs: z.number().min(0).default(DEFAULT_COOLDOWNS.defaultCommandMs),
    verifyAttemptMs: z.number().min(0).default(DEFAULT_COOLDOWNS.verifyAttemptMs),
    ticketCreateMs: z.number().min(0).default(DEFAULT_COOLDOWNS.ticketCreateMs),
    reportCreateMs: z.number().min(0).default(DEFAULT_COOLDOWNS.reportCreateMs),
    applicationSubmitMs: z.number().min(0).default(DEFAULT_COOLDOWNS.applicationSubmitMs),
    buttonClickMs: z.number().min(0).default(DEFAULT_COOLDOWNS.buttonClickMs),
  }),

  rulesText: z.string().max(3500).default(DEFAULT_SERVER_RULES),

  createdAt: dateField(true),
  updatedAt: dateField(true),
});

export const ServerConfigModel = {
  modelName: 'ServerConfig',
  primaryKey: 'serverId',
  schema: ServerConfigSchema,
  validate: (data) => validateWithSchema(ServerConfigSchema, 'ServerConfig', data),
};
