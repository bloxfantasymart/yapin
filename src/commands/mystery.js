import { parseCommandArgs } from '../utils/argParser.js';
import { buildMysteryRoundEmbed, buildMysteryRoundRows } from '../utils/embeds.js';
import { ValidationError } from '../utils/errors.js';
import { userMention } from '../utils/ids.js';

export const mysteryCommand = {
  name: 'mystery',
  description: 'Host a MurderMystery2 mystery round with private Murderer, Sheriff, and Innocent assignments.',
  usage: '$mystery <start|join|draw|end> [Map or RND-ID]',
  category: 'community',
  staffOnly: false,

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const sub = (positional[0] || 'start').toLowerCase();

    if (sub === 'start') {
      const mapName = kv.map || positional.slice(1).join(' ') || 'Mansion';
      const round = ctx.services.roleplay.startMysteryRound({
        serverId: ctx.event.server_id,
        channelId: ctx.event.channel_id,
        hostId: ctx.event.author_id,
        mapName,
      });

      await ctx.reply({
        content: `🔪 **MurderMystery2 Round \`${round.roundId}\` Lobby Open!** Click **Join Round** below (minimum 3 suspects)!`,
        embeds: [buildMysteryRoundEmbed(round)],
        components: buildMysteryRoundRows(round),
      });
      return;
    }

    if (sub === 'join') {
      const roundId = (kv.id || positional[1] || '').toUpperCase();
      if (!roundId) throw new ValidationError('Usage: `$mystery join <RND-ID>` (or click the Join button!).');
      const round = ctx.services.roleplay.joinMysteryRound({
        roundId,
        userId: ctx.event.author_id,
      });
      await ctx.reply({
        embeds: [buildMysteryRoundEmbed(round)],
        components: buildMysteryRoundRows(round),
      });
      return;
    }

    if (sub === 'draw') {
      const roundId = (kv.id || positional[1] || '').toUpperCase();
      if (!roundId) throw new ValidationError('Usage: `$mystery draw <RND-ID>`');
      const round = await ctx.services.roleplay.drawMysteryRoles({
        serverId: ctx.event.server_id,
        roundId,
        actorId: ctx.event.author_id,
      });
      await ctx.reply({
        content: '🕵️ **Secret Roles Assigned!** Every suspect: click **Reveal Secret Role** to view your role privately!',
        embeds: [buildMysteryRoundEmbed(round)],
        components: buildMysteryRoundRows(round),
      });
      return;
    }

    if (sub === 'end') {
      const roundId = (kv.id || positional[1] || '').toUpperCase();
      if (!roundId) throw new ValidationError('Usage: `$mystery end <RND-ID>`');
      const ended = await ctx.services.roleplay.endMysteryRound({
        serverId: ctx.event.server_id,
        roundId,
        actorId: ctx.event.author_id,
      });

      const murdererId = Object.keys(ended.assignments).find(
        (uid) => ended.assignments[uid] === 'MURDERER',
      );
      const sheriffId = Object.keys(ended.assignments).find(
        (uid) => ended.assignments[uid] === 'SHERIFF',
      );

      await ctx.reply({
        content:
          `🏁 **Round \`${ended.roundId}\` Concluded!**\n` +
          (murdererId
            ? `• 🔪 **The Murderer was:** ${userMention(murdererId)}\n• 🔫 **The Sheriff was:** ${userMention(sheriffId)}`
            : '• Ended before roles were drawn.'),
      });
      return;
    }

    throw new ValidationError('Subcommands: `$mystery start [Map]`, `$mystery join <RND-ID>`, `$mystery draw <RND-ID>`, `$mystery end <RND-ID>`.');
  },
};
