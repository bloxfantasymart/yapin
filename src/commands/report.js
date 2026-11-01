import { EmbedBuilder } from '../api/messages.js';
import { BOT_BRAND, EMBED_COLORS } from '../config/settings.js';
import { parseCommandArgs } from '../utils/argParser.js';
import { ValidationError } from '../utils/errors.js';
import { extractYapinUserId } from '../utils/ids.js';

const CATEGORY_LABELS = {
  RDM_FAILRP: 'Unprovoked attack or unfair conduct',
  HARASSMENT: 'Harassment',
  EXPLOITING: 'Suspected exploit',
  SCAM_LINK: 'Scam or unsafe link',
  SPAM: 'Spam',
  OTHER: 'Other concern',
};

export const reportCommand = {
  name: 'report',
  description: 'Submit a private report about harassment, unsafe links, disruptive conduct, or another server concern.',
  usage: '$report <@member> <category> <details> [evidence=https://...]',
  category: 'moderation',
  staffOnly: false,

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const targetUserId = extractYapinUserId(kv.user || positional[0] || '');
    if (!targetUserId) {
      throw new ValidationError(
        'Usage: `$report <@member> <category> <what happened>`',
      );
    }

    const category = kv.category || positional[1] || 'RDM_FAILRP';
    const description = kv.details || kv.reason || positional.slice(2).join(' ');
    const evidenceUrl = kv.evidence || null;

    const report = await ctx.services.moderation.submitReport({
      serverId: ctx.event.server_id,
      reporterId: ctx.event.author_id,
      targetUserId,
      category,
      description,
      evidenceUrl,
      correlationId: ctx.correlationId,
    });

    const embed = new EmbedBuilder()
      .setTitle('MURDERMYSTERY2 | REPORT RECEIVED')
      .setColor(EMBED_COLORS.WARNING)
      .setDescription(
        `Your report has been received and sent to authorized staff for review. A report is not a finding of misconduct and does not automatically result in punishment.`,
      )
      .addField('REPORT ID', `\`${report.reportId}\``, true)
      .addField('CATEGORY', CATEGORY_LABELS[report.category] || 'Other concern', true)
      .setFooter(BOT_BRAND.footer);

    await ctx.reply({ embeds: [embed] });
  },
};
