import { EmbedBuilder } from '../api/messages.js';
import { BOT_BRAND, EMBED_COLORS } from '../config/settings.js';

export const helpCommand = {
  name: 'help',
  description: 'View all MM2 Helper community, roleplay, ticket, and staff commands.',
  usage: '/help',
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
      .setTitle(`🔪 ${BOT_BRAND.botName} • ${BOT_BRAND.serverName} Command Manual`)
      .setColor(EMBED_COLORS.CRIMSON)
      .setDescription(
        `Welcome to **${BOT_BRAND.serverName}**! Below is your field guide to verification, leveling, tickets, Moderator applications, and MM2 Roleplay.`,
      )
      .addField(
        '🛡️ Verification & Info',
        '`/verify` • `/rules` • `/serverinfo` • `/profile` • `/ping` • `/help`',
        false,
      )
      .addField(
        '🏆 Ranks, XP & Daily Crates',
        '`/rank` • `/leaderboard` • `/daily`',
        false,
      )
      .addField(
        '🎭 MurderMystery2 Roleplay',
        '`/character` (`create|list|switch|delete`) • `/rp` (`say|scene|clue|roll|maps`) • `/mystery` (`start|join|draw|end`) • `/roles`',
        false,
      )
      .addField(
        '🕵️ Support Tickets, Reports & Sheriff Academy',
        '`/ticket` (`open|view|note|close`) • `/report` • `/apply`',
        false,
      );

    if (access.roles.isStaff) {
      embed.addField(
        '🔫 Sheriff & Moderator Enforcement',
        '`/warn` • `/warnings` • `/clearwarn` • `/mute` • `/unmute` • `/kick` • `/ban` • `/unban` • `/case` • `/modlogs` • `/purge` • `/slowmode` • `/lock` • `/unlock` • `/verifyuser`',
        false,
      );
    }

    if (access.roles.isAdmin) {
      embed.addField(
        '👑 High Sheriff Administration',
        '`/applications` • `/appreview` • `/xp` • `/panel` (`verify|tickets|applications|roles`) • `/config`',
        false,
      );
    }

    embed.setFooter(BOT_BRAND.footer);
    await ctx.reply({ embeds: [embed] });
  },
};
