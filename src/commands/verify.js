import { EmbedBuilder } from '../api/messages.js';
import { BOT_BRAND, EMBED_COLORS } from '../config/settings.js';
import { parseCommandArgs } from '../utils/argParser.js';

export const verifyCommand = {
  name: 'verify',
  description: 'Verify your identity at the MurderMystery2 Sheriff Checkpoint.',
  usage: '/verify [MM2-XXXX]',
  category: 'verification',
  staffOnly: false,

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const code = kv.code || positional[0] || '';

    const result = await ctx.services.verification.verifyMember({
      serverId: ctx.event.server_id,
      userId: ctx.event.author_id,
      username: ctx.event.username || null,
      code,
      correlationId: ctx.correlationId,
    });

    if (result.alreadyVerified) {
      await ctx.reply({
        content: '✅ You are already a **Verified Citizen** of **MurderMystery2**!',
      });
      return;
    }

    if (result.status === 'CHALLENGE_ISSUED') {
      const embed = new EmbedBuilder()
        .setTitle('🛡️ Sheriff Passcode Checkpoint')
        .setColor(EMBED_COLORS.GOLD)
        .setDescription(
          `Your personal verification passcode is:\n\n# \`${result.code}\`\n\nRun \`/verify ${result.code}\` within **10 minutes** to unlock **MurderMystery2**!`,
        )
        .setFooter(BOT_BRAND.footer);
      await ctx.reply({ embeds: [embed] });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('🔫 Clearance Granted • Welcome to MurderMystery2!')
      .setColor(EMBED_COLORS.SUCCESS)
      .setDescription(
        `You are now an official **Verified Citizen**!\n` +
          `• Check \`/character create\` to register your RP persona\n` +
          `• Check \`/rank\` & \`/daily\` to start climbing MM2 Ranks\n` +
          `• Need help? Open a private ticket with \`/ticket open\``,
      )
      .setFooter(BOT_BRAND.footer);

    await ctx.reply({ embeds: [embed] });
  },
};
