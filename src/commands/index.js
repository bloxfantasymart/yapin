import { YAPIN_LIMITS } from '../config/settings.js';
import { applicationsCommand } from './admin/applications.js';
import { appreviewCommand } from './admin/appreview.js';
import { configCommand } from './admin/config.js';
import { panelCommand } from './admin/panel.js';
import { xpCommand } from './admin/xp.js';
import { applyCommand } from './apply.js';
import { characterCommand } from './character.js';
import { dailyCommand } from './daily.js';
import { helpCommand } from './help.js';
import { leaderboardCommand } from './leaderboard.js';
import { mysteryCommand } from './mystery.js';
import { pingCommand } from './ping.js';
import { profileCommand } from './profile.js';
import { rankCommand } from './rank.js';
import { reportCommand } from './report.js';
import { rolesCommand } from './roles.js';
import { rpCommand } from './rp.js';
import { rulesCommand } from './rules.js';
import { serverInfoCommand } from './serverinfo.js';
import { banCommand } from './staff/ban.js';
import { caseCommand } from './staff/case.js';
import { clearwarnCommand } from './staff/clearwarn.js';
import { kickCommand } from './staff/kick.js';
import { lockCommand } from './staff/lock.js';
import { modlogsCommand } from './staff/modlogs.js';
import { muteCommand } from './staff/mute.js';
import { purgeCommand } from './staff/purge.js';
import { slowmodeCommand } from './staff/slowmode.js';
import { unbanCommand } from './staff/unban.js';
import { unlockCommand } from './staff/unlock.js';
import { unmuteCommand } from './staff/unmute.js';
import { verifyuserCommand } from './staff/verifyuser.js';
import { warnCommand } from './staff/warn.js';
import { warningsCommand } from './staff/warnings.js';
import { ticketCommand } from './ticket.js';
import { verifyCommand } from './verify.js';

export const ALL_COMMANDS = [
  verifyCommand,
  rulesCommand,
  helpCommand,
  pingCommand,
  serverInfoCommand,
  profileCommand,
  rankCommand,
  leaderboardCommand,
  dailyCommand,
  applyCommand,
  ticketCommand,
  reportCommand,
  characterCommand,
  rpCommand,
  mysteryCommand,
  rolesCommand,
  warnCommand,
  warningsCommand,
  clearwarnCommand,
  muteCommand,
  unmuteCommand,
  kickCommand,
  banCommand,
  unbanCommand,
  caseCommand,
  modlogsCommand,
  purgeCommand,
  slowmodeCommand,
  lockCommand,
  unlockCommand,
  verifyuserCommand,
  applicationsCommand,
  appreviewCommand,
  xpCommand,
  panelCommand,
  configCommand,
];

export class CommandRegistry {
  constructor() {
    /** @type {Map<string, object>} */
    this.commands = new Map();
  }

  register(cmd) {
    const name = String(cmd.name).toLowerCase();
    this.commands.set(name, cmd);
    return this;
  }

  get(name) {
    return this.commands.get(String(name || '').toLowerCase()) || null;
  }

  list() {
    return [...this.commands.values()];
  }

  toYapinDefinitions() {
    return this.list().map((c) => ({
      name: String(c.name).toLowerCase(),
      description: String(c.description || '').slice(0, YAPIN_LIMITS.COMMAND_DESCRIPTION_MAX),
    }));
  }
}

export function registerAllCommands(registry) {
  for (const cmd of ALL_COMMANDS) {
    registry.register(cmd);
  }
  return registry;
}

export function createCommandRegistry() {
  const registry = new CommandRegistry();
  return registerAllCommands(registry);
}
