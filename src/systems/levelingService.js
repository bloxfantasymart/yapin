import { EmbedBuilder } from '../api/messages.js';
import { BOT_BRAND, EMBED_COLORS, resolveRankForLevel } from '../config/settings.js';
import { ValidationError } from '../utils/errors.js';
import { secureRandomInt, userMention } from '../utils/ids.js';

/**
 * Smooth quadratic XP requirement for progressing from `level` to `level + 1`.
 */
export function xpRequiredForLevel(level = 1) {
  const lv = Math.max(1, Number(level) || 1);
  return 5 * lv * lv + 50 * lv + 100;
}

/**
 * Recomputes `(level, xpIntoCurrentLevel)` from cumulative `totalXp`.
 */
export function computeLevelStateFromTotalXp(totalXp = 0) {
  let remaining = Math.max(0, Math.floor(Number(totalXp) || 0));
  let level = 1;
  while (remaining >= xpRequiredForLevel(level) && level < 500) {
    remaining -= xpRequiredForLevel(level);
    level += 1;
  }
  return {
    level,
    xp: remaining,
    xpNeeded: xpRequiredForLevel(level),
  };
}

/**
 * MurderMystery2 Leveling, Prestige, Role Rewards & Daily Stipend Engine.
 */
export class LevelingService {
  constructor({
    userRepo,
    serverConfigRepo,
    permissionsApi,
    messagesApi = null,
    logService,
    logger = null,
  }) {
    this.userRepo = userRepo;
    this.serverConfigRepo = serverConfigRepo;
    this.permissionsApi = permissionsApi;
    this.messagesApi = messagesApi;
    this.logService = logService;
    this.logger = logger;
  }

  /**
   * Processes an incoming server messages for XP and character scene tracking.
   */
  async processChatMessage({ serverId, channelId, userId, username = null, content = '' }) {
    if (!serverId || !userId) return { awarded: false };
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    if (!cfg.leveling.enabled) return { awarded: false };

    const trimmed = String(content || '').trim();
    if (trimmed.length < 3) return { awarded: false };

    const isRpAction =
      trimmed.length >= 80 || /\*[^*]{4,}\*/.test(trimmed) || /^["“].+["”]/.test(trimmed);

    const now = Date.now();
    let leveledUp = false;
    let oldLevel = 1;
    let newLevel = 1;
    let xpGained = 0;

    const updated = await this.userRepo.updateUser(
      userId,
      (draft) => {
        draft.leveling.messagesCount = (draft.leveling.messagesCount || 0) + 1;
        if (isRpAction) {
          draft.leveling.rpPostsCount = (draft.leveling.rpPostsCount || 0) + 1;
        }

        const lastXpMs = draft.leveling.lastXpAt ? new Date(draft.leveling.lastXpAt).getTime() : 0;
        if (now - lastXpMs < cfg.leveling.cooldownMs) {
          return;
        }

        const min = Math.min(cfg.leveling.xpMin, cfg.leveling.xpMax);
        const max = Math.max(cfg.leveling.xpMin, cfg.leveling.xpMax);
        xpGained = secureRandomInt(min, max) + (isRpAction ? cfg.leveling.rpBonusXp : 0);

        oldLevel = draft.leveling.level || 1;
        draft.leveling.totalXp = (draft.leveling.totalXp || 0) + xpGained;
        draft.leveling.coins = (draft.leveling.coins || 0) + (isRpAction ? 3 : 1);
        draft.leveling.lastXpAt = new Date(now);

        const state = computeLevelStateFromTotalXp(draft.leveling.totalXp);
        draft.leveling.level = state.level;
        draft.leveling.xp = state.xp;
        draft.leveling.rankTitle = resolveRankForLevel(state.level).title;
        newLevel = state.level;
        leveledUp = newLevel > oldLevel;

        if (newLevel >= 10 && !draft.leveling.badges.includes('🕵️ Detective')) {
          draft.leveling.badges.push('🕵️ Detective');
        }
        if (newLevel >= 20 && !draft.leveling.badges.includes('🔫 Sheriff Star')) {
          draft.leveling.badges.push('🔫 Sheriff Star');
        }
      },
      username,
    );

    if (leveledUp) {
      await this._handleLevelUpSideEffects({
        serverId,
        channelId,
        userId,
        oldLevel,
        newLevel,
        cfg,
      });
    }

    return {
      awarded: xpGained > 0,
      xpGained,
      leveledUp,
      oldLevel,
      newLevel,
      user: updated,
    };
  }

  async grantSystemXp({ serverId, userId, amount, reason = 'Bonus XP' }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    let oldLevel = 1;
    let newLevel = 1;
    const updated = await this.userRepo.updateUser(userId, (draft) => {
      oldLevel = draft.leveling.level || 1;
      draft.leveling.totalXp = Math.max(0, (draft.leveling.totalXp || 0) + Math.floor(amount));
      const state = computeLevelStateFromTotalXp(draft.leveling.totalXp);
      draft.leveling.level = state.level;
      draft.leveling.xp = state.xp;
      newLevel = state.level;
    });

    if (newLevel > oldLevel) {
      await this._handleLevelUpSideEffects({
        serverId,
        channelId: null,
        userId,
        oldLevel,
        newLevel,
        cfg,
        reason,
      });
    }
    return updated;
  }

