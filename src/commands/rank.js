import { xpRequiredForLevel } from '../systems/levelingService.js';
import { parseCommandArgs } from '../utils/argParser.js';
import { buildRankCardEmbed } from '../utils/embeds.js';
import { ValidationError } from '../utils/errors.js';
import { extractYapinUserId } from '../utils/ids.js';

export const rankCommand = {
  name: 'rank',
  description: 'Inspect your MurderMystery2 Rank, Level, and XP progress bar.',
  usage: '/rank [@user]',
  category: 'leveling',
  staffOnly: false,

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const rawTarget = kv.user || positional[0];
    const targetId = rawTarget ? extractYapinUserId(rawTarget) : ctx.event.author_id;
    if (!targetId) {
      throw new ValidationError('Invalid user mention or UUID.');
    }

    const userDoc = await ctx.repositories.users.getOrCreate(targetId);
    const rankPosition = await ctx.repositories.users.getRankPosition(targetId);
    const neededXp = xpRequiredForLevel(userDoc.leveling?.level || 1);

    await ctx.reply({
      embeds: [buildRankCardEmbed(userDoc, rankPosition, neededXp)],
    });
  },
};
