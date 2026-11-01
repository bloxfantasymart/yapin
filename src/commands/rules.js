import { DEFAULT_SERVER_RULES } from '../config/settings.js';
import { buildRulesEmbed } from '../utils/embeds.js';

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

    await ctx.reply({ embeds: [buildRulesEmbed(text)] });
  },
};
