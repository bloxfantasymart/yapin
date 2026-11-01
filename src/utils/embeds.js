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
    .setTitle(`📜 ${BOT_BRAND.serverName} • Roleplay & Community Rulebook`)
    .setColor(EMBED_COLORS.CRIMSON)
    .setDescription(text.slice(0, 4096) || 'The rulebook has not been configured yet.')
    .setFooter('Read before participating • Reports are reviewed, not treated as proof');
}

export function buildVerificationPanelEmbed(serverConfig = {}) {
  const instant = serverConfig?.verification?.mode !== 'code';
  const modeLabel = instant ? 'Button • one-click clearance' : 'Button • private Sheriff passcode';

  return new EmbedBuilder()
    .setTitle('🛡️ Sheriff Checkpoint • New Citizen Intake')
    .setColor(EMBED_COLORS.SHERIFF)
    .setDescription(
      [
        `Welcome to **${BOT_BRAND.serverName}**, a Murder Mystery 2 roleplay community. This is the official entrance to the city.`,
        '',
        '**Before you enter:**',
        '1. Read the rules and understand fair-play RP, IC/OOC boundaries, and how reports are handled.',
        '2. Press **Verify at Checkpoint**. Clearance is tied to your Yapin account; staff will never ask you to post a password or token.',
        '3. Once cleared, create your character with `/character create`, check `/help`, and open a private support ticket if you need assistance.',
        '',
        '**What happens when you verify?** MM2 Helper records your clearance and grants the configured Verified Citizen role. If role assignment is unavailable, clearance is not reported as successful; contact staff through a ticket.',
      ].join('\n'),
    )
    .addField('Checkpoint process', modeLabel, true)
    .addField('Keep the city fair', 'No RDM / forced outcomes • No metagaming • Respect privacy • Use private reports', true)
    .setFooter('MurderMystery2 Sheriff HQ • Powered by MM2 Helper');
}

export function buildVerificationPanelRows() {
  return [
    new ActionRowBuilder().addButtons(
      new ButtonBuilder()
        .setCustomId('mm2:verify:start')
        .setLabel('🛡️ Verify at Checkpoint')
        .setStyle('success'),
      new ButtonBuilder()
        .setCustomId('mm2:verify:rules')
        .setLabel('📜 Read RP Rules')
        .setStyle('secondary'),
      new ButtonBuilder()
        .setCustomId('mm2:verify:help')
        .setLabel('❓ Checkpoint Help')
        .setStyle('primary'),
    ),
  ];
}

export function buildTicketPanelEmbed() {
  return new EmbedBuilder()
    .setTitle('🕵️ MurderMystery2 • Detective Bureau & Support Desk')
    .setColor(EMBED_COLORS.DETECTIVE)
    .setDescription(
      [
        'Need assistance from the **MurderMystery2** Staff or Lore Team? Select a category to request a **private, staff-scoped case channel**. Do not submit passwords, tokens, or unnecessary personal information:',
        '',
        '• **🎫 General Support** — Server questions, role issues, or technical help',
        '• **🎭 Character / Lore** — Custom RP character, faction, or storyline approval',
        '• **🚨 Report FailRP / RDM** — Submit clips/evidence of rulebreakers privately',
        '• **⚖️ Punishment Appeal** — Appeal a mute, warning, or restriction respectfully',
        '• **🛡️ Staff Report** — Confidential report visible **strictly to Server Admins**',
      ].join('\n'),
    )
    .setFooter(BOT_BRAND.footer);
}

export function buildTicketPanelRows() {
  return [
    new ActionRowBuilder().addButtons(
      new ButtonBuilder()
        .setCustomId('mm2:ticket:open:GENERAL_SUPPORT')
        .setLabel('🎫 General Support')
        .setStyle('primary'),
      new ButtonBuilder()
        .setCustomId('mm2:ticket:open:RP_CHARACTER')
        .setLabel('🎭 Character / Lore')
        .setStyle('secondary'),
      new ButtonBuilder()
        .setCustomId('mm2:ticket:open:RULE_VIOLATION')
        .setLabel('🚨 Report FailRP/RDM')
        .setStyle('danger'),
    ),
    new ActionRowBuilder().addButtons(
      new ButtonBuilder()
        .setCustomId('mm2:ticket:open:APPEAL')
        .setLabel('⚖️ Punishment Appeal')
        .setStyle('secondary'),
      new ButtonBuilder()
        .setCustomId('mm2:ticket:open:STAFF_REPORT')
        .setLabel('🛡️ Staff Report (Admin Only)')
        .setStyle('danger'),
    ),
  ];
}

export function buildTicketEmbed(ticket) {
  return new EmbedBuilder()
    .setTitle(`📂 Case Ticket • ${ticket.ticketId}`)
    .setColor(ticket.status === 'CLOSED' ? EMBED_COLORS.NEUTRAL : EMBED_COLORS.DETECTIVE)
    .addField('Category', `\`${ticket.type}\``, true)
    .addField('Status', `\`${ticket.status}\``, true)
    .addField('Opened By', userMention(ticket.creatorId), true)
    .addField(
      'Assigned Staff',
      ticket.assignedStaffId ? userMention(ticket.assignedStaffId) : '*Unclaimed*',
      true,
    )
    .addField('Subject', ticket.subject, false)
    .addField('Details', ticket.description, false)
    .setFooter(BOT_BRAND.footer);
}

