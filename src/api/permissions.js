import { YAPIN_PERMISSIONS } from '../config/settings.js';
import { AuthorizationError } from '../utils/errors.js';

const normalizePermissionName = (name) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/^perms[._:]/, '')
    .replace(/[^a-z]/g, '');

const normalizeRoleId = (role) => {
  if (typeof role === 'string' || typeof role === 'number') return String(role);
  if (!role || typeof role !== 'object') return '';
  const id = role.id ?? role.role_id ?? role.roleId;
  return id === undefined || id === null ? '' : String(id);
};

const addPermissionFlags = (permissions, source) => {
  if (Array.isArray(source)) {
    for (const entry of source) {
      const name = typeof entry === 'string' ? entry : entry?.name ?? entry?.key;
      const enabled = typeof entry === 'object' ? entry.enabled ?? entry.value ?? true : true;
      if (enabled && name) permissions.add(normalizePermissionName(name));
    }
    return;
  }
  if (!source || typeof source !== 'object') return;
  for (const [name, enabled] of Object.entries(source)) {
    if (enabled === true || enabled === 1 || enabled === 'true') {
      permissions.add(normalizePermissionName(name));
    }
  }
};

export const STAFF_TIERS = Object.freeze({
  USER: 0,
  SUPPORT: 10,
  TRIAL_MOD: 20,
  MODERATOR: 30,
  ADMIN: 40,
  OWNER: 50,
});

/**
 * Verified Yapin Permissions, Role Management & Server-Side Identity Verifier for **MM2 Helper**.
 * Source: https://www.yapin.gg/developers#permissions
 *
 * Security invariants:
 * 1. NEVER trusts display names, usernames, nicknames, or message text claims.
 * 2. Resolves real server owner (`server.owner_id`), server roles (`GET /servers/:id/roles`),
 *    and member role assignments (`GET /servers/:id/members/:uid`) directly from Yapin's API.
 * 3. Supports verified Yapin role assignment (`PUT / DELETE /servers/:id/members/:uid/roles/:rid`)
 *    for Verification, Level Ranks, member notification roles, Mutes, and Trial Mod promotions.
 */
export class YapinPermissionsApi {
  /**
   * @param {import('./YapinClient.js').YapinClient} client
   * @param {{ cacheTtlMs?: number }} [options]
   */
  constructor(client, options = {}) {
    this.client = client;
    this.cacheTtlMs = options.cacheTtlMs ?? 15_000;
    this._serverCache = new Map();
    this._rolesCache = new Map();
    this._memberCache = new Map();
  }

  clearCache() {
    this._serverCache.clear();
    this._rolesCache.clear();
    this._memberCache.clear();
  }

  invalidateMember(serverId, userId) {
    this._memberCache.delete(`${serverId}:${userId}`);
  }

  async fetchServer(serverId, { forceRefresh = false } = {}) {
    const cached = this._serverCache.get(serverId);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const out = await this.client.request('GET', `/servers/${encodeURIComponent(serverId)}`);
    const server = out.server || out;
    this._serverCache.set(serverId, { value: server, expiresAt: Date.now() + this.cacheTtlMs });
    return server;
  }

  async fetchServerRoles(serverId, { forceRefresh = false } = {}) {
    const cached = this._rolesCache.get(serverId);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const out = await this.client.request('GET', `/servers/${encodeURIComponent(serverId)}/roles`);
    const roles = Array.isArray(out.roles) ? out.roles : [];
    this._rolesCache.set(serverId, { value: roles, expiresAt: Date.now() + this.cacheTtlMs });
    return roles;
  }

  async fetchServerMember(serverId, userId, { forceRefresh = false } = {}) {
    const key = `${serverId}:${userId}`;
    const cached = this._memberCache.get(key);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    try {
      const out = await this.client.request(
        'GET',
        `/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}`,
      );
      const member = out.member || out;
      this._memberCache.set(key, { value: member, expiresAt: Date.now() + this.cacheTtlMs });
      return member;
    } catch (err) {
      if (err?.status === 404) return null;
      throw err;
    }
  }

  async fetchPublicUser(userId) {
    try {
      const out = await this.client.request('GET', `/users/${encodeURIComponent(userId)}`);
      return out.user || out;
    } catch (err) {
      if (err?.status === 404) return null;
      throw err;
    }
  }

  /**
   * Assigns a role to a member (`PUT /servers/:id/members/:uid/roles/:rid`).
   */
  async addMemberRole(serverId, userId, roleId) {
    if (!roleId) return false;
    await this.client.request(
      'PUT',
      `/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`,
    );
    this.invalidateMember(serverId, userId);
    return true;
  }

  /**
   * Removes a role from a member (`DELETE /servers/:id/members/:uid/roles/:rid`).
   */
  async removeMemberRole(serverId, userId, roleId) {
    if (!roleId) return false;
    await this.client.request(
      'DELETE',
      `/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`,
    );
    this.invalidateMember(serverId, userId);
    return true;
  }

