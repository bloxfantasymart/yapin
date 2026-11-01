import { EmbedBuilder } from '../api/messages.js';
import { BOT_BRAND, EMBED_COLORS } from '../config/settings.js';
import { ConflictError, ValidationError } from '../utils/errors.js';
import { generateVerificationCode, userMention } from '../utils/ids.js';

/**
 * MurderMystery2 Sheriff Checkpoint Verification Service.
 */
export class VerificationService {
  constructor({
    userRepo,
    serverConfigRepo,
    permissionsApi,
    messagesApi = null,
    levelingService = null,
    logService,
    logger = null,
  }) {
    this.userRepo = userRepo;
    this.serverConfigRepo = serverConfigRepo;
    this.permissionsApi = permissionsApi;
    this.messagesApi = messagesApi;
    this.levelingService = levelingService;
    this.logService = logService;
    this.logger = logger;
  }

  /**
   * Starts verification (`mm2:verify:start` button or `$verify` without code).
   * - If `mode === 'instant'`, verifies immediately and assigns `verifiedRoleId`.
   * - If `mode === 'code'`, issues a 10-minute Sheriff Passcode (`MM2-XXXX`) to submit via `$verify code=...`.
   */
  async initiateVerification({ serverId, userId, username = null, correlationId = null }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    if (!cfg.verification.enabled) {
      throw new ValidationError('Checkpoint verification is currently paused by server admins.');
    }

    const user = await this.userRepo.getOrCreate(userId, username);
    if (user.moderation?.activeBan?.active) {
      throw new ValidationError(
        `Access denied: You have an active MurderMystery2 ban (${user.moderation.activeBan.caseId || 'Banned'}). Open an appeal if permitted.`,
      );
    }

    if (user.verification?.verified) {
      return { alreadyVerified: true, verified: true, user };
    }

    if (cfg.verification.mode === 'instant') {
      const updated = await this._finalizeVerification({
        serverId,
        userId,
        username,
        verifiedBy: 'CHECKPOINT_INSTANT',
        cfg,
        correlationId,
      });
      return { alreadyVerified: false, verified: true, user: updated };
    }

    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await this.userRepo.updateUser(
      userId,
      (draft) => {
        draft.verification.pendingCode = code;
        draft.verification.codeExpiresAt = expiresAt;
      },
      username,
    );

    return {
      alreadyVerified: false,
      verified: false,
      code,
      expiresAt,
    };
  }

  /**
   * Verifies a submitted Sheriff Passcode (`$verify code=MM2-XXXX`).
   */
  async verifyWithCode({ serverId, userId, username = null, code, correlationId = null }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    const user = await this.userRepo.getOrCreate(userId, username);

    if (user.moderation?.activeBan?.active) {
      throw new ValidationError('Access denied: Active server ban on record.');
    }
    if (user.verification?.verified) {
      return { alreadyVerified: true, user };
    }

    if (cfg.verification.mode === 'instant' && !code) {
      const updated = await this._finalizeVerification({
        serverId,
        userId,
        username,
        verifiedBy: 'CHECKPOINT_INSTANT',
        cfg,
        correlationId,
      });
      return { alreadyVerified: false, user: updated };
    }

    const submitted = String(code || '').trim().toUpperCase();
    if (!submitted) {
      throw new ValidationError(
        'Missing Sheriff Passcode! Click **🛡️ Verify at Checkpoint** or run `$verify` first to get your code, then run `$verify code=MM2-XXXX`.',
      );
    }

    const pending = user.verification?.pendingCode;
    const exp = user.verification?.codeExpiresAt
      ? new Date(user.verification.codeExpiresAt).getTime()
      : 0;

    if (!pending || Date.now() > exp) {
      throw new ValidationError(
        'Your Sheriff Passcode expired or has not been generated yet. Run `$verify` to request a fresh code!',
      );
    }

    if (submitted !== pending.toUpperCase()) {
      await this.userRepo.updateUser(userId, (draft) => {
        draft.verification.attempts = (draft.verification.attempts || 0) + 1;
      });
      throw new ValidationError(
        'Incorrect Sheriff Passcode! Double-check your code (`MM2-XXXX`) and try again.',
      );
    }

    const updated = await this._finalizeVerification({
      serverId,
      userId,
      username,
      verifiedBy: 'CHECKPOINT_CODE',
      cfg,
      correlationId,
    });
    return { alreadyVerified: false, user: updated };
  }

  /**
   * Staff manual verify / unverify (`$verifyuser`).
   */
  async staffSetVerified({
    serverId,
    actorId,
    targetUserId,
    verified = true,
    reason = 'Manual Sheriff verification update',
    correlationId = null,
  }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    await this.permissionsApi.assertAuthorized({
      serverId,
      userId: actorId,
      serverConfig: cfg,
      requiredRole: 'trialmod',
    });

    if (verified) {
      return this._finalizeVerification({
        serverId,
        userId: targetUserId,
        verifiedBy: actorId,
        cfg,
        correlationId,
      });
    }

    try {
      if (cfg.roles.verifiedRoleId) {
        await this.permissionsApi.removeMemberRole(serverId, targetUserId, cfg.roles.verifiedRoleId);
      }
      if (cfg.roles.unverifiedRoleId) {
        await this.permissionsApi.addMemberRole(serverId, targetUserId, cfg.roles.unverifiedRoleId);
      }
    } catch (err) {
      this.logger?.warn?.({ errMessage: err?.message, userId: targetUserId }, 'Unable to update Yapin verification roles');
      throw new ValidationError(
        'Verification roles could not be updated. Ask an administrator to check MM2 Helper’s Manage Roles permission and role order, then retry.',
      );
    }

    const updated = await this.userRepo.updateUser(targetUserId, (draft) => {
      draft.verification.verified = false;
      draft.verification.verifiedAt = null;
      draft.verification.verifiedBy = null;
      draft.verification.pendingCode = null;
    });

    await this.logService.record({
      serverId,
      actorId,
      actorType: 'STAFF',
      action: 'MEMBER_UNVERIFIED',
      targetType: 'USER',
      targetId: targetUserId,
      metadata: { reason },
      correlationId,
      stream: 'member',
    });

    return updated;
  }

