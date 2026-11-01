import { TicketModel } from '../models/Ticket.js';
import { DisputeModel } from '../models/Dispute.js';
import { ReportModel } from '../models/Report.js';

export const OPEN_TICKET_STATUSES = Object.freeze(['OPEN', 'CLAIMED', 'REOPENED']);

export class MongooseTicketRepository {
  async create(ticketData, session = null) {
    const [created] = await TicketModel.create([ticketData], session ? { session } : undefined);
    return created.toObject();
  }

  async findByTicketId(ticketId, session = null) {
    return TicketModel.findOne({ ticketId }).session(session).lean();
  }

  async findByChannelId(channelId, session = null) {
    return TicketModel.findOne({ channelId }).session(session).lean();
  }

  async findOpenDuplicate({ serverId, creatorId, type, tradeId = null }, session = null) {
    const filter = {
      serverId,
      creatorId,
      type,
      status: { $in: OPEN_TICKET_STATUSES },
    };
    if (tradeId) filter.tradeId = tradeId;
    return TicketModel.findOne(filter).session(session).lean();
  }

  async countOpenByCreator(serverId, creatorId, session = null) {
    return TicketModel.countDocuments({
      serverId,
      creatorId,
      status: { $in: OPEN_TICKET_STATUSES },
    }).session(session);
  }

  async atomicUpdate(ticketId, { expectedVersion, set = {}, push = {} }, session = null) {
    const filter = { ticketId, version: expectedVersion };
    const updateDoc = { $inc: { version: 1 } };
    if (Object.keys(set).length > 0) updateDoc.$set = set;
    if (Object.keys(push).length > 0) updateDoc.$push = push;

    return TicketModel.findOneAndUpdate(filter, updateDoc, {
      returnDocument: 'after',
      runValidators: true,
      session,
    }).lean();
  }

  async listTickets({ serverId, status, creatorId, assignedStaffId, page = 1, limit = 15 } = {}) {
    const filter = {};
    if (serverId) filter.serverId = serverId;
    if (status) filter.status = Array.isArray(status) ? { $in: status } : status;
    if (creatorId) filter.creatorId = creatorId;
    if (assignedStaffId) filter.assignedStaffId = assignedStaffId;

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 15));
    const [items, total] = await Promise.all([
      TicketModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      TicketModel.countDocuments(filter),
    ]);

    return { items, total, page: safePage, limit: safeLimit };
  }
}

export class MongooseDisputeRepository {
  async create(disputeData, session = null) {
    const [created] = await DisputeModel.create([disputeData], session ? { session } : undefined);
    return created.toObject();
  }

  async findByDisputeId(disputeId, session = null) {
    return DisputeModel.findOne({ disputeId }).session(session).lean();
  }

  async findActiveByTradeId(tradeId, session = null) {
    return DisputeModel.findOne({
      tradeId,
      status: { $in: ['OPEN', 'UNDER_REVIEW', 'ESCALATED'] },
    })
      .session(session)
      .lean();
  }

  async updateDispute(disputeId, { set = {}, push = {} }, session = null) {
    const updateDoc = {};
    if (Object.keys(set).length > 0) updateDoc.$set = set;
    if (Object.keys(push).length > 0) updateDoc.$push = push;

    return DisputeModel.findOneAndUpdate({ disputeId }, updateDoc, {
      returnDocument: 'after',
      runValidators: true,
      session,
    }).lean();
  }

  async listDisputes({ serverId, statuses, page = 1, limit = 15 } = {}) {
    const filter = {};
    if (serverId) filter.serverId = serverId;
    if (Array.isArray(statuses) && statuses.length > 0) filter.status = { $in: statuses };

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 15));
    const [items, total] = await Promise.all([
      DisputeModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      DisputeModel.countDocuments(filter),
    ]);
    return { items, total, page: safePage, limit: safeLimit };
  }
}

export class MongooseReportRepository {
  async create(reportData, session = null) {
    const [created] = await ReportModel.create([reportData], session ? { session } : undefined);
    return created.toObject();
  }

  async findByReportId(reportId, session = null) {
    return ReportModel.findOne({ reportId }).session(session).lean();
  }

  async updateReport(reportId, set = {}, session = null) {
    return ReportModel.findOneAndUpdate(
      { reportId },
      { $set: set },
      { returnDocument: 'after', runValidators: true, session },
    ).lean();
  }

  async listReports({ serverId, status, targetUserId, page = 1, limit = 15 } = {}) {
    const filter = {};
    if (serverId) filter.serverId = serverId;
    if (status) filter.status = status;
    if (targetUserId) filter.targetUserId = targetUserId;

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 15));
    const [items, total] = await Promise.all([
      ReportModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      ReportModel.countDocuments(filter),
    ]);
    return { items, total, page: safePage, limit: safeLimit };
  }
}