  /**
   * Computes a member's verified Yapin platform permissions and configured MurderMystery2 staff tier.
   */
  async resolveMemberAccess(serverId, userId, serverConfig = null, options = {}) {
    const [server, allRoles, member] = await Promise.all([
      this.fetchServer(serverId, options),
      this.fetchServerRoles(serverId, options),
      this.fetchServerMember(serverId, userId, options),
    ]);

    const isOwner = Boolean(server?.owner_id && String(server.owner_id) === String(userId));

    if (!member && !isOwner) {
      return {
        isMember: false,
        isOwner: false,
        userId: String(userId),
        roleIds: [],
        platformPermissions: new Set(),
        tier: STAFF_TIERS.USER,
        roles: {
          isOwner: false,
          isAdmin: false,
          isModerator: false,
          isTrialMod: false,
          isSupport: false,
          isStaff: false,
        },
        member: null,
      };
    }

    const rawRoles = Array.isArray(member?.roles) ? member.roles : [];
    const roleIds = rawRoles.map(normalizeRoleId).filter(Boolean);
    const roleIdSet = new Set(roleIds);

    const platformPermissions = new Set();
    if (isOwner) {
      for (const flag of Object.values(YAPIN_PERMISSIONS)) {
        platformPermissions.add(normalizePermissionName(flag));
      }
    } else {
      for (const role of allRoles) {
        if (!role || !roleIdSet.has(normalizeRoleId(role))) continue;
        if (role.manage_server === true || role.manageServer === true) {
          platformPermissions.add(normalizePermissionName(YAPIN_PERMISSIONS.MANAGE_SERVER));
        }
        if (role.manage_messages === true || role.manageMessages === true) {
          platformPermissions.add(normalizePermissionName(YAPIN_PERMISSIONS.MANAGE_MESSAGES));
        }
        // Yapin's documented role response exposes both direct flags and `perms.*` flags.
        // Accept its nested-object and flattened-key shapes without treating false as granted.
        addPermissionFlags(platformPermissions, role.perms);
        addPermissionFlags(platformPermissions, role.permissions);
        for (const [key, value] of Object.entries(role)) {
          if (key.startsWith('perms.') || key.startsWith('perms_')) {
            addPermissionFlags(platformPermissions, { [key]: value });
          }
        }
      }
    }

    const cfgStaff = serverConfig?.staffRoles || {};
    const hasAnyRole = (configuredIds = []) =>
      Array.isArray(configuredIds) && configuredIds.some((id) => roleIdSet.has(String(id)));

    const hasManageServer = platformPermissions.has(
      normalizePermissionName(YAPIN_PERMISSIONS.MANAGE_SERVER),
    );
    const hasManageMessages = platformPermissions.has(
      normalizePermissionName(YAPIN_PERMISSIONS.MANAGE_MESSAGES),
    );

    const isAdmin = isOwner || hasManageServer || hasAnyRole(cfgStaff.adminRoleIds);
    const isModerator = isAdmin || hasManageMessages || hasAnyRole(cfgStaff.moderatorRoleIds);
    const isTrialMod = isModerator || hasAnyRole(cfgStaff.trialModRoleIds);
    const isSupport = isTrialMod || hasAnyRole(cfgStaff.supportRoleIds);
    const isStaff = isAdmin || isModerator || isTrialMod || isSupport;

    let tier = STAFF_TIERS.USER;
    if (isOwner) tier = STAFF_TIERS.OWNER;
    else if (isAdmin) tier = STAFF_TIERS.ADMIN;
    else if (isModerator) tier = STAFF_TIERS.MODERATOR;
    else if (isTrialMod) tier = STAFF_TIERS.TRIAL_MOD;
    else if (isSupport) tier = STAFF_TIERS.SUPPORT;

    return {
      isMember: true,
      isOwner,
      userId: String(userId),
      roleIds,
      platformPermissions,
      tier,
      roles: {
        isOwner,
        isAdmin,
        isModerator,
        isTrialMod,
        isSupport,
        isStaff,
      },
      member,
    };
  }

  /**
   * Asserts that a user satisfies a required staff role/tier on MurderMystery2.
   *
   * @param {{
   *   serverId: string,
   *   userId: string,
   *   serverConfig?: object | null,
   *   requiredRole: 'staff' | 'support' | 'trialmod' | 'moderator' | 'admin' | 'owner',
   *   forceRefresh?: boolean,
   * }} check
   */
  async assertAuthorized({
    serverId,
    userId,
    serverConfig = null,
    requiredRole,
    forceRefresh = true,
  }) {
    const access = await this.resolveMemberAccess(serverId, userId, serverConfig, { forceRefresh });
    if (!access.isMember) {
      throw new AuthorizationError('User is not a verified member of MurderMystery2.');
    }

    const ok =
      (requiredRole === 'owner' && access.roles.isOwner) ||
      (requiredRole === 'admin' && access.roles.isAdmin) ||
      (requiredRole === 'moderator' && access.roles.isModerator) ||
      (requiredRole === 'trialmod' && access.roles.isTrialMod) ||
      (requiredRole === 'support' && access.roles.isSupport) ||
      (requiredRole === 'staff' && access.roles.isStaff);

    if (!ok) {
      throw new AuthorizationError(
        `Insufficient MurderMystery2 staff clearance. Required tier: ${requiredRole}.`,
        { userId, requiredRole },
      );
    }

    return access;
  }

  async getBotRoleIds(serverId) {
    const botId = this.client.me?.id || this.client.me?.bot?.id;
    if (!botId) return [];
    const botMember = await this.fetchServerMember(serverId, botId);
    if (!botMember || !Array.isArray(botMember.roles)) return [];
    return botMember.roles.map((r) => (typeof r === 'object' ? String(r.id) : String(r)));
  }
}
