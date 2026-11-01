import { EmbedBuilder } from '../api/messages.js';
import { BOT_BRAND, EMBED_COLORS } from '../config/settings.js';
import { xpRequiredForLevel } from '../systems/levelingService.js';
import { parseCommandArgs } from '../utils/argParser.js';
import { ValidationError } from '../utils/errors.js';
import { extractYapinUserId, userMention } from '../utils/ids.js';

export const profileCommand = {
  name: 'profile',
  description: 'View a MurderMystery2 Citizen & Roleplay Dossier.',
  usage: '/profile [@user]',
  category: 'leveling',
  staffOnly: false,

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const rawTarget = kv.user || positional[0];
    const targetId = rawTarget ? extractYapinUserId(rawTarget) : ctx.event.author_id;

    if (!targetId) {
      throw new ValidationError('Invalid user UUID or mention (`<@uuid>`).');
    }

    const userDoc = await ctx.repositories.users.getOrCreate(targetId);
    const serverCfg = await ctx.repositories.serverConfigs.getOrCreate(ctx.event.server_id);
    const access = await ctx.permissionsApi.resolveMemberAccess(
      ctx.event.server_id,
      ctx.event.author_id,
      serverCfg,
    );

    const lvl = userDoc.leveling || {};
    const needed = xpRequiredForLevel(lvl.level || 1);
    const activeChar =
      (userDoc.characters || []).find((c) => c.characterId === userDoc.activeCharacterId) ||
      userDoc.characters?.[0] ||
      null;

    const embed = new EmbedBuilder()
      .setTitle('🕵️ MurderMystery2 Citizen Dossier')
      .setDescription(`**Citizen:** ${userMention(targetId)} (\`${targetId}\`)`)
      .setColor(userDoc.moderation?.activeBan?.active ? EMBED_COLORS.DANGER : EMBED_COLORS.SHERIFF)
      .addField('MM2 Rank', `${lvl.rankTitle || '🔪 New Suspect'} (Lv. **${lvl.level || 1}**)`, true)
      .addField('XP Progress', `${lvl.xp || 0} / ${needed} XP (Total: ${lvl.totalXp || 0})`, true)
      .addField(
        'Checkpoint Status',
        userDoc.verification?.verified ? '✅ Verified Citizen' : '⏳ Unverified',
        true,
      )
      .addField(
        'Active RP Persona',
        activeChar
          ? `**${activeChar.name}** (\`${activeChar.alignment}\` • 🗡️ ${activeChar.weapon})`
          : '_None registered (`/character create`)_',
        false,
      )
      .addField(
        'Earned Badges',
        lvl.badges?.length ? lvl.badges.join(' • ') : '_No badges unlocked yet_',
        false,
      );

    if (access.roles.isStaff || targetId === ctx.event.author_id) {
      embed.addField(
        'Active Warnings',
        String(userDoc.moderation?.activeWarnCount || 0),
        true,
      );
    }
    if (access.roles.isStaff) {
      embed.addField('Total Case Files', String(userDoc.moderation?.totalCases || 0), true);
      embed.addField(
        'Queued Reports',
        String(userDoc.moderation?.openReportsCount || 0),
        true,
      );
    }

    embed.setFooter(BOT_BRAND.footer);
    await ctx.reply({ embeds: [embed] });
  },
};
