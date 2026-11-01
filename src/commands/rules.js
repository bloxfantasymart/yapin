import { EmbedBuilder } from '../api/messages.js';
import { BOT_BRAND, DEFAULT_SERVER_RULES, EMBED_COLORS } from '../config/settings.js';

export const rulesCommand = {
  name: 'rules',
  description: 'Read the official MurderMystery2 Roleplay & Community Rules.',
  usage: '/rules',
  category: 'utility',
  staffOnly: false,

  async execute(ctx) {
    const cfg = await ctx.repositories.serverConfigs.getOrCreate(ctx.event.server_id);
    const rawRules = cfg.rulesText || DEFAULT_SERVER_RULES;
    const text = Array.isArray(rawRules) ? rawRules.join('\n\n') : String(rawRules);

    const embed = new EmbedBuilder()
      .setTitle(`📜 ${BOT_BRAND.serverName} • Official Roleplay & Server Laws`)
      .setColor(EMBED_COLORS.CRIMSON)
      .setDescription(text)
      .setFooter(BOT_BRAND.footer);

    await ctx.reply({ embeds: [embed] });
  },
};
