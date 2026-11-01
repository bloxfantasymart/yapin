import { EmbedBuilder } from '../api/messages.js';
import { BOT_BRAND, EMBED_COLORS, MM2_MAPS } from '../config/settings.js';
import { sanitizeUserText } from '../security/sanitizer.js';
import { parseCommandArgs } from '../utils/argParser.js';
import { ValidationError } from '../utils/errors.js';
import { userMention } from '../utils/ids.js';

export const rpCommand = {
  name: 'rp',
  description: 'Post character dialogue, open a map scene, record clues, or roll for an outcome.',
  usage: '/rp <say|scene|clue|roll|maps> ...',
  category: 'community',
  staffOnly: false,

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const sub = (positional[0] || 'maps').toLowerCase();

    if (sub === 'maps' || sub === 'locations') {
      const embed = new EmbedBuilder()
        .setTitle('MURDERMYSTERY2 | LOCATIONS & MAPS')
        .setColor(EMBED_COLORS.MYSTERY)
        .setDescription(
          MM2_MAPS.map((m) => `${m.emoji} **${m.name}** (\`${m.id}\`) — *${m.vibe}*`).join('\n'),
        )
        .setFooter(BOT_BRAND.footer);
      await ctx.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'roll') {
      const expr = kv.dice || positional[1] || '1d20';
      const actionDesc = sanitizeUserText(positional.slice(2).join(' ') || 'Action check', {
        maxLength: 200,
      });
      const result = ctx.services.roleplay.rollDice(expr);
      const embed = new EmbedBuilder()
        .setTitle(`🎲 MM2 Fate Roll • ${result.notation}`)
        .setColor(EMBED_COLORS.GOLD)
        .setDescription(
          `${userMention(ctx.event.author_id)} rolled for **${actionDesc}**:\n\n` +
            `🎯 **Total: ${result.total}** *(Rolls: ${result.rolls.join(', ')})*`,
        )
        .setFooter(BOT_BRAND.footer);
      await ctx.reply({ embeds: [embed] });
      return;
    }

    const user = await ctx.repositories.users.getOrCreate(ctx.event.author_id);
    const activeChar =
      (user.characters || []).find((c) => c.characterId === user.activeCharacterId) ||
      user.characters?.[0] ||
      null;
    const speakerLabel = activeChar
      ? `${activeChar.name} (${activeChar.alignment})`
      : ctx.event.username || 'Suspect';

    if (sub === 'say') {
      const dialogue = sanitizeUserText(positional.slice(1).join(' '), {
        maxLength: 1200,
        fieldName: 'Dialogue',
      });
      if (!dialogue) throw new ValidationError('Usage: `/rp say <character dialogue>`');
      const embed = new EmbedBuilder()
        .setTitle(`🎭 ${speakerLabel}`)
        .setColor(EMBED_COLORS.MYSTERY)
        .setDescription(`*"${dialogue}"*`)
        .setFooter(`Played by ${ctx.event.username || ctx.event.author_id} • ${BOT_BRAND.serverName}`);
      await ctx.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'scene') {
      const map = ctx.services.roleplay.resolveMap(kv.map || positional[1] || 'Mansion');
      const description = sanitizeUserText(
        kv.desc || positional.slice(2).join(' ') || map.vibe,
        { maxLength: 1200, fieldName: 'Scene description' },
      );

      const embed = new EmbedBuilder()
        .setTitle(`${map.emoji} Crime Scene Opened • ${map.name}`)
        .setColor(EMBED_COLORS.CRIMSON)
        .setDescription(description)
        .addField('Scene Director', `${speakerLabel} (${userMention(ctx.event.author_id)})`, true)
        .addField('Atmosphere', map.vibe, true)
        .setFooter(BOT_BRAND.footer);

      await ctx.services.log.record({
        serverId: ctx.event.server_id,
        actorId: ctx.event.author_id,
        actorType: 'USER',
        action: 'COMMUNITY_SCENE_STARTED',
        targetType: 'COMMUNITY',
        targetId: map.id,
        metadata: { map: map.name },
        stream: 'community',
        embed,
      });

      await ctx.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'clue') {
      const clueText = sanitizeUserText(positional.slice(1).join(' '), {
        maxLength: 800,
        fieldName: 'Clue',
      });
      if (!clueText) throw new ValidationError('Usage: `/rp clue <evidence or clue description>`');
      const embed = new EmbedBuilder()
        .setTitle('🔎 Forensic Clue Discovered!')
        .setColor(EMBED_COLORS.GOLD)
        .setDescription(`> *${clueText}*`)
        .addField('Planted / Found By', userMention(ctx.event.author_id), true)
        .setFooter(BOT_BRAND.footer);
      await ctx.reply({ embeds: [embed] });
      return;
    }

    throw new ValidationError(
      'Subcommands: `/rp say`, `/rp scene <Map> <desc>`, `/rp clue <evidence>`, `/rp roll [1d20]`, `/rp maps`.',
    );
  },
};
