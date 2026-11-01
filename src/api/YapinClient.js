import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { YAPIN_LIMITS } from '../config/settings.js';
import { YapinApiError } from '../utils/errors.js';
import { logger as defaultLogger } from '../utils/logger.js';
import {
  buildBotAuthHeaders,
  validateBotToken,
  verifyYapinWebhookSignature,
} from './authentication.js';

const SAFE_NETWORK_RETRY_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const computeBackoffMs = (attempt) =>
  Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1)) * (0.75 + Math.random() * 0.5);

function parseRetryAfterSeconds(headerValue, bodyRetryAfter) {
  if (headerValue !== null && headerValue !== undefined && headerValue !== '') {
    const num = Number(headerValue);
    if (Number.isFinite(num) && num >= 0) return num;
    const parsedDate = Date.parse(headerValue);
    if (!Number.isNaN(parsedDate)) return Math.max(0, (parsedDate - Date.now()) / 1000);
  }
  if (typeof bodyRetryAfter === 'number' && Number.isFinite(bodyRetryAfter) && bodyRetryAfter >= 0) {
    return bodyRetryAfter;
  }
  return null;
}

/**
 * Normalizes a REST path into a per-route rate-limit bucket key.
 * Preserves the first major resource ID (server or channel) so independent channels do not head-of-line block.
 */
export function deriveRouteBucket(method, rawPath) {
  let seenMajorId = false;
  const cleanPath = rawPath.split('?')[0].replace(/\/([0-9a-f]{8}-[0-9a-f-]{27,}|[^/]{20,})/gi, (segment) => {
    if (!seenMajorId) {
      seenMajorId = true;
      return segment;
    }
    return '/:id';
  });
  return `${method.toUpperCase()} ${cleanPath}`;
}

/**
 * Verified Yapin.gg Bot API Client
 *
 * Official Specification: https://www.yapin.gg/developers
 * - REST Base URL: https://www.yapin.gg/api/bot/v1 (or https://bots.yapper.website/api/bot/v1)
 * - Auth Header:   Authorization: Bot yb_...
 * - Events:        WebSocket Gateway (`wss://rt.yapper.website/bot`) with automatic fallback to
 *                  documented HTTPS Long-Polling (`GET /events?after=<last>&wait=20`), plus optional
 *                  HMAC-verified Event Webhooks (`X-Yapper-Signature`).
 */
export class YapinClient extends EventEmitter {
  /**
   * @param {{
   *   token: string,
   *   baseUrl?: string,
   *   gatewayUrl?: string | false,
   *   enableGateway?: boolean,
   *   prefixes?: string[],
   *   ignoreBots?: boolean,
   *   timeoutMs?: number,
   *   maxRetries?: number,
   *   maxRetryAfterSeconds?: number,
   *   pollWaitSeconds?: number,
   *   cursorStore?: { getCursor: () => Promise<number>, setCursor: (seq: number) => Promise<void> } | null,
   *   fetchImpl?: typeof fetch,
   *   WebSocketImpl?: typeof WebSocket,
   *   logger?: import('pino').Logger,
   * }} options
   */
  constructor(options) {
    super();
    const validToken = validateBotToken(options.token);
    Object.defineProperty(this, '_token', {
      value: validToken,
      enumerable: false,
      writable: false,
    });

    this.baseUrl = (options.baseUrl || 'https://www.yapin.gg/api/bot/v1').replace(/\/+$/, '');
    this.enableGateway =
      options.enableGateway !== false &&
      options.gatewayUrl !== false &&
      typeof (options.WebSocketImpl || globalThis.WebSocket) === 'function';
    this.gatewayUrl = this.enableGateway
      ? options.gatewayUrl || 'wss://rt.yapper.website/bot'
      : null;

    this.prefixes = Array.isArray(options.prefixes) && options.prefixes.length > 0
      ? options.prefixes
      : ['/', '!'];
    this.ignoreBots = options.ignoreBots !== false;
    this.timeoutMs = options.timeoutMs ?? 25_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.maxRetryAfterSeconds = options.maxRetryAfterSeconds ?? 60;
    this.pollWaitSeconds = Math.min(
      YAPIN_LIMITS.EVENT_POLL_MAX_WAIT_SECONDS,
      Math.max(0, options.pollWaitSeconds ?? 20),
    );

    this.cursorStore = options.cursorStore || null;
    this.fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
    this.WebSocketImpl = options.WebSocketImpl || globalThis.WebSocket;
    this.logger = options.logger || defaultLogger;

    this.me = null;
    this.lastEventId = 0;
    this.running = false;
    this.transport = 'disconnected'; // 'gateway' | 'polling' | 'disconnected'
    this.lastPingMs = null;

    /** @type {Map<string, Promise<unknown>>} */
    this._bucketQueues = new Map();
    this._globalResetAt = 0;
    /** @type {Map<string, { timestamp: number, promise: Promise<unknown> }>} */
    this._inflightIdempotent = new Map();
    /** @type {Set<number>} */
    this._recentEventIds = new Set();

    this._ws = null;
    this._webhookServer = null;
    this._pollAbortController = null;
  }

