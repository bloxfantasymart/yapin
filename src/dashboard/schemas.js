import { z } from 'zod';

export const ApplicationReviewBodySchema = z.object({
  decision: z.enum(['UNDER_REVIEW', 'ACCEPTED', 'DENIED']),
  notes: z.string().trim().max(1000).optional().default(''),
});

export const ModerationWarnBodySchema = z.object({
  targetUserId: z.string().trim().min(4).max(64),
  reason: z.string().trim().min(3).max(1000),
});

export const ClearWarningBodySchema = z.object({
  reason: z.string().trim().min(2).max(500).optional().default('Cleared via Sheriff HQ Console'),
});

export const TicketNoteBodySchema = z.object({
  content: z.string().trim().min(2).max(2000),
  internalOnly: z.boolean().optional().default(false),
});

export const TicketCloseBodySchema = z.object({
  reason: z.string().trim().min(3).max(1000),
});

export const AuditSearchQuerySchema = z.object({
  action: z.string().trim().max(80).optional(),
  actorId: z.string().trim().max(64).optional(),
  targetId: z.string().trim().max(64).optional(),
  correlationId: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const UpdateServerConfigBodySchema = z.object({
  adminRoleIds: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  moderatorRoleIds: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  trialModRoleIds: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  supportRoleIds: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  verifiedRoleId: z.string().trim().max(64).nullable().optional(),
  mutedRoleId: z.string().trim().max(64).nullable().optional(),
  modLogChannelId: z.string().trim().max(64).nullable().optional(),
  modAppLogChannelId: z.string().trim().max(64).nullable().optional(),
  ticketLogChannelId: z.string().trim().max(64).nullable().optional(),
  welcomeChannelId: z.string().trim().max(64).nullable().optional(),
  verificationMode: z
    .preprocess((v) => (v ? String(v).toLowerCase() : undefined), z.enum(['instant', 'code']))
    .optional(),
  applicationsOpen: z.boolean().optional(),
  autoModEnabled: z.boolean().optional(),
});
