/**
 * Verified Yapin.gg platform limits, permission flags, and MurderMystery2 community settings
 * for **MM2 Helper** (Server: **MurderMystery2**).
 * Source: https://www.yapin.gg/developers (https://www.yapper.website/developers)
 */

export const BOT_BRAND = Object.freeze({
  name: 'MM2 Helper',
  botName: 'MM2 Helper',
  serverName: 'MurderMystery2',
  statusText: '/verify • MurderMystery2',
  tagline: 'MM2 Helper • Verification, Support, Cases & Community',
  footer: 'MurderMystery2 • MM2 Helper',
});

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

// Only permission flags explicitly documented by Yapin's bot API are used for RBAC.
// `perms.*` entries are normalized by YapinPermissionsApi before being checked.
export const YAPIN_PERMISSIONS = Object.freeze({
  MANAGE_SERVER: 'manage_server',
  MANAGE_MESSAGES: 'manage_messages',
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

// MurderMystery2 visual palette
export const EMBED_COLORS = Object.freeze({
  PRIMARY: 0xdc2626, // MM2 Crimson
  CRIMSON: 0xdc2626,
  MURDERER: 0xdc2626,
  SHERIFF: 0xf59e0b,
  GOLD: 0xf59e0b,
  INNOCENT: 0x10b981,
  DETECTIVE: 0x4f46e5,
  MYSTERY: 0x7c3aed,
  CHROMA: 0xa855f7,
  GODLY: 0xec4899,
  SUCCESS: 0x10b981,
  WARNING: 0xf59e0b,
  DANGER: 0xef4444,
  INFO: 0x3b82f6,
  NOIR: 0x1e293b,
  NEUTRAL: 0x64748b,
});

export const MM2_MAPS = Object.freeze([
  { id: 'Mansion', emoji: '🏚️', name: 'The Mansion', vibe: 'Stormy gothic estate filled with secret passages and flickering chandeliers.' },
  { id: 'Factory', emoji: '🏭', name: 'Nikilis Factory', vibe: 'Industrial assembly floor, catwalks, crates, and shadowy vents.' },
  { id: 'Hotel', emoji: '🏨', name: 'Grand Hotel', vibe: 'Luxury suites, elevator shafts, and a tense lobby full of suspects.' },
  { id: 'MilBase', emoji: '🪖', name: 'Military Base', vibe: 'High-security bunkers, armory lockers, and radar towers.' },
  { id: 'PoliceHQ', emoji: '🚓', name: 'Police Station HQ', vibe: 'Interrogation rooms, evidence lockers, holding cells, and Sheriff dispatch.' },
  { id: 'BioLab', emoji: '🧪', name: 'BioLab Facility', vibe: 'Containment chambers, glowing vials, and sealed blast doors.' },
  { id: 'Bank', emoji: '🏦', name: 'Downtown Bank', vibe: 'Reinforced underground vault, laser security grid, and marble lobby.' },
  { id: 'ResearchFacility', emoji: '🔬', name: 'Research Facility', vibe: 'Classified testing wing deep beneath MurderMystery2 city.' },
  { id: 'House2', emoji: '🏡', name: 'Suburban House 2', vibe: 'Quiet two-story neighborhood home hiding dark secrets in the basement.' },
  { id: 'Office3', emoji: '🏢', name: 'High-Rise Office 3', vibe: 'Late-night executive floor with glass conference rooms and server racks.' },
]);

export const MM2_ALIGNMENTS = Object.freeze([
  'INNOCENT',
  'SHERIFF',
  'DETECTIVE',
  'MURDERER',
  'CIVILIAN',
  'SUSPECT',
]);

export const MM2_LEVEL_RANKS = Object.freeze([
  { minLevel: 75, title: "👑 Nikilis's Chosen", color: EMBED_COLORS.CHROMA },
  { minLevel: 50, title: '🌈 Chroma Master', color: EMBED_COLORS.CHROMA },
  { minLevel: 40, title: '💎 Godly Veteran', color: EMBED_COLORS.GODLY },
  { minLevel: 30, title: '🗡️ Elite Assassin', color: EMBED_COLORS.MURDERER },
  { minLevel: 20, title: '🔫 Head Sheriff', color: EMBED_COLORS.SHERIFF },
  { minLevel: 15, title: '⭐ Deputy Sheriff', color: EMBED_COLORS.SHERIFF },
  { minLevel: 10, title: '🕵️ Lead Detective', color: EMBED_COLORS.DETECTIVE },
  { minLevel: 5, title: '🔦 Junior Investigator', color: EMBED_COLORS.INFO },
  { minLevel: 2, title: '🟢 Innocent Survivor', color: EMBED_COLORS.INNOCENT },
  { minLevel: 0, title: '🎭 New Suspect', color: EMBED_COLORS.NEUTRAL },
]);

export function resolveRankForLevel(level = 1) {
  for (const rank of MM2_LEVEL_RANKS) {
    if (level >= rank.minLevel) return rank;
  }
  return MM2_LEVEL_RANKS[MM2_LEVEL_RANKS.length - 1];
}

export const DEFAULT_SERVER_RULES = [
  '**MURDERMYSTERY2 — COMMUNITY STANDARDS**',
  '_Member conduct, character scenes, and staff procedures._',
  '',
  '**1. Treat members with respect.** No hate speech, threats, harassment, doxxing, sexual harassment, or repeated unwanted contact. Stop when asked. Keep personal disputes out of public channels.',
  '',
  '**2. Keep character actions separate from outside information.** Do not use private messages, streams, profiles, or information learned outside a scene to influence what your character knows or does. Mark out-of-character discussion clearly.',
  '',
  '**3. Make scenes collaborative.** Describe what your character attempts; do not decide another person’s actions, thoughts, injuries, or outcome. Give others a reasonable chance to respond. Use `/rp roll` when participants cannot agree on a fair outcome.',
  '',
  '**4. No random attacks or forced outcomes.** An attack, accusation, arrest, or detention needs a clear in-character reason and reasonable buildup. Do not repeatedly target someone or use a game-round result to justify harassment.',
  '',
  '**5. Keep characters consistent and appropriate.** No impossible abilities, instant travel, unexplained knowledge, or changing identity to evade consequences. Respect the agreed setting and other members’ boundaries.',
  '',
  '**6. Staff authority has limits.** Follow reasonable server directions. Staff must act within their assigned permissions, explain consequential decisions, avoid personal conflicts of interest, and protect private reports.',
  '',
  '**7. Protect accounts and personal information.** No impersonation, fabricated evidence, phishing, scam or invite spam, malicious links, or disclosure of private information. Never post passwords, tokens, or private ticket contents.',
  '',
  '**8. Keep channels usable.** Use the right channel; no spam, flooding, mention abuse, disruptive formatting, or restriction evasion with alternate accounts.',
  '',
  '**9. Reports are leads, not verdicts.** Submit a truthful report with relevant context through `/report` or a private ticket. Do not organize pile-ons or publish accusations. Staff review context and all available accounts; a report alone is not proof.',
  '',
  '**10. Moderation and appeals.** Staff may remove harmful content and apply proportionate action based on context, evidence, and prior history. Do not evade an active restriction. Appeal calmly through a private ticket.',
  '',
  '**11. Platform rules apply.** Yapin.gg rules apply throughout the server. Staff may pause a scene or move discussion to a private ticket to protect members or review a case.',
  '',
  '**Getting started:** review these standards, complete verification using the button above, then use `/help` and `/character create`. Open a support ticket if you need assistance.',
].join('\n');

export const DEFAULT_MOD_APP_QUESTIONS = Object.freeze([
  '1. Age / Maturity & Timezone',
  '2. Daily active hours on MurderMystery2',
  '3. Past Moderation / Community Staff Experience',
  '4. Why do you want to join the MurderMystery2 Staff Team?',
  '5. Scenario: Two members give conflicting accounts of an unprovoked attack at the Mansion. How would you review it fairly?',
]);

export const DEFAULT_COOLDOWNS = Object.freeze({
  defaultCommandMs: 2000,
  verifyAttemptMs: 5000,
  ticketCreateMs: 20000,
  reportCreateMs: 15000,
  applicationSubmitMs: 30000,
  xpGainCooldownMs: 45000,
  buttonClickMs: 1500,
});
