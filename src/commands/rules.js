import {
  DEFAULT_COORDINATION_DISCLAIMER,
  DEFAULT_TRADING_RULES,
  EMBED_COLORS,
} from '../config/settings.js';
import { EmbedBuilder } from '../api/messages.js';

export const rulesCommand = {
  name: 'rules',
  description: 'View server middleman trading rules and non-custody safety notice.',
  usage: '/rules',
  category: 'utility',
  staffOnly: false,

  async execute(ctx) {
    const serverCfg = await ctx.repositories.serverConfig.getOrCreate(ctx.event.server_id);
    const rules = serverCfg.rulesText || DEFAULT_TRADING_RULES;
    const disclaimer = serverCfg.disclaimerText || DEFAULT_COORDINATION_DISCLAIMER;

    const embed = new EmbedBuilder()
      .setTitle('📜 Middleman Trading Rules & Safety Notice')
      .setDescription(rules)
      .setColor(EMBED_COLORS.INFO)
      .addField('⚠️ Important Non-Custody Notice', disclaimer, false)
      .setFooter('Both participants must explicitly agree to these rules (rules=yes) when creating or accepting a trade.');

    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      embeds: [embed],
      replyTo: ctx.event.id,
    });
  },
};
