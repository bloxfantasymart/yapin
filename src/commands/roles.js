import { parseCommandArgs } from '../utils/argParser.js';
import { buildSelfRolesEmbed, buildSelfRolesRows } from '../utils/embeds.js';

export const rolesCommand = {
  name: 'roles',
  description: 'View or toggle self-assignable MurderMystery2 RP notification roles.',
  usage: '/roles [toggle <roleKey>]',
  category: 'roleplay',
  staffOnly: false,

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const sub = (positional[0] || 'list').toLowerCase();

    if (sub === 'toggle' || kv.role) {
      const roleKey = kv.role || positional[1] || '';
      const res = await ctx.services.roleplay.toggleSelfRole({
        serverId: ctx.event.server_id,
        userId: ctx.event.author_id,
        roleKey,
      });
      await ctx.reply({
        content:
          res.action === 'added'
            ? `✅ Equipped MurderMystery2 role **${res.roleKey}**!`
            : `➖ Removed MurderMystery2 role **${res.roleKey}**.`,
      });
      return;
    }

    const cfg = await ctx.repositories.serverConfigs.getOrCreate(ctx.event.server_id);
    const rows = buildSelfRolesRows(cfg.roles.selfRoles);
    await ctx.reply({
      embeds: [buildSelfRolesEmbed(cfg.roles.selfRoles)],
      ...(rows.length > 0 ? { components: rows } : {}),
    });
  },
};
