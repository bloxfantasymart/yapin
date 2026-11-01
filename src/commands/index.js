import { pingCommand } from './ping.js';
import { helpCommand } from './help.js';
import { rulesCommand } from './rules.js';
import { middlemanCommand } from './middleman.js';
import { tradeCommand } from './trade.js';
import { statusCommand } from './status.js';
import { acceptCommand } from './accept.js';
import { rejectCommand } from './reject.js';
import { cancelCommand } from './cancel.js';
import { depositCommand } from './deposit.js';
import { confirmCommand } from './confirm.js';
import { releaseCommand } from './release.js';
import { disputeCommand } from './dispute.js';
import { reportCommand } from './report.js';
import { profileCommand } from './profile.js';
import { statsCommand } from './stats.js';
import { ticketCommand } from './ticket.js';
import { claimCommand } from './claim.js';

import { assignCommand } from './admin/assign.js';
import { unassignCommand } from './admin/unassign.js';
import { reassignCommand } from './admin/reassign.js';
import { reviewCommand } from './admin/review.js';
import { verifydepositCommand } from './admin/verifydeposit.js';
import { resolveCommand } from './admin/resolve.js';
import { completeCommand } from './admin/complete.js';
import { canceltradeCommand } from './admin/canceltrade.js';
import { warnuserCommand } from './admin/warnuser.js';
import { suspenduserCommand } from './admin/suspenduser.js';
import { unsuspenduserCommand } from './admin/unsuspenduser.js';
import { staffstatsCommand } from './admin/staffstats.js';
import { tradehistoryCommand } from './admin/tradehistory.js';
import { availabilityCommand } from './admin/availability.js';
import { configCommand } from './admin/config.js';

export const ALL_COMMAND_MODULES = Object.freeze([
  // User & General Commands
  pingCommand,
  helpCommand,
  rulesCommand,
  middlemanCommand,
  tradeCommand,
  statusCommand,
  acceptCommand,
  rejectCommand,
  cancelCommand,
  depositCommand,
  confirmCommand,
  releaseCommand,
  disputeCommand,
  reportCommand,
  profileCommand,
  statsCommand,
  ticketCommand,

  // Staff & Admin Commands
  claimCommand,
  assignCommand,
  unassignCommand,
  reassignCommand,
  reviewCommand,
  verifydepositCommand,
  resolveCommand,
  completeCommand,
  canceltradeCommand,
  warnuserCommand,
  suspenduserCommand,
  unsuspenduserCommand,
  staffstatsCommand,
  tradehistoryCommand,
  availabilityCommand,
  configCommand,
]);

export function createCommandRegistry(modules = ALL_COMMAND_MODULES) {
  const map = new Map();
  for (const mod of modules) {
    if (map.has(mod.name)) {
      throw new Error(`Duplicate command definition detected: /${mod.name}`);
    }
    map.set(mod.name, mod);
  }

  return {
    get(name) {
      return map.get(String(name || '').toLowerCase()) || null;
    },
    getAll() {
      return Array.from(map.values());
    },
    toYapinDefinitions() {
      return Array.from(map.values()).map((c) => ({
        name: c.name,
        description: c.description,
      }));
    },
  };
}
