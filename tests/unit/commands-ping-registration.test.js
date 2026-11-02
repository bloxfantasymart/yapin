import { describe, expect, it } from 'vitest';
import { YapinClient } from '../../src/api/YapinClient.js';
import { YapinCommandsApi } from '../../src/api/commands.js';
import { YapinMessagesApi } from '../../src/api/messages.js';
import { YapinPermissionsApi } from '../../src/api/permissions.js';
import { ALL_COMMANDS, createCommandRegistry } from '../../src/commands/index.js';
import { pingCommand } from '../../src/commands/ping.js';
import { connectDatabase, disconnectDatabase } from '../../src/database/connection.js';
import { createInMemoryRepositories } from '../helpers/inMemoryRepositories.js';
import { createMockYapinFetch } from '../helpers/mockYapinServer.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('Stage 1 — MM2 Helper Command Registration & Telemetry Commands', () => {
  it('validates and syncs all 36 MM2 Helper commands via PUT /commands within Yapin limits', async () => {
    const mock = createMockYapinFetch();
    const client = new YapinClient({
      token: mock.state.botToken,
      fetchImpl: mock.fetchImpl,
      enableGateway: false,
    });
    const commandsApi = new YapinCommandsApi(client);
    const registry = createCommandRegistry();

    const defs = registry.toYapinDefinitions();
    expect(defs.length).toBe(ALL_COMMANDS.length);
    expect(defs.length).toBe(36);

    const res = await commandsApi.syncCommands(defs);
    expect(res.registeredCount).toBe(36);

    const listed = await commandsApi.listRegisteredCommands();
    expect(listed.map((c) => c.name)).toContain('verify');
    expect(listed.map((c) => c.name)).toContain('apply');
    expect(listed.map((c) => c.name)).toContain('ticket');
    expect(listed.map((c) => c.name)).toContain('mystery');
    expect(listed.map((c) => c.name)).not.toContain('middleman');

    expect(() =>
      commandsApi.validateDefinitions([{ name: 'bad space!', description: 'invalid' }]),
    ).toThrow(/1-32 characters/i);

    expect(() =>
      commandsApi.validateDefinitions([
        { name: 'ping', description: 'a' },
        { name: 'ping', description: 'b' },
      ]),
    ).toThrow(/Duplicate/i);
  });

  it('executes /ping and reports MM2 Helper Gateway & JSON storage health', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm2-ping-'));
    try {
      await connectDatabase(tmpDir);
      const mock = createMockYapinFetch();
      const client = new YapinClient({
        token: mock.state.botToken,
        fetchImpl: mock.fetchImpl,
        enableGateway: false,
      });
      const messagesApi = new YapinMessagesApi(client);
      const permissionsApi = new YapinPermissionsApi(client);
      const repos = createInMemoryRepositories();

      const event = {
        id: 'msg-user-1',
        channel_id: 'ch-general',
        server_id: mock.defaultServerId,
        author_id: mock.ownerId,
        command: 'ping',
        args: '',
      };

      let sent = null;
      await pingCommand.execute({
        event,
        client,
        messagesApi,
        permissionsApi,
        repositories: repos,
        reply: async (opts) => {
          sent = await messagesApi.sendMessage(event.channel_id, {
            ...opts,
            replyTo: event.id,
          });
          return sent;
        },
      });

      expect(sent.channel_id).toBe('ch-general');
      expect(sent.reply_to_id).toBe('msg-user-1');
      expect(sent.embeds[0].title).toContain('MM2 Helper');
      expect(sent.embeds[0].fields.some((f) => f.name === 'JSON Storage')).toBe(true);
    } finally {
      await disconnectDatabase();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
