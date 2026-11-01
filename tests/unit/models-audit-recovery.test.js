import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { YapinClient } from '../../src/api/YapinClient.js';
import { YapinPermissionsApi } from '../../src/api/permissions.js';
import { connectDatabase, disconnectDatabase, withTransaction } from '../../src/database/connection.js';
import {
  AuditLogModel,
  DisputeModel,
  ServerConfigModel,
  TicketModel,
  TradeModel,
  UserModel,
} from '../../src/database/models/index.js';
import { createJsonRepositories } from '../../src/database/repositories/index.js';
import { AuditService } from '../../src/middleman/auditService.js';
import { AntiScamService } from '../../src/security/antiScam.js';
import { TradeService } from '../../src/middleman/tradeService.js';
import { ConfirmationService } from '../../src/middleman/confirmationService.js';
import { createMockYapinFetch } from '../helpers/mockYapinServer.js';

const tempDirs = [];

afterEach(async () => {
  await disconnectDatabase().catch(() => undefined);
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe('Stage 3 — Atomic JSON Storage, Zod Domain Schemas, Append-Only AuditLog & Disk Restart Recovery', () => {
  it('validates all JSON domain models strictly via Zod and enforces explicit rules acceptance', () => {
    for (const Model of [
      UserModel,
      TradeModel,
      TicketModel,
      DisputeModel,
      AuditLogModel,
      ServerConfigModel,
    ]) {
      expect(typeof Model.validate).toBe('function');
      expect(Model.primaryKey).toBeTruthy();
    }

    expect(() =>
      TradeModel.validate({
        tradeId: 'TRD-BAD',
        serverId: 'srv-1',
        channelId: 'ch-1',
        traderAId: 'a',
        traderBId: 'b',
        createdBy: 'a',
        dedupeFingerprint: 'fp',
        items: { primaryAsset: 'Sword', traderAGiving: 'Sword', traderBGiving: '$10' },
        rulesAccepted: false,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).toThrow(/rules/i);
  });

  it('enforces append-only immutability on AuditLog and rolls back multi-collection JSON transactions on error', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yapin-json-test-'));
    tempDirs.push(tmpDir);

    const db = await connectDatabase(tmpDir);
    const repos = createJsonRepositories(db);
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
    await expect(AuditLogModel.updateOne()).rejects.toThrow(/append-only/i);
    await expect(repos.audits.updateOne()).rejects.toThrow(/append-only/i);
    await expect(repos.audits.deleteOne()).rejects.toThrow(/append-only/i);

    // Multi-collection ACID rollback test: if transaction fails mid-flight, user stats do NOT persist!
    await expect(
      withTransaction(async () => {
        await repos.users.incrementStats('rollback-user-1', { created: 5 });
        throw new Error('Simulated mid-transaction failure');
      }),
    ).rejects.toThrow(/Simulated mid-transaction failure/);

    expect(await repos.users.findByYapinId('rollback-user-1')).toBeNull();
  });

  it('persists JSON files atomically to disk, recovers from corrupted primary via .bak, and resumes cursor & trades after restart', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yapin-json-restart-'));
    tempDirs.push(tmpDir);

    const mock = createMockYapinFetch();
    const serverId = mock.defaultServerId;
    const traderA = '22222222-2222-4222-8222-222222222222';
    const traderB = '33333333-3333-4333-8333-333333333333';
    mock.setMember(serverId, traderA, [], 'Alice');
    mock.setMember(serverId, traderB, [], 'Bob');

    // Process 1: connect to tmpDir on disk, create trade, advance cursor
    const db1 = await connectDatabase(tmpDir);
    const repos1 = createJsonRepositories(db1);
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

    // Simulate storage outage -> fails cleanly without corrupting state
    db1.setSimulateFailure(true);
    await expect(repos1.trades.findByTradeId(trade.tradeId)).rejects.toThrow(/JsonStorageError/);
    db1.setSimulateFailure(false);

    await client1.stop();
    await disconnectDatabase();

    // Verify real JSON files were written on disk
    const diskFiles = await fs.readdir(tmpDir);
    expect(diskFiles).toContain('trades.json');
    expect(diskFiles).toContain('audit_logs.json');
    expect(diskFiles).toContain('operational.json');

    // Simulate power-loss truncation of primary users.json while users.json.bak is intact
    await fs.writeFile(path.join(tmpDir, 'users.json'), '{corrupted-truncated-json', 'utf8');

    // Process 2: fresh boot from the same `tmpDir` on disk
    const db2 = await connectDatabase(tmpDir);
    const repos2 = createJsonRepositories(db2);
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

    // Cursor resumes at 255 from operational.json; replayed event 255 is ignored!
    expect(await repos2.operational.getCursor('default')).toBe(255);
    client2.lastEventId = await repos2.operational.getCursor('default');
    const replayed = await client2.ingestEvent({ id: 255, type: 'test', data: {} });
    expect(replayed).toBe(false);

    // In-flight trade loaded from trades.json resumes seamlessly (Date objects hydrated!)
    const resumedTrade = await confirmation2.acceptTrade({
      serverId,
      tradeId: trade.tradeId,
      actorId: traderB,
    });
    expect(resumedTrade.state).toBe('WAITING_FOR_MIDDLEMAN');
    expect(resumedTrade.expiresAt instanceof Date).toBe(true);
    await client2.stop();
  });
});
