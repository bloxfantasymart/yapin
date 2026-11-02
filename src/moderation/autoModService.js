const INVITE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord\.com\/invite|yapin\.gg\/invite)\/[A-Za-z0-9_-]+/i;
const SCAM_LINK_REGEX = /https?:\/\/[^\s]*(?:free-?nitro|free-?godly|mm2-?dupe|robux-?gift|steamcommunlty)/i;
const MENTION_GLOBAL_REGEX = /<@!?[A-Za-z0-9_-]{4,64}>/g;

/**
 * Smart MurderMystery2 Auto-Moderation Filter (staff-exempt!).
 */
export class AutoModService {
  constructor({
    serverConfigRepo,
    permissionsApi,
    messagesApi = null,
    moderationService,
    logService,
    logger = null,
  }) {
    this.serverConfigRepo = serverConfigRepo;
    this.permissionsApi = permissionsApi;
    this.messagesApi = messagesApi;
    this.moderationService = moderationService;
    this.logService = logService;
    this.logger = logger;
  }

  /**
   * Inspects a non-bot chat message. Returns `{ triggered: true, rule }` if filtered.
   */
  async inspectMessage(event) {
    if (!event?.server_id || !event?.author_id || event.author_bot) {
      return { triggered: false };
    }

    const content = String(event.content || '');
    if (!content) return { triggered: false };

    const cfg = await this.serverConfigRepo.getOrCreate(event.server_id);
    if (!cfg.autoMod.enabled) return { triggered: false };

    // Staff members are exempt from Auto-Mod filters
    const access = await this.permissionsApi.resolveMemberAccess(
      event.server_id,
      event.author_id,
      cfg,
    );
    if (access.roles.isStaff) return { triggered: false };

    let violatedRule = null;

    if (cfg.autoMod.blockScamLinks && SCAM_LINK_REGEX.test(content)) {
      violatedRule = 'Suspicious MM2 scam / phishing link blocked';
    } else if (cfg.autoMod.blockInviteLinks && INVITE_REGEX.test(content)) {
      violatedRule = 'Unauthorized external server invite link';
    } else {
      const mentions = content.match(MENTION_GLOBAL_REGEX) || [];
      if (mentions.length > cfg.autoMod.maxMentions) {
        violatedRule = `Mass mention spam (${mentions.length} mentions > limit ${cfg.autoMod.maxMentions})`;
      }
    }

    if (!violatedRule && Array.isArray(cfg.autoMod.blockedWords) && cfg.autoMod.blockedWords.length > 0) {
      const lower = content.toLowerCase();
      for (const word of cfg.autoMod.blockedWords) {
        const cleanWord = String(word || '').trim().toLowerCase();
        if (cleanWord && lower.includes(cleanWord)) {
          violatedRule = 'Blocked server filter word';
          break;
        }
      }
    }

    if (!violatedRule) {
      return { triggered: false };
    }

    // Delete offending message immediately (best-effort)
    if (this.messagesApi && event.channel_id && event.id) {
      await this.messagesApi.deleteMessage(event.channel_id, event.id).catch(() => undefined);
    }

    // Issue automated Case File warning (which auto-escalates to Mute on repeat violations!)
    await this.moderationService
      .warnUser({
        serverId: event.server_id,
        actorId: 'MM2_AUTOMOD',
        targetUserId: event.author_id,
        reason: `[Auto-Mod] ${violatedRule}`,
        isAutoMod: true,
      })
      .catch((err) => {
        this.logger?.debug?.({ errMessage: err?.message }, 'Auto-Mod warning skipped');
      });

    if (this.messagesApi && event.channel_id) {
      await this.messagesApi
        .sendMessage(event.channel_id, {
          content: `🛡️ **MM2 Helper Auto-Mod:** <@${event.author_id}>, your message was removed (*${violatedRule}*).`,
        })
        .catch(() => undefined);
    }

    return { triggered: true, rule: violatedRule };
  }
}