  async _finalizeVerification({
    serverId,
    userId,
    username = null,
    verifiedBy,
    cfg,
    correlationId = null,
  }) {
    if (!cfg.roles?.verifiedRoleId) {
      throw new ValidationError(
        'The Sheriff Checkpoint is not ready: an administrator must set the Verified Citizen role with `$config role verified <roleId>`.',
      );
    }

    try {
      await this.permissionsApi.addMemberRole(serverId, userId, cfg.roles.verifiedRoleId);
      if (cfg.roles.unverifiedRoleId) {
        await this.permissionsApi.removeMemberRole(serverId, userId, cfg.roles.unverifiedRoleId);
      }
    } catch (err) {
      await this.permissionsApi
        .removeMemberRole(serverId, userId, cfg.roles.verifiedRoleId)
        .catch(() => undefined);
      this.logger?.warn?.({ errMessage: err?.message, userId }, 'Could not complete Yapin verification role assignment');
      throw new ValidationError(
        'Clearance was not recorded because the citizen role could not be assigned. Ask an administrator to check MM2 Helper’s Manage Roles permission, role order, and configured role IDs, then try again.',
      );
    }

    const now = new Date();
    const updated = await this.userRepo.updateUser(
      userId,
      (draft) => {
        if (draft.verification.verified) {
          throw new ConflictError('Member is already verified.');
        }
        draft.verification.verified = true;
        draft.verification.verifiedAt = now;
        draft.verification.verifiedBy = verifiedBy;
        draft.verification.pendingCode = null;
        draft.verification.codeExpiresAt = null;
        if (!draft.leveling.badges.includes('🛡️ Verified Citizen')) {
          draft.leveling.badges.push('🛡️ Verified Citizen');
        }
      },
      username,
    );

    if (this.levelingService) {
      await this.levelingService
        .grantSystemXp({ serverId, userId, amount: 50, reason: 'Checkpoint Verification Bonus' })
        .catch(() => undefined);
    }

    const logEmbed = new EmbedBuilder()
      .setTitle('🛡️ Citizen Cleared Sheriff Checkpoint')
      .setColor(EMBED_COLORS.INNOCENT)
      .addField('Member', userMention(userId), true)
      .addField('Method', `\`${verifiedBy}\``, true)
      .setFooter(BOT_BRAND.footer);

    await this.logService.record({
      serverId,
      actorId: verifiedBy.startsWith('CHECKPOINT') ? userId : verifiedBy,
      actorType: verifiedBy.startsWith('CHECKPOINT') ? 'USER' : 'STAFF',
      action: 'MEMBER_VERIFIED',
      targetType: 'USER',
      targetId: userId,
      correlationId,
      stream: 'member',
      embed: logEmbed,
    });

    if (cfg.channels.welcomeChannelId && this.messagesApi) {
      const welcomeEmbed = new EmbedBuilder()
        .setTitle('🔪 A New Citizen Entered MurderMystery2!')
        .setColor(EMBED_COLORS.PRIMARY)
        .setDescription(
          `${userMention(userId)} cleared the **Sheriff Checkpoint**! Create your character with \`$character create\` and check \`$rules\` before entering a scene.`,
        )
        .setFooter(BOT_BRAND.footer);
      await this.messagesApi
        .sendMessage(cfg.channels.welcomeChannelId, { embeds: [welcomeEmbed] })
        .catch(() => undefined);
    }

    return updated;
  }

  /**
   * Unified entry point used by `$verify [code]` and `mm2:verify:start` / `mm2:verify:instant` buttons.
   */
  async verifyMember({
    serverId,
    userId,
    username = null,
    code = '',
    correlationId = null,
  }) {
    const trimmedCode = String(code || '').trim();
    if (trimmedCode) {
      const out = await this.verifyWithCode({
        serverId,
        userId,
        username,
        code: trimmedCode,
        correlationId,
      });
      return { ...out, status: 'VERIFIED' };
    }
    const init = await this.initiateVerification({
      serverId,
      userId,
      username,
      correlationId,
    });
    return {
      ...init,
      status: init.verified ? 'VERIFIED' : 'CHALLENGE_ISSUED',
    };
  }

  async issueChallenge(serverId, userId, username = null) {
    return this.initiateVerification({ serverId, userId, username });
  }

  async staffSetVerification(params) {
    return this.staffSetVerified(params);
  }

  /**
   * Called on `member_join` — creates profile, assigns `unverifiedRoleId`, and logs member arrival.
   */
  async handleMemberJoin({ serverId, userId, username = null }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    const user = await this.userRepo.getOrCreate(userId, username);

    if (!user.verification?.verified && cfg.roles.unverifiedRoleId) {
      await this.permissionsApi
        .addMemberRole(serverId, userId, cfg.roles.unverifiedRoleId)
        .catch(() => undefined);
    }

    await this.logService.record({
      serverId,
      actorId: userId,
      actorType: 'USER',
      action: 'MEMBER_JOINED',
      targetType: 'USER',
      targetId: userId,
      stream: 'member',
    });

    return user;
  }
}
