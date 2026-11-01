import { describe, expect, it } from 'vitest';
import { YapinClient } from '../../src/api/YapinClient.js';
import { YapinChannelsApi } from '../../src/api/channels.js';
import { YapinMessagesApi } from '../../src/api/messages.js';
import { YapinPermissionsApi } from '../../src/api/permissions.js';
import { createInMemoryRepositories } from '../helpers/inMemoryRepositories.js';
import { createMockYapinFetch } from '../helpers/mockYapinServer.js';
import { createApplicationServices } from '../../src/systems/createServices.js';
import { logger } from '../../src/utils/logger.js';

async function setup(fetchImpl = null) {
  const mock = createMockYapinFetch();
  const serverId = mock.defaultServerId;
  const userId = 'abababab-abab-4bab-8bab-abababababab';
  mock.setMember(serverId, userId, ['role-unverified'], 'NewCitizen');
  const client = new YapinClient({
    token: mock.state.botToken,
    fetchImpl: fetchImpl || mock.fetchImpl,
    enableGateway: false,
  });
  const repos = createInMemoryRepositories();
  await repos.serverConfigs.updateConfig(serverId, {
    'verification.mode': 'instant',
    'roles.unverifiedRoleId': 'role-unverified',
  });
  const permissionsApi = new YapinPermissionsApi(client, { cacheTtlMs: 0 });
  const messagesApi = new YapinMessagesApi(client);
  const channelsApi = new YapinChannelsApi(client);
  const { services } = createApplicationServices({
    repositories: repos,
    permissionsApi,
    channelsApi,
    messagesApi,
    logger,
  });
  return { mock, serverId, userId, repos, services };
}

describe('Sheriff Checkpoint role assignment is fail-closed', () => {
  it('refuses to mark a member verified when no Verified Citizen role is configured', async () => {
    const ctx = await setup();
    await expect(ctx.services.verification.verifyMember({
      serverId: ctx.serverId,
      userId: ctx.userId,
    })).rejects.toThrow(/must set the Verified Citizen role/i);

    const saved = await ctx.repos.users.findByYapinId(ctx.userId);
    expect(saved.verification.verified).toBe(false);
    expect(ctx.mock.state.members.get(`${ctx.serverId}:${ctx.userId}`).roles).not.toContain('role-verified');
  });

  it('does not save clearance or announce success when Yapin denies role assignment', async () => {
    const mock = createMockYapinFetch();
    const serverId = mock.defaultServerId;
    const userId = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
    mock.setMember(serverId, userId, ['role-unverified'], 'NewCitizen');
    const deniedFetch = async (url, init) => {
      if (String(url).includes('/roles/role-verified') && init.method === 'PUT') {
        return new Response(JSON.stringify({ error: 'missing permission' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }
      return mock.fetchImpl(url, init);
    };
    const client = new YapinClient({ token: mock.state.botToken, fetchImpl: deniedFetch, enableGateway: false });
    const repos = createInMemoryRepositories();
    await repos.serverConfigs.updateConfig(serverId, {
      'verification.mode': 'instant',
      'roles.verifiedRoleId': 'role-verified',
      'roles.unverifiedRoleId': 'role-unverified',
    });
    const permissionsApi = new YapinPermissionsApi(client, { cacheTtlMs: 0 });
    const messagesApi = new YapinMessagesApi(client);
    const channelsApi = new YapinChannelsApi(client);
    const { services } = createApplicationServices({ repositories: repos, permissionsApi, channelsApi, messagesApi, logger });

    await expect(services.verification.verifyMember({ serverId, userId })).rejects.toThrow(/clearance was not recorded/i);
    expect((await repos.users.findByYapinId(userId)).verification.verified).toBe(false);
    expect(mock.state.members.get(`${serverId}:${userId}`).roles).not.toContain('role-verified');
  });
});
