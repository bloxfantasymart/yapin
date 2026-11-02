import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { SecurityError, ValidationError, YapinApiError } from '../utils/errors.js';

const base64url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Validates that a Yapin bot token matches the documented `yb_` format
 * generated in Yapin Settings -> Developer -> Token.
 *
 * @param {string} token
 * @returns {string}
 */
export function validateBotToken(token) {
  if (!token || typeof token !== 'string') {
    throw new ValidationError('Yapin bot token is required.');
  }
  const trimmed = token.trim();
  if (!trimmed.startsWith('yb_') || trimmed.length < 8 || /\s/.test(trimmed)) {
    throw new ValidationError(
      'Invalid Yapin bot token format. Expected token starting with "yb_" from Settings -> Developer.',
    );
  }
  return trimmed;
}

/**
 * Builds documented Yapin Bot REST API request headers.
 * Source: https://www.yapin.gg/developers#rest-api (`Authorization: Bot <token>`)
 *
 * @param {string} token
 * @param {{ hasJsonBody?: boolean, userAgent?: string, extraHeaders?: Record<string, string> }} [options]
 */
export function buildBotAuthHeaders(token, options = {}) {
  const validToken = validateBotToken(token);
  const headers = {
    authorization: `Bot ${validToken}`,
    accept: 'application/json',
    'user-agent': options.userAgent || 'mm2-helper-bot/2.0',
    ...(options.extraHeaders || {}),
  };
  if (options.hasJsonBody) {
    headers['content-type'] = 'application/json';
  }
  return headers;
}

/**
 * Verifies Yapin Event Webhook HMAC-SHA256 signatures in constant time.
 * Header format documented at https://www.yapin.gg/developers#event-webhooks:
 *   `X-Yapper-Signature: sha256=<hex HMAC-SHA256 of raw body>`
 *
 * @param {Buffer | string} rawBody
 * @param {string | undefined | null} signatureHeader
 * @param {string} webhookSecret
 * @returns {boolean}
 */
export function verifyYapinWebhookSignature(rawBody, signatureHeader, webhookSecret) {
  if (!signatureHeader || !webhookSecret || typeof webhookSecret !== 'string') {
    return false;
  }
  const rawBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  const expectedHex = createHmac('sha256', webhookSecret).update(rawBuffer).digest('hex');
  const providedHex = String(signatureHeader).replace(/^sha256=/i, '').trim().toLowerCase();

  if (providedHex.length !== expectedHex.length || !/^[0-9a-f]+$/.test(providedHex)) {
    return false;
  }

  return timingSafeEqual(Buffer.from(providedHex, 'utf8'), Buffer.from(expectedHex, 'utf8'));
}

/**
 * Official "Login with Yapin'" OAuth2 client (`identify` scope) for the optional Staff Dashboard.
 * Source: https://www.yapin.gg/developers#login-with-yapper
 *   - Authorize: GET https://www.yapin.gg/oauth/authorize
 *   - Token:     POST https://www.yapin.gg/api/oauth/token
 *   - Identity:  GET https://www.yapin.gg/api/oauth/me
 */
export class YapinOAuth2Client {
  /**
   * @param {{ clientId: string, clientSecret?: string, redirectUri: string, siteUrl?: string, fetchImpl?: typeof fetch }} opts
   */
  constructor({ clientId, clientSecret, redirectUri, siteUrl = 'https://www.yapin.gg', fetchImpl }) {
    if (!clientId || !redirectUri) {
      throw new ValidationError('YapinOAuth2Client requires clientId and redirectUri.');
    }
    this.clientId = clientId;
    Object.defineProperty(this, 'clientSecret', {
      value: clientSecret || null,
      enumerable: false,
      writable: false,
    });
    this.redirectUri = redirectUri;
    this.siteUrl = siteUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl || globalThis.fetch.bind(globalThis);
  }

  static generateState(byteLength = 24) {
    return base64url(randomBytes(byteLength));
  }

  static generatePKCE() {
    const verifier = base64url(randomBytes(48));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    return { verifier, challenge, method: 'S256' };
  }

  /**
   * Generates the official Yapin OAuth2 authorization URL.
   * @param {{ state: string, codeChallenge?: string }} params
   */
  buildAuthorizeUrl({ state, codeChallenge }) {
    if (!state || typeof state !== 'string' || state.length < 16) {
      throw new SecurityError('OAuth2 state parameter must be a cryptographically random string.');
    }
    const query = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'identify',
      state,
    });
    if (codeChallenge) {
      query.set('code_challenge', codeChallenge);
      query.set('code_challenge_method', 'S256');
    }
    return `${this.siteUrl}/oauth/authorize?${query.toString()}`;
  }

  /**
   * Exchanges a single-use authorization code (60s TTL) for an access token (`yo_...`, 30d TTL).
   * @param {string} code
   * @param {{ codeVerifier?: string, timeoutMs?: number }} [options]
   */
  async exchangeCode(code, options = {}) {
    if (!code || typeof code !== 'string') {
      throw new ValidationError('Missing OAuth2 authorization code.');
    }
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
    });
    if (this.clientSecret) {
      form.set('client_secret', this.clientSecret);
    }
    if (options.codeVerifier) {
      form.set('code_verifier', options.codeVerifier);
    }

    const res = await this.fetchImpl(`${this.siteUrl}/api/oauth/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: form,
      signal: AbortSignal.timeout(options.timeoutMs || 15000),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw new YapinApiError({
        message: data.error_description || data.error || `OAuth2 token exchange failed (${res.status})`,
        status: res.status,
        method: 'POST',
        path: '/api/oauth/token',
      });
    }

    return {
      accessToken: data.access_token,
      tokenType: data.token_type || 'Bearer',
      expiresIn: typeof data.expires_in === 'number' ? data.expires_in : 30 * 86400,
      scope: data.scope || 'identify',
    };
  }

  /**
   * Fetches the authenticated Yapin user profile (`{ id, username, display_name, avatar_url }`).
   * Always key identity off `id`, never `username`.
   *
   * @param {string} accessToken
   * @param {{ timeoutMs?: number }} [options]
   */
  async fetchCurrentUser(accessToken, options = {}) {
    if (!accessToken || typeof accessToken !== 'string') {
      throw new ValidationError('Missing OAuth2 access token.');
    }
    const res = await this.fetchImpl(`${this.siteUrl}/api/oauth/me`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(options.timeoutMs || 15000),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) {
      throw new YapinApiError({
        message: data.error || `OAuth2 /me lookup failed (${res.status})`,
        status: res.status,
        method: 'GET',
        path: '/api/oauth/me',
      });
    }

    return {
      id: String(data.id),
      username: String(data.username || ''),
      displayName: data.display_name ? String(data.display_name) : null,
      avatarUrl: data.avatar_url ? String(data.avatar_url) : null,
    };
  }
}
