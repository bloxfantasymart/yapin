import { EmbedBuilder } from '../api/messages.js';
import { BOT_BRAND, EMBED_COLORS } from '../config/settings.js';
import { withTransaction } from '../database/connection.js';
import { sanitizeUserText } from '../security/sanitizer.js';
import {
  buildApplicationReviewEmbed,
  buildApplicationReviewRows,
} from '../utils/embeds.js';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../utils/errors.js';
import { generateApplicationId, userMention } from '../utils/ids.js';

/**
 * MurderMystery2 Sheriff Academy (Moderator Applications) Service.
 */
export class ApplicationService {
  constructor({
    applicationRepo,
    userRepo,
    serverConfigRepo,
    permissionsApi,
    messagesApi = null,
    logService,
    logger = null,
  }) {
    this.applicationRepo = applicationRepo;
    this.userRepo = userRepo;
    this.serverConfigRepo = serverConfigRepo;
    this.permissionsApi = permissionsApi;
    this.messagesApi = messagesApi;
    this.logService = logService;
    this.logger = logger;
  }

  /**
   * Submits a new Moderator Application (`/apply`).
   */
  async submitApplication({
    serverId,
    applicantId,
    applicantUsername = null,
    answers = {},
    correlationId = null,
  }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    if (!cfg.applications.open) {
      throw new ValidationError(
        'MurderMystery2 Moderator Applications are currently **CLOSED**. Watch announcements for the next Sheriff Academy recruitment wave!',
      );
    }

    const user = await this.userRepo.getOrCreate(applicantId, applicantUsername);
    if (user.moderation?.activeBan?.active || user.moderation?.activeMute?.active) {
      throw new ValidationError(
        'Applicants cannot apply while under an active MurderMystery2 mute or ban.',
      );
    }

    const currentLevel = user.leveling?.level || 1;
    if (currentLevel < cfg.applications.minLevel) {
      throw new ValidationError(
        `You must reach at least **Level ${cfg.applications.minLevel}** in MurderMystery2 before applying (current Level: **${currentLevel}**).`,
      );
    }

    const existingOpen = await this.applicationRepo.findOpenByApplicant(serverId, applicantId);
    if (existingOpen) {
      throw new ConflictError(
        `You already have an active application (\`${existingOpen.applicationId}\`, status: \`${existingOpen.status}\`).`,
      );
    }

    if (user.lastApplicationAt && cfg.applications.reapplyCooldownHours > 0) {
      const cooldownMs = cfg.applications.reapplyCooldownHours * 3_600_000;
      const elapsed = Date.now() - new Date(user.lastApplicationAt).getTime();
      if (elapsed < cooldownMs) {
        const hrsLeft = Math.ceil((cooldownMs - elapsed) / 3_600_000);
        throw new ValidationError(
          `Please wait **${hrsLeft}h** before submitting another Moderator Application.`,
        );
      }
    }

    const cleanedAnswers = {
      age: sanitizeUserText(answers.age || '', { maxLength: 100, fieldName: 'Age' }),
      timezone: sanitizeUserText(answers.timezone || '', { maxLength: 100, fieldName: 'Timezone' }),
      hours: sanitizeUserText(answers.hours || '', { maxLength: 150, fieldName: 'Daily hours' }),
      experience: sanitizeUserText(answers.experience || '', {
        maxLength: 1000,
        fieldName: 'Experience',
      }),
      reason: sanitizeUserText(answers.reason || '', { maxLength: 1500, fieldName: 'Reason' }),
      scenario: sanitizeUserText(answers.scenario || '', {
        maxLength: 1500,
        fieldName: 'Scenario',
      }),
    };

    const applicationId = generateApplicationId();
    const created = await withTransaction(async () => {
      const appDoc = await this.applicationRepo.create({
        applicationId,
        serverId,
        applicantId,
        applicantUsername,
        levelAtApply: currentLevel,
        answers: cleanedAnswers,
        status: 'PENDING',
      });

      await this.userRepo.updateUser(applicantId, (draft) => {
        draft.lastApplicationAt = new Date();
      });

      await this.logService.record({
        serverId,
        actorId: applicantId,
        actorType: 'USER',
        action: 'MOD_APPLICATION_SUBMITTED',
        targetType: 'APPLICATION',
        targetId: applicationId,
        afterState: { status: 'PENDING', levelAtApply: currentLevel },
        correlationId,
      });

      return appDoc;
    });

    // Post interactive review card with Accept / Deny / Under Review buttons to modAppLogChannelId
    const reviewChannelId = cfg.channels.modAppLogChannelId || cfg.channels.modLogChannelId;
    if (reviewChannelId && this.messagesApi) {
      try {
        const sent = await this.messagesApi.sendMessage(reviewChannelId, {
          content: `📥 **New Sheriff Academy Application** from ${userMention(applicantId)} (\`${created.applicationId}\`)`,
          embeds: [buildApplicationReviewEmbed(created, user)],
          components: buildApplicationReviewRows(created),
        });
        if (sent?.id) {
          await this.applicationRepo.atomicUpdate(created.applicationId, {
            expectedVersion: created.version,
            set: {
              reviewMessageId: sent.id,
              reviewChannelId,
            },
          });
        }
      } catch (err) {
        this.logger?.warn?.(
          { errMessage: err?.message, applicationId },
          'Failed to post mod application review card to channel',
        );
      }
    }

    return created;
  }