  /**
   * Executes a verified Yapin REST API call with per-route bucket serialization,
   * Retry-After compliance, timeout enforcement, and safe retry rules.
   *
   * @param {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} method
   * @param {string} path
   * @param {{
   *   body?: unknown,
   *   query?: Record<string, string | number | boolean | undefined | null>,
   *   timeoutMs?: number,
   *   retries?: number,
   *   idempotencyKey?: string,
   *   signal?: AbortSignal,
   * }} [options]
   */
  async request(method, path, options = {}) {
    const upperMethod = method.toUpperCase();
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    let queryString = '';
    if (options.query) {
      const params = new URLSearchParams();
      for (const [key, val] of Object.entries(options.query)) {
        if (val !== undefined && val !== null) {
          params.set(key, val instanceof Date ? val.toISOString() : String(val));
        }
      }
      const built = params.toString();
      if (built) queryString = `?${built}`;
    }

    const fullPath = `${normalizedPath}${queryString}`;

    // Deduplicate concurrent identical sensitive requests carrying an idempotencyKey
    if (options.idempotencyKey) {
      const existing = this._inflightIdempotent.get(options.idempotencyKey);
      if (existing && Date.now() - existing.timestamp < 60_000) {
        return existing.promise;
      }
    }

    const bucket = deriveRouteBucket(upperMethod, normalizedPath);
    const prev = this._bucketQueues.get(bucket) || Promise.resolve();

    const executeTask = prev
      .catch(() => undefined)
      .then(() => this._performRequest(upperMethod, fullPath, options));

    this._bucketQueues.set(bucket, executeTask);
    executeTask.finally(() => {
      if (this._bucketQueues.get(bucket) === executeTask) {
        this._bucketQueues.delete(bucket);
      }
    }).catch(() => undefined);

    if (options.idempotencyKey) {
      this._inflightIdempotent.set(options.idempotencyKey, {
        timestamp: Date.now(),
        promise: executeTask,
      });
      executeTask.catch(() => {
        this._inflightIdempotent.delete(options.idempotencyKey);
      });
    }

    return executeTask;
  }

