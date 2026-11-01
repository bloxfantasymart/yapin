import mongoose from 'mongoose';

export const TICKET_TYPES = Object.freeze([
  'GENERAL_SUPPORT',
  'TRADE_ASSISTANCE',
  'DISPUTE',
  'SCAM_REPORT',
  'STAFF_REPORT',
  'APPEAL',
]);

export const TICKET_STATUSES = Object.freeze(['OPEN', 'CLAIMED', 'CLOSED', 'REOPENED']);

const TicketNoteSubSchema = new mongoose.Schema(
  {
    noteId: { type: String, required: true },
    authorId: { type: String, required: true },
    content: { type: String, required: true, maxlength: 2000 },
    internalOnly: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const TranscriptEntrySubSchema = new mongoose.Schema(
  {
    messageId: { type: String, required: true },
    authorId: { type: String, required: true },
    authorUsername: { type: String, default: null },
    content: { type: String, default: '', maxlength: 2000 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const TicketSchema = new mongoose.Schema(
  {
    ticketId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    serverId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    creatorId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    participantIds: {
      type: [String],
      default: [],
    },
    tradeId: {
      type: String,
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: TICKET_TYPES,
      required: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    channelId: {
      type: String,
      default: null,
      index: true,
    },
    assignedStaffId: {
      type: String,
      default: null,
      index: true,
    },
    accessConfig: {
      isPrivate: { type: Boolean, required: true, default: true },
      allowedRoleIds: { type: [String], default: [] },
      scopedRoleId: { type: String, default: null },
    },
    status: {
      type: String,
      enum: TICKET_STATUSES,
      required: true,
      default: 'OPEN',
      index: true,
    },
    notes: {
      type: [TicketNoteSubSchema],
      default: [],
    },
    transcript: {
      messageCount: { type: Number, default: 0 },
      generatedAt: { type: Date, default: null },
      generatedBy: { type: String, default: null },
      checksumSha256: { type: String, default: null },
      entries: { type: [TranscriptEntrySubSchema], default: [] },
    },
    closure: {
      closedAt: { type: Date, default: null },
      closedBy: { type: String, default: null },
      reason: { type: String, default: null, maxlength: 1000 },
      reopenedAt: { type: Date, default: null },
      reopenedBy: { type: String, default: null },
      reopenReason: { type: String, default: null, maxlength: 1000 },
    },
    version: {
      type: Number,
      default: 1,
      min: 1,
    },
  },
  {
    timestamps: true,
  },
);

TicketSchema.index({ serverId: 1, creatorId: 1, type: 1, status: 1 });
TicketSchema.index({ serverId: 1, status: 1, createdAt: -1 });

export const TicketModel = mongoose.models.Ticket || mongoose.model('Ticket', TicketSchema);