  /**
   * Claims the 20-hour Sheriff Daily Crate (`$daily`).
   */
  async claimDaily({ serverId, userId, username = null }) {
    const COOLDOWN_MS = 20 * 3_600_000;
    const STREAK_RESET_MS = 48 * 3_600_000;
    const now = Date.now();
    let xpReward = 0;
    let coinReward = 0;
    let streak = 1;

    const updated = await this.userRepo.updateUser(
      userId,
      (draft) => {
        const lastMs = draft.leveling.lastDailyAt
          ? new Date(draft.leveling.lastDailyAt).getTime()
          : 0;
        const elapsed = now - lastMs;
        if (lastMs > 0 && elapsed < COOLDOWN_MS) {
          const remainingMin = Math.ceil((COOLDOWN_MS - elapsed) / 60_000);
          const hrs = Math.floor(remainingMin / 60);
          const mins = remainingMin % 60;
          throw new ValidationError(
            `You already claimed your Sheriff Daily Crate! Next crate ready in **${hrs}h ${mins}m**.`,
          );
        }

        streak =
          lastMs > 0 && elapsed <= STREAK_RESET_MS
            ? Math.min(30, (draft.leveling.dailyStreak || 0) + 1)
            : 1;
        xpReward = 120 + streak * 15;
        coinReward = 50 + streak * 10;

        draft.leveling.dailyStreak = streak;
        draft.leveling.lastDailyAt = new Date(now);
        draft.leveling.totalXp = (draft.leveling.totalXp || 0) + xpReward;
        draft.leveling.coins = (draft.leveling.coins || 0) + coinReward;

        const state = computeLevelStateFromTotalXp(draft.leveling.totalXp);
        draft.leveling.level = state.level;
        draft.leveling.xp = state.xp;
        draft.leveling.rankTitle = resolveRankForLevel(state.level).title;
      },
      username,
    );

    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    await this._syncLevelRewardRoles(serverId, userId, updated.leveling.level, cfg);

    return {
      user: updated,
      gainedXp: xpReward,
      xpReward,
      coinReward,
      streak,
    };
  }

  /**
   * Staff XP / Level management (`$xp give|remove|setlevel|reset`).
   */
  async staffManageXp({
    serverId,
    actorId,
    targetUserId,
    mode,
    amount = 0,
    reason = 'Staff XP adjustment',
    correlationId = null,
  }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    await this.permissionsApi.assertAuthorized({
      serverId,
      userId: actorId,
      serverConfig: cfg,
      requiredRole: 'moderator',
    });

    const updated = await this.userRepo.updateUser(targetUserId, (draft) => {
      if (mode === 'give') {
        draft.leveling.totalXp = (draft.leveling.totalXp || 0) + Math.max(1, Math.floor(amount));
      } else if (mode === 'remove') {
        draft.leveling.totalXp = Math.max(
          0,
          (draft.leveling.totalXp || 0) - Math.max(1, Math.floor(amount)),
        );
      } else if (mode === 'setlevel') {
        const targetLv = Math.max(1, Math.min(200, Math.floor(amount)));
        let total = 0;
        for (let l = 1; l < targetLv; l++) {
          total += xpRequiredForLevel(l);
        }
        draft.leveling.totalXp = total;
      } else if (mode === 'reset') {
        draft.leveling.totalXp = 0;
      } else {
        throw new ValidationError('Invalid XP mode. Use `give`, `remove`, `setlevel`, or `reset`.');
      }

      const state = computeLevelStateFromTotalXp(draft.leveling.totalXp);
      draft.leveling.level = state.level;
      draft.leveling.xp = state.xp;
      draft.leveling.rankTitle = resolveRankForLevel(state.level).title;
    });

    await this._syncLevelRewardRoles(serverId, targetUserId, updated.leveling.level, cfg);

    await this.logService.record({
      serverId,
      actorId,
      actorType: 'STAFF',
      action: `XP_${mode.toUpperCase()}`,
      targetType: 'USER',
      targetId: targetUserId,
      afterState: { level: updated.leveling.level, totalXp: updated.leveling.totalXp },
      metadata: { mode, amount, reason },
      correlationId,
      stream: 'level',
    });

    return updated;
  }

  async _syncLevelRewardRoles(serverId, userId, currentLevel, cfg) {
    const rewards = cfg?.roles?.levelRewards || {};
    for (const [lvlStr, roleId] of Object.entries(rewards)) {
      const reqLvl = Number(lvlStr);
      if (Number.isInteger(reqLvl) && currentLevel >= reqLvl && roleId) {
        await this.permissionsApi.addMemberRole(serverId, userId, roleId).catch(() => undefined);
      }
    }
  }

  async _handleLevelUpSideEffects({ serverId, channelId, userId, oldLevel, newLevel, cfg }) {
    await this._syncLevelRewardRoles(serverId, userId, newLevel, cfg);
    const rankMeta = resolveRankForLevel(newLevel);

    const embed = new EmbedBuilder()
      .setTitle('🌈 MurderMystery2 Promotion • Level Up!')
      .setColor(rankMeta.color || EMBED_COLORS.CHROMA)
      .setDescription(
        `🎉 ${userMention(userId)} advanced from **Level ${oldLevel}** to **Level ${newLevel}**!\n**Current Rank:** ${rankMeta.title}`,
      )
      .setFooter(BOT_BRAND.footer);

    if (cfg.leveling.announceLevelUp && this.messagesApi) {
      const destChannel = cfg.channels.levelUpChannelId || channelId;
      if (destChannel) {
        await this.messagesApi.sendMessage(destChannel, { embeds: [embed] }).catch(() => undefined);
      }
    }
  }

  async awardChatXp(event) {
    if (!event?.server_id || !event?.author_id || event.author_bot) {
      return { awarded: false };
    }
    return this.processChatMessage({
      serverId: event.server_id,
      channelId: event.channel_id,
      userId: event.author_id,
      username: event.username || null,
      content: event.content || '',
    });
  }

  async modifyUserXp({ serverId, actorId, targetUserId, action, amount = 0, correlationId = null }) {
    return this.staffManageXp({
      serverId,
      actorId,
      targetUserId,
      mode: action,
      amount,
      correlationId,
    });
  }
}
