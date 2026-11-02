import { EmbedBuilder } from '../api/messages.js';
import { BOT_BRAND, EMBED_COLORS } from '../config/settings.js';
import { parseCommandArgs, parsePipeSegments } from '../utils/argParser.js';
import { ValidationError } from '../utils/errors.js';

export const applyCommand = {
  name: 'apply',
  description: 'Submit an official MurderMystery2 Trial Sheriff (Moderator) Application.',
  usage: '$apply <Age> | <Timezone> | <Daily Hours> | <Experience> | <Why You> | <Incident Review Scenario>',
  category: 'applications',
  staffOnly: false,

  async execute(ctx) {
    const raw = (ctx.event.args || '').trim();
    const { kv } = parseCommandArgs(raw);
    const segments = parsePipeSegments(raw);

    const answers = {
      age: kv.age || segments[0] || '',
      timezone: kv.timezone || segments[1] || '',
      hours: kv.hours || segments[2] || '',
      experience: kv.experience || segments[3] || '',
      reason: kv.reason || segments[4] || '',
      scenario: kv.scenario || segments[5] || '',
    };

    if (!answers.age || !answers.timezone || !answers.hours || !answers.experience || !answers.reason || !answers.scenario) {
      throw new ValidationError(
        'Please complete all 6 fields separated by `|`:\n' +
          '`$apply 18 | EST (UTC-5) | 3-4h/day | Moderated two online communities | Why you want to serve this community | Review context and evidence before acting`',
      );
    }

    const created = await ctx.services.application.submitApplication({
      serverId: ctx.event.server_id,
      applicantId: ctx.event.author_id,
      applicantUsername: ctx.event.username || null,
      answers,
      correlationId: ctx.correlationId,
    });

    const embed = new EmbedBuilder()
      .setTitle('⭐ Staff Application Received')
      .setColor(EMBED_COLORS.GOLD)
      .setDescription(
        `Your Trial Moderator application (\`${created.applicationId}\`) has been submitted for staff review.`,
      )
      .addField('Application ID', `\`${created.applicationId}\``, true)
      .addField('Status', '`PENDING`', true)
      .setFooter(BOT_BRAND.footer);

    await ctx.reply({ embeds: [embed] });
  },
};
