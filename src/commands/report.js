import { EmbedBuilder } from '../api/messages.js';
import { BOT_BRAND, EMBED_COLORS } from '../config/settings.js';
import { parseCommandArgs } from '../utils/argParser.js';
import { ValidationError } from '../utils/errors.js';
import { extractYapinUserId } from '../utils/ids.js';

export const reportCommand = {
  name: 'report',
  description: 'Privately report RDM, FailRP, harassment, or exploits to MurderMystery2 Staff.',
  usage: '/report <@user> <RDM_FAILRP|HARASSMENT|EXPLOITING|SCAM_LINK|SPAM|OTHER> <details> [evidence=https://...]',
  category: 'moderation',
  staffOnly: false,

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const targetUserId = extractYapinUserId(kv.user || positional[0] || '');
    if (!targetUserId) {
      throw new ValidationError(
        'Usage: `/report <@user> <RDM_FAILRP|HARASSMENT|EXPLOITING|SPAM|OTHER> <what happened>`',
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
      .setTitle('🚨 Sheriff Dispatch • Report Filed')
      .setColor(EMBED_COLORS.WARNING)
      .setDescription(
        `Your report (\`${report.reportId}\`) has been routed privately to **MurderMystery2** Moderators for investigation.\n*Accused players are never automatically punished from unverified reports.*`,
      )
      .addField('Report ID', `\`${report.reportId}\``, true)
      .addField('Category', `\`${report.category}\``, true)
      .setFooter(BOT_BRAND.footer);

    await ctx.reply({ embeds: [embed] });
  },
};
