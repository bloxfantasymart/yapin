import { EMBED_COLORS } from '../config/settings.js';
import { EmbedBuilder } from '../api/messages.js';

export const pingCommand = {
  name: 'ping',
  description: 'Check Yapin API connectivity, event transport, and response latency',
  category: 'general',
  staffOnly: false,
  requiredRole: null,
  cooldownMs: 2000,
  usage: '/ping',

  /**
   * Executes a verified `GET /me` round-trip to measure real Yapin REST latency
   * and reports event cursor + transport state.
   */
  async execute(ctx) {
    const started = performance.now();
    const { profile, latencyMs } = await ctx.client.getMe();
    const totalMs = Math.max(1, Math.round(performance.now() - started));

    const embed = new EmbedBuilder()
      .setTitle('🏓 Pong — Yapin Middleman Bot Online')
      .setColor(EMBED_COLORS.SUCCESS)
      .addField('REST Latency', `${latencyMs} ms`, true)
      .addField('Handler Time', `${totalMs} ms`, true)
      .addField('Event Transport', ctx.client.transport || 'polling', true)
      .addField('Bot Identity', `${profile.username || profile.bot?.name || 'bot'} (\`${profile.id || 'verified'}\`)`, true)
      .addField('Last Event Cursor', String(ctx.client.lastEventId ?? 0), true)
      .setFooter(`Correlation ID: ${ctx.correlationId}`)
      .setTimestamp();

    if (typeof ctx.reply === 'function') {
      return ctx.reply({ embeds: [embed] });
    }
    return ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      embeds: [embed],
      replyTo: ctx.event.id,
    });
  },
};

export default pingCommand;
