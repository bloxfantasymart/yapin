import { ALLOWED_MEDIA_HOSTS, EMBED_COLORS, YAPIN_LIMITS } from '../config/settings.js';
import { ValidationError } from '../utils/errors.js';

function toPlain(item) {
  return item && typeof item.toJSON === 'function' ? item.toJSON() : item;
}

/**
 * Validates that an image/media URL uses HTTPS and an officially permitted Yapin media host.
 * Source: https://www.yapin.gg/developers#embeds
 *
 * @param {string} urlStr
 */
export function validateAllowedMediaUrl(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new ValidationError(`Invalid media URL: "${urlStr}"`);
  }
  if (parsed.protocol !== 'https:') {
    throw new ValidationError('Yapin media URLs must use https://');
  }
  const host = parsed.hostname.toLowerCase();
  const allowed =
    ALLOWED_MEDIA_HOSTS.includes(host) ||
    host.endsWith('.klipy.com') ||
    host.endsWith('.rbxcdn.com');
  if (!allowed) {
    throw new ValidationError(`Media host "${host}" is not on Yapin's allowed embed host list.`);
  }
  return urlStr;
}

/**
 * Verified Yapin Embed Card Builder (`embeds` array in messages/callbacks).
 */
export class EmbedBuilder {
  constructor(initial = {}) {
    this.data = { ...initial };
  }

  setTitle(title) {
    this.data.title = String(title).slice(0, YAPIN_LIMITS.EMBED_TITLE);
    return this;
  }

  setDescription(description) {
    this.data.description = String(description).slice(0, YAPIN_LIMITS.EMBED_DESCRIPTION);
    return this;
  }

  setUrl(url) {
    const s = String(url);
    if (s.length > YAPIN_LIMITS.EMBED_URL) {
      throw new ValidationError(`Embed URL exceeds ${YAPIN_LIMITS.EMBED_URL} characters.`);
    }
    this.data.url = s;
    return this;
  }