  async _performRequest(method, fullPath, options) {
    const maxRetries = options.retries ?? this.maxRetries;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const hasJsonBody = options.body !== undefined;

    for (let attempt = 0; ; attempt++) {
      // Respect bot-wide global rate limit window if active
      const globalWaitMs = this._globalResetAt - Date.now();
      if (globalWaitMs > 0) {
        await sleep(globalWaitMs);
      }

      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal = options.signal
        ? AbortSignal.any([options.signal, timeoutSignal])
        : timeoutSignal;

      const startedAt = performance.now();
      let res;
      try {
        res = await this.fetchImpl(`${this.baseUrl}${fullPath}`, {
          method,
          headers: buildBotAuthHeaders(this._token, { hasJsonBody }),
          body: hasJsonBody ? JSON.stringify(options.body) : undefined,
          signal,
        });
      } catch (networkErr) {
        // NEVER retry non-idempotent POST/PATCH on ambiguous network timeouts to prevent duplicate actions!
        const isSafeToRetry = SAFE_NETWORK_RETRY_METHODS.has(method);
        if (isSafeToRetry && attempt < maxRetries && !options.signal?.aborted) {
          const waitMs = computeBackoffMs(attempt + 1);
          this.logger.warn(
            { method, path: fullPath, attempt: attempt + 1, waitMs, err: networkErr?.message },
            'Transient network error on idempotent Yapin API request; retrying',
          );
          await sleep(waitMs);
          continue;
        }
        throw new YapinApiError({
          message: `Network or timeout failure calling ${method} ${fullPath}: ${networkErr?.message || 'request failed'}`,
          status: 503,
          method,
          path: fullPath,
        });
      }

      this.lastPingMs = Math.round(performance.now() - startedAt);

      if (res.status === 204) {
        return {};
      }

      const rawText = await res.text();
      let data = {};
      if (rawText) {
        try {
          data = JSON.parse(rawText);
        } catch {
          if (res.ok) {
            throw new YapinApiError({
              message: `Malformed JSON response from Yapin API on ${method} ${fullPath}`,
              status: 502,
              method,
              path: fullPath,
            });
          }
          data = { error: rawText.slice(0, 200) };
        }
      }

      if (res.ok) {
        return data;
      }

      const retryAfter = parseRetryAfterSeconds(res.headers.get('retry-after'), data?.retry_after);
      const errorMessage = data?.error || data?.message || `${method} ${fullPath} failed (${res.status})`;
      const isGlobalLimit = res.status === 429 && /overall/i.test(String(errorMessage));

      if (isGlobalLimit && retryAfter) {
        this._globalResetAt = Math.max(this._globalResetAt, Date.now() + retryAfter * 1000);
      }

      if (res.status === 429) {
        this.emit('rateLimited', {
          method,
          path: fullPath,
          retryAfter,
          global: isGlobalLimit,
        });
      }

      // Documented Yapin retry safety:
      // - 429 WITH Retry-After: nothing was executed; wait Retry-After + jitter.
      // - 429 WITHOUT Retry-After: duplicate message or >10 interaction responses; waiting will NEVER succeed!
      // - 503 WITH Retry-After: "Yapin' is busy" and nothing was done; safe to retry.
      const isBusyRetryable = res.status === 503 && retryAfter !== null && retryAfter > 0;
      const isRateLimitRetryable = res.status === 429 && retryAfter !== null && retryAfter > 0;

      if (
        (isRateLimitRetryable || isBusyRetryable) &&
        retryAfter <= this.maxRetryAfterSeconds &&
        attempt < maxRetries
      ) {
        const waitMs = retryAfter * 1000 * (1 + Math.random() * 0.25);
        this.logger.warn(
          { method, path: fullPath, status: res.status, retryAfter, attempt: attempt + 1 },
          'Yapin API requested backoff; waiting before retry',
        );
        await sleep(waitMs);
        continue;
      }

      throw new YapinApiError({
        message: errorMessage,
        status: res.status,
        method,
        path: fullPath,
        retryAfter,
        body: data,
      });
    }
  }

  /**
   * Verifies connectivity and returns the authenticated bot profile (`GET /me`).
   */
  async getMe() {
    const started = performance.now();
    const profile = await this.request('GET', '/me');
    const latencyMs = Math.round(performance.now() - started);
    if (!profile || typeof profile !== 'object' || (!profile.id && !profile.username && !profile.bot)) {
      throw new YapinApiError({
        message: 'Unexpected response payload from GET /me',
        status: 502,
        method: 'GET',
        path: '/me',
      });
    }
    this.me = profile;
    this.lastPingMs = latencyMs;
    return { profile, latencyMs };
  }

  /**
   * Updates bot status (`online`, `idle`, `dnd`) and optional activity text (<= 60 chars).
   */
  async setStatus(status = 'online', activity = null) {
    return this.request('PUT', '/me/status', {
      body: {
        status,
        activity: activity ? String(activity).slice(0, 60) : null,
      },
    });
  }

  /**
   * Initializes cursor state, authenticates against `GET /me`, and starts event ingestion
   * (Gateway with automatic fallback to Long-Polling).
   */
  async start() {
    if (this.running) return;
    this.running = true;

    // 1. Authenticate & fetch bot identity
    const { profile } = await this.getMe();

    // 2. Restore saved sequence cursor (for restart catch-up) or initialize from latest event ID
    let restoredCursor = 0;
    if (this.cursorStore) {
      try {
        restoredCursor = (await this.cursorStore.getCursor()) || 0;
      } catch (err) {
        this.logger.warn({ err }, 'Failed to read saved event cursor; initializing from live stream');
      }
    }

    if (restoredCursor > 0) {
      this.lastEventId = restoredCursor;
      this.logger.info({ lastEventId: this.lastEventId }, 'Resuming Yapin event stream from persisted cursor');
    } else {
      const initial = await this.request('GET', '/events', {
        query: { after: 0, wait: 0 },
      });
      this.lastEventId = typeof initial.last === 'number' ? initial.last : 0;
      await this._persistCursor(this.lastEventId);
    }

    this.emit('ready', profile);
    this._runEventLoop().catch((err) => {
      this.logger.error({ err }, 'Fatal error in Yapin event loop');
      this.emit('error', err);
    });
  }