  /**
   * Staff review decision (`UNDER_REVIEW`, `ACCEPTED`, `DENIED`) via `/appreview` or buttons.
   */
  async reviewApplication({
    serverId,
    applicationId,
    actorId,
    decision,
    notes = '',
    correlationId = null,
  }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    await this.permissionsApi.assertAuthorized({
      serverId,
      userId: actorId,
      serverConfig: cfg,
      requiredRole: 'admin',
    });

    const app = await this.applicationRepo.findByApplicationId(applicationId);
    if (!app || app.serverId !== serverId) {
      throw new NotFoundError(`Application \`${applicationId}\` was not found.`);
    }

    if (app.applicantId === actorId) {
      throw new AuthorizationError('Staff cannot review or accept their own Moderator Application.');
    }

    const normalizedDecision = String(decision || '').toUpperCase();
    if (!['UNDER_REVIEW', 'ACCEPTED', 'DENIED'].includes(normalizedDecision)) {
      throw new ValidationError('Decision must be `UNDER_REVIEW`, `ACCEPTED`, or `DENIED`.');
    }

    if (app.status === 'ACCEPTED' || app.status === 'DENIED') {
      throw new ConflictError(
        `Application \`${app.applicationId}\` has already been finalized as \`${app.status}\`.`,
      );
    }

    const cleanNotes = notes
      ? sanitizeUserText(notes, { maxLength: 1000, fieldName: 'Review notes' })
      : normalizedDecision === 'ACCEPTED'
        ? 'Welcome to the MurderMystery2 Trial Sheriff team!'
        : normalizedDecision === 'DENIED'
          ? 'Thank you for applying to MurderMystery2.'
          : 'Application is now under active Admin review.';

    const updated = await withTransaction(async () => {
      const saved = await this.applicationRepo.atomicUpdate(app.applicationId, {
        expectedVersion: app.version,
        set: {
          status: normalizedDecision,
          reviewerId: actorId,
          reviewNotes: cleanNotes,
          reviewedAt: new Date(),
        },
      });
      if (!saved) {
        throw new ConflictError('Application was updated concurrently by another Admin.');
      }

      if (normalizedDecision === 'ACCEPTED') {
        await this.userRepo.updateUser(app.applicantId, (draft) => {
          if (!draft.leveling.badges.includes('⭐ Trial Sheriff')) {
            draft.leveling.badges.push('⭐ Trial Sheriff');
          }
        });
      }

      await this.logService.record({
        serverId,
        actorId,
        actorType: 'STAFF',
        action: `MOD_APPLICATION_${normalizedDecision}`,
        targetType: 'APPLICATION',
        targetId: app.applicationId,
        beforeState: { status: app.status },
        afterState: { status: normalizedDecision, notes: cleanNotes },
        correlationId,
        stream: 'app',
      });

      return saved;
    });

    // Auto-assign Trial Mod role on ACCEPTED if configured
    if (
      normalizedDecision === 'ACCEPTED' &&
      cfg.applications.autoAssignTrialModOnAccept &&
      cfg.staffRoles.trialModRoleIds.length > 0
    ) {
      await this.permissionsApi
        .addMemberRole(serverId, app.applicantId, cfg.staffRoles.trialModRoleIds[0])
        .catch(() => undefined);
    }

    // Update live review card if posted
    if (updated.reviewChannelId && updated.reviewMessageId && this.messagesApi) {
      const applicantUser = await this.userRepo.getOrCreate(updated.applicantId);
      await this.messagesApi
        .editMessage(updated.reviewChannelId, updated.reviewMessageId, {
          embeds: [buildApplicationReviewEmbed(updated, applicantUser)],
          components: buildApplicationReviewRows(updated),
        })
        .catch(() => undefined);
    }

    // Best-effort DM notification to applicant
    if (this.messagesApi && (normalizedDecision === 'ACCEPTED' || normalizedDecision === 'DENIED')) {
      const dmEmbed = new EmbedBuilder()
        .setTitle(
          normalizedDecision === 'ACCEPTED'
            ? '⭐ MurderMystery2 • Sheriff Application ACCEPTED!'
            : '📩 MurderMystery2 • Sheriff Application Update',
        )
        .setColor(normalizedDecision === 'ACCEPTED' ? EMBED_COLORS.SUCCESS : EMBED_COLORS.WARNING)
        .setDescription(
          `Your Moderator Application (\`${updated.applicationId}\`) has been marked **${normalizedDecision}** by ${userMention(actorId)}.`,
        )
        .addField('Reviewer Feedback', cleanNotes, false)
        .setFooter(BOT_BRAND.footer);

      await this.messagesApi
        .sendDirectMessage(updated.applicantId, { embeds: [dmEmbed] })
        .catch(() => undefined);
    }

    return updated;
  }

  async getApplicationForViewer({ serverId, applicationId, viewerId }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    const app = await this.applicationRepo.findByApplicationId(applicationId);
    if (!app || app.serverId !== serverId) {
      throw new NotFoundError(`Application \`${applicationId}\` was not found.`);
    }

    const access = await this.permissionsApi.resolveMemberAccess(serverId, viewerId, cfg);
    if (app.applicantId !== viewerId && !access.roles.isStaff) {
      throw new AuthorizationError('You may only view your own application unless you are Staff.');
    }
    return app;
  }
}
