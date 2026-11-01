/**
 * Verified Yapin.gg platform limits, permission flags, and default application settings.
 * Source: https://www.yapin.gg/developers (https://www.yapper.website/developers)
 */

export const YAPIN_LIMITS = Object.freeze({
  MESSAGE_CONTENT: 2000,
  EMBEDS_PER_MESSAGE: 5,
  EMBED_TITLE: 256,
  EMBED_DESCRIPTION: 4096,
  EMBED_FIELDS: 10,
  EMBED_FIELD_NAME: 256,
  EMBED_FIELD_VALUE: 1024,
  EMBED_AUTHOR_NAME: 256,
  EMBED_FOOTER_TEXT: 2048,
  EMBED_TOTAL_CHARS: 6000,
  EMBED_URL: 512,
  ACTION_ROWS_PER_MESSAGE: 5,
  BUTTONS_PER_ROW: 5,
  BUTTON_LABEL: 80,
  CUSTOM_ID: 100,
  COMPONENTS_V2_FLAG: 1 << 15, // 32768
  COMPONENTS_V2_TOTAL: 40,
  COMPONENTS_V2_TEXT: 4000,
  MAX_COMMANDS: 100,
  COMMAND_NAME_MAX: 32,
  COMMAND_DESCRIPTION_MAX: 100,
  BULK_DELETE_MAX: 100,
  MESSAGES_FETCH_MAX: 100,
  MEMBERS_PAGE_MAX: 500,
  MEMBERS_DEFAULT_PAGE: 200,
  INTERACTION_ACK_WINDOW_MS: 3000,
  INTERACTION_TTL_MS: 15 * 60 * 1000,
  INTERACTION_MAX_RESPONSES: 10,
  EVENT_POLL_MAX_WAIT_SECONDS: 20,
  EVENT_MAX_AGE_SECONDS: 86400,
  CHANNEL_CREATE_PER_MIN: 10,
  MESSAGES_PER_MIN_SERVER: 30,
  SLOWMODE_MAX_SECONDS: 21600,
  TIMEOUT_MAX_MINUTES: 40320,
});

export const YAPIN_PERMISSIONS = Object.freeze({
  MANAGE_SERVER: 'manage_server',
  MANAGE_MESSAGES: 'manage_messages',
  MANAGE_ROLES: 'manage_roles',
  MANAGE_CHANNELS: 'manage_channels',
  MANAGE_NICKNAMES: 'manage_nicknames',
  MANAGE_WEBHOOKS: 'manage_webhooks',
  KICK_MEMBERS: 'kick_members',
  BAN_MEMBERS: 'ban_members',
  TIMEOUT_MEMBERS: 'timeout_members',
  MOVE_MEMBERS: 'move_members',
  CONNECT: 'connect',
  SPEAK: 'speak',
});

export const ALLOWED_MEDIA_HOSTS = Object.freeze([
  'files.yapper.website',
  'www.yapin.gg',
  'yapin.gg',
  'i.imgur.com',
  'media.tenor.com',
  'media.giphy.com',
  'i.giphy.com',
  'upload.wikimedia.org',
  'raw.githubusercontent.com',
  'avatars.githubusercontent.com',
  'user-images.githubusercontent.com',
  'i.ytimg.com',
  'cdn.discordapp.com',
  'media.discordapp.net',
  'pbs.twimg.com',
  'i.redd.it',
  'static-cdn.jtvnw.net',
  'i.scdn.co',
  's4.anilist.co',
  'cdn.myanimelist.net',
  'nekos.best',
  'cdn.weeb.sh',
]);

export const EMBED_COLORS = Object.freeze({
  PRIMARY: 0x5865f2,
  SUCCESS: 0x57f287,
  WARNING: 0xfee75c,
  DANGER: 0xed4245,
  INFO: 0x3498db,
  NEUTRAL: 0x95a5a6,
  YAPIN: 0xff6b4a,
  DISPUTE: 0xe67e22,
});

export const DEFAULT_COORDINATION_DISCLAIMER =
  'IMPORTANT NOTICE: This bot is a Middleman Coordination & Verification assistant for Yapin.gg. ' +
  'It does NOT hold, custody, transfer, or escrow digital assets, cryptocurrency, cash, or game items automatically. ' +
  'Never send items or funds until a verified server Middleman is assigned in this trade record and explicitly instructs you.';

export const DEFAULT_TRADING_RULES = [
  '1. Verify stable Yapin User IDs (`<@user_id>`) before every trade; never rely on display names or avatars.',
  '2. Only deal inside official server channels with an authorized Middleman assigned in the bot trade record.',
  '3. Never send assets in DMs. Yapin bots do not receive incoming DM events and staff will never conduct middleman trades in DMs.',
  '4. Reporting a deposit (`/deposit`) marks it as `REPORTED_SENT` only; wait for the assigned Middleman to verify and mark it `CONFIRMED`.',
  '5. Provide honest transaction references or evidence links. Fabricated evidence or impersonation results in immediate suspension.',
  '6. If anything looks wrong, run `/dispute` immediately to freeze trade completion until staff review.',
].join('\n');

export const DEFAULT_COOLDOWNS = Object.freeze({
  defaultCommandMs: 2500,
  tradeCreateMs: 15000,
  ticketCreateMs: 20000,
  reportCreateMs: 15000,
  buttonClickMs: 1500,
});

export const DEFAULT_TRADE_LIMITS = Object.freeze({
  maxActiveTradesPerUser: 3,
  maxOpenTicketsPerUser: 2,
  tradeExpirationHours: 48,
  maxMiddlemanActiveWorkload: 5,
  allowSelfTrade: false,
  autoAssignMiddleman: false,
  requireFinalStaffConfirmationFlag: true,
});
