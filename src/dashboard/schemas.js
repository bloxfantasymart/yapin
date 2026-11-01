import { z } from 'zod';

export const AssignMiddlemanBodySchema = z.object({
  targetMiddlemanId: z.string().trim().min(4).max(64),
  reason: z.string().trim().min(3).max(500).default('Assigned via Staff Web Dashboard'),
  reassign: z.boolean().optional().default(false),
});

export const VerifyDepositBodySchema = z.object({
  traderSideOrUserId: z.string().trim().min(1).max(64),
  decision: z.enum(['CONFIRMED', 'REJECTED', 'UNDER_REVIEW', 'NOT_REQUIRED']),
  notes: z.string().trim().min(3).max(1000),
});

export const CompleteTradeBodySchema = z.object({
  decisionNotes: z.string().trim().min(10).max(2000),
  evidenceSummary: z.string().trim().max(2000).optional().default(''),
  confirm: z.literal(true),
});

export const CancelTradeBodySchema = z.object({
  reason: z.string().trim().min(5).max(1000),
  confirm: z.literal(true),
});

export const ResolveDisputeBodySchema = z.object({
  outcome: z.enum(['RESUME_TRADE', 'CANCEL_TRADE']),
  decisionSummary: z.string().trim().min(10).max(2000),
  confirm: z.literal(true),
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
  middlemanRoleIds: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  moderatorRoleIds: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  adminRoleIds: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  supportRoleIds: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  alertChannelId: z.string().trim().max(64).nullable().optional(),
  auditLogChannelId: z.string().trim().max(64).nullable().optional(),
  ticketCategoryId: z.string().trim().max(64).nullable().optional(),
  autoAssignMiddleman: z.boolean().optional(),
  maxActiveTradesPerUser: z.number().int().min(1).max(20).optional(),
});
