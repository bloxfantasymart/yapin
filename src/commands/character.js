import { EmbedBuilder } from '../api/messages.js';
import { BOT_BRAND, EMBED_COLORS, MM2_ALIGNMENTS } from '../config/settings.js';
import { parseCommandArgs, parsePipeSegments } from '../utils/argParser.js';
import { ValidationError } from '../utils/errors.js';

export const characterCommand = {
  name: 'character',
  description: 'Create and manage your MurderMystery2 character profiles.',
  usage: '/character <create|list|switch|delete> ...',
  category: 'community',
  staffOnly: false,

  async execute(ctx) {
    const raw = (ctx.event.args || '').trim();
    const { positional, kv } = parseCommandArgs(raw);
    const sub = (positional[0] || 'list').toLowerCase();

    if (sub === 'create') {
      const rest = raw.replace(/^create\s+/i, '');
      const pipes = parsePipeSegments(rest);
      const name = kv.name || pipes[0] || positional[1] || '';
      const alignment = kv.alignment || pipes[1] || positional[2] || 'INNOCENT';
      const weapon = kv.weapon || pipes[2] || positional[3] || 'Luger';
      const bio = kv.bio || pipes[3] || positional.slice(4).join(' ') || '';

      const { character } = await ctx.services.roleplay.createCharacter({
        serverId: ctx.event.server_id,
        userId: ctx.event.author_id,
        username: ctx.event.username || null,
        name,
        alignment,
        weapon,
        bio,
      });

      const embed = new EmbedBuilder()
        .setTitle('MURDERMYSTERY2 | CHARACTER REGISTERED')
        .setColor(EMBED_COLORS.MYSTERY)
        .addField('Character', `**${character.name}** (\`${character.characterId}\`)`, true)
        .addField('Alignment', `\`${character.alignment}\``, true)
        .addField('Signature Gear', character.weapon, true)
        .addField('Backstory', character.bio, false)
        .setFooter(BOT_BRAND.footer);

      await ctx.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'list') {
      const user = await ctx.repositories.users.getOrCreate(ctx.event.author_id);
      const chars = user.characters || [];
      const lines = chars.map((c) => {
        const activeTag = c.characterId === user.activeCharacterId ? ' ⭐ **(Active)**' : '';
        return `• \`${c.characterId}\` — **${c.name}** [\`${c.alignment}\` • 🗡️ ${c.weapon}]${activeTag}`;
      });

      const embed = new EmbedBuilder()
        .setTitle('MURDERMYSTERY2 | YOUR CHARACTERS')
        .setColor(EMBED_COLORS.MYSTERY)
        .setDescription(
          lines.length > 0
            ? lines.join('\n')
            : `No characters registered yet. Create your first character:\n\`/character create Detective Vance | SHERIFF | Golden Luger | Veteran investigator\``,
        )
        .setFooter(`Alignments: ${MM2_ALIGNMENTS.join(', ')} • ${BOT_BRAND.botName}`);

      await ctx.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'switch') {
      const target = kv.id || positional.slice(1).join(' ');
      if (!target) throw new ValidationError('Usage: `/character switch <Character Name or CHR-ID>`');
      const { character } = await ctx.services.roleplay.switchCharacter({
        userId: ctx.event.author_id,
        characterIdOrName: target,
      });
      await ctx.reply({
        content: `🎭 Active character changed to **${character.name}** (\`${character.alignment}\` • 🗡️ ${character.weapon}).`,
      });
      return;
    }

    if (sub === 'delete') {
      const target = kv.id || positional.slice(1).join(' ');
      if (!target) throw new ValidationError('Usage: `/character delete <CHR-ID or exact Name>`');
      const { removed } = await ctx.services.roleplay.deleteCharacter({
        userId: ctx.event.author_id,
        characterIdOrName: target,
      });
      await ctx.reply({
        content: `🗑️ Deleted character **${removed.name}** (\`${removed.characterId}\`).`,
      });
      return;
    }

    throw new ValidationError(
      'Subcommands: `/character create`, `/character list`, `/character switch`, `/character delete`.',
    );
  },
};
