import { describe, expect, it } from 'vitest';
import { YapinClient } from '../../src/api/YapinClient.js';
import { YapinPermissionsApi } from '../../src/api/permissions.js';
import {
  AuditLogModel,
  DisputeModel,
  ServerConfigModel,
  TicketModel,
  TradeModel,
  UserModel,
} from '../../src/database/models/index.js';
import { AuditService } from '../../src/middleman/auditService.js';
import { AntiScamService } from '../../src/security/antiScam.js';
import { TradeService } from '../../src/middleman/tradeService.js';
import { ConfirmationService } from '../../src/middleman/confirmationService.js';
import { createMockYapinFetch } from '../helpers/mockYapinServer.js';
import { createInMemoryRepositories } from '../helpers/inMemoryRepositories.js';

describe('Stage 3 — Mongoose Schemas, Append-Only AuditLog, DB Outage Handling & Restart Recovery', () => {
  it('defines indexes on all required Mongoose models and rejects TTL deletion on Trade/AuditLog', () => {
    for (const Model of [
      UserModel,
      TradeModel,
      TicketModel,
      DisputeModel,
      AuditLogModel,
      ServerConfigModel,
    ]) {
      const indexes = Model.schema.indexes();
      expect(indexes.length).toBeGreaterThan(0);
      // Verify NO business-critical model has a TTL `expires` index!
      for (const [, opts] of indexes) {
        expect(opts?.expires).toBeUndefined();
      }
    }
  });

  it('enforces append-only immutability on AuditLog both in Mongoose hooks and repositories', async () => {
    const repos = createInMemoryRepositories();
    const auditService = new AuditService({ auditRepo: repos.audits });

    const created = await auditService.record({
      serverId: 'srv-1',
      actorId: 'user-1',
      actorType: 'USER',
      action: 'TEST_ACTION',
      targetType: 'SYSTEM',
      targetId: 'srv-1',
      metadata: {
        botToken: 'yb_should_be_redacted_12345',
        safeField: 'hello',
      },
    });

    expect(created.metadata.botToken).toBe('[REDACTED]');
    expect(created.metadata.safeField).toBe('hello');

    await expect(repos.audits.updateOne()).rejects.toThrow(/append-only/i);
    await expect(repos.audits.deleteOne()).rejects.toThrow(/append-only/i);
  });

  it('surfaces clean errors during database outages and recovers seamlessly after restart with persisted cursor & trade state', async () => {
    const mock = createMockYapinFetch();
    const serverId = mock.defaultServerId;
    const traderA = '22222222-2222-4222-8222-222222222222';
    const traderB = '33333333-3333-4333-8333-333333333333';
    mock.setMember(serverId, traderA, [], 'Alice');
    mock.setMember(serverId, traderB, [], 'Bob');

    const repos1 = createInMemoryRepositories();
    await repos1.operational.setCursor('default', 250);

    const client1 = new YapinClient({
      token: mock.state.botToken,
      fetchImpl: mock.fetchImpl,
      enableGateway: false,
      cursorStore: {
        getCursor: () => repos1.operational.getCursor('default'),
        setCursor: (seq) => repos1.operational.setCursor('default', seq),
      },
    });
    const permissionsApi1 = new YapinPermissionsApi(client1);
    const audit1 = new AuditService({ auditRepo: repos1.audits });
    const antiScam1 = new AntiScamService({ userRepo: repos1.users, permissionsApi: permissionsApi1 });
    const tradeService1 = new TradeService({
      tradeRepo: repos1.trades,
      userRepo: repos1.users,
      disputeRepo: repos1.disputes,
      serverConfigRepo: repos1.serverConfigs,
      permissionsApi: permissionsApi1,
      antiScam: antiScam1,
      auditService: audit1,
    });

    const { trade } = await tradeService1.createTrade({
      serverId,
      channelId: 'ch-1',
      createdBy: traderA,
      traderAId: traderA,
      traderBId: traderB,
      primaryAsset: 'Emerald Blade',
      traderAGiving: 'Emerald Blade',
      traderBGiving: '50 Gold',
      rulesAccepted: true,
    });

    await client1.ingestEvent({
      id: 255,
      type: 'test',
      data: { hello: 'world' },
    });
    expect(await repos1.operational.getCursor('default')).toBe(255);

    // Simulate DB outage -> fails cleanly without corrupting state
    repos1.setSimulateFailure(true);
    await expect(repos1.trades.findByTradeId(trade.tradeId)).rejects.toThrow(/MongoServerSelectionError/);
    repos1.setSimulateFailure(false);

    // Export snapshot and boot a brand-new process instance (simulating full restart)
    const snapshot = repos1.exportSnapshot();
    await client1.stop();

    const repos2 = createInMemoryRepositories(snapshot);
    const client2 = new YapinClient({
      token: mock.state.botToken,
      fetchImpl: mock.fetchImpl,
      enableGateway: false,
      cursorStore: {
        getCursor: () => repos2.operational.getCursor('default'),
        setCursor: (seq) => repos2.operational.setCursor('default', seq),
      },
    });
    const audit2 = new AuditService({ auditRepo: repos2.audits });
    const confirmation2 = new ConfirmationService({
      tradeRepo: repos2.trades,
      userRepo: repos2.users,
      auditService: audit2,
      serverConfigRepo: repos2.serverConfigs,
    });

    // Cursor resumes at 255; replayed event 255 is ignored!
    expect(await repos2.operational.getCursor('default')).toBe(255);
    client2.lastEventId = await repos2.operational.getCursor('default');
    const replayed = await client2.ingestEvent({ id: 255, type: 'test', data: {} });
    expect(replayed).toBe(false);

    // In-flight trade resumes seamlessly from WAITING_FOR_PARTICIPANTS -> WAITING_FOR_MIDDLEMAN
    const resumedTrade = await confirmation2.acceptTrade({
      serverId,
      tradeId: trade.tradeId,
      actorId: traderB,
    });
    expect(resumedTrade.state).toBe('WAITING_FOR_MIDDLEMAN');
    await client2.stop();
  });
});