export function buildTicketRoomRows(ticket) {
  if (ticket.status === 'CLOSED') return [];
  return [
    new ActionRowBuilder().addButtons(
      new ButtonBuilder()
        .setCustomId(`mm2:ticket:claim:${ticket.ticketId}`)
        .setLabel('🙋 Claim Case (Staff)')
        .setStyle('primary'),
      new ButtonBuilder()
        .setCustomId(`mm2:ticket:close:${ticket.ticketId}`)
        .setLabel('🔒 Close & Save Transcript')
        .setStyle('danger'),
    ),
  ];
}

export function buildApplicationPanelEmbed(serverConfig = {}) {
  const isOpen = serverConfig?.applications?.open !== false;
  const minLevel = serverConfig?.applications?.minLevel || 1;

  return new EmbedBuilder()
    .setTitle('⭐ MurderMystery2 • Sheriff Academy (Moderator Applications)')
    .setColor(isOpen ? EMBED_COLORS.SHERIFF : EMBED_COLORS.DANGER)
    .setDescription(
      [
        `Want to help keep **${BOT_BRAND.serverName}** fair, immersive, and drama-free?`,
        '',
        `**Recruitment Status:** ${isOpen ? '🟢 **OPEN**' : '🔴 **CLOSED**'}`,
        `**Minimum Rank Requirement:** Level \`${minLevel}\``,
        '',
        '**Required Application Questions:**',
        ...DEFAULT_MOD_APP_QUESTIONS.map((q) => `• ${q}`),
        '',
        'Click **📋 How to Apply** below for the exact `/apply` command template, or check your existing submission anytime!',
      ].join('\n'),
    )
    .setFooter(BOT_BRAND.footer);
}

export function buildApplicationPanelRows() {
  return [
    new ActionRowBuilder().addButtons(
      new ButtonBuilder()
        .setCustomId('mm2:app:guide')
        .setLabel('📋 How to Apply (/apply)')
        .setStyle('success'),
      new ButtonBuilder()
        .setCustomId('mm2:app:status')
        .setLabel('📩 My Application Status')
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
    .setTitle(`📋 Moderator Application • ${app.applicationId}`)
    .setColor(colorMap[app.status] || EMBED_COLORS.INFO)
    .addField('Applicant', `${userMention(app.applicantId)} (${app.applicantUsername || app.applicantId})`, true)
    .addField('Status', `\`${app.status}\``, true)
    .addField(
      'Standing',
      `Level **${app.levelAtApply}** • Warns: **${userRecord?.moderation?.activeWarnCount || 0}**`,
      true,
    )
    .addField('1. Age & Timezone', `${app.answers.age} | ${app.answers.timezone}`, true)
    .addField('2. Daily Availability', app.answers.hours, true)
    .addField('3. Past Staff / RP Experience', app.answers.experience, false)
    .addField('4. Motivation for MurderMystery2', app.answers.reason, false)
    .addField('5. RDM / FailRP Scenario Response', app.answers.scenario, false)
    .setFooter(BOT_BRAND.footer);

  if (app.reviewerId) {
    embed.addField(
      'Reviewed By',
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
        .setLabel('🔎 Under Review')
        .setStyle('secondary'),
      new ButtonBuilder()
        .setCustomId(`mm2:app:accept:${app.applicationId}`)
        .setLabel('✅ Accept (Trial Mod)')
        .setStyle('success'),
      new ButtonBuilder()
        .setCustomId(`mm2:app:deny:${app.applicationId}`)
        .setLabel('❌ Deny')
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
    .setTitle(`🎖️ MurderMystery2 Dossier • ${user.lastKnownUsername || user.yapinUserId}`)
    .setColor(rankMeta.color)
    .setDescription(
      `**Rank Title:** ${rankMeta.title}\n**Progress:** \`${buildProgressBar(lv.xp || 0, xpNeeded)}\` (\`${lv.xp || 0} / ${xpNeeded} XP\`)`,
    )
    .addField('Level', `**${lv.level || 1}**`, true)
    .addField('Total XP', `**${lv.totalXp || 0}**`, true)
    .addField('Leaderboard', rankPosition ? `**#${rankPosition}**` : 'Unranked', true)
    .addField('Sheriff Coins', `🪙 **${lv.coins || 0}**`, true)
    .addField('Messages / RP Posts', `${lv.messagesCount || 0} / ${lv.rpPostsCount || 0}`, true)
    .addField(
      'Verification',
      user.verification?.verified ? '🟢 Verified Citizen' : '⏳ Unverified',
      true,
    )
    .setFooter(BOT_BRAND.footer);

  if (activeChar) {
    embed.addField(
      '🎭 Active RP Character',
      `**${activeChar.name}** (\`${activeChar.alignment}\`) • Signature: *${activeChar.weapon}*`,
      false,
    );
  }
  if (Array.isArray(lv.badges) && lv.badges.length > 0) {
    embed.addField('🏅 Badges', lv.badges.join(' • '), false);
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
    .addField('Status', modCase.active ? '🟢 Active on Record' : '⚪ Pardoned / Expired', true)
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
      : '*No self-assignable RP roles configured yet. Admins can add them via `/config set-selfrole key=rp_ping role=<roleId>`.*';

  return new EmbedBuilder()
    .setTitle('🎭 MurderMystery2 • Roleplay & Event Ping Roles')
    .setColor(EMBED_COLORS.CHROMA)
    .setDescription(`Click any button below to toggle your **MurderMystery2** Roleplay notification & alignment roles:\n\n${desc}`)
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
            .setLabel(`🎭 ${key}`)
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
