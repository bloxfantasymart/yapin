import { EMBED_COLORS } from '../config/settings.js';
import { EmbedBuilder } from '../api/messages.js';
import { ValidationError } from '../utils/errors.js';
import { parseCommandArgs } from '../utils/argParser.js';
import { extractYapinUserId } from '../utils/ids.js';

export const profileCommand = {
  name: 'profile',
  description: 'View verified trade statistics and standing for yourself or another user.',
  usage: '/profile [user=<@id>]',
  category: 'utility',
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

    const stats = userDoc.tradeStats || {};
    const susp = userDoc.suspension || {};
    const isCurrentlySuspended =
      Boolean(susp.active) && (!susp.expiresAt || new Date(susp.expiresAt) > new Date());

    const embed = new EmbedBuilder()
      .setTitle('👤 Trader & Middleman Profile')
      .setDescription(`**Yapin UUID:** \`${targetId}\` (<@${targetId}>)`)
      .setColor(isCurrentlySuspended ? EMBED_COLORS.DANGER : EMBED_COLORS.PRIMARY)
      .addField('Completed Trades', String(stats.completed || 0), true)
      .addField('Cancelled Trades', String(stats.cancelled || 0), true)
      .addField('Middleman Handled', String(stats.asMiddlemanCompleted || 0), true)
      .addField(
        'Trade Standing',
        isCurrentlySuspended ? '⛔ Suspended from new trades' : '✅ Permitted to trade',
        true,
      );

    if (access.roles.isStaff || targetId === ctx.event.author_id) {
      embed.addField('Recorded Warnings', String(userDoc.warnings?.length || 0), true);
    }
    if (access.roles.isStaff) {
      embed.addField(
        'Staff Review Queue Reports (Unverified)',
        String(userDoc.riskFlags?.openReportsCount || 0),
        true,
      );
    }

    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      embeds: [embed],
      replyTo: ctx.event.id,
    });
  },
};
