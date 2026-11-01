import { EmbedBuilder } from '../api/messages.js';
import { BOT_BRAND, EMBED_COLORS } from '../config/settings.js';

export const helpCommand = {
  name: 'help',
  description: 'View the MurderMystery2 server guide and MM2 Helper commands.',
  usage: '$help',
  category: 'utility',
  staffOnly: false,

  async execute(ctx) {
    const cfg = await ctx.repositories.serverConfigs.getOrCreate(ctx.event.server_id);
    const access = await ctx.permissionsApi.resolveMemberAccess(
      ctx.event.server_id,
      ctx.event.author_id,
      cfg,
    );

    const embed = new EmbedBuilder()
      .setTitle(`${BOT_BRAND.botName} | ${BOT_BRAND.serverName} Guide`)
      .setColor(EMBED_COLORS.CRIMSON)
      .setDescription(
        `Welcome to **${BOT_BRAND.serverName}**. Use this guide to access verification, member support, community features, and staff services.`,
      )
      .addField(
        'VERIFICATION & ACCOUNT',
        '`$verify` • `$rules` • `$serverinfo` • `$profile` • `$ping` • `$help`',
        false,
      )
      .addField(
        'LEVELS & REWARDS',
        '`$rank` • `$leaderboard` • `$daily`',
        false,
      )
      .addField(
        'CHARACTERS & MYSTERY EVENTS',
        '`$character` (`create|list|switch|delete`) • `$rp` (`say|scene|clue|roll|maps`) • `$mystery` (`start|join|draw|end`) • `$roles`',
        false,
      )
      .addField(
        'SUPPORT & APPLICATIONS',
        '`$ticket` (`open|view|note|close`) • `$report` • `$apply`',
        false,
      );

    if (access.roles.isStaff) {
      embed.addField('STAFF APPLICATIONS', '`$applications` — list and filter submitted applications.', false);
      embed.addField(
        'STAFF MODERATION',
        '`$warn` • `$warnings` • `$clearwarn` • `$mute` • `$unmute` • `$kick` • `$ban` • `$unban` • `$case` • `$modlogs` • `$purge` • `$slowmode` • `$lock` • `$unlock` • `$verifyuser`',
        false,
      );
    }

    if (access.roles.isAdmin) {
      embed.addField(
        'SERVER ADMINISTRATION',
        '`$appreview` • `$xp` • `$panel` (`verify|tickets|applications|roles`) • `$config`',
        false,
      );
    }

    embed.setFooter(BOT_BRAND.footer);
    await ctx.reply({ embeds: [embed] });
  },
};