  async _persistCursor(seq) {
    if (!this.cursorStore || typeof seq !== 'number' || seq <= 0) return;
    try {
      await this.cursorStore.setCursor(seq);
    } catch (err) {
      this.logger.warn({ err, seq }, 'Failed to persist Yapin event sequence cursor');
    }
  }

  async _runEventLoop() {
    let pollFailures = 0;
    let gatewayFailures = 0;
    let gatewayRetryAt = 0;

    while (this.running) {
      if (this.gatewayUrl && Date.now() >= gatewayRetryAt) {
        const outcome = await this._runGatewaySession();
        if (!this.running) break;

        if (outcome === 'bad_token') {
          const authErr = new YapinApiError({
            message: 'Gateway rejected bot token (4004). Generate a new token in Yapin Settings -> Developer.',
            status: 401,
            method: 'WS',
            path: '/bot',
          });
          this.running = false;
          this.transport = 'disconnected';
          this.emit('error', authErr);
          break;
        }

        if (outcome === 'disabled') {
          this.logger.info('Yapin WebSocket gateway not enabled for this bot (4003); using HTTPS long-polling');
          gatewayRetryAt = Date.now() + 10 * 60_000;
        } else if (outcome === 'rate_limited') {
          gatewayRetryAt = Date.now() + 60_000;
        } else if (outcome === 'ok') {
          gatewayFailures = 0;
          await sleep(computeBackoffMs(1));
          continue;
        } else {
          gatewayFailures += 1;
          if (gatewayFailures >= 3) {
            this.logger.warn('Gateway disconnected repeatedly; falling back to HTTPS long-polling for 5 minutes');
            gatewayFailures = 0;
            gatewayRetryAt = Date.now() + 5 * 60_000;
          } else {
            await sleep(computeBackoffMs(gatewayFailures));
            continue;
          }
        }
      }

      // Official HTTPS Long-Polling (`GET /events?after=<last>&wait=<sec>`)
      this.transport = 'polling';
      this._pollAbortController = new AbortController();
      const pollStartedAt = Date.now();
      try {
        const out = await this.request('GET', '/events', {
          query: {
            after: this.lastEventId,
            wait: this.pollWaitSeconds,
          },
          timeoutMs: (this.pollWaitSeconds + 20) * 1000,
          retries: 0,
          signal: this._pollAbortController.signal,
        });
        pollFailures = 0;

        const events = Array.isArray(out.events) ? out.events : [];
        for (const ev of events) {
          await this.ingestEvent(ev);
        }
        if (typeof out.last === 'number' && out.last > this.lastEventId) {
          this.lastEventId = out.last;
          await this._persistCursor(this.lastEventId);
        } else if (events.length === 0 && Date.now() - pollStartedAt < 25) {
          // Guard against tight microtask polling if wait=0 or an upstream proxy returns immediately
          await sleep(50);
        }
      } catch (err) {
        if (!this.running || this._pollAbortController?.signal.aborted) break;
        pollFailures += 1;
        if (err?.status === 401) {
          this.running = false;
          this.transport = 'disconnected';
          this.emit('error', err);
          break;
        }
        this.emit('error', err);
        const retryWaitMs = Math.max((err?.retryAfter || 0) * 1000, computeBackoffMs(pollFailures));
        await sleep(retryWaitMs);
      } finally {
        this._pollAbortController = null;
      }
    }

    this.transport = 'disconnected';
  }

