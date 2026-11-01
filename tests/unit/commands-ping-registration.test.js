import { describe, expect, it } from 'vitest';
import { YapinClient } from '../../src/api/YapinClient.js';
import { YapinCommandsApi } from '../../src/api/commands.js';
import { YapinMessagesApi } from '../../src/api/messages.js';
import pingCommand from '../../src/commands/ping.js';
import { createMockYapinFetch } from '../helpers/mockYapinServer.js';

describe('Stage 1 — Command Registration & Verified /ping Command', () => {
  it('validates and registers commands via PUT /commands and rejects unsupported names or duplicates', async () => {
    const mock = createMockYapinFetch();
    const client = new YapinClient({
      token: mock.state.botToken,
      fetchImpl: mock.fetchImpl,
      enableGateway: false,
    });
    const commandsApi = new YapinCommandsApi(client);

    const res = await commandsApi.syncCommands([
      { name: pingCommand.name, description: pingCommand.description },
      { name: 'middleman', description: 'Create a middleman trade request' },
    ]);

    expect(res.registeredCount).toBe(2);
    const listed = await commandsApi.listRegisteredCommands();
    expect(listed.map((c) => c.name)).toEqual(['ping', 'middleman']);

    // Rejects invalid characters (spaces / uppercase / symbols)
    expect(() =>
      commandsApi.validateDefinitions([{ name: 'bad space!', description: 'invalid' }]),
    ).toThrow(/1-32 characters/i);

    // Rejects duplicate command names
    expect(() =>
      commandsApi.validateDefinitions([
        { name: 'ping', description: 'a' },
        { name: 'ping', description: 'b' },
      ]),
    ).toThrow(/Duplicate/i);
  });

  it('executes /ping using real GET /me round-trip and replies with reply_to quoting', async () => {
    const mock = createMockYapinFetch();
    const client = new YapinClient({
      token: mock.state.botToken,
      fetchImpl: mock.fetchImpl,
      enableGateway: false,
    });
    const messagesApi = new YapinMessagesApi(client);

    const incomingMessage = {
      id: 'msg-user-1',
      channel_id: 'ch-general',
      server_id: mock.defaultServerId,
      author_id: mock.ownerId,
      command: 'ping',
      args: '',
    };

    const sent = await pingCommand.execute({
      client,
      messagesApi,
      message: incomingMessage,
      serverId: incomingMessage.server_id,
      channelId: incomingMessage.channel_id,
      authorId: incomingMessage.author_id,
      correlationId: 'cor_test_ping_1',
      reply: (payload) => messagesApi.replyToMessage(incomingMessage, payload),
    });

    expect(sent.channel_id).toBe('ch-general');
    expect(sent.reply_to_id).toBe('msg-user-1');
    expect(sent.embeds).toHaveLength(1);
    expect(sent.embeds[0].title).toContain('Pong');
    expect(sent.embeds[0].fields.some((f) => f.name === 'REST Latency')).toBe(true);
  });
});
