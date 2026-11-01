import { describe, expect, it } from 'vitest';
import { YapinClient } from '../../src/api/YapinClient.js';
import { YapinPermissionsApi } from '../../src/api/permissions.js';
import { createInMemoryRepositories } from '../helpers/inMemoryRepositories.js';
import { createMockYapinFetch } from '../helpers/mockYapinServer.js';

describe('Yapin role permission parsing and fail-closed RBAC', () => {
  it('normalizes documented nested and flattened perms.* flags and role object IDs', async () => {
    const mock = createMockYapinFetch();
    const serverId = mock.defaultServerId;
    const nestedUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const flatUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    mock.state.roles.set(serverId, [
      { id: 'nested-mod', perms: { 'perms.manage_messages': true } },
      { id: 'flat-admin', 'perms.manage_server': true },
      { id: 'false-flag', perms: { manage_server: false, manage_messages: 'false' } },
    ]);
    mock.setMember(serverId, nestedUserId, [{ role_id: 'nested-mod' }], 'CaseReader');
    mock.setMember(serverId, flatUserId, ['flat-admin'], 'ChiefSheriff');

    const client = new YapinClient({ token: mock.state.botToken, fetchImpl: mock.fetchImpl, enableGateway: false });
    const permissions = new YapinPermissionsApi(client, { cacheTtlMs: 0 });
    const nested = await permissions.resolveMemberAccess(serverId, nestedUserId);
    const flat = await permissions.resolveMemberAccess(serverId, flatUserId);

    expect(nested.roleIds).toEqual(['nested-mod']);
    expect(nested.platformPermissions.has('managemessages')).toBe(true);
    expect(nested.roles.isModerator).toBe(true);
    expect(nested.roles.isAdmin).toBe(false);
    expect(flat.platformPermissions.has('manageserver')).toBe(true);
    expect(flat.roles.isAdmin).toBe(true);
  });

  it('does not grant authority from false flags or missing membership and rejects unknown tiers', async () => {
    const mock = createMockYapinFetch();
    const serverId = mock.defaultServerId;
    const userId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    mock.state.roles.set(serverId, [{ id: 'false-flag', perms: { manage_server: false, manage_messages: 'false' } }]);
    mock.setMember(serverId, userId, ['false-flag'], 'UnprivilegedCitizen');

    const client = new YapinClient({ token: mock.state.botToken, fetchImpl: mock.fetchImpl, enableGateway: false });
    const permissions = new YapinPermissionsApi(client, { cacheTtlMs: 0 });
    const access = await permissions.resolveMemberAccess(serverId, userId);
    expect(access.roles.isStaff).toBe(false);
    expect(access.platformPermissions.size).toBe(0);

    const absent = await permissions.resolveMemberAccess(serverId, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    expect(absent.isMember).toBe(false);
    expect(absent.roles.isStaff).toBe(false);
    await expect(
      permissions.assertAuthorized({ serverId, userId, requiredRole: 'superadmin' }),
    ).rejects.toThrow(/Insufficient MurderMystery2 staff clearance/);
  });

  it('allows explicitly configured staff roles but never trusts a username or display name', async () => {
    const mock = createMockYapinFetch();
    const serverId = mock.defaultServerId;
    const userId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    mock.setMember(serverId, userId, ['configured-support'], 'SheriffAdmin');
    const client = new YapinClient({ token: mock.state.botToken, fetchImpl: mock.fetchImpl, enableGateway: false });
    const permissions = new YapinPermissionsApi(client, { cacheTtlMs: 0 });
    const repos = createInMemoryRepositories();
    const cfg = await repos.serverConfigs.getOrCreate(serverId);
    cfg.staffRoles.supportRoleIds = ['configured-support'];

    const access = await permissions.resolveMemberAccess(serverId, userId, cfg);
    expect(access.roles.isSupport).toBe(true);
    expect(access.tier).toBe(10);
    expect(access.member.user.username).toBe('SheriffAdmin');
  });
});
