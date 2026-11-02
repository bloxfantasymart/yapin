import { EmbedBuilder } from '../api/messages.js';
import { BOT_BRAND, EMBED_COLORS, MM2_MAPS } from '../config/settings.js';

export const serverInfoCommand = {
  name: 'serverinfo',
  description: 'View MurderMystery2 server status, member access, support, and case statistics.',
  usage: '$serverinfo',
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
      .setTitle(`MURDERMYSTERY2 | SERVER OVERVIEW`)
      .setColor(EMBED_COLORS.CRIMSON)
      .setDescription(
        `**${BOT_BRAND.botName}** provides verification, member support, staff tools, and server information.`,
      )
      .addField('VERIFIED MEMBERS', String(verifiedCount), true)
      .addField('APPLICATION STATUS', cfg.applications.open ? '🟢 OPEN' : '🔴 CLOSED', true)
      .addField('PENDING APPLICATIONS', String(appsPage.total), true)
      .addField('OPEN SUPPORT CASES', String(openTickets.total), true)
      .addField('RECORDED CASE FILES', String(casesPage.total), true)
      .addField('ACTIVE MYSTERY EVENTS', String(activeRounds), true)
      .addField('AVAILABLE MAPS', MM2_MAPS.map((m) => `${m.emoji} ${m.name}`).join(' • '), false)
      .setFooter(BOT_BRAND.footer);

    await ctx.reply({ embeds: [embed] });
  },
};
