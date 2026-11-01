import { describe, expect, it } from 'vitest';
import dotenv from 'dotenv';
import { YapinClient } from '../../src/api/YapinClient.js';
import { YapinCommandsApi } from '../../src/api/commands.js';
import { YapinMessagesApi, EmbedBuilder } from '../../src/api/messages.js';
import { YapinChannelsApi } from '../../src/api/channels.js';
import { YapinPermissionsApi } from '../../src/api/permissions.js';

dotenv.config({ quiet: true });

const LIVE_ENABLED =
  String(process.env.YAPIN_LIVE_TEST || '').toLowerCase() === 'true' &&
  Boolean(process.env.YAPIN_BOT_TOKEN) &&
  Boolean(process.env.YAPIN_SERVER_ID) &&
  Boolean(process.env.YAPIN_TEST_CHANNEL_ID);

describe.skipIf(!LIVE_ENABLED)(
  'Live Yapin.gg Integration Suite (Opt-In: requires YAPIN_LIVE_TEST=true & real test server credentials)',
  () => {
    it('authenticates via GET /me, inspects server & roles, sends/edits/deletes a test message, and verifies private channel lock + cleanup', async () => {
      const client = new YapinClient({
        token: process.env.YAPIN_BOT_TOKEN,
        baseUrl: process.env.YAPIN_API_BASE_URL || 'https://www.yapin.gg/api/bot/v1',
        enableGateway: false,
      });

      const serverId = process.env.YAPIN_SERVER_ID;
      const testChannelId = process.env.YAPIN_TEST_CHANNEL_ID;

      try {
        // 1. Verify bot identity
        const { profile, latencyMs } = await client.getMe();
        expect(profile.id).toBeTruthy();
        expect(latencyMs).toBeGreaterThanOrEqual(0);

        // 2. Verify server & roles retrieval
        const permissionsApi = new YapinPermissionsApi(client);
        const server = await permissionsApi.fetchServer(serverId);
        expect(server.id).toBe(serverId);
        const roles = await permissionsApi.fetchServerRoles(serverId);
        expect(Array.isArray(roles)).toBe(true);

        // 3. List registered commands
        const commandsApi = new YapinCommandsApi(client);
        const cmds = await commandsApi.listRegisteredCommands();
        expect(Array.isArray(cmds)).toBe(true);

        // 4. Send, edit, and clean up a real test message in YAPIN_TEST_CHANNEL_ID
        const messagesApi = new YapinMessagesApi(client);
        const sent = await messagesApi.sendMessage(testChannelId, {
          content: '[Integration Test] Yapin Middleman Bot connectivity probe',
          embeds: [new EmbedBuilder().setTitle('Live Probe').setDescription('Automated integration test')],
        });
        expect(sent.id).toBeTruthy();

        await messagesApi.editMessage(testChannelId, sent.id, {
          content: '[Integration Test] Yapin Middleman Bot connectivity probe (edited)',
        });
        await messagesApi.deleteMessage(testChannelId, sent.id);

        // 5. Optional private channel creation & cleanup if bot has Manage Channels + staff role configured
        if (process.env.YAPIN_LIVE_STAFF_ROLE_ID) {
          const channelsApi = new YapinChannelsApi(client);
          const { channel } = await channelsApi.createPrivateChannel({
            serverId,
            name: `mm-live-test-${Date.now().toString(36)}`,
            allowedRoleIds: [process.env.YAPIN_LIVE_STAFF_ROLE_ID],
          });
          expect(channel.id).toBeTruthy();
          await channelsApi.deleteChannel(channel.id);
        }
      } finally {
        await client.stop();
      }
    }, 30_000);
  },
);
