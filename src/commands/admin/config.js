import { EmbedBuilder } from '../../api/messages.js';
import { BOT_BRAND, EMBED_COLORS } from '../../config/settings.js';
import { parseBooleanInput, parseCommandArgs } from '../../utils/argParser.js';
import { ValidationError } from '../../utils/errors.js';

const CHANNEL_SLOT_MAP = {
  welcome: 'channels.welcomeChannelId',
  verify: 'channels.verifyChannelId',
  modlog: 'channels.modLogChannelId',
  memberlog: 'channels.memberLogChannelId',
  ticketlog: 'channels.ticketLogChannelId',
  applog: 'channels.modAppLogChannelId',
  rplog: 'channels.rpLogChannelId',
  levellog: 'channels.levelUpChannelId',
  alert: 'channels.alertChannelId',
  transcript: 'channels.transcriptChannelId',
  ticketcategory: 'channels.ticketCategoryId',
};

export const configCommand = {
  name: 'config',
  description: 'View or configure MurderMystery2 roles, log channels, verification, apps, and Auto-Mod.',
  usage: '/config <view|role|channel|verify|rules|apps|automod|levelrole|selfrole> ...',
  category: 'admin',
  staffOnly: true,
  requiredRole: 'admin',

  async execute(ctx) {
    const serverId = ctx.event.server_id;
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const sub = (positional[0] || 'view').toLowerCase();
    const cfg = await ctx.repositories.serverConfigs.getOrCreate(serverId);

    if (sub === 'view') {
      const embed = new EmbedBuilder()
        .setTitle(`⚙️ ${cfg.serverName || BOT_BRAND.serverName} • Server Configuration`)
        .setColor(EMBED_COLORS.SHERIFF)
        .addField(
          'Staff Roles',
          `Admins: \`${cfg.staffRoles.adminRoleIds.join(', ') || 'none'}\`\n` +
            `Mods: \`${cfg.staffRoles.moderatorRoleIds.join(', ') || 'none'}\`\n` +
            `Trial Mods: \`${cfg.staffRoles.trialModRoleIds.join(', ') || 'none'}\`\n` +
            `Support: \`${cfg.staffRoles.supportRoleIds.join(', ') || 'none'}\``,
          false,
        )
        .addField(
          'Citizen & Mute Roles',
          `Verified: \`${cfg.roles.verifiedRoleId || 'none'}\` • Unverified: \`${cfg.roles.unverifiedRoleId || 'none'}\` • Muted: \`${cfg.roles.mutedRoleId || 'none'}\``,
          false,
        )
        .addField(
          'Log & Operational Channels',
          `ModLog: \`${cfg.channels.modLogChannelId || '-'}\` • AppLog: \`${cfg.channels.modAppLogChannelId || '-'}\`\n` +
            `TicketLog: \`${cfg.channels.ticketLogChannelId || '-'}\` • Welcome: \`${cfg.channels.welcomeChannelId || '-'}\`\n` +
            `RPLog: \`${cfg.channels.rpLogChannelId || '-'}\` • TicketCat: \`${cfg.channels.ticketCategoryId || '-'}\``,
          false,
        )
        .addField(
          'Systems State',
          `Verification: \`${cfg.verification.mode}\` • Mod Apps: \`${cfg.applications.open ? 'OPEN' : 'CLOSED'}\` (Min Lv.${cfg.applications.minLevel}) • Auto-Mod: \`${cfg.autoMod.enabled ? 'ON' : 'OFF'}\``,
          false,
        )
        .setFooter(BOT_BRAND.footer);
      await ctx.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'role') {
      const slot = (positional[1] || '').toLowerCase();
      const roleId = String(positional[2] || '').replace(/[<@&#>]/g, '');
      if (!slot || !roleId) {
        throw new ValidationError(
          'Usage: `/config role <admin|mod|trialmod|support|verified|unverified|muted> <roleId>`',
        );
      }

      const setPatch = {};
      if (slot === 'admin') {
        setPatch['staffRoles.adminRoleIds'] = [...new Set([...cfg.staffRoles.adminRoleIds, roleId])];
      } else if (slot === 'mod' || slot === 'moderator') {
        setPatch['staffRoles.moderatorRoleIds'] = [
          ...new Set([...cfg.staffRoles.moderatorRoleIds, roleId]),
        ];
      } else if (slot === 'trialmod') {
        setPatch['staffRoles.trialModRoleIds'] = [
          ...new Set([...cfg.staffRoles.trialModRoleIds, roleId]),
        ];
      } else if (slot === 'support') {
        setPatch['staffRoles.supportRoleIds'] = [
          ...new Set([...cfg.staffRoles.supportRoleIds, roleId]),
        ];
      } else if (slot === 'verified') {
        setPatch['roles.verifiedRoleId'] = roleId;
      } else if (slot === 'unverified') {
        setPatch['roles.unverifiedRoleId'] = roleId;
      } else if (slot === 'muted') {
        setPatch['roles.mutedRoleId'] = roleId;
      } else {
        throw new ValidationError('Slot must be `admin|mod|trialmod|support|verified|unverified|muted`.');
      }

      await ctx.repositories.serverConfigs.updateConfig(serverId, setPatch);
      await ctx.services.log.record({
        serverId,
        actorId: ctx.event.author_id,
        actorType: 'STAFF',
        action: 'SERVER_CONFIG_ROLE_UPDATED',
        targetType: 'SERVER_CONFIG',
        targetId: serverId,
        afterState: setPatch,
        correlationId: ctx.correlationId,
      });
      await ctx.reply({ content: `✅ Configured **${slot}** role → \`${roleId}\`.` });
      return;
    }

    if (sub === 'channel') {
      const slot = (positional[1] || '').toLowerCase();
      const rawCh = String(positional[2] || '').replace(/[<#>]/g, '');
      const dotPath = CHANNEL_SLOT_MAP[slot];
      if (!dotPath || !rawCh) {
        throw new ValidationError(
          `Usage: \`/config channel <${Object.keys(CHANNEL_SLOT_MAP).join('|')}> <channelId|none>\``,
        );
      }
      const value = rawCh.toLowerCase() === 'none' ? null : rawCh;
      await ctx.repositories.serverConfigs.updateConfig(serverId, { [dotPath]: value });
      await ctx.reply({ content: `✅ Configured **${slot}** channel → \`${value || 'none'}\`.` });
      return;
    }

    if (sub === 'rules') {
      if ((positional[1] || '').toLowerCase() !== 'reset') {
        throw new ValidationError('Usage: `/config rules reset` restores the official MurderMystery2 community standards.');
      }
      await ctx.repositories.serverConfigs.updateConfig(serverId, { rulesText: DEFAULT_SERVER_RULES });
      await ctx.services.log.record({
        serverId,
        actorId: ctx.event.author_id,
        actorType: 'STAFF',
        action: 'SERVER_RULES_RESET',
        targetType: 'SERVER_CONFIG',
        targetId: serverId,
        correlationId: ctx.correlationId,
      });
      await ctx.reply({ content: '✅ Official MurderMystery2 community standards restored. Review them with `/rules`.' });
      return;
    }

    if (sub === 'verify') {
      const mode = (kv.mode || positional[1] || '').toUpperCase();
      if (!['INSTANT', 'CODE'].includes(mode)) {
        throw new ValidationError('Usage: `/config verify <INSTANT|CODE>`');
      }
      await ctx.repositories.serverConfigs.updateConfig(serverId, {
        'verification.mode': mode,
      });
      await ctx.reply({ content: `✅ Verification mode set to **${mode}**.` });
      return;
    }

    if (sub === 'apps') {
      const patch = {};
      if (kv.open !== undefined || positional[1]) {
        const val = kv.open !== undefined ? kv.open : positional[1];
        patch['applications.open'] =
          String(val).toLowerCase() === 'open' ? true : parseBooleanInput(val);
      }
      if (kv.minlevel !== undefined) {
        patch['applications.minLevel'] = Math.max(1, Number(kv.minlevel) || 1);
      }
      await ctx.repositories.serverConfigs.updateConfig(serverId, patch);
      await ctx.reply({ content: '✅ Sheriff Academy Application settings updated.' });
      return;
    }

    if (sub === 'automod') {
      const patch = {};
      if (kv.enabled !== undefined) patch['autoMod.enabled'] = parseBooleanInput(kv.enabled);
      if (kv.invites !== undefined) patch['autoMod.blockInviteLinks'] = parseBooleanInput(kv.invites);
      if (kv.scams !== undefined) patch['autoMod.blockScamLinks'] = parseBooleanInput(kv.scams);
      if (kv.threshold !== undefined) {
        patch['autoMod.autoWarnThreshold'] = Math.max(2, Math.min(10, Number(kv.threshold) || 3));
      }
      if (kv.addword) {
        patch['autoMod.blockedWords'] = [
          ...new Set([...cfg.autoMod.blockedWords, String(kv.addword).toLowerCase()]),
        ];
      }
      await ctx.repositories.serverConfigs.updateConfig(serverId, patch);
      await ctx.reply({ content: '✅ MurderMystery2 Auto-Mod settings updated.' });
      return;
    }

    if (sub === 'levelrole') {
      const level = String(positional[1] || '');
      const roleId = String(positional[2] || '').replace(/[<@&#>]/g, '');
      if (!/^\d+$/.test(level) || !roleId) {
        throw new ValidationError('Usage: `/config levelrole <levelNumber> <roleId>`');
      }
      const next = { ...cfg.roles.levelRewards, [level]: roleId };
      await ctx.repositories.serverConfigs.updateConfig(serverId, {
        'roles.levelRewards': next,
      });
      await ctx.reply({ content: `✅ Level **${level}** milestone role set to \`${roleId}\`.` });
      return;
    }

    if (sub === 'selfrole') {
      const key = String(positional[1] || '').toLowerCase();
      const roleId = String(positional[2] || '').replace(/[<@&#>]/g, '');
      if (!key || !roleId) {
        throw new ValidationError('Usage: `/config selfrole <key e.g. events> <roleId|none>`');
      }
      const next = { ...cfg.roles.selfRoles };
      if (roleId.toLowerCase() === 'none') delete next[key];
      else next[key] = roleId;
      await ctx.repositories.serverConfigs.updateConfig(serverId, {
        'roles.selfRoles': next,
      });
      await ctx.reply({ content: `✅ Self-role **${key}** updated.` });
      return;
    }

    throw new ValidationError(
      'Subcommands: `/config view`, `/config role`, `/config channel`, `/config verify`, `/config rules reset`, `/config apps`, `/config automod`, `/config levelrole`, `/config selfrole`.',
    );
  },
};
