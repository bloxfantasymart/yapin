import mongoose from 'mongoose';
import {
  DEFAULT_COOLDOWNS,
  DEFAULT_COORDINATION_DISCLAIMER,
  DEFAULT_TRADE_LIMITS,
  DEFAULT_TRADING_RULES,
} from '../../config/settings.js';

const ServerConfigSchema = new mongoose.Schema(
  {
    serverId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    staffRoles: {
      adminRoleIds: { type: [String], default: [] },
      middlemanRoleIds: { type: [String], default: [] },
      moderatorRoleIds: { type: [String], default: [] },
      supportRoleIds: { type: [String], default: [] },
    },
    channels: {
      auditLogChannelId: { type: String, default: null },
      alertChannelId: { type: String, default: null },
      tradeRequestsChannelId: { type: String, default: null },
      ticketCategoryId: { type: String, default: null },
      tradeCategoryId: { type: String, default: null },
      transcriptChannelId: { type: String, default: null },
    },
    ticketConfig: {
      createDedicatedChannel: { type: Boolean, default: true },
      useScopedParticipantRole: { type: Boolean, default: false },
      maxOpenPerUser: { type: Number, default: DEFAULT_TRADE_LIMITS.maxOpenTicketsPerUser, min: 1, max: 10 },
      requireCloseReason: { type: Boolean, default: true },
    },
    tradeLimits: {
      maxActiveTradesPerUser: {
        type: Number,
        default: DEFAULT_TRADE_LIMITS.maxActiveTradesPerUser,
        min: 1,
        max: 20,
      },
      tradeExpirationHours: {
        type: Number,
        default: DEFAULT_TRADE_LIMITS.tradeExpirationHours,
        min: 1,
        max: 720,
      },
      maxMiddlemanActiveWorkload: {
        type: Number,
        default: DEFAULT_TRADE_LIMITS.maxMiddlemanActiveWorkload,
        min: 1,
        max: 50,
      },
      allowSelfTrade: { type: Boolean, default: DEFAULT_TRADE_LIMITS.allowSelfTrade },
      autoAssignMiddleman: { type: Boolean, default: DEFAULT_TRADE_LIMITS.autoAssignMiddleman },
      requireFinalStaffConfirmationFlag: {
        type: Boolean,
        default: DEFAULT_TRADE_LIMITS.requireFinalStaffConfirmationFlag,
      },
    },
    cooldowns: {
      defaultCommandMs: { type: Number, default: DEFAULT_COOLDOWNS.defaultCommandMs, min: 0 },
      tradeCreateMs: { type: Number, default: DEFAULT_COOLDOWNS.tradeCreateMs, min: 0 },
      ticketCreateMs: { type: Number, default: DEFAULT_COOLDOWNS.ticketCreateMs, min: 0 },
      reportCreateMs: { type: Number, default: DEFAULT_COOLDOWNS.reportCreateMs, min: 0 },
      buttonClickMs: { type: Number, default: DEFAULT_COOLDOWNS.buttonClickMs, min: 0 },
    },
    rulesText: {
      type: String,
      default: DEFAULT_TRADING_RULES,
      maxlength: 3500,
    },
    disclaimerText: {
      type: String,
      default: DEFAULT_COORDINATION_DISCLAIMER,
      maxlength: 1500,
    },
    features: {
      tradesEnabled: { type: Boolean, default: true },
      ticketsEnabled: { type: Boolean, default: true },
      disputesEnabled: { type: Boolean, default: true },
      reportsEnabled: { type: Boolean, default: true },
      dmNotificationsEnabled: { type: Boolean, default: false },
      suspiciousActivityAlertsEnabled: { type: Boolean, default: true },
      restrictSuspendedUsers: { type: Boolean, default: true },
      restrictUnderReviewUsers: { type: Boolean, default: false },
    },
  },
  {
    timestamps: true,
  },
);

export const ServerConfigModel =
  mongoose.models.ServerConfig || mongoose.model('ServerConfig', ServerConfigSchema);
