import { YAPIN_LIMITS } from '../config/settings.js';
import { SecurityError, ValidationError } from '../utils/errors.js';

/**
 * Verified Yapin Channels, Categories & Member Pagination Adapter.
 * Source: https://www.yapin.gg/developers#rest-api
 *
 * Key verified platform details:
 * - `POST /servers/:id/channels` `{ name, kind: 'text'|'voice', category_id }` creates a channel (Manage Channels; 10/min/server).
 * - `PATCH /channels/:id` `{ name, category_id, private, role_ids, read_only, post_role_ids, slowmode }` configures channel access.
 * - Yapin channel privacy is ROLE-BASED (`private: true` + `role_ids: [...]`), NOT per-user overwrite based!
 * - `PUT /channels/:id/permissions/:role` `{ allow, deny }` and `POST /servers/:id/roles` exist in beta on Yapin test servers.
 * - If locking a private ticket channel fails, `createPrivateChannel` immediately rolls back (`DELETE /channels/:id`)
 *   so a private ticket NEVER remains public!
 */
export class YapinChannelsApi {
  /**
   * @param {import('./YapinClient.js').YapinClient} client
   */
  constructor(client) {
    this.client = client;
  }

  /**
   * Lists channels (and categories) visible to the bot in a server (`GET /servers/:id/channels`).
   */
  async listServerChannels(serverId, { type } = {}) {
    const out = await this.client.request('GET', `/servers/${encodeURIComponent(serverId)}/channels`, {
      query: type ? { type } : undefined,
    });
    return {
      channels: Array.isArray(out.channels) ? out.channels : [],
      categories: Array.isArray(out.categories) ? out.categories : [],
    };
  }

  /**
   * Fetches one channel by ID (`GET /channels/:id`), or returns null if 404 / hidden.
   */
  async getChannel(channelId) {
    try {
      const out = await this.client.request('GET', `/channels/${encodeURIComponent(channelId)}`);
      return out.channel || out;
    } catch (err) {
      if (err?.status === 404) return null;
      throw err;
    }
  }

  /**
   * Creates a channel (`POST /servers/:id/channels`). Requires `manage_channels`.
   */
  async createChannel(serverId, name, { kind = 'text', categoryId = null } = {}) {
    const cleanName = String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64);
    if (!cleanName) {
      throw new ValidationError('Channel name cannot be empty.');
    }

    const body = {
      name: cleanName,
      kind,
      ...(categoryId ? { category_id: categoryId } : {}),
    };

