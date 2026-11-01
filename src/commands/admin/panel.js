import { parseCommandArgs } from '../../utils/argParser.js';
import {
  buildApplicationPanelEmbed,
  buildApplicationPanelRows,
  buildSelfRolesEmbed,
  buildSelfRolesRows,
  buildTicketPanelEmbed,
  buildTicketPanelRows,
  buildVerificationPanelEmbed,
  buildVerificationPanelRows,
} from '../../utils/embeds.js';
import { ValidationError } from '../../utils/errors.js';

export const panelCommand = {
  name: 'panel',
  description: 'Deploy an interactive MurderMystery2 verification, support, application, or notification panel.',
  usage: '/panel <verify|tickets|applications|roles>',
  category: 'admin',
  staffOnly: true,
  requiredRole: 'admin',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const kind = (kv.type || positional[0] || '').toLowerCase();
    const cfg = await ctx.repositories.serverConfigs.getOrCreate(ctx.event.server_id);

    if (kind === 'verify' || kind === 'verification') {
      await ctx.repositories.serverConfigs.updateConfig(ctx.event.server_id, {
        'channels.verifyChannelId': ctx.event.channel_id,
      });
      await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
        embeds: [buildVerificationPanelEmbed(cfg)],
        components: buildVerificationPanelRows(cfg),
      });
      await ctx.services.log.record({
        serverId: ctx.event.server_id,
        actorId: ctx.event.author_id,
        actorType: 'STAFF',
        action: 'VERIFICATION_PANEL_DEPLOYED',
        targetType: 'CHANNEL',
        targetId: ctx.event.channel_id,
        correlationId: ctx.correlationId,
      });
      return;
    }

    if (kind === 'tickets' || kind === 'ticket') {
      await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
        embeds: [buildTicketPanelEmbed(cfg)],
        components: buildTicketPanelRows(),
      });
      return;
    }

    if (kind === 'applications' || kind === 'apps' || kind === 'apply') {
      await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
        embeds: [buildApplicationPanelEmbed(cfg)],
        components: buildApplicationPanelRows(cfg),
      });
      return;
    }

    if (kind === 'roles' || kind === 'selfroles') {
      const rows = buildSelfRolesRows(cfg.roles.selfRoles);
      await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
        embeds: [buildSelfRolesEmbed(cfg.roles.selfRoles)],
        ...(rows.length > 0 ? { components: rows } : {}),
      });
      return;
    }

    throw new ValidationError(
      'Usage: `/panel <verify|tickets|applications|roles>`',
    );
  },
};
