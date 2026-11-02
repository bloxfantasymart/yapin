/**
 * Deterministic in-process mock of Yapin.gg's verified Bot REST API v1 for unit tests.
 * Mirrors the exact request headers, endpoints, status codes, Retry-After behavior,
 * and JSON response envelopes documented at https://www.yapin.gg/developers.
 */
export function createMockYapinFetch(overrides = {}) {
  const state = {
    botToken: overrides.botToken || 'yb_unit_test_secret_token_123456',
    botProfile: {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'MM2Helper',
      display_name: 'MM2 Helper',
      avatar_url: null,
      banner_url: null,
      bot: {
        name: 'MM2 Helper',
        public: false,
        owner_id: '00000000-0000-4000-8000-000000000099',
      },
      ...(overrides.botProfile || {}),
    },
    servers: new Map(),
    roles: new Map(),
    members: new Map(),
    channels: new Map(),
    categories: new Map(),
    messages: new Map(),
    commands: [],
    interactions: new Map(),
    events: [],
    lastEventId: 100,
    calls: [],
    failPrivateLockOnChannelId: null,
    rateLimitNextCount: 0,
    rateLimitRetryAfter: '0.02',
    busyNextCount: 0,
  };

  const defaultServerId = '11111111-1111-4111-8111-111111111111';
  const ownerId = '00000000-0000-4000-8000-000000000099';
  state.servers.set(defaultServerId, {
    id: defaultServerId,
    name: 'MurderMystery2',
    owner_id: ownerId,
    member_count: 120,
    online_count: 38,
  });

  state.roles.set(defaultServerId, [
    {
      id: 'role-admin',
      name: 'High Sheriff (Admin)',
      position: 50,
      manage_server: true,
      manage_messages: true,
      perms: { manage_roles: true, manage_channels: true, kick_members: true, ban_members: true },
    },
    {
      id: 'role-mod',
      name: 'Sheriff Moderator',
      position: 35,
      manage_server: false,
      manage_messages: true,
      perms: { timeout_members: true },
    },
    {
      id: 'role-trialmod',
      name: 'Trial Sheriff',
      position: 28,
      manage_server: false,
      manage_messages: false,
      perms: {},
    },
    {
      id: 'role-support',
      name: 'Detective Support',
      position: 20,
      manage_server: false,
      manage_messages: false,
      perms: {},
    },
    {
      id: 'role-verified',
      name: 'Verified Citizen',
      position: 10,
      manage_server: false,
      manage_messages: false,
      perms: {},
    },
    {
      id: 'role-unverified',
      name: 'Unverified Suspect',
      position: 5,
      manage_server: false,
      manage_messages: false,
      perms: {},
    },
    {
      id: 'role-muted',
      name: 'Quarantined (Muted)',
      position: 4,
      manage_server: false,
      manage_messages: false,
      perms: {},
    },
    {
      id: 'role-bot',
      name: 'MM2 Helper',
      position: 45,
      auto: true,
      manage_server: false,
      manage_messages: true,
      perms: { manage_channels: true, manage_roles: true },
    },
  ]);

  const setMember = (serverId, userId, roles = [], username = `user_${userId.slice(0, 6)}`) => {
    state.members.set(`${serverId}:${userId}`, {
      id: userId,
      user_id: userId,
      user: { id: userId, username, display_name: username },
      roles,
      nickname: null,
      joined_at: '2026-10-01T00:00:00.000Z',
      timeout: null,
    });
  };

  setMember(defaultServerId, state.botProfile.id, ['role-bot'], 'MM2Helper');
  setMember(defaultServerId, ownerId, ['role-admin'], 'ServerOwner');

  let idCounter = 1;
  const nextId = (prefix) => `${prefix}-${idCounter++}`;

  const jsonResponse = (status, body, headers = {}) =>
    new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
    });

  const fetchImpl = async (urlStr, init = {}) => {
    const url = new URL(urlStr);
    const method = (init.method || 'GET').toUpperCase();
    const rawBody = init.body ? String(init.body) : null;
    const parsedBody =
      rawBody && (init.headers?.['content-type'] || '').includes('application/json')
        ? JSON.parse(rawBody)
        : null;

    state.calls.push({
      method,
      url: urlStr,
      pathname: url.pathname,
      search: url.search,
      headers: { ...(init.headers || {}) },
      body: parsedBody ?? rawBody,
    });

    if (init.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    // OAuth2 endpoints (/api/oauth/token and /api/oauth/me)
    if (url.pathname === '/api/oauth/token' && method === 'POST') {
      const params = new URLSearchParams(rawBody || '');
      if (params.get('code') === 'valid_oauth_code') {
        return jsonResponse(200, {
          access_token: 'yo_test_oauth_access_token_abcdef',
          token_type: 'Bearer',
          expires_in: 2592000,
          scope: 'identify',
        });
      }
      return jsonResponse(400, {
        error: 'invalid_grant',
        error_description: 'Authorization code expired or invalid',
      });
    }

    if (url.pathname === '/api/oauth/me' && method === 'GET') {
      const auth = init.headers?.authorization || init.headers?.Authorization || '';
      if (auth === 'Bearer yo_test_oauth_access_token_abcdef') {
        return jsonResponse(200, {
          id: ownerId,
          username: 'ServerOwner',
          display_name: 'Server Owner',
          avatar_url: null,
        });
      }
      return jsonResponse(401, { error: 'invalid_token' });
    }

    // Bot API auth check
    const authHeader = init.headers?.authorization || init.headers?.Authorization || '';
    if (authHeader !== `Bot ${state.botToken}`) {
      return jsonResponse(401, { error: 'Wrong or missing bot token' });
    }

    // Simulated rate-limit or 503 busy behavior
    if (state.rateLimitNextCount > 0) {
      state.rateLimitNextCount -= 1;
      const headers = state.rateLimitRetryAfter ? { 'retry-after': state.rateLimitRetryAfter } : {};
      return jsonResponse(
        429,
        {
          error: '30 messages a minute in this server',
          ...(state.rateLimitRetryAfter ? { retry_after: Number(state.rateLimitRetryAfter) } : {}),
        },
        headers,
      );
    }

    if (state.busyNextCount > 0) {
      state.busyNextCount -= 1;
      return jsonResponse(
        503,
        { error: 'Yapin is busy', retry_after: 0.02 },
        { 'retry-after': '0.02' },
      );
    }

    const apiPrefix = '/api/bot/v1';
    const route = url.pathname.startsWith(apiPrefix)
      ? url.pathname.slice(apiPrefix.length)
      : url.pathname;

    if (route === '/me' && method === 'GET') {
      return jsonResponse(200, state.botProfile);
    }

    if (route === '/me/status' && method === 'PUT') {
      return jsonResponse(200, { ok: true, ...parsedBody });
    }

    if (route === '/commands' && method === 'GET') {
      return jsonResponse(200, { commands: state.commands });
    }

    if (route === '/commands' && method === 'PUT') {
      if (!Array.isArray(parsedBody?.commands)) {
        return jsonResponse(400, { error: 'commands array required' });
      }
      state.commands = parsedBody.commands;
      return jsonResponse(200, { commands: state.commands });
    }

    if (route === '/events' && method === 'GET') {
      const after = Number(url.searchParams.get('after') || 0);
      const wait = Number(url.searchParams.get('wait') || 0);
      if (after === 0 && wait === 0) {
        return jsonResponse(200, { events: [], last: state.lastEventId });
      }
      const matching = state.events.filter((e) => e.id > after).slice(0, 100);
      const newest = matching.length > 0 ? matching[matching.length - 1].id : state.lastEventId;
      return jsonResponse(200, { events: matching, last: newest });
    }

    let m;

    // GET /servers/:id
    if ((m = /^\/servers\/([^/]+)$/.exec(route)) && method === 'GET') {
      const srv = state.servers.get(decodeURIComponent(m[1]));
      if (!srv) return jsonResponse(404, { error: 'Server not found' });
      return jsonResponse(200, { server: srv });
    }

    // GET /servers/:id/roles
    if ((m = /^\/servers\/([^/]+)\/roles$/.exec(route)) && method === 'GET') {
      const srvId = decodeURIComponent(m[1]);
      return jsonResponse(200, { roles: state.roles.get(srvId) || [] });
    }

    // GET /servers/:id/members/:uid
    if ((m = /^\/servers\/([^/]+)\/members\/([^/]+)$/.exec(route)) && method === 'GET') {
      const key = `${decodeURIComponent(m[1])}:${decodeURIComponent(m[2])}`;
      const member = state.members.get(key);
      if (!member) return jsonResponse(404, { error: 'Member not found' });
      return jsonResponse(200, { member });
    }

    // PUT / DELETE /servers/:id/members/:uid/roles/:rid
    if (
      (m = /^\/servers\/([^/]+)\/members\/([^/]+)\/roles\/([^/]+)$/.exec(route)) &&
      (method === 'PUT' || method === 'DELETE')
    ) {
      const srvId = decodeURIComponent(m[1]);
      const uid = decodeURIComponent(m[2]);
      const rid = decodeURIComponent(m[3]);
      const key = `${srvId}:${uid}`;
      const member = state.members.get(key);
      if (!member) return jsonResponse(404, { error: 'Member not found' });
      const roleSet = new Set(member.roles || []);
      if (method === 'PUT') roleSet.add(rid);
      else roleSet.delete(rid);
      member.roles = [...roleSet];
      return jsonResponse(200, { ok: true, roles: member.roles });
    }

    // GET /servers/:id/members
    if ((m = /^\/servers\/([^/]+)\/members$/.exec(route)) && method === 'GET') {
      const srvId = decodeURIComponent(m[1]);
      const limit = Number(url.searchParams.get('limit') || 200);
      const after = url.searchParams.get('after');
      const all = [...state.members.entries()]
        .filter(([k]) => k.startsWith(`${srvId}:`))
        .map(([, v]) => v)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const filtered = after ? all.filter((item) => String(item.id) > after) : all;
      return jsonResponse(200, { members: filtered.slice(0, limit) });
    }

    // POST /servers/:id/channels
    if ((m = /^\/servers\/([^/]+)\/channels$/.exec(route)) && method === 'POST') {
      const srvId = decodeURIComponent(m[1]);
      const ch = {
        id: nextId('ch'),
        server_id: srvId,
        name: parsedBody.name,
        kind: parsedBody.kind || 'text',
        type: parsedBody.kind || 'text',
        category_id: parsedBody.category_id || null,
        private: false,
        role_ids: [],
        read_only: false,
        slowmode: 0,
      };
      state.channels.set(ch.id, ch);
      return jsonResponse(200, { channel: ch });
    }

    // GET /servers/:id/channels
    if ((m = /^\/servers\/([^/]+)\/channels$/.exec(route)) && method === 'GET') {
      const srvId = decodeURIComponent(m[1]);
      const channels = [...state.channels.values()].filter((c) => c.server_id === srvId);
      return jsonResponse(200, { channels, categories: [] });
    }

    // PATCH /channels/:id
    if ((m = /^\/channels\/([^/]+)$/.exec(route)) && method === 'PATCH') {
      const chId = decodeURIComponent(m[1]);
      if (state.failPrivateLockOnChannelId === chId || state.failPrivateLockOnChannelId === '*') {
        return jsonResponse(403, { error: 'Missing Manage Channels permission' });
      }
      const ch = state.channels.get(chId);
      if (!ch) return jsonResponse(404, { error: 'Channel not found' });
      Object.assign(ch, parsedBody);
      return jsonResponse(200, { channel: ch });
    }

    // GET /channels/:id
    if ((m = /^\/channels\/([^/]+)$/.exec(route)) && method === 'GET') {
      const ch = state.channels.get(decodeURIComponent(m[1]));
      if (!ch) return jsonResponse(404, { error: 'Channel not found' });
      return jsonResponse(200, { channel: ch });
    }

    // DELETE /channels/:id
    if ((m = /^\/channels\/([^/]+)$/.exec(route)) && method === 'DELETE') {
      const chId = decodeURIComponent(m[1]);
      state.channels.delete(chId);
      return jsonResponse(200, { deleted: true });
    }

    // POST /channels/:id/messages
    if ((m = /^\/channels\/([^/]+)\/messages$/.exec(route)) && method === 'POST') {
      const chId = decodeURIComponent(m[1]);
      const msg = {
        id: nextId('msg'),
        channel_id: chId,
        author_id: state.botProfile.id,
        content: parsedBody.content ?? '',
        embeds: parsedBody.embeds || [],
        components: parsedBody.components || [],
        reply_to_id: parsedBody.reply_to || null,
        created_at: new Date().toISOString(),
      };
      const list = state.messages.get(chId) || [];
      list.push(msg);
      state.messages.set(chId, list);
      return jsonResponse(200, { message: msg });
    }

    // PATCH /channels/:id/messages/:mid
    if ((m = /^\/channels\/([^/]+)\/messages\/([^/]+)$/.exec(route)) && method === 'PATCH') {
      const chId = decodeURIComponent(m[1]);
      const msgId = decodeURIComponent(m[2]);
      const list = state.messages.get(chId) || [];
      const found = list.find((item) => item.id === msgId) || { id: msgId, channel_id: chId };
      if (parsedBody.content !== undefined) found.content = parsedBody.content;
      if (parsedBody.embeds !== undefined) found.embeds = parsedBody.embeds;
      if (parsedBody.components !== undefined) found.components = parsedBody.components;
      return jsonResponse(200, { message: found });
    }

    // POST /channels/:id/messages/bulk-delete
    if ((m = /^\/channels\/([^/]+)\/messages\/bulk-delete$/.exec(route)) && method === 'POST') {
      const chId = decodeURIComponent(m[1]);
      const ids = new Set(parsedBody?.message_ids || []);
      const list = state.messages.get(chId) || [];
      state.messages.set(chId, list.filter((msg) => !ids.has(msg.id)));
      return jsonResponse(200, { deleted: ids.size });
    }

    // DELETE /channels/:id/messages/:mid
    if ((m = /^\/channels\/([^/]+)\/messages\/([^/]+)$/.exec(route)) && method === 'DELETE') {
      const chId = decodeURIComponent(m[1]);
      const msgId = decodeURIComponent(m[2]);
      const list = state.messages.get(chId) || [];
      state.messages.set(chId, list.filter((msg) => msg.id !== msgId));
      return jsonResponse(200, { deleted: true });
    }

    // GET /channels/:id/messages
    if ((m = /^\/channels\/([^/]+)\/messages$/.exec(route)) && method === 'GET') {
      const chId = decodeURIComponent(m[1]);
      const after = url.searchParams.get('after');
      const limit = Number(url.searchParams.get('limit') || 50);
      let list = state.messages.get(chId) || [];
      if (after) {
        const afterMs = new Date(after).getTime();
        list = list.filter((msg) => new Date(msg.created_at).getTime() > afterMs);
      }
      const sliced = list.slice(0, limit);
      const authors = [
        { id: state.botProfile.id, username: state.botProfile.username },
        ...[...state.members.values()].map((mem) => mem.user),
      ];
      return jsonResponse(200, { messages: sliced, authors });
    }

    // POST /interactions/:id/:token/callback
    if ((m = /^\/interactions\/([^/]+)\/([^/]+)\/callback$/.exec(route)) && method === 'POST') {
      const intId = decodeURIComponent(m[1]);
      const token = decodeURIComponent(m[2]);
      const prev = state.interactions.get(intId) || [];
      if (prev.length >= 10) {
        return jsonResponse(429, { error: 'More than 10 answers to one click' });
      }
      prev.push({ token, body: parsedBody });
      state.interactions.set(intId, prev);
      return jsonResponse(200, { ok: true });
    }

    // POST /users/:id/dm
    if ((m = /^\/users\/([^/]+)\/dm$/.exec(route)) && method === 'POST') {
      const uid = decodeURIComponent(m[1]);
      const dmChannelId = `dm-${uid}`;
      if (!state.channels.has(dmChannelId)) {
        state.channels.set(dmChannelId, { id: dmChannelId, kind: 'dm', type: 'dm', server_id: null });
      }
      return jsonResponse(200, { channel_id: dmChannelId });
    }

    // GET /users/:id
    if ((m = /^\/users\/([^/]+)$/.exec(route)) && method === 'GET') {
      const uid = decodeURIComponent(m[1]);
      return jsonResponse(200, { user: { id: uid, username: `user_${uid.slice(0, 6)}` } });
    }

    return jsonResponse(404, { error: `Unhandled mock route: ${method} ${route}` });
  };

  return {
    state,
    defaultServerId,
    ownerId,
    setMember,
    fetchImpl,
  };
}