  setColor(color) {
    if (typeof color === 'number') {
      this.data.color = color;
    } else if (typeof color === 'string') {
      const upper = color.toUpperCase();
      if (upper in EMBED_COLORS) {
        this.data.color = EMBED_COLORS[upper];
      } else {
        this.data.color = parseInt(color.replace(/^#/, ''), 16) || EMBED_COLORS.PRIMARY;
      }
    }
    return this;
  }

  addField(name, value, inline = false) {
    this.data.fields = this.data.fields || [];
    if (this.data.fields.length >= YAPIN_LIMITS.EMBED_FIELDS) {
      throw new ValidationError(`Yapin embeds allow up to ${YAPIN_LIMITS.EMBED_FIELDS} fields.`);
    }
    this.data.fields.push({
      name: String(name || '\u200b').slice(0, YAPIN_LIMITS.EMBED_FIELD_NAME),
      value: String(value || '-').slice(0, YAPIN_LIMITS.EMBED_FIELD_VALUE),
      inline: Boolean(inline),
    });
    return this;
  }

  setFooter(text, iconUrl) {
    this.data.footer = {
      text: String(text).slice(0, YAPIN_LIMITS.EMBED_FOOTER_TEXT),
      ...(iconUrl ? { icon_url: validateAllowedMediaUrl(iconUrl) } : {}),
    };
    return this;
  }

  setAuthor(name, { url, iconUrl } = {}) {
    this.data.author = {
      name: String(name).slice(0, YAPIN_LIMITS.EMBED_AUTHOR_NAME),
      ...(url ? { url } : {}),
      ...(iconUrl ? { icon_url: validateAllowedMediaUrl(iconUrl) } : {}),
    };
    return this;
  }

  setThumbnail(url) {
    this.data.thumbnail = { url: validateAllowedMediaUrl(url) };
    return this;
  }

  setImage(url) {
    this.data.image = { url: validateAllowedMediaUrl(url) };
    return this;
  }

  setTimestamp(date = new Date()) {
    this.data.timestamp = (date instanceof Date ? date : new Date(date)).toISOString();
    return this;
  }

  toJSON() {
    return { ...this.data };
  }
}

/**
 * Verified Yapin Button Builder (`type: "button"`, styles: `primary|secondary|success|danger|link`).
 * Source: https://www.yapin.gg/developers#buttons
 */
export class ButtonBuilder {
  constructor(initial = {}) {
    this.data = { type: 'button', style: 'secondary', ...initial };
  }

  static primary(label, customId) {
    return new ButtonBuilder({ style: 'primary' }).setLabel(label).setCustomId(customId);
  }

  static secondary(label, customId) {
    return new ButtonBuilder({ style: 'secondary' }).setLabel(label).setCustomId(customId);
  }

  static success(label, customId) {
    return new ButtonBuilder({ style: 'success' }).setLabel(label).setCustomId(customId);
  }

  static danger(label, customId) {
    return new ButtonBuilder({ style: 'danger' }).setLabel(label).setCustomId(customId);
  }

  static link(label, url) {
    return new ButtonBuilder({ style: 'link' }).setLabel(label).setUrl(url);
  }

  setLabel(label) {
    const s = String(label).trim();
    if (!s || s.length > YAPIN_LIMITS.BUTTON_LABEL) {
      throw new ValidationError(`Button label must be 1-${YAPIN_LIMITS.BUTTON_LABEL} characters.`);
    }
    this.data.label = s;
    return this;
  }

  setCustomId(customId) {
    const s = String(customId).trim();
    if (!s || s.length > YAPIN_LIMITS.CUSTOM_ID) {
      throw new ValidationError(`Button custom_id must be 1-${YAPIN_LIMITS.CUSTOM_ID} characters.`);
    }
    delete this.data.url;
    this.data.custom_id = s;
    return this;
  }

  setStyle(style) {
    const s = String(style || 'secondary').trim().toLowerCase();
    if (!['primary', 'secondary', 'success', 'danger', 'link'].includes(s)) {
      throw new ValidationError(`Invalid Yapin button style "${style}".`);
    }
    this.data.style = s;
    return this;
  }

  setUrl(url) {
    const s = String(url).trim();
    if (!s.startsWith('https://')) {
      throw new ValidationError('Yapin link buttons require an https:// URL.');
    }
    delete this.data.custom_id;
    this.data.style = 'link';
    this.data.url = s;
    return this;
  }

  setEmoji(emoji) {
    this.data.emoji = String(emoji);
    return this;
  }

  setDisabled(disabled = true) {
    this.data.disabled = Boolean(disabled);
    return this;
  }

  toJSON() {
    return { ...this.data };
  }
}

/**
 * Verified Yapin ActionRow Builder (`type: "row"`, up to 5 buttons).
 */
export class ActionRowBuilder {
  constructor(...buttons) {
    this.buttons = [];
    if (buttons.length > 0) {
      this.addComponents(...buttons);
    }
  }

  addComponents(...buttons) {
    const flat = buttons.flat();
    if (this.buttons.length + flat.length > YAPIN_LIMITS.BUTTONS_PER_ROW) {
      throw new ValidationError(
        `Yapin button rows support at most ${YAPIN_LIMITS.BUTTONS_PER_ROW} buttons per row.`,
      );
    }
    this.buttons.push(...flat);
    return this;
  }

  addButtons(...buttons) {
    return this.addComponents(...buttons);
  }

  toJSON() {
    return {
      type: 'row',
      components: this.buttons.map(toPlain),
    };
  }
}

/**
 * Validates and normalizes outbound Yapin message payloads against documented limits.
 */
export function normalizeMessagePayload(options = {}, { isEdit = false, isEphemeral = false } = {}) {
  if (typeof options === 'string') {
    options = { content: options };
  }

  const body = {};

  if (options.content !== undefined) {
    if (options.content === null && isEdit) {
      body.content = null;
    } else {
      const contentStr = String(options.content);
      if (contentStr.length > YAPIN_LIMITS.MESSAGE_CONTENT) {
        throw new ValidationError(
          `Message content exceeds Yapin's ${YAPIN_LIMITS.MESSAGE_CONTENT}-character limit.`,
        );
      }
      body.content = contentStr;
    }
  }

  if (options.replyTo) {
    body.reply_to = String(options.replyTo);
  }

  if (options.embeds !== undefined) {
    if (options.embeds === null && isEdit) {
      body.embeds = null;
    } else {
      const embeds = [].concat(options.embeds).map(toPlain);
      if (embeds.length > YAPIN_LIMITS.EMBEDS_PER_MESSAGE) {
        throw new ValidationError(
          `Yapin allows at most ${YAPIN_LIMITS.EMBEDS_PER_MESSAGE} embeds per message.`,
        );
      }
      let totalChars = 0;
      for (const e of embeds) {
        totalChars +=
          (e.title?.length || 0) +
          (e.description?.length || 0) +
          (e.author?.name?.length || 0) +
          (e.footer?.text?.length || 0) +
          (e.fields || []).reduce((acc, f) => acc + (f.name?.length || 0) + (f.value?.length || 0), 0);
      }
      if (totalChars > YAPIN_LIMITS.EMBED_TOTAL_CHARS) {
        throw new ValidationError(
          `Total embed text (${totalChars}) exceeds Yapin's ${YAPIN_LIMITS.EMBED_TOTAL_CHARS}-character limit.`,
        );
      }
      body.embeds = embeds;
    }
  }

  if (options.components !== undefined) {
    if (isEphemeral && options.components && options.components.length > 0) {
      throw new ValidationError('Yapin ephemeral interaction responses cannot include buttons.');
    }
    if (options.components === null && isEdit) {
      body.components = null;
    } else {
      const rows = [].concat(options.components).map(toPlain);
      if (rows.length > YAPIN_LIMITS.ACTION_ROWS_PER_MESSAGE) {
        throw new ValidationError(
          `Yapin allows up to ${YAPIN_LIMITS.ACTION_ROWS_PER_MESSAGE} action rows per message.`,
        );
      }
      const seenCustomIds = new Set();
      for (const row of rows) {
        for (const btn of row.components || []) {
          if (btn.custom_id) {
            if (seenCustomIds.has(btn.custom_id)) {
              throw new ValidationError(
                `Duplicate button custom_id "${btn.custom_id}" in the same Yapin message.`,
              );
            }
            seenCustomIds.add(btn.custom_id);
          }
        }
      }
      body.components = rows;
    }
  }

  if (!isEdit && body.content === undefined && (!body.embeds || body.embeds.length === 0)) {
    throw new ValidationError('Yapin messages require non-empty content or at least one embed.');
  }
  if (!isEdit && body.content === '' && (!body.embeds || body.embeds.length === 0)) {
    throw new ValidationError('Yapin messages with empty content must include at least one embed.');
  }

  return body;
}

/**
 * Joins `{ messages, authors }` returned by `GET /channels/:id/messages`.
 */
function joinAuthors(out) {
  const authorMap = new Map((out?.authors || []).map((a) => [a.id, a]));
  return (out?.messages || []).map((m) => ({
    ...m,
    author: authorMap.get(m.author_id) || null,
  }));
}

/**
 * Verified Yapin Messages & Interactions API Adapter.
 */
export class YapinMessagesApi {
  /**
   * @param {import('./YapinClient.js').YapinClient} client
   */
  constructor(client) {
    this.client = client;
  }

  /**
   * Sends a message to a channel (`POST /channels/:id/messages`).
   * Setting `replyTo` on slash command responses exempts the first 5 replies from the bot-wide 30/min limit.
   */
  async sendMessage(channelId, payload, { idempotencyKey } = {}) {
    const body = normalizeMessagePayload(payload);
    const out = await this.client.request('POST', `/channels/${encodeURIComponent(channelId)}/messages`, {
      body,
      idempotencyKey,
    });
    return out.message || out;
  }

  /**
   * Replies directly to a received message quoting `message.id`.
   */
  async replyToMessage(messageEvent, payload, opts = {}) {
    const normalized = typeof payload === 'string' ? { content: payload } : { ...payload };
    return this.sendMessage(
      messageEvent.channel_id,
      { ...normalized, replyTo: messageEvent.id },
      opts,
    );
  }

  /**
   * Edits a message sent by this bot (`PATCH /channels/:id/messages/:mid`).
   */
  async editMessage(channelId, messageId, payload) {
    const body = normalizeMessagePayload(payload, { isEdit: true });
    const out = await this.client.request(
      'PATCH',
      `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
      { body },
    );
    return out.message || out;
  }

  /**
   * Deletes a message (`DELETE /channels/:id/messages/:mid`).
   */
  async deleteMessage(channelId, messageId) {
    return this.client.request(
      'DELETE',
      `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
    );
  }

  /**
   * Fetches recent messages in a channel (`GET /channels/:id/messages`), oldest first (up to 100).
   */
  async fetchMessages(channelId, { limit = 50, before, after } = {}) {
    const clampedLimit = Math.min(YAPIN_LIMITS.MESSAGES_FETCH_MAX, Math.max(1, limit));
    const out = await this.client.request(
      'GET',
      `/channels/${encodeURIComponent(channelId)}/messages`,
      {
        query: {
          limit: clampedLimit,
          before,
          after,
        },
      },
    );
    return joinAuthors(out);
  }

  /**
   * Fetches all available channel messages using forward cursor pagination (`after=isoTime`)
   * for ticket transcript archival.
   */
  async fetchChannelTranscriptMessages(channelId, { maxMessages = 500 } = {}) {
    const collected = [];
    const seenIds = new Set();
    let cursorTime = '1970-01-01T00:00:00.000Z';

    while (collected.length < maxMessages) {
      const batchSize = Math.min(YAPIN_LIMITS.MESSAGES_FETCH_MAX, maxMessages - collected.length);
      const batch = await this.fetchMessages(channelId, {
        limit: batchSize,
        after: cursorTime,
      });
      if (!batch.length) break;

      let addedNew = false;
      for (const msg of batch) {
        if (!seenIds.has(msg.id)) {
          seenIds.add(msg.id);
          collected.push(msg);
          addedNew = true;
        }
      }

      const lastMsg = batch[batch.length - 1];
      if (!addedNew || !lastMsg?.created_at || batch.length < batchSize) {
        break;
      }
      cursorTime = lastMsg.created_at;
    }

    return collected;
  }

  /**
   * Responds to a button click interaction (`POST /interactions/:id/:token/callback`).
   * Types: `'reply' | 'ephemeral' | 'update' | 'ack'`.
   * Must be answered within 3 seconds initially, and stays valid for 15 minutes (up to 10 callbacks).
   */
  async respondToInteraction(interaction, type, payload = {}) {
    if (!interaction?.id || !interaction?.token) {
      throw new ValidationError('Interaction id and token are required to send a callback.');
    }
    if (interaction.expires_at && new Date(interaction.expires_at).getTime() <= Date.now()) {
      throw new ValidationError('This Yapin button interaction has expired (15-minute window).');
    }

    let body = { type };
    if (type !== 'ack') {
      const normalized = normalizeMessagePayload(payload, {
        isEdit: type === 'update',
        isEphemeral: type === 'ephemeral',
      });
      body = { type, ...normalized };
    }

    return this.client.request(
      'POST',
      `/interactions/${encodeURIComponent(interaction.id)}/${encodeURIComponent(interaction.token)}/callback`,
      { body },
    );
  }

  /**
   * Opens a DM channel with a user (`POST /users/:id/dm`) and posts a notification message.
   * Note: Incoming messages sent by users in DMs are NOT delivered to Yapin bots as events.
   */
  async sendDirectMessage(userId, payload) {
    const dmOut = await this.client.request('POST', `/users/${encodeURIComponent(userId)}/dm`);
    if (!dmOut?.channel_id) {
      throw new ValidationError('Unable to open DM channel with user.');
    }
    return this.sendMessage(dmOut.channel_id, payload);
  }

  async pinMessage(channelId, messageId) {
    return this.client.request(
      'PUT',
      `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/pin`,
    );
  }

  /**
   * Bulk-deletes up to 100 messages in a channel (`POST /channels/:id/messages/bulk-delete`).
   * Falls back cleanly to single `DELETE` when only 1 message is targeted.
   */
  async bulkDeleteMessages(channelId, messageIds = []) {
    const ids = [...new Set(messageIds.filter(Boolean))].slice(0, YAPIN_LIMITS.BULK_DELETE_MAX);
    if (ids.length === 0) return { deletedCount: 0 };
    if (ids.length === 1) {
      await this.deleteMessage(channelId, ids[0]);
      return { deletedCount: 1 };
    }
    await this.client.request(
      'POST',
      `/channels/${encodeURIComponent(channelId)}/messages/bulk-delete`,
      { body: { message_ids: ids } },
    );
    return { deletedCount: ids.length };
  }
}
