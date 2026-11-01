import { DEFAULT_COORDINATION_DISCLAIMER, EMBED_COLORS } from '../config/settings.js';
import { ActionRowBuilder, ButtonBuilder, EmbedBuilder } from '../api/messages.js';

const STATE_EMOJI = Object.freeze({
  CREATED: '🆕',
  WAITING_FOR_PARTICIPANTS: '⏳',
  WAITING_FOR_MIDDLEMAN: '🔍',
  MIDDLEMAN_ASSIGNED: '🛡️',
  WAITING_FOR_DEPOSITS: '📦',
  DEPOSIT_CONFIRMATION: '🔎',
  WAITING_FOR_FINAL_CONFIRMATION: '✅',
  COMPLETED: '🏁',
  CANCELLED: '🚫',
  DISPUTED: '⚠️',
  REJECTED: '❌',
  EXPIRED: '⌛',
  UNDER_REVIEW: '🕵️',
});

const STATE_COLOR = Object.freeze({
  CREATED: EMBED_COLORS.INFO,
  WAITING_FOR_PARTICIPANTS: EMBED_COLORS.INFO,
  WAITING_FOR_MIDDLEMAN: EMBED_COLORS.PRIMARY,
  MIDDLEMAN_ASSIGNED: EMBED_COLORS.PRIMARY,
  WAITING_FOR_DEPOSITS: EMBED_COLORS.WARNING,
  DEPOSIT_CONFIRMATION: EMBED_COLORS.WARNING,
  WAITING_FOR_FINAL_CONFIRMATION: EMBED_COLORS.SUCCESS,
  COMPLETED: EMBED_COLORS.SUCCESS,
  CANCELLED: EMBED_COLORS.NEUTRAL,
  DISPUTED: EMBED_COLORS.DANGER,
  REJECTED: EMBED_COLORS.DANGER,
  EXPIRED: EMBED_COLORS.NEUTRAL,
  UNDER_REVIEW: EMBED_COLORS.DISPUTE,
});

const ORDERED_PIPELINE = [
  'WAITING_FOR_PARTICIPANTS',
  'WAITING_FOR_MIDDLEMAN',
  'MIDDLEMAN_ASSIGNED',
  'WAITING_FOR_DEPOSITS',
  'DEPOSIT_CONFIRMATION',
  'WAITING_FOR_FINAL_CONFIRMATION',
  'COMPLETED',
];

export function renderProgressChecklist(trade) {
  const currentIdx = ORDERED_PIPELINE.indexOf(trade.state);
  return ORDERED_PIPELINE.map((step, idx) => {
    let icon = '⬜';
    if (trade.state === 'COMPLETED' || (currentIdx > idx && currentIdx !== -1)) {
      icon = '🟩';
    } else if (trade.state === step) {
      icon = '🟦';
    } else if (['DISPUTED', 'UNDER_REVIEW'].includes(trade.state)) {
      const preIdx = ORDERED_PIPELINE.indexOf(trade.preDisputeState);
      if (preIdx > idx) icon = '🟩';
      else if (preIdx === idx) icon = '🟧';
    }
    return `${icon} \`${step}\``;
  }).join('\n');
}

function boolBadge(flag) {
  return flag ? '✅ Yes' : '⏳ Pending';
}

/**
 * Builds a comprehensive, clear Yapin Embed card for a trade record.
 * Explicitly includes the non-custody coordination notice so users are never misled about escrow.
 */
