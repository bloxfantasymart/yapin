import { z } from 'zod';
import {
  DEFAULT_COOLDOWNS,
  DEFAULT_COORDINATION_DISCLAIMER,
  DEFAULT_TRADE_LIMITS,
  DEFAULT_TRADING_RULES,
} from '../../config/settings.js';
import { dateField, defaultedObject, validateWithSchema } from './schemaHelpers.js';

export const ServerConfigSchema = z.object({
  serverId: z.string().trim().min(1),
  staffRoles: defaultedObject({
    adminRoleIds: z.array(z.string()).default([]),
    middlemanRoleIds: z.array(z.string()).default([]),
    moderatorRoleIds: z.array(z.string()).default([]),
    supportRoleIds: z.array(z.string()).default([]),
  }),
  channels: defaultedObject({
    auditLogChannelId: z.string().nullable().default(null),
    alertChannelId: z.string().nullable().default(null),
    tradeRequestsChannelId: z.string().nullable().default(null),
    ticketCategoryId: z.string().nullable().default(null),
    tradeCategoryId: z.string().nullable().default(null),
    transcriptChannelId: z.string().nullable().default(null),
  }),
  ticketConfig: defaultedObject({
    createDedicatedChannel: z.boolean().default(true),
    useScopedParticipantRole: z.boolean().default(false),
    maxOpenPerUser: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(DEFAULT_TRADE_LIMITS.maxOpenTicketsPerUser),
    requireCloseReason: z.boolean().default(true),
  }),
  tradeLimits: defaultedObject({
    maxActiveTradesPerUser: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(DEFAULT_TRADE_LIMITS.maxActiveTradesPerUser),
    tradeExpirationHours: z
      .number()
      .int()
      .min(1)
      .max(720)
      .default(DEFAULT_TRADE_LIMITS.tradeExpirationHours),
    maxMiddlemanActiveWorkload: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(DEFAULT_TRADE_LIMITS.maxMiddlemanActiveWorkload),
    allowSelfTrade: z.boolean().default(DEFAULT_TRADE_LIMITS.allowSelfTrade),
    autoAssignMiddleman: z.boolean().default(DEFAULT_TRADE_LIMITS.autoAssignMiddleman),
    requireFinalStaffConfirmationFlag: z
      .boolean()
      .default(DEFAULT_TRADE_LIMITS.requireFinalStaffConfirmationFlag),
  }),
  cooldowns: defaultedObject({
    defaultCommandMs: z.number().min(0).default(DEFAULT_COOLDOWNS.defaultCommandMs),
    tradeCreateMs: z.number().min(0).default(DEFAULT_COOLDOWNS.tradeCreateMs),
    ticketCreateMs: z.number().min(0).default(DEFAULT_COOLDOWNS.ticketCreateMs),
    reportCreateMs: z.number().min(0).default(DEFAULT_COOLDOWNS.reportCreateMs),
    buttonClickMs: z.number().min(0).default(DEFAULT_COOLDOWNS.buttonClickMs),
  }),
  rulesText: z.string().max(3500).default(DEFAULT_TRADING_RULES),
  disclaimerText: z.string().max(1500).default(DEFAULT_COORDINATION_DISCLAIMER),
  features: defaultedObject({
    tradesEnabled: z.boolean().default(true),
    ticketsEnabled: z.boolean().default(true),
    disputesEnabled: z.boolean().default(true),
    reportsEnabled: z.boolean().default(true),
    dmNotificationsEnabled: z.boolean().default(false),
    suspiciousActivityAlertsEnabled: z.boolean().default(true),
    restrictSuspendedUsers: z.boolean().default(true),
    restrictUnderReviewUsers: z.boolean().default(false),
  }),
  createdAt: dateField(true),
  updatedAt: dateField(true),
});

export const ServerConfigModel = {
  modelName: 'ServerConfig',
  primaryKey: 'serverId',
  schema: ServerConfigSchema,
  validate: (data) => validateWithSchema(ServerConfigSchema, 'ServerConfig', data),
};
