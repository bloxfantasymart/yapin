import { parseCommandArgs, parseYesBoolean } from '../utils/argParser.js';
import { extractYapinUserId } from '../utils/ids.js';
import { ValidationError } from '../utils/errors.js';
import { buildTradeActionRows, buildTradeEmbed } from '../utils/embeds.js';

export const middlemanCommand = {
  name: 'middleman',
  description: 'Create a verified middleman trade coordination request.',
  usage:
    '/middleman partner=<@user> item="Asset" giving="Your offer" receiving="Their offer" [cash=0 currency=USD payer=A|B] [preferred=<@staff>] [notes="..."] rules=yes',
  category: 'trades',
  staffOnly: false,

  async execute(ctx) {
    const { kv } = parseCommandArgs(ctx.event.args || '');

    if (!kv.partner || !kv.item || !kv.giving || !kv.receiving) {
      throw new ValidationError(
        'Missing required trade fields. Example:\n' +
          '`/middleman partner=@UuidOrMention item="Rare Username" giving="Rare Username" receiving="$150 USD" cash=150 currency=USD payer=B rules=yes`',
      );
    }

    const traderBId = extractYapinUserId(kv.partner);
    if (!traderBId) {
      throw new ValidationError('Invalid `partner` user ID or mention (`<@uuid>`).');
    }

    let preferredMiddlemanId = null;
    if (kv.preferred) {
      preferredMiddlemanId = extractYapinUserId(kv.preferred);
      if (!preferredMiddlemanId) {
        throw new ValidationError('Invalid `preferred` middleman user ID or mention.');
      }
    }

    const cashAmount = kv.cash ? Number(kv.cash) : 0;
    if (!Number.isFinite(cashAmount) || cashAmount < 0) {
      throw new ValidationError('`cash` must be a non-negative number.');
    }

    const payerMap = { A: 'TRADER_A', B: 'TRADER_B', TRADER_A: 'TRADER_A', TRADER_B: 'TRADER_B', NONE: 'NONE' };
    const payerKey = String(kv.payer || (cashAmount > 0 ? 'TRADER_B' : 'NONE')).toUpperCase();
    const payer = payerMap[payerKey] || 'NONE';

    const rulesAccepted = parseYesBoolean(kv.rules);
    if (!rulesAccepted) {
      throw new ValidationError(
        'You must read `/rules` and include `rules=yes` to confirm agreement before opening a trade.',
      );
    }

    const serverCfg = await ctx.repositories.serverConfigs.getOrCreate(ctx.event.server_id);
    const { trade } = await ctx.services.trade.createTrade({
      serverId: ctx.event.server_id,
      channelId: ctx.event.channel_id,
      createdBy: ctx.event.author_id,
      traderAId: ctx.event.author_id,
      traderBId,
      primaryAsset: kv.item,
      traderAGiving: kv.giving,
      traderBGiving: kv.receiving,
      cashAmount,
      cashCurrency: kv.currency || 'USD',
      cashPayer: payer,
      notes: kv.notes || '',
      preferredMiddlemanId,
      rulesAccepted,
      correlationId: ctx.correlationId,
    });

    const embed = buildTradeEmbed(trade, { disclaimerText: serverCfg.disclaimerText });
    const components = buildTradeActionRows(trade);

    await ctx.messagesApi.sendMessage(ctx.event.channel_id, {
      content: `🔔 Middleman trade **${trade.tradeId}** created! <@${trade.traderBId}>, please review the terms below and click **Accept & Confirm Terms** (or run \`/accept ${trade.tradeId}\`).`,
      embeds: [embed],
      components,
      replyTo: ctx.event.id,
    });
  },
};
