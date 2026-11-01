import { EmbedBuilder } from '../api/messages.js';
import { BOT_BRAND, EMBED_COLORS, MM2_MAPS } from '../config/settings.js';

export const serverInfoCommand = {
  name: 'serverinfo',
  description: 'View live MurderMystery2 community, case file, and roleplay statistics.',
  usage: '/serverinfo',
  category: 'utility',
  staffOnly: false,

  async execute(ctx) {
    const serverId = ctx.event.server_id;
    const cfg = await ctx.repositories.serverConfigs.getOrCreate(serverId);
    const [verifiedCount, openTickets, appsPage, casesPage] = await Promise.all([
      ctx.repositories.users.countVerified(),
      ctx.repositories.tickets.listTickets({ serverId, status: 'OPEN', limit: 1 }),
      ctx.repositories.applications.listByServer(serverId, { status: 'PENDING', limit: 1 }),
      ctx.repositories.cases.listRecentByServer(serverId, { limit: 1 }),
    ]);

    const activeRounds = [...ctx.services.roleplay.activeRounds.values()].filter(
      (r) => r.serverId === serverId,
    ).length;

    const embed = new EmbedBuilder()
      .setTitle(`🏰 ${cfg.serverName || BOT_BRAND.serverName} • Server Dossier`)
      .setColor(EMBED_COLORS.CRIMSON)
      .setDescription(
        `Managed by **${BOT_BRAND.botName}** — Official Murder Mystery 2 Roleplay & Enforcement Suite.`,
      )
      .addField('Verified Citizens', String(verifiedCount), true)
      .addField('Mod Applications', cfg.applications.open ? '🟢 OPEN' : '🔴 CLOSED', true)
      .addField('Pending Apps', String(appsPage.total), true)
      .addField('Open Tickets', String(openTickets.total), true)
      .addField('Recorded Case Files', String(casesPage.total), true)
      .addField('Active Mystery Rounds', String(activeRounds), true)
      .addField('Available RP Maps', MM2_MAPS.map((m) => `${m.emoji} ${m.name}`).join(' • '), false)
      .setFooter(BOT_BRAND.footer);

    await ctx.reply({ embeds: [embed] });
  },
};
