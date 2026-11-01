import { ActionRowBuilder, ButtonBuilder, EmbedBuilder } from '../api/messages.js';
import {
  BOT_BRAND,
  DEFAULT_MOD_APP_QUESTIONS,
  EMBED_COLORS,
  resolveRankForLevel,
} from '../config/settings.js';
import { userMention } from './ids.js';

export function buildProgressBar(current, total, slots = 10) {
  const safeTotal = Math.max(1, total);
  const ratio = Math.max(0, Math.min(1, current / safeTotal));
  const filled = Math.round(ratio * slots);
  return `${'▰'.repeat(filled)}${'▱'.repeat(slots - filled)} ${Math.round(ratio * 100)}%`;
}

export function buildRulesEmbed(rawRules = '') {
  const text = Array.isArray(rawRules) ? rawRules.join('\n') : String(rawRules || '');
  return new EmbedBuilder()
    .setTitle(`MURDERMYSTERY2 | COMMUNITY STANDARDS`)
    .setColor(EMBED_COLORS.CRIMSON)
    .setDescription(text.slice(0, 4096) || 'The rulebook has not been configured yet.')
    .setFooter('MURDERMYSTERY2 • Read before participating');
}

export function buildVerificationPanelEmbed(serverConfig = {}) {
  const instant = serverConfig?.verification?.mode !== 'code';
  const modeLabel = instant ? 'Button • one-click clearance' : 'Button • private Sheriff passcode';

  return new EmbedBuilder()
    .setTitle('MURDERMYSTERY2 | VERIFICATION CENTER')
    .setColor(EMBED_COLORS.SHERIFF)
    .setDescription(
      [
        `Welcome to **${BOT_BRAND.serverName}**. Complete account verification to access member channels.`,
        '',
        '**GET STARTED**',
        '01  Review the server standards and support procedures.',
        '02  Select **Verify Account** below. Your clearance is linked to your Yapin account. Never share a password or access token.',
        '03  After verification, review `/help` and set up your character with `/character create`. For assistance, open a private support case.',
        '',
        '**VERIFICATION**  MM2 Helper records your clearance and assigns the configured member role. If Yapin cannot apply the role, verification is not marked complete. Contact staff through a support case.',
      ].join('\n'),
    )
    .addField('METHOD', modeLabel, true)
    .addField('SUPPORT', 'Private support • Case tracking • Staff review', true)
    .setFooter('MURDERMYSTERY2 • SERVER ACCESS');
}

export function buildVerificationPanelRows() {
  return [
    new ActionRowBuilder().addButtons(
      new ButtonBuilder()
        .setCustomId('mm2:verify:start')
        .setLabel('Verify Account')
        .setStyle('success'),
      new ButtonBuilder()
        .setCustomId('mm2:verify:rules')
        .setLabel('View Rules')
        .setStyle('secondary'),
      new ButtonBuilder()
        .setCustomId('mm2:verify:help')
        .setLabel('Help')
        .setStyle('primary'),
    ),
  ];
}

export function buildTicketPanelEmbed() {
  return new EmbedBuilder()
    .setTitle('MURDERMYSTERY2 | SUPPORT CENTER')
    .setColor(EMBED_COLORS.DETECTIVE)
    .setDescription(
      [
        'Choose a category to contact the **MurderMystery2** staff team. Your request is handled in a **private, staff-scoped case channel**. Never include passwords, access tokens, or unnecessary personal information.',
        '',
        '• **GENERAL SUPPORT** — Server questions, account access, or technical help',
        '• **CHARACTER SUPPORT** — Character profile or community guidance',
        '• **INCIDENT REPORT** — Submit relevant context or evidence privately',
        '• **APPEAL** — Request a review of a warning or restriction',
        '• **STAFF CONCERN** — Restricted report visible to authorized administrators',
      ].join('\n'),
    )
    .setFooter(BOT_BRAND.footer);
}

export function buildTicketPanelRows() {
  return [
    new ActionRowBuilder().addButtons(
      new ButtonBuilder()
        .setCustomId('mm2:ticket:open:GENERAL_SUPPORT')
        .setLabel('General Support')
        .setStyle('primary'),
      new ButtonBuilder()
        .setCustomId('mm2:ticket:open:RP_CHARACTER')
        .setLabel('Character Support')
        .setStyle('secondary'),
      new ButtonBuilder()
        .setCustomId('mm2:ticket:open:RULE_VIOLATION')
        .setLabel('Report an Incident')
        .setStyle('danger'),
    ),
    new ActionRowBuilder().addButtons(
      new ButtonBuilder()
        .setCustomId('mm2:ticket:open:APPEAL')
        .setLabel('Appeal a Decision')
        .setStyle('secondary'),
      new ButtonBuilder()
        .setCustomId('mm2:ticket:open:STAFF_REPORT')
        .setLabel('Staff Concern')
        .setStyle('danger'),
    ),
  ];
}

