import { EmbedBuilder } from '../api/messages.js';
import { BOT_BRAND, EMBED_COLORS } from '../config/settings.js';
import { parseCommandArgs } from '../utils/argParser.js';
import { AppError, sanitizeErrorMessage } from '../utils/errors.js';

export const verifyCommand = {
  name: 'verify',
  description: 'Open the Sheriff Checkpoint and complete verification with its button.',
  usage: '$verify [MM2-XXXX]',
  category: 'verification',
  staffOnly: false,

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const code = kv.code || positional[0] || '';
    const serverId = ctx.event.server_id;
    const userId = ctx.event.author_id;
    const cfg = await ctx.repositories.serverConfigs.getOrCreate(serverId);

    // Codes are only created by the Checkpoint button and are shown in a private interaction
    // response. The text command is deliberately not allowed to issue a code in public chat.
    if (!code) {
      const channelHint = cfg.channels.verifyChannelId
        ? `Open <#${cfg.channels.verifyChannelId}> and press **Verify Account**.`
        : 'Ask a server administrator to deploy the panel with `$panel verify`.';
      const embed = new EmbedBuilder()
        .setTitle('🛡️ Sheriff Checkpoint')
        .setColor(EMBED_COLORS.SHERIFF)
        .setDescription(
          `Verification is completed from the official button panel so clearance is tied to your Yapin account.\\n\\n${channelHint}\\n\\n` +
            (cfg.verification.mode === 'code'
              ? 'The button will privately show you a short-lived Sheriff Passcode. Never post that code publicly.'
              : 'The button will complete the one-click checkpoint and assign your Verified Citizen role.'),
        )
        .setFooter(BOT_BRAND.footer);
      await ctx.reply({ embeds: [embed] });
      return;
    }

    if (cfg.verification.mode !== 'code') {
      await ctx.reply({
        content: 'This checkpoint uses one-click button verification. Open the official panel and press **Verify Account**.',
      });
      return;
    }

    // A typed passcode can appear in ordinary command history. Remove that message first;
    // never accept the code if Yapin refuses the deletion (for example, missing Manage Messages).
    try {
      await ctx.messagesApi.deleteMessage(ctx.event.channel_id, ctx.event.id);
    } catch {
      await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
        content: '⚠️ Passcode not checked. The command could not be removed from channel history. Delete it yourself, then use the one-click Checkpoint button or ask staff to fix MM2 Helper’s message permissions.',
      });
      return;
    }

    let result;
    try {
      result = await ctx.services.verification.verifyMember({
        serverId,
        userId,
        username: ctx.event.username || null,
        code,
        correlationId: ctx.correlationId,
      });
    } catch (error) {
      if (error instanceof AppError && error.expose !== false) {
        await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
          content: `❌ ${sanitizeErrorMessage(error.message)}`,
        });
        return;
      }
      throw error;
    }

    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      content: result.alreadyVerified
        ? '✅ Your MurderMystery2 citizen clearance is already active.'
        : '✅ Sheriff Passcode accepted. Your MurderMystery2 citizen clearance is active.',
    });
  },
};