  _runGatewaySession() {
    return new Promise((resolve) => {
      let ws;
      try {
        ws = new this.WebSocketImpl(this.gatewayUrl);
      } catch {
        resolve('failed');
        return;
      }

      this._ws = ws;
      let readyAt = 0;
      let heartbeatTimer = null;
      let heartbeatAcked = true;
      let lastHeartbeatSentAt = 0;
      let settled = false;
      let eventChain = Promise.resolve();

      const finish = (reason) => {
        if (settled) return;
        settled = true;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        clearInterval(heartbeatTimer);
        clearTimeout(handshakeTimeout);
        if (this._ws === ws) this._ws = null;
        this.emit('disconnected', { transport: 'gateway', reason });
        eventChain.finally(() => resolve(reason));
      };

      const handshakeTimeout = setTimeout(() => {
        finish('failed');
        try {
          ws.close(4000, 'identify timeout');
        } catch {
          // ignore close errors
        }
      }, 15_000);

      ws.onmessage = (rawEvent) => {
        let packet;
        try {
          const text = typeof rawEvent.data === 'string' ? rawEvent.data : String(rawEvent.data);
          packet = JSON.parse(text);
        } catch {
          return;
        }

        if (packet.op === 'hello') {
          const authFrame =
            this.lastEventId > 0
              ? { op: 'resume', token: this._token, seq: this.lastEventId }
              : { op: 'identify', token: this._token };
          ws.send(JSON.stringify(authFrame));
        } else if (packet.op === 'ready') {
          readyAt = Date.now();
          clearTimeout(handshakeTimeout);
          this.transport = 'gateway';
          if (typeof packet.seq === 'number' && packet.seq > this.lastEventId) {
            this.lastEventId = packet.seq;
          }
          this.emit('connected', { transport: 'gateway' });

          const intervalMs = packet.heartbeat_interval || 30_000;
          heartbeatTimer = setInterval(() => {
            if (!heartbeatAcked) {
              finish('ok');
              try {
                ws.close(4000, 'heartbeat timeout');
              } catch {
                // ignore
              }
              return;
            }
            heartbeatAcked = false;
            lastHeartbeatSentAt = performance.now();
            ws.send(JSON.stringify({ op: 'heartbeat' }));
          }, intervalMs);
        } else if (packet.op === 'heartbeat_ack') {
          heartbeatAcked = true;
          if (lastHeartbeatSentAt > 0) {
            this.lastPingMs = Math.round(performance.now() - lastHeartbeatSentAt);
          }
        } else if (packet.op === 'event' && packet.d) {
          const ev =
            packet.t || typeof packet.s === 'number'
              ? {
                  id: typeof packet.s === 'number' ? packet.s : packet.d.id,
                  type: packet.t || packet.d.type || packet.d.event,
                  data: packet.t ? packet.d : packet.d.data || packet.d,
                  created_at: packet.d.created_at,
                }
              : packet.d;
          eventChain = eventChain.then(() => this.ingestEvent(ev)).catch((err) => {
            this.emit('error', err);
          });
        }
      };

      ws.onerror = () => {
        if (!readyAt) finish('failed');
      };

      ws.onclose = (closeEv) => {
        const code = closeEv?.code;
        if (code === 4004) return finish('bad_token');
        if (code === 4003) return finish('disabled');
        if (code === 4008 || code === 4029) return finish('rate_limited');
        if (readyAt && Date.now() - readyAt > 10_000) return finish('ok');
        return finish('failed');
      };
    });
  }

