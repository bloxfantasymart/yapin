import { EMBED_COLORS } from '../config/settings.js';
import { EmbedBuilder } from '../api/messages.js';

export const helpCommand = {
  name: 'help',
  description: 'List Middleman Bot commands and detailed usage guides.',
  usage: '/help [command-name]',
  category: 'utility',
  staffOnly: false,

  async execute(ctx) {
    const query = (ctx.event.args || '').trim().replace(/^\//, '').toLowerCase();
    const allCommands = ctx.commandRegistry?.getAll() || [];

    if (query) {
      const target = allCommands.find((c) => c.name === query);
      if (!target) {
        await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
          content: `Unknown command \`/${query}\`. Run \`/help\` to see available commands.`,
          replyTo: ctx.event.id,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`Command: /${target.name}`)
        .setDescription(target.description)
        .setColor(EMBED_COLORS.INFO)
        .addField('Usage', `\`${target.usage || `/${target.name}`}\``, false)
        .addField('Access', target.staffOnly ? `Staff (${target.requiredRole || 'middleman'})` : 'All server members', true);

      await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
        embeds: [embed],
        replyTo: ctx.event.id,
      });
      return;
    }

    const userCommands = allCommands.filter((c) => !c.staffOnly);
    const staffCommands = allCommands.filter((c) => c.staffOnly);

    const embed = new EmbedBuilder()
      .setTitle('Yapin Middleman Coordination Bot — Help')
      .setDescription(
        'Safe, audited middleman trade coordination for Yapin.gg.\n' +
          'Run `/help <command>` for detailed syntax or `/rules` before trading.',
      )
      .setColor(EMBED_COLORS.PRIMARY)
      .addField(
        'Trader & General Commands',
        userCommands.map((c) => `\`/${c.name}\` — ${c.description}`).join('\n').slice(0, 1020),
        false,
      )
      .addField(
        'Middleman & Staff Commands',
        staffCommands.map((c) => `\`/${c.name}\` — ${c.description}`).join('\n').slice(0, 1020),
        false,
      )
      .setFooter('Note: Yapin slash commands accept key="value" arguments after the command name.');

    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      embeds: [embed],
      replyTo: ctx.event.id,
    });
  },
};
