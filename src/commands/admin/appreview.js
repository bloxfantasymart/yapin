import { parseCommandArgs } from '../../utils/argParser.js';
import { buildApplicationReviewEmbed } from '../../utils/embeds.js';
import { ValidationError } from '../../utils/errors.js';

const DECISION_MAP = {
  accept: 'ACCEPTED',
  accepted: 'ACCEPTED',
  approve: 'ACCEPTED',
  deny: 'DENIED',
  denied: 'DENIED',
  reject: 'DENIED',
  review: 'UNDER_REVIEW',
  under_review: 'UNDER_REVIEW',
};

export const appreviewCommand = {
  name: 'appreview',
  description: 'Accept, deny, or mark a MurderMystery2 Moderator Application under review.',
  usage: '/appreview <APP-ID> <accept|deny|review> [notes]',
  category: 'applications',
  staffOnly: true,
  requiredRole: 'admin',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const applicationId = (kv.id || positional[0] || '').toUpperCase();
    const rawDecision = (kv.decision || positional[1] || '').toLowerCase();
    const decision = DECISION_MAP[rawDecision];
    const notes = kv.notes || positional.slice(2).join(' ') || '';

    if (!applicationId || !decision) {
      throw new ValidationError('Usage: `/appreview <APP-ID> <accept|deny|review> [notes]`');
    }

    const updated = await ctx.services.application.reviewApplication({
      serverId: ctx.event.server_id,
      applicationId,
      actorId: ctx.event.author_id,
      decision,
      notes,
      correlationId: ctx.correlationId,
    });

    const applicant = await ctx.repositories.users.getOrCreate(updated.applicantId);
    await ctx.reply({
      content: `⚖️ Application \`${updated.applicationId}\` updated to **${updated.status}**.`,
      embeds: [buildApplicationReviewEmbed(updated, applicant)],
    });
  },
};