  /**
   * Deduplicates, validates, advances cursor, and dispatches a single Yapin event
   * from Gateway, Long-Polling, or Signed Event Webhook.
   *
   * @param {{ id?: number, type?: string, event?: string, data?: Record<string, unknown>, created_at?: string }} rawEvent
   */
  async ingestEvent(rawEvent) {
    if (!rawEvent || typeof rawEvent !== 'object') return false;
    const eventId = typeof rawEvent.id === 'number' ? rawEvent.id : null;
    const eventType = rawEvent.type || rawEvent.event;
    if (!eventType || typeof eventType !== 'string') return false;

    // Strict replay & duplicate suppression across Gateway, Polling, and Webhooks
    if (eventId !== null) {
      if (eventId <= this.lastEventId || this._recentEventIds.has(eventId)) {
        return false;
      }
      this.lastEventId = eventId;
      this._recentEventIds.add(eventId);
      if (this._recentEventIds.size > 1000) {
        const oldest = this._recentEventIds.values().next().value;
        this._recentEventIds.delete(oldest);
      }
      await this._persistCursor(eventId);
    }

    const data = rawEvent.data && typeof rawEvent.data === 'object' ? rawEvent.data : {};
    const envelope = {
      id: eventId,
      type: eventType,
      data,
      createdAt: rawEvent.created_at || new Date().toISOString(),
    };

    this.emit('rawEvent', envelope);

    if (eventType === 'message') {
      if (this.ignoreBots && data.author_bot) {
        return true;
      }
      // Respect Yapin's multi-bot disambiguation (`command_for`): skip commands addressed to another bot
      const botId = this.me?.id || this.me?.bot?.id || null;
      const targetedOtherBot =
        Array.isArray(data.command_for) &&
        data.command_for.length > 0 &&
        (!botId || !data.command_for.includes(botId));

      let commandName = targetedOtherBot ? null : data.command || null;
      let commandArgs = targetedOtherBot ? '' : data.args || '';

      if (!commandName && !targetedOtherBot && typeof data.content === 'string') {
        const sortedPrefixes = [...this.prefixes].sort((a, b) => b.length - a.length);
        for (const prefix of sortedPrefixes) {
          if (prefix && data.content.startsWith(prefix)) {
            const match = /^([a-z0-9_-]{1,32})(?:\s+([\s\S]*))?$/i.exec(
              data.content.slice(prefix.length),
            );
            if (match) {
              commandName = match[1].toLowerCase();
              commandArgs = (match[2] || '').trim();
              break;
            }
          }
        }
      }

      const messagePayload = {
        ...data,
        eventId,
        command: commandName ? String(commandName).toLowerCase() : null,
        args: String(commandArgs || ''),
      };

      this.emit('message', messagePayload);
      if (messagePayload.command) {
        this.emit('command', messagePayload);
      }
      return true;
    }

    if (eventType === 'interaction') {
      this.emit('interaction', {
        ...data,
        eventId,
      });
      return true;
    }

    this.emit(eventType, {
      ...data,
      eventId,
      type: eventType,
    });
    return true;
  }

  /**
   * Starts an optional HTTP listener for Yapin Signed Event Webhooks (`X-Yapper-Signature`).
   * Responds 200 within Yapin's 3-second deadline after verifying HMAC-SHA256.
   *
   * @param {{ port: number, host?: string, path?: string, secret: string }} webhookOpts
   */
  async startWebhookServer({ port, host = '0.0.0.0', path = '/webhooks/yapin', secret }) {
    if (!secret || secret.length < 16) {
      throw new Error('Webhook secret (>= 16 chars) is required to start the Yapin webhook server.');
    }

    const server = createServer(async (req, res) => {
      const reqPath = (req.url || '/').split('?')[0];
      if (reqPath === '/healthz' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', transport: this.transport, lastEventId: this.lastEventId }));
        return;
      }

      if (reqPath !== path) {
        res.writeHead(404).end();
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }

      const chunks = [];
      let totalBytes = 0;
      try {
        for await (const chunk of req) {
          totalBytes += chunk.length;
          if (totalBytes > 512 * 1024) {
            res.writeHead(413).end();
            return;
          }
          chunks.push(chunk);
        }
      } catch {
        res.writeHead(400).end();
        return;
      }

      const rawBody = Buffer.concat(chunks);
      const signature = req.headers['x-yapper-signature'];
      if (!verifyYapinWebhookSignature(rawBody, signature, secret)) {
        this.logger.warn('Rejected Yapin webhook request with invalid HMAC signature');
        res.writeHead(401).end();
        return;
      }

      let payload;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        res.writeHead(400).end();
        return;
      }

      // Acknowledge immediately per Yapin's 3-second webhook timeout
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ received: true }));

      this.ingestEvent(payload).catch((err) => this.emit('error', err));
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });

    this._webhookServer = server;
    return server;
  }

  /**
   * Gracefully stops active Gateway sockets, Long-Poll requests, and Webhook servers,
   * flushing the final event cursor.
   */
  async stop() {
    this.running = false;
    try {
      this._pollAbortController?.abort();
    } catch {
      // ignore
    }
    try {
      this._ws?.close(1000, 'shutting down');
    } catch {
      // ignore
    }
    this._ws = null;

    if (this._webhookServer) {
      const srv = this._webhookServer;
      this._webhookServer = null;
      await new Promise((resolve) => srv.close(() => resolve()));
    }

    await this._persistCursor(this.lastEventId);
    this.transport = 'disconnected';
  }
}