export function buildTradeEmbed(trade, { disclaimerText = DEFAULT_COORDINATION_DISCLAIMER } = {}) {
  const emoji = STATE_EMOJI[trade.state] || '📄';
  const color = STATE_COLOR[trade.state] ?? EMBED_COLORS.PRIMARY;
  const cash = trade.items?.cashComponent;
  const cashSummary =
    cash && cash.amount > 0
      ? `${cash.amount} ${cash.currency} (paid by ${cash.payer === 'TRADER_A' ? 'Trader A' : cash.payer === 'TRADER_B' ? 'Trader B' : 'Agreed party'})`
      : 'None';

  const confA = trade.confirmations?.traderA || {};
  const confB = trade.confirmations?.traderB || {};
  const depA = trade.deposits?.traderA || { status: 'PENDING' };
  const depB = trade.deposits?.traderB || { status: 'PENDING' };

  const embed = new EmbedBuilder()
    .setTitle(`${emoji} Trade ${trade.tradeId} — ${trade.state}`)
    .setDescription(
      `**Asset:** ${trade.items?.primaryAsset || 'N/A'}\n` +
        (trade.items?.notes ? `**Notes:** ${trade.items.notes}\n` : '') +
        `\n_${disclaimerText.slice(0, 350)}_`,
    )
    .setColor(color)
    .addField('Trader A', `<@${trade.traderAId}>\nGiving: ${trade.items?.traderAGiving || '-'}`, true)
    .addField('Trader B', `<@${trade.traderBId}>\nGiving: ${trade.items?.traderBGiving || '-'}`, true)
    .addField(
      'Middleman',
      trade.assignedMiddlemanId
        ? `<@${trade.assignedMiddlemanId}>`
        : trade.preferredMiddlemanId
          ? `Unassigned (Preferred: <@${trade.preferredMiddlemanId}>)`
          : 'Unassigned',
      true,
    )
    .addField('Cash Component', cashSummary, true)
    .addField(
      'Confirmations (A / B)',
      `Terms: ${boolBadge(confA.detailsConfirmed)} / ${boolBadge(confB.detailsConfirmed)}\n` +
        `MM: ${boolBadge(confA.middlemanConfirmed)} / ${boolBadge(confB.middlemanConfirmed)}\n` +
        `Release: ${boolBadge(confA.finalReleaseConfirmed)} / ${boolBadge(confB.finalReleaseConfirmed)}`,
      false,
    )
    .addField(
      'Deposit Status',
      `Trader A: \`${depA.status}\` | Trader B: \`${depB.status}\``,
      false,
    )
    .setFooter(
      trade.activeDisputeId
        ? `FROZEN — Active Dispute: ${trade.activeDisputeId}`
        : `Trade ID: ${trade.tradeId} • v${trade.version}`,
    )
    .setTimestamp(trade.updatedAt || new Date());

  return embed;
}

/**
 * Builds verified Yapin button action rows appropriate for `trade.state`.
 * All button clicks still undergo strict server-side RBAC & participant verification!
 */
export function buildTradeActionRows(trade) {
  const id = trade.tradeId;

  if (trade.state === 'WAITING_FOR_PARTICIPANTS') {
    return [
      new ActionRowBuilder(
        ButtonBuilder.success('Accept & Confirm Terms', `mm:accept:${id}`).setEmoji('✅'),
        ButtonBuilder.danger('Reject Invite', `mm:reject:${id}`).setEmoji('❌'),
        ButtonBuilder.secondary('Cancel Request', `mm:cancel:${id}`),
      ),
    ];
  }

  if (trade.state === 'WAITING_FOR_MIDDLEMAN') {
    return [
      new ActionRowBuilder(
        ButtonBuilder.primary('Claim Trade (Staff)', `mm:claim:${id}`).setEmoji('🛡️'),
        ButtonBuilder.secondary('Cancel Request', `mm:cancel:${id}`),
      ),
    ];
  }

  if (trade.state === 'MIDDLEMAN_ASSIGNED') {
    return [
      new ActionRowBuilder(
        ButtonBuilder.success('Confirm Assigned Middleman', `mm:confirm_mm:${id}`).setEmoji('✅'),
        ButtonBuilder.danger('Dispute Info', `mm:dispute_info:${id}`).setEmoji('⚠️'),
      ),
    ];
  }

  if (trade.state === 'WAITING_FOR_DEPOSITS' || trade.state === 'DEPOSIT_CONFIRMATION') {
    return [
      new ActionRowBuilder(
        ButtonBuilder.primary('How to Report Deposit', `mm:deposit_info:${id}`).setEmoji('📦'),
        ButtonBuilder.danger('Dispute Info', `mm:dispute_info:${id}`).setEmoji('⚠️'),
      ),
    ];
  }

  if (trade.state === 'WAITING_FOR_FINAL_CONFIRMATION') {
    return [
      new ActionRowBuilder(
        ButtonBuilder.success('Confirm Final Release', `mm:confirm_release:${id}`).setEmoji('✅'),
        ButtonBuilder.danger('Dispute Info', `mm:dispute_info:${id}`).setEmoji('⚠️'),
      ),
    ];
  }

  return [];
}