    const out = await this.client.request(
      'POST',
      `/servers/${encodeURIComponent(serverId)}/channels`,
      { body },
    );
    return out.channel || out;
  }

  /**
   * Updates channel configuration (`PATCH /channels/:id`).
   */
  async editChannel(channelId, changes = {}) {
    const body = {};
    if (changes.name !== undefined) body.name = String(changes.name).slice(0, 64);
    if (changes.categoryId !== undefined) body.category_id = changes.categoryId;
    if (changes.private !== undefined) body.private = Boolean(changes.private);
    if (changes.roleIds !== undefined) body.role_ids = changes.roleIds;
    if (changes.readOnly !== undefined) body.read_only = Boolean(changes.readOnly);
    if (changes.postRoleIds !== undefined) body.post_role_ids = changes.postRoleIds;
    if (changes.slowmode !== undefined) {
      const slow = Number(changes.slowmode);
      if (!Number.isInteger(slow) || slow < 0 || slow > YAPIN_LIMITS.SLOWMODE_MAX_SECONDS) {
        throw new ValidationError(`Slowmode must be between 0 and ${YAPIN_LIMITS.SLOWMODE_MAX_SECONDS} seconds.`);
      }
      body.slowmode = slow;
    }

    const out = await this.client.request('PATCH', `/channels/${encodeURIComponent(channelId)}`, {
      body,
    });
    return out.channel || out;
  }

  /**
   * Deletes a channel (`DELETE /channels/:id`).
   */
  async deleteChannel(channelId) {
    return this.client.request('DELETE', `/channels/${encodeURIComponent(channelId)}`);
  }

  /**
   * Creates a category (`POST /servers/:id/categories`).
   */
  async createCategory(serverId, name) {
    const out = await this.client.request(
      'POST',
      `/servers/${encodeURIComponent(serverId)}/categories`,
      { body: { name: String(name).slice(0, 64) } },
    );
    return out.category || out;
  }

  /**
   * Sets role-level channel permission overrides (`PUT /channels/:id/permissions/:role`).
   * Note: Documented as "In testing: test servers only for now" on Yapin.
   */
  async setChannelRolePermissions(channelId, roleOrEveryone, { allow = [], deny = [] } = {}) {
    return this.client.request(
      'PUT',
      `/channels/${encodeURIComponent(channelId)}/permissions/${encodeURIComponent(roleOrEveryone)}`,
      { body: { allow, deny } },
    );
  }

  /**
   * Securely creates a private ticket/trade channel using Yapin's verified `PATCH /channels/:id`
   * `{ private: true, role_ids }` mechanism (plus optional scoped ticket role if enabled & supported).
   *
   * FAIL-CLOSED GUARANTEE:
   * If `editChannel({ private: true, roleIds })` fails or does not report `private === true`,
   * the newly created channel is IMMEDIATELY deleted so a private ticket never becomes public!
   *
   * @param {{
   *   serverId: string,
   *   name: string,
   *   categoryId?: string | null,
   *   allowedRoleIds: string[],
   *   participantUserIds?: string[],
   *   useScopedParticipantRole?: boolean,
   * }} params
   */
  async createPrivateChannel({
    serverId,
    name,
    categoryId = null,
    allowedRoleIds = [],
    participantUserIds = [],
    useScopedParticipantRole = false,
  }) {
    const uniqueRoleIds = [...new Set(allowedRoleIds.filter(Boolean))];
    if (uniqueRoleIds.length === 0) {
      throw new SecurityError(
        'Cannot create a private Yapin channel without at least one authorized staff/bot role ID.',
      );
    }

    const created = await this.createChannel(serverId, name, {
      kind: 'text',
      categoryId,
    });

    if (!created?.id) {
      throw new SecurityError('Yapin channel creation returned no channel ID.');
    }

    let scopedRoleId = null;
    try {
      // Optional beta feature on Yapin test servers: create a temporary role for ticket participants
      if (useScopedParticipantRole && participantUserIds.length > 0) {
        try {
          const roleRes = await this.client.request(
            'POST',
            `/servers/${encodeURIComponent(serverId)}/roles`,
            {
              body: {
                name: `ticket-${created.name || created.id.slice(0, 8)}`.slice(0, 32),
                mentionable: false,
                permissions: {},
              },
            },
          );
          const roleObj = roleRes.role || roleRes;
          if (roleObj?.id) {
            scopedRoleId = String(roleObj.id);
            uniqueRoleIds.push(scopedRoleId);
            for (const uid of participantUserIds) {
              await this.client.request(
                'PUT',
                `/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(uid)}/roles/${encodeURIComponent(scopedRoleId)}`,
              );
            }
          }
        } catch {
          // Expected on non-test servers where role creation is still in beta; continue with strict staff-role lock
          scopedRoleId = null;
        }
      }

      const locked = await this.editChannel(created.id, {
        private: true,
        roleIds: uniqueRoleIds,
      });

      if (!locked || locked.private !== true) {
        throw new SecurityError(
          `Channel ${created.id} did not confirm private=true after permission lock.`,
        );
      }

      return {
        channel: locked,
        allowedRoleIds: uniqueRoleIds,
        scopedRoleId,
      };
    } catch (lockErr) {
      // FAIL CLOSED: Destroy channel immediately so it is NEVER left public!
      let rollbackSucceeded = false;
      try {
        await this.deleteChannel(created.id);
        rollbackSucceeded = true;
      } catch (deleteErr) {
        this.client.logger.fatal(
          { channelId: created.id, deleteErr: deleteErr?.message },
          'CRITICAL: Failed to delete channel after private permission lock failed',
        );
      }

      if (scopedRoleId) {
        await this.client
          .request(
            'DELETE',
            `/servers/${encodeURIComponent(serverId)}/roles/${encodeURIComponent(scopedRoleId)}`,
          )
          .catch(() => undefined);
      }

      throw new SecurityError(
        `Failed to lock private channel permissions (channel rollback=${rollbackSucceeded}): ${lockErr?.message || 'unknown error'}`,
        { channelId: created.id, rollbackSucceeded },
      );
    }
  }

  /**
   * Iterates paginated server members (`GET /servers/:id/members?limit=200&after=:userId`).
   */
  async fetchAllMembers(serverId, { pageLimit = 200, maxMembers = 2000 } = {}) {
    const clampedPage = Math.min(YAPIN_LIMITS.MEMBERS_PAGE_MAX, Math.max(1, pageLimit));
    const all = [];
    let afterUserId = undefined;

    while (all.length < maxMembers) {
      const out = await this.client.request(
        'GET',
        `/servers/${encodeURIComponent(serverId)}/members`,
        {
          query: {
            limit: clampedPage,
            after: afterUserId,
          },
        },
      );
      const page = Array.isArray(out.members) ? out.members : [];
      if (page.length === 0) break;
      all.push(...page);
      const lastMember = page[page.length - 1];
      const lastId = lastMember?.id || lastMember?.user_id || lastMember?.user?.id;
      if (!lastId || page.length < clampedPage) break;
      afterUserId = lastId;
    }

    return all.slice(0, maxMembers);
  }
}