export function buildTicketEmbed(ticket) {
  return new EmbedBuilder()
    .setTitle(`SUPPORT CASE | ${ticket.ticketId}`)
    .setColor(ticket.status === 'CLOSED' ? EMBED_COLORS.NEUTRAL : EMBED_COLORS.DETECTIVE)
    .addField('CATEGORY', `\`${ticket.type}\``, true)
    .addField('STATUS', `\`${ticket.status}\``, true)
    .addField('Opened By', userMention(ticket.creatorId), true)
    .addField(
      'ASSIGNED STAFF',
      ticket.assignedStaffId ? userMention(ticket.assignedStaffId) : '*Unclaimed*',
      true,
    )
    .addField('SUBJECT', ticket.subject, false)
    .addField('DETAILS', ticket.description, false)
    .setFooter(BOT_BRAND.footer);
}

export function buildTicketRoomRows(ticket) {
  if (ticket.status === 'CLOSED') return [];
  return [
    new ActionRowBuilder().addButtons(
      new ButtonBuilder()
        .setCustomId(`mm2:ticket:claim:${ticket.ticketId}`)
        .setLabel('Claim Case')
        .setStyle('primary'),
      new ButtonBuilder()
        .setCustomId(`mm2:ticket:close:${ticket.ticketId}`)
        .setLabel('Close Case')
        .setStyle('danger'),
    ),
  ];
}

export function buildApplicationPanelEmbed(serverConfig = {}) {
  const isOpen = serverConfig?.applications?.open !== false;
  const minLevel = serverConfig?.applications?.minLevel || 1;

  return new EmbedBuilder()
    .setTitle('MURDERMYSTERY2 | STAFF APPLICATIONS')
    .setColor(isOpen ? EMBED_COLORS.SHERIFF : EMBED_COLORS.DANGER)
    .setDescription(
      [
        `Applications to join the **${BOT_BRAND.serverName}** staff team are reviewed by authorized administrators.`,
        '',
        `**STATUS:** ${isOpen ? 'OPEN' : 'CLOSED'}`,
        `**MINIMUM LEVEL:** \`${minLevel}\``,
        '',
        '**APPLICATION INFORMATION**',
        ...DEFAULT_MOD_APP_QUESTIONS.map((q) => `• ${q}`),
        '',
        'Use the application guide for the required `/apply` format. You can check your submission status at any time.',
      ].join('\n'),
    )
    .setFooter(BOT_BRAND.footer);
}

export function buildApplicationPanelRows() {
  return [
    new ActionRowBuilder().addButtons(
      new ButtonBuilder()
        .setCustomId('mm2:app:guide')
        .setLabel('Application Guide')
        .setStyle('success'),
      new ButtonBuilder()
        .setCustomId('mm2:app:status')
        .setLabel('Check Application Status')
        .setStyle('primary'),
    ),
  ];
}

export function buildApplicationReviewEmbed(app, userRecord = null) {
  const colorMap = {
    PENDING: EMBED_COLORS.SHERIFF,
    UNDER_REVIEW: EMBED_COLORS.DETECTIVE,
    ACCEPTED: EMBED_COLORS.SUCCESS,
    DENIED: EMBED_COLORS.DANGER,
  };

  const embed = new EmbedBuilder()
    .setTitle(`STAFF APPLICATION | ${app.applicationId}`)
    .setColor(colorMap[app.status] || EMBED_COLORS.INFO)
    .addField('APPLICANT', `${userMention(app.applicantId)} (${app.applicantUsername || app.applicantId})`, true)
    .addField('STATUS', `\`${app.status}\``, true)
    .addField(
      'REVIEW SUMMARY',
      `Level **${app.levelAtApply}** • Warns: **${userRecord?.moderation?.activeWarnCount || 0}**`,
      true,
    )
    .addField('01 | AGE & TIMEZONE', `${app.answers.age} | ${app.answers.timezone}`, true)
    .addField('02 | AVAILABILITY', app.answers.hours, true)
    .addField('03 | COMMUNITY EXPERIENCE', app.answers.experience, false)
    .addField('04 | MOTIVATION', app.answers.reason, false)
    .addField('05 | INCIDENT REVIEW', app.answers.scenario, false)
    .setFooter(BOT_BRAND.footer);

  if (app.reviewerId) {
    embed.addField(
      'REVIEWED BY',
      `${userMention(app.reviewerId)}${app.reviewNotes ? ` — ${app.reviewNotes}` : ''}`,
      false,
    );
  }
  return embed;
}

