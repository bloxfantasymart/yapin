import { describe, expect, it } from 'vitest';
import { createMessageCreateListener } from '../../src/events/messageCreate.js';
import { CommandHandler } from '../../src/handlers/commandHandler.js';
import { parsePrefixedCommand } from '../../src/utils/commandPrefix.js';
import { logger } from '../../src/utils/logger.js';

describe('MM2 Helper dollar-prefix commands', () => {
  it('parses the configured prefix and preserves multiword arguments', () => {
    expect(parsePrefixedCommand('$rules')).toEqual({ command: 'rules', args: '' });
    expect(parsePrefixedCommand('  $ ticket open GENERAL_SUPPORT “Need help”  ')).toEqual({
      command: 'ticket',
      args: 'open GENERAL_SUPPORT “Need help”',
    });
    expect(parsePrefixedCommand('hello $rules')).toBeNull();
    expect(parsePrefixedCommand('/rules')).toBeNull();
  });

  it('routes ordinary Yapin messages through the command handler before Auto-Mod', async () => {
    const seen = [];
    const listener = createMessageCreateListener({
      commandHandler: {
        async handleMessage(event) {
          seen.push(event);
          return true;
        },
      },
      services: { autoMod: { async inspectMessage() { throw new Error('must not inspect a handled command'); } } },
    });
    const event = { id: 'message-route', content: '$rules', author_id: 'user-1', author_bot: false };

    expect(await listener(event)).toBe(true);
    expect(seen).toEqual([event]);
  });

  it('executes `$command args` from ordinary Yapin message events', async () => {
    const sent = [];
    const invoked = [];
    const registry = {
      get(name) {
        if (name !== 'echo') return null;
        return {
          name: 'echo',
          staffOnly: false,
          async execute(ctx) {
            invoked.push({ command: ctx.event.command, args: ctx.event.args });
            await ctx.reply({ content: `executed:${ctx.event.args}` });
          },
        };
      },
    };
    const handler = new CommandHandler({
      client: { me: { id: 'bot-id' } },
      commandRegistry: registry,
      messagesApi: {
        async sendMessage(channelId, payload) {
          sent.push({ channelId, payload });
        },
      },
      channelsApi: {},
      permissionsApi: {},
      repositories: {
        serverConfigs: { async getOrCreate() { return { cooldowns: {} }; } },
        users: { async getOrCreate() {} },
      },
      services: {},
      cooldowns: null,
      logger,
    });

    const handled = await handler.handleMessage({
      id: 'message-1',
      content: '$echo hello from Yapin',
      server_id: 'server-1',
      channel_id: 'channel-1',
      author_id: 'user-1',
      username: 'Member',
      author_bot: false,
    });

    expect(handled).toBe(true);
    expect(invoked).toEqual([{ command: 'echo', args: 'hello from Yapin' }]);
    expect(sent[0]).toEqual({
      channelId: 'channel-1',
      payload: { content: 'executed:hello from Yapin', replyTo: 'message-1' },
    });

    expect(await handler.handleMessage({
      id: 'message-other-bot',
      content: '$echo must not run',
      server_id: 'server-1',
      channel_id: 'channel-1',
      author_id: 'user-1',
      command_for: ['another-bot'],
      author_bot: false,
    })).toBe(false);
    expect(invoked).toHaveLength(1);
  });

  it('replies with help for unknown prefixed commands, while ignoring ordinary chat', async () => {
    const sent = [];
    const handler = new CommandHandler({
      client: {},
      commandRegistry: { get: () => null },
      messagesApi: { async sendMessage(channelId, payload) { sent.push({ channelId, payload }); } },
      channelsApi: {},
      permissionsApi: {},
      repositories: {},
      services: {},
      cooldowns: null,
      logger,
    });

    expect(await handler.handleMessage({
      id: 'message-2', content: 'Hello there', server_id: 'server-1', channel_id: 'channel-1', author_id: 'user-1',
    })).toBe(false);
    expect(await handler.handleMessage({
      id: 'message-3', content: '$notacommand', server_id: 'server-1', channel_id: 'channel-1', author_id: 'user-1',
    })).toBe(true);
    expect(sent[0].payload.content).toContain('Unknown command: **$notacommand**');
    expect(sent[0].payload.content).toContain('**$help**');
  });
});
