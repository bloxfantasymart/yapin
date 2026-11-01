import { EmbedBuilder } from '../api/messages.js';
import { BOT_BRAND, EMBED_COLORS } from '../config/settings.js';
import { pingDatabase } from '../database/connection.js';

export const pingCommand = {
  name: 'ping',
  description: 'Check MM2 Helper Gateway status, uptime, and JSON database health.',
  usage: '$ping',
  category: 'utility',
  staffOnly: false,

  async execute(ctx) {
    const dbHealth = await pingDatabase();
    const gwConnected = Boolean(ctx.client?.wsConnected || ctx.client?.connected);
    const uptimeSec = Math.floor(process.uptime());

    const embed = new EmbedBuilder()
      .setTitle(`📡 ${BOT_BRAND.botName} • System Telemetry`)
      .setColor(dbHealth.healthy ? EMBED_COLORS.SUCCESS : EMBED_COLORS.WARNING)
      .addField('Gateway Link', gwConnected ? '🟢 Live WebSocket' : '🟡 HTTPS Long-Poll', true)
      .addField(
        'JSON Storage',
        dbHealth.healthy ? `🟢 Healthy (${dbHealth.latencyMs ?? 0}ms)` : '🔴 Degraded',
        true,
      )
      .addField('Uptime', `${uptimeSec}s`, true)
      .setFooter(BOT_BRAND.footer);

    await ctx.reply({ embeds: [embed] });
  },
};