export function buildApplicationReviewRows(app) {
  if (app.status === 'ACCEPTED' || app.status === 'DENIED') {
    return [];
  }
  return [
    new ActionRowBuilder().addButtons(
      new ButtonBuilder()
        .setCustomId(`mm2:app:review:${app.applicationId}`)
        .setLabel('Mark Under Review')
        .setStyle('secondary'),
      new ButtonBuilder()
        .setCustomId(`mm2:app:accept:${app.applicationId}`)
        .setLabel('Accept')
        .setStyle('success'),
      new ButtonBuilder()
        .setCustomId(`mm2:app:deny:${app.applicationId}`)
        .setLabel('Decline')
        .setStyle('danger'),
    ),
  ];
}

export function buildRankCardEmbed(user, rankPositionOrOpts = {}, maybeXpNeeded = 100) {
  const rankPosition =
    typeof rankPositionOrOpts === 'object' && rankPositionOrOpts !== null
      ? rankPositionOrOpts.rankPosition
      : rankPositionOrOpts;
  const xpNeeded =
    typeof rankPositionOrOpts === 'object' && rankPositionOrOpts !== null
      ? (rankPositionOrOpts.xpNeeded ?? 100)
      : maybeXpNeeded;
  const lv = user.leveling || {};
  const rankMeta = resolveRankForLevel(lv.level || 1);
  const activeChar = (user.characters || []).find((c) => c.characterId === user.activeCharacterId);

  const embed = new EmbedBuilder()
    .setTitle(`MURDERMYSTERY2 | MEMBER PROFILE | ${user.lastKnownUsername || user.yapinUserId}`)
    .setColor(rankMeta.color)
    .setDescription(
      `**Rank Title:** ${rankMeta.title}\n**Progress:** \`${buildProgressBar(lv.xp || 0, xpNeeded)}\` (\`${lv.xp || 0} / ${xpNeeded} XP\`)`,
    )
    .addField('LEVEL', `**${lv.level || 1}**`, true)
    .addField('TOTAL XP', `**${lv.totalXp || 0}**`, true)
    .addField('LEADERBOARD', rankPosition ? `**#${rankPosition}**` : 'Unranked', true)
    .addField('COINS', `🪙 **${lv.coins || 0}**`, true)
    .addField('MESSAGES / SCENE POSTS', `${lv.messagesCount || 0} / ${lv.rpPostsCount || 0}`, true)
    .addField(
      'VERIFICATION',
      user.verification?.verified ? '🟢 Verified Citizen' : '⏳ Unverified',
      true,
    )
    .setFooter(BOT_BRAND.footer);

  if (activeChar) {
    embed.addField(
      'ACTIVE CHARACTER',
      `**${activeChar.name}** (\`${activeChar.alignment}\`) • Signature: *${activeChar.weapon}*`,
      false,
    );
  }
  if (Array.isArray(lv.badges) && lv.badges.length > 0) {
    embed.addField('BADGES', lv.badges.join(' • '), false);
  }
  return embed;
}

export function buildModCaseEmbed(modCase) {
  const actionColors = {
    WARN: EMBED_COLORS.WARNING,
    AUTOMOD_WARN: EMBED_COLORS.WARNING,
    MUTE: EMBED_COLORS.MURDERER,
    AUTOMOD_MUTE: EMBED_COLORS.MURDERER,
    UNMUTE: EMBED_COLORS.SUCCESS,
    KICK: EMBED_COLORS.DANGER,
    BAN: EMBED_COLORS.DANGER,
    UNBAN: EMBED_COLORS.SUCCESS,
  };

  const embed = new EmbedBuilder()
    .setTitle(`⚖️ Sheriff Case File #${modCase.caseNumber} (${modCase.caseId})`)
    .setColor(actionColors[modCase.action] || EMBED_COLORS.NOIR)
    .addField('Action', `\`${modCase.action}\``, true)
    .addField('Target', userMention(modCase.targetUserId), true)
    .addField('Enforcing Officer', userMention(modCase.moderatorId), true)
    .addField('STATUS', modCase.active ? '🟢 Active on Record' : '⚪ Pardoned / Expired', true)
    .addField('Reason', modCase.reason, false)
    .setFooter(BOT_BRAND.footer);

  if (modCase.expiresAt) {
    embed.addField('Expires At', new Date(modCase.expiresAt).toISOString(), true);
  }
  if (modCase.voidedBy) {
    embed.addField(
      'Voided By',
      `${userMention(modCase.voidedBy)} — ${modCase.voidReason || 'Cleared'}`,
      false,
    );
  }
  return embed;
}

