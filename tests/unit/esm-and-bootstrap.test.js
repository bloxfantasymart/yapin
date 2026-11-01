import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { startApplication } from '../../src/index.js';
import { createMockYapinFetch } from '../helpers/mockYapinServer.js';

const execFileAsync = promisify(execFile);

describe('Native Node ESM Module Graph & MM2 Helper Production Bootstrap Verification', () => {
  it('loads all modules in src/ cleanly via native Node.js ESM loader with zero missing exports', async () => {
    const checkScript = `
      import fs from "node:fs";
      import path from "node:path";
      import { pathToFileURL } from "node:url";

      function walk(dir) {
        let out = [];
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, ent.name);
          if (ent.isDirectory()) out.push(...walk(p));
          else if (ent.name.endsWith(".js")) out.push(p);
        }
        return out;
      }

      for (const f of walk("./src")) {
        await import(pathToFileURL(path.resolve(f)).href);
      }
    `;
    const { stderr } = await execFileAsync(
      process.execPath,
      ['--input-type=module', '-e', checkScript],
      { cwd: process.cwd() },
    );
    expect(stderr).toBe('');
  });

  it('boots startApplication() end-to-end with local JSON storage, syncs 36 MM2 Helper commands, and shuts down cleanly', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm2-boot-test-'));
    const mock = createMockYapinFetch();

    try {
      const app = await startApplication(
        {
          YAPIN_BOT_TOKEN: mock.state.botToken,
          YAPIN_SERVER_ID: mock.defaultServerId,
          DATA_DIR: tmpDir,
          YAPIN_ENABLE_GATEWAY: 'false',
          LOG_LEVEL: 'silent',
        },
        {
          fetchImpl: mock.fetchImpl,
          exitOnError: false,
        },
      );

      expect(mock.state.commands.length).toBe(36);
      const files = await fs.readdir(tmpDir);
      expect(files).toContain('server_configs.json');

      await app.shutdown('SIGTERM');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
