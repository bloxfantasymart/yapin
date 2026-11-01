import { EMBED_COLORS } from '../../config/settings.js';
import { EmbedBuilder } from '../../api/messages.js';
import { ValidationError } from '../../utils/errors.js';
import { parseCommandArgs, parseYesBoolean } from '../../utils/argParser.js';
import { sanitizeUserText } from '../../security/sanitizer.js';

export const configCommand = {
  name: 'config',
  description: 'View or update server middleman roles, alert channels, auto-assign, and trade limits.',
  usage:
    '/config view | /config set-role tier=middleman|moderator|admin|support roles=roleId1,roleId2 | /config set-channel key=alertChannelId|auditLogChannelId|ticketCategoryId value=<id> | /config autoassign enabled=yes|no',
  category: 'staff',
  staffOnly: true,
  requiredRole: 'admin',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const sub = (positional[0] || kv.action || 'view').toLowerCase();
    const serverId = ctx.event.server_id;

    if (sub === 'view') {
      const cfg = await ctx.repositories.serverConfigs.getOrCreate(serverId);
      const embed = new EmbedBuilder()
        .setTitle('⚙️ Server Middleman Configuration')
        .setColor(EMBED_COLORS.INFO)
        .addField('Middleman Roles', (cfg.staffRoles?.middlemanRoleIds || []).join(', ') || 'None configured', true)
        .addField('Moderator Roles', (cfg.staffRoles?.moderatorRoleIds || []).join(', ') || 'None configured', true)
        .addField('Admin Roles', (cfg.staffRoles?.adminRoleIds || []).join(', ') || 'None configured', true)
        .addField('Staff Alerts Channel', cfg.channels?.alertChannelId || 'Unset', true)
        .addField('Ticket Category', cfg.channels?.ticketCategoryId || 'Unset', true)
        .addField('Auto-Assign Enabled', cfg.tradeLimits?.autoAssignMiddleman ? 'Yes' : 'No', true);

      await ctx.messagesApi.sendMessage(ctx.event.channel_id, { embeds: [embed], replyTo: ctx.event.id });
      return;
    }

    if (sub === 'set-role') {
      const tier = (kv.tier || '').toLowerCase();
      const roleIds = (kv.roles || '')
        .split(',')
        .map((s) => sanitizeUserText(s, { maxLength: 64, fieldName: 'roleId' }))
        .filter(Boolean);
      const fieldMap = {
        middleman: 'staffRoles.middlemanRoleIds',
        moderator: 'staffRoles.moderatorRoleIds',
        admin: 'staffRoles.adminRoleIds',
        support: 'staffRoles.supportRoleIds',
      };
      const field = fieldMap[tier];
      if (!field) throw new ValidationError('`tier` must be `middleman`, `moderator`, `support`, or `admin`.');

      await ctx.repositories.serverConfigs.updateConfig(serverId, { [field]: roleIds });
      await ctx.services.audit.record({
        serverId,
        action: 'SERVER_CONFIG_UPDATED',
        actorId: ctx.event.author_id,
        actorType: 'STAFF',
        targetType: 'SERVER_CONFIG',
        targetId: serverId,
        correlationId: ctx.correlationId,
        afterState: { [field]: roleIds },
      });

      await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
        content: `✅ Updated \`${field}\` to: ${roleIds.length ? roleIds.map((r) => `\`${r}\``).join(', ') : '(empty)'}.`,
        replyTo: ctx.event.id,
      });
      return;
    }

    if (sub === 'set-channel') {
      const allowedKeys = [
        'auditLogChannelId',
        'alertChannelId',
        'tradeRequestsChannelId',
        'ticketCategoryId',
        'tradeCategoryId',
      ];
      const key = kv.key;
      if (!allowedKeys.includes(key)) {
        throw new ValidationError(`\`key\` must be one of: ${allowedKeys.join(', ')}`);
      }
      const value =
        kv.value && kv.value !== 'none'
          ? sanitizeUserText(kv.value, { maxLength: 64, fieldName: 'channelId' })
          : null;
      await ctx.repositories.serverConfigs.updateConfig(serverId, { [`channels.${key}`]: value });
      await ctx.services.audit.record({
        serverId,
        action: 'SERVER_CONFIG_UPDATED',
        actorId: ctx.event.author_id,
        actorType: 'STAFF',
        targetType: 'SERVER_CONFIG',
        targetId: serverId,
        correlationId: ctx.correlationId,
        afterState: { [`channels.${key}`]: value },
      });

      await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
        content: `✅ Updated \`channels.${key}\` to \`${value || 'null'}\`.`,
        replyTo: ctx.event.id,
      });
      return;
    }

    if (sub === 'autoassign') {
      const enabled = parseYesBoolean(kv.enabled);
      await ctx.repositories.serverConfigs.updateConfig(serverId, {
        'tradeLimits.autoAssignMiddleman': enabled,
      });
      await ctx.services.audit.record({
        serverId,
        action: 'SERVER_CONFIG_UPDATED',
        actorId: ctx.event.author_id,
        actorType: 'STAFF',
        targetType: 'SERVER_CONFIG',
        targetId: serverId,
        correlationId: ctx.correlationId,
        afterState: { autoAssignMiddleman: enabled },
      });
      await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
        content: `✅ Workload auto-assignment is now **${enabled ? 'ENABLED' : 'DISABLED'}**.`,
        replyTo: ctx.event.id,
      });
      return;
    }

    throw new ValidationError('Unknown `/config` action. Use `view`, `set-role`, `set-channel`, or `autoassign`.');
  },
};
