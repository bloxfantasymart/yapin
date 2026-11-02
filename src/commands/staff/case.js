import { parseCommandArgs } from '../../utils/argParser.js';
import { buildModCaseEmbed } from '../../utils/embeds.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

export const caseCommand = {
  name: 'case',
  description: 'Inspect a specific MurderMystery2 Sheriff Case File by ID.',
  usage: '$case <CASE-ID>',
  category: 'moderation',
  staffOnly: true,
  requiredRole: 'staff',

  async execute(ctx) {
    const { positional, kv } = parseCommandArgs(ctx.event.args || '');
    const caseId = (kv.id || positional[0] || '').toUpperCase();
    if (!caseId) throw new ValidationError('Usage: `$case <CASE-ID>`');

    const found = await ctx.repositories.cases.findByCaseId(caseId);
    if (!found || found.serverId !== ctx.event.server_id) {
      throw new NotFoundError(`Case \`${caseId}\` was not found in this server.`);
    }

    await ctx.reply({ embeds: [buildModCaseEmbed(found)] });
  },
};
