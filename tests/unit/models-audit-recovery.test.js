import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { YapinClient } from '../../src/api/YapinClient.js';
import { connectDatabase, disconnectDatabase, withTransaction } from '../../src/database/connection.js';
import {
  AuditLogModel,
  ModApplicationModel,
  ModCaseModel,
  ReportModel,
  ServerConfigModel,
  TicketModel,
  UserModel,
} from '../../src/database/models/index.js';
import { createJsonRepositories } from '../../src/database/repositories/index.js';
import { LogService } from '../../src/systems/logService.js';
import { createMockYapinFetch } from '../helpers/mockYapinServer.js';

const tempDirs = [];

afterEach(async () => {
  await disconnectDatabase().catch(() => undefined);
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe('Stage 3 — MM2 Helper Atomic JSON Storage, Zod Schemas, Append-Only AuditLog & Crash Recovery', () => {
  it('validates all MM2 Helper JSON domain models strictly via Zod', () => {
    for (const Model of [
      UserModel,
      ModCaseModel,
      ModApplicationModel,
      TicketModel,
      ReportModel,
      AuditLogModel,
      ServerConfigModel,
    ]) {
      expect(typeof Model.validate).toBe('function');
      expect(Model.primaryKey).toBeTruthy();
    }

    const cfg = ServerConfigModel.validate({ serverId: 'srv-mm2' });
    expect(cfg.applications.open).toBe(true);
    expect(cfg.autoMod.enabled).toBe(true);
  });

  it('enforces append-only immutability on AuditLog, redacts secrets, and rolls back ACID JSON transactions on error', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm2-json-acid-'));
    tempDirs.push(tmpDir);

    const db = await connectDatabase(tmpDir);
    const repos = createJsonRepositories(db);
    const logService = new LogService({
      auditRepo: repos.audits,
      serverConfigRepo: repos.serverConfigs,
    });

    const created = await logService.record({
      serverId: 'srv-mm2',
      actorId: 'user-1',
      actorType: 'USER',
      action: 'TEST_ACTION',
      targetType: 'SYSTEM',
      targetId: 'srv-mm2',
      metadata: {
        botToken: 'yb_should_be_redacted_12345',
        safeField: 'mansion_clue',
      },
    });

    expect(created.metadata.botToken).toBe('[REDACTED]');
    expect(created.metadata.safeField).toBe('mansion_clue');
    await expect(AuditLogModel.updateOne()).rejects.toThrow(/append-only/i);
    await expect(repos.audits.updateOne()).rejects.toThrow(/append-only/i);
    await expect(repos.audits.deleteOne()).rejects.toThrow(/append-only/i);

    await expect(
      withTransaction(async () => {
        await repos.users.getOrCreate('rollback-citizen-1', 'Ghost');
        throw new Error('Simulated mid-transaction failure');
      }),
    ).rejects.toThrow(/Simulated mid-transaction failure/);

    expect(await repos.users.findByYapinId('rollback-citizen-1')).toBeNull();
  });

  it('persists JSON files atomically to disk, recovers from corrupted primary via .bak, and resumes cursor & cases after restart', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm2-json-restart-'));
    tempDirs.push(tmpDir);

    const mock = createMockYapinFetch();
    const serverId = mock.defaultServerId;

    const db1 = await connectDatabase(tmpDir);
    const repos1 = createJsonRepositories(db1);
    await repos1.operational.setCursor('default', 300);

    const caseNo1 = await repos1.cases.nextCaseNumber(serverId);
    expect(caseNo1).toBe(1);
    const createdCase = await repos1.cases.create({
      caseId: 'CASE-REST01',
      caseNumber: caseNo1,
      serverId,
      action: 'WARN',
      targetUserId: 'citizen-99',
      moderatorId: mock.ownerId,
      reason: 'RDM in The Mansion',
      active: true,
    });
    await repos1.users.updateUser('citizen-99', (d) => {
      d.verification.verified = true;
    });

    const client1 = new YapinClient({
      token: mock.state.botToken,
      fetchImpl: mock.fetchImpl,
      enableGateway: false,
      cursorStore: {
        getCursor: () => repos1.operational.getCursor('default'),
        setCursor: (seq) => repos1.operational.setCursor('default', seq),
      },
    });
    await client1.ingestEvent({ id: 312, type: 'test', data: { map: 'Mansion' } });

    db1.setSimulateFailure(true);
    await expect(repos1.cases.findByCaseId(createdCase.caseId)).rejects.toThrow(/JsonStorageError/);
    db1.setSimulateFailure(false);

    await client1.stop();
    await disconnectDatabase();

    const diskFiles = await fs.readdir(tmpDir);
    expect(diskFiles).toContain('cases.json');
    expect(diskFiles).toContain('operational.json');

    // Update citizen-99 once more in a short boot so users.json.bak has the verified citizen, then corrupt users.json!
    const dbMid = await connectDatabase(tmpDir);
    const reposMid = createJsonRepositories(dbMid);
    await reposMid.users.updateUser('citizen-99', (d) => {
      d.leveling.totalXp = 500;
    });
    await disconnectDatabase();

    await fs.writeFile(path.join(tmpDir, 'users.json'), '{truncated-power-loss', 'utf8');

    // Fresh boot recovers users.json from users.json.bak and preserves monotonic case counter + cursor!
    const db2 = await connectDatabase(tmpDir);
    const repos2 = createJsonRepositories(db2);
    expect(await repos2.operational.getCursor('default')).toBe(312);
    expect(await repos2.cases.nextCaseNumber(serverId)).toBe(2);
    const recoveredUser = await repos2.users.findByYapinId('citizen-99');
    expect(recoveredUser.verification.verified).toBe(true);
  });
});