export function buildMysteryLobbyEmbed(round) {
  const statusText =
    round.status === 'LOBBY'
      ? '🟡 **Recruiting Suspects** — Click **Join Mystery Round**!'
      : round.status === 'ACTIVE'
        ? '🔴 **Murderer Loose!** — Click **Reveal My Secret Role** below!'
        : '⚪ **Round Concluded**';

  return new EmbedBuilder()
    .setTitle(`🔪 MurderMystery2 Live Round • ${round.map.name} (${round.roundId})`)
    .setColor(round.status === 'ACTIVE' ? EMBED_COLORS.MURDERER : EMBED_COLORS.SHERIFF)
    .setDescription(`${round.map.vibe}\n\n${statusText}`)
    .addField('Host', userMention(round.hostId), true)
    .addField('Players Joined', `**${round.players.length}** (min 3 to draw roles)`, true)
    .addField(
      'Roster',
      round.players.length > 0 ? round.players.map(userMention).join(', ') : '*No players yet*',
      false,
    )
    .setFooter(BOT_BRAND.footer);
}

export function buildMysteryLobbyRows(round) {
  if (round.status === 'ENDED') return [];
  if (round.status === 'LOBBY') {
    return [
      new ActionRowBuilder().addButtons(
        new ButtonBuilder()
          .setCustomId(`mm2:mystery:join:${round.roundId}`)
          .setLabel('🔪 Join Mystery Round')
          .setStyle('success'),
        new ButtonBuilder()
          .setCustomId(`mm2:mystery:leave:${round.roundId}`)
          .setLabel('🚪 Leave')
          .setStyle('secondary'),
        new ButtonBuilder()
          .setCustomId(`mm2:mystery:draw:${round.roundId}`)
          .setLabel('🎲 Draw Secret Roles (Host/Staff)')
          .setStyle('primary'),
      ),
    ];
  }
  return [
    new ActionRowBuilder().addButtons(
      new ButtonBuilder()
        .setCustomId(`mm2:mystery:reveal:${round.roundId}`)
        .setLabel('🎭 Reveal My Secret Role (Private)')
        .setStyle('danger'),
    ),
  ];
}

export function buildSelfRolesPanelEmbed(selfRoles = {}) {
  const entries = Object.entries(selfRoles);
  const desc =
    entries.length > 0
      ? entries.map(([key, roleId]) => `• **${key}** -> <@&${roleId}>`).join('\n')
      : '*No self-assignable community roles are configured yet. Admins can add them with `/config selfrole <key> <roleId>`.*';

  return new EmbedBuilder()
    .setTitle('MURDERMYSTERY2 | NOTIFICATION SETTINGS')
    .setColor(EMBED_COLORS.CHROMA)
    .setDescription(`Select a button to manage your **MurderMystery2** notifications and member roles.\n\n${desc}`)
    .setFooter(BOT_BRAND.footer);
}

export function buildSelfRolesRows(selfRoles = {}) {
  const keys = Object.keys(selfRoles).slice(0, 15);
  if (keys.length === 0) return [];
  const rows = [];
  for (let i = 0; i < keys.length; i += 5) {
    const chunk = keys.slice(i, i + 5);
    rows.push(
      new ActionRowBuilder().addButtons(
        ...chunk.map((key) =>
          new ButtonBuilder()
            .setCustomId(`mm2:selfrole:${key}`)
            .setLabel(String(key).slice(0, 80))
            .setStyle('secondary'),
        ),
      ),
    );
  }
  return rows;
}

export const buildMysteryRoundEmbed = buildMysteryLobbyEmbed;
export const buildMysteryRoundRows = buildMysteryLobbyRows;
export const buildSelfRolesEmbed = buildSelfRolesPanelEmbed;
