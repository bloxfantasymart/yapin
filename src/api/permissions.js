import { YAPIN_PERMISSIONS } from '../config/settings.js';
import { AuthorizationError } from '../utils/errors.js';

const normalizePermissionName = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

export const STAFF_TIERS = Object.freeze({
  USER: 0,
  SUPPORT: 10,
  MIDDLEMAN: 20,
  MODERATOR: 30,
  ADMIN: 40,
  OWNER: 50,
});

/**
 * Verified Yapin Permissions & Server-Side Identity Verifier.
 * Source: https://www.yapin.gg/developers#permissions & structures/Permissions.js
 *
 * Security invariants:
 * 1. NEVER trusts display names, usernames, nicknames, or message text claims.
 * 2. Resolves real server owner (`server.owner_id`), server roles (`GET /servers/:id/roles`),
 *    and member role assignments (`GET /servers/:id/members/:uid`) directly from Yapin's API.
 * 3. Evaluates both Yapin platform permissions (`manage_server`, `manage_messages`, `manage_channels`, etc.)
 *    and server-configured RBAC role IDs (`adminRoleIds`, `middlemanRoleIds`, `moderatorRoleIds`, `supportRoleIds`).
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
   * Computes a member's verified Yapin platform permissions and configured staff tier.
   *
   * @param {string} serverId
   * @param {string} userId
   * @param {object | null} [serverConfig]
   * @param {{ forceRefresh?: boolean }} [options]
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
          isMiddleman: false,
          isModerator: false,
          isSupport: false,
          isStaff: false,
        },
        member: null,
      };
    }

    const rawRoles = Array.isArray(member?.roles) ? member.roles : [];
    const roleIds = rawRoles.map((r) => (typeof r === 'object' && r !== null ? String(r.id) : String(r)));
    const roleIdSet = new Set(roleIds);

    const platformPermissions = new Set();
    if (isOwner) {
      for (const flag of Object.values(YAPIN_PERMISSIONS)) {
        platformPermissions.add(normalizePermissionName(flag));
      }
    } else {
      for (const role of allRoles) {
        if (!roleIdSet.has(String(role.id))) continue;
        if (role.manage_server || role.manageServer) {
          platformPermissions.add(normalizePermissionName(YAPIN_PERMISSIONS.MANAGE_SERVER));
        }
        if (role.manage_messages || role.manageMessages) {
          platformPermissions.add(normalizePermissionName(YAPIN_PERMISSIONS.MANAGE_MESSAGES));
        }
        const permsObj = role.perms || role.permissions || {};
        for (const [k, v] of Object.entries(permsObj)) {
          if (v) platformPermissions.add(normalizePermissionName(k));
        }
      }
    }

    const cfgStaff = serverConfig?.staffRoles || {};
    const hasAnyRole = (configuredIds = []) =>
      Array.isArray(configuredIds) && configuredIds.some((id) => roleIdSet.has(String(id)));

    const hasManageServer = platformPermissions.has(
      normalizePermissionName(YAPIN_PERMISSIONS.MANAGE_SERVER),
    );

    const isAdmin = isOwner || hasManageServer || hasAnyRole(cfgStaff.adminRoleIds);
    const isModerator = isAdmin || hasAnyRole(cfgStaff.moderatorRoleIds);
    const isMiddleman = isAdmin || hasAnyRole(cfgStaff.middlemanRoleIds);
    const isSupport = isModerator || isMiddleman || hasAnyRole(cfgStaff.supportRoleIds);
    const isStaff = isAdmin || isModerator || isMiddleman || isSupport;

    let tier = STAFF_TIERS.USER;
    if (isOwner) tier = STAFF_TIERS.OWNER;
    else if (isAdmin) tier = STAFF_TIERS.ADMIN;
    else if (isModerator) tier = STAFF_TIERS.MODERATOR;
    else if (isMiddleman) tier = STAFF_TIERS.MIDDLEMAN;
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
        isMiddleman,
        isModerator,
        isSupport,
        isStaff,
      },
      member,
    };
  }

  /**
   * Asserts that a user satisfies a required staff role/tier on the server.
   * Uses `forceRefresh: true` by default for privileged staff actions so revoked roles take effect immediately.
   *
   * @param {{
   *   serverId: string,
   *   userId: string,
   *   serverConfig?: object | null,
   *   requiredRole: 'staff' | 'support' | 'middleman' | 'moderator' | 'admin' | 'owner',
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
      throw new AuthorizationError('User is not a verified member of this Yapin server.');
    }

    const ok =
      (requiredRole === 'owner' && access.roles.isOwner) ||
      (requiredRole === 'admin' && access.roles.isAdmin) ||
      (requiredRole === 'moderator' && (access.roles.isModerator || access.roles.isAdmin)) ||
      (requiredRole === 'middleman' && (access.roles.isMiddleman || access.roles.isAdmin)) ||
      (requiredRole === 'support' && access.roles.isSupport) ||
      (requiredRole === 'staff' && access.roles.isStaff);

    if (!ok) {
      throw new AuthorizationError(
        `Insufficient server permissions. Required staff role: ${requiredRole}.`,
        { userId, requiredRole },
      );
    }

    return access;
  }

  /**
   * Resolves the bot's own role IDs in a server so private channels always retain bot visibility.
   */
  async getBotRoleIds(serverId) {
    const botId = this.client.me?.id || this.client.me?.bot?.id;
    if (!botId) return [];
    const botMember = await this.fetchServerMember(serverId, botId);
    if (!botMember || !Array.isArray(botMember.roles)) return [];
    return botMember.roles.map((r) => (typeof r === 'object' ? String(r.id) : String(r)));
  }
}
