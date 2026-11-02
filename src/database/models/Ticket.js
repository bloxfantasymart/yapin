import { z } from 'zod';
import {
  dateField,
  defaultedObject,
  nullableDateField,
  validateWithSchema,
} from './schemaHelpers.js';

export const TICKET_TYPES = Object.freeze([
  'GENERAL_SUPPORT',
  'RP_CHARACTER',
  'RULE_VIOLATION',
  'APPEAL',
  'STAFF_REPORT',
]);

export const TICKET_STATUSES = Object.freeze(['OPEN', 'CLAIMED', 'CLOSED', 'REOPENED']);

const TicketNoteSubSchema = z.object({
  noteId: z.string().min(1),
  authorId: z.string().min(1),
  content: z.string().min(1).max(2000),
  internalOnly: z.boolean().default(false),
  createdAt: dateField(true),
});

const TranscriptEntrySubSchema = z.object({
  messageId: z.string().min(1),
  authorId: z.string().min(1),
  authorUsername: z.string().nullable().default(null),
  content: z.string().max(2000).default(''),
  createdAt: dateField(true),
});

export const TicketSchema = z.object({
  ticketId: z.string().trim().min(1),
  serverId: z.string().trim().min(1),
  creatorId: z.string().trim().min(1),
  participantIds: z.array(z.string()).default([]),
  type: z.enum(TICKET_TYPES),
  subject: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000),
  channelId: z.string().nullable().default(null),
  assignedStaffId: z.string().nullable().default(null),
  accessConfig: defaultedObject({
    isPrivate: z.boolean().default(true),
    allowedRoleIds: z.array(z.string()).default([]),
    scopedRoleId: z.string().nullable().default(null),
  }),
  status: z.enum(TICKET_STATUSES).default('OPEN'),
  notes: z.array(TicketNoteSubSchema).default([]),
  transcript: defaultedObject({
    messageCount: z.number().int().min(0).default(0),
    generatedAt: nullableDateField(),
    generatedBy: z.string().nullable().default(null),
    checksumSha256: z.string().nullable().default(null),
    entries: z.array(TranscriptEntrySubSchema).default([]),
  }),
  closure: defaultedObject({
    closedAt: nullableDateField(),
    closedBy: z.string().nullable().default(null),
    reason: z.string().max(1000).nullable().default(null),
    reopenedAt: nullableDateField(),
    reopenedBy: z.string().nullable().default(null),
    reopenReason: z.string().max(1000).nullable().default(null),
  }),
  version: z.number().int().min(1).default(1),
  createdAt: dateField(true),
  updatedAt: dateField(true),
});

export const TicketModel = {
  modelName: 'Ticket',
  primaryKey: 'ticketId',
  schema: TicketSchema,
  validate: (data) => validateWithSchema(TicketSchema, 'Ticket', data),
};
