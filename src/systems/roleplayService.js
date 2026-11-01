import { MM2_ALIGNMENTS, MM2_MAPS } from '../config/settings.js';
import { sanitizeUserText } from '../security/sanitizer.js';
import { AuthorizationError, NotFoundError, ValidationError } from '../utils/errors.js';
import {
  generateCharacterId,
  generateRoundId,
  secureRandomInt,
} from '../utils/ids.js';

/**
 * MurderMystery2 Roleplay Suite:
 * - Character Registry (`create`, `switch`, `delete`, `list`)
 * - In-Character Scenes, Clues & Fair Dice Rolls (`1d20`, `2d6`, etc.)
 * - Live Secret MM2 Mystery Rounds (1 Murderer, 1 Sheriff, Innocents — private ephemeral reveal!)
 * - RP Self-Roles Toggle
 */
export class RoleplayService {
  constructor({
    userRepo,
    serverConfigRepo,
    permissionsApi,
    logService,
  }) {
    this.userRepo = userRepo;
    this.serverConfigRepo = serverConfigRepo;
    this.permissionsApi = permissionsApi;
    this.logService = logService;
    /** @type {Map<string, object>} */
    this.activeRounds = new Map();
  }

  resolveMap(mapInput = 'Mansion') {
    const query = String(mapInput || 'Mansion').trim().toLowerCase();
    return (
      MM2_MAPS.find(
        (m) => m.id.toLowerCase() === query || m.name.toLowerCase().includes(query),
      ) || MM2_MAPS[0]
    );
  }

  async createCharacter({
    serverId,
    userId,
    username = null,
    name,
    alignment = 'INNOCENT',
    weapon = 'Flashlight',
    codename = '',
    bio = '',
  }) {
    const cleanName = sanitizeUserText(name || '', { maxLength: 60, fieldName: 'Character name' });
    if (cleanName.length < 2) {
      throw new ValidationError('Character name must be at least 2 characters.');
    }

    const normAlign = String(alignment || 'INNOCENT').trim().toUpperCase();
    if (!MM2_ALIGNMENTS.includes(normAlign)) {
      throw new ValidationError(
        `Invalid alignment. Choose one of: ${MM2_ALIGNMENTS.join(', ')}`,
      );
    }

    const character = {
      characterId: generateCharacterId(),
      name: cleanName,
      codename: sanitizeUserText(codename || '', { maxLength: 40, fieldName: 'Codename' }),
      alignment: normAlign,
      weapon: sanitizeUserText(weapon || 'Flashlight', { maxLength: 60, fieldName: 'Weapon/Gear' }),
      bio: sanitizeUserText(bio || 'A mysterious resident of MurderMystery2.', {
        maxLength: 500,
        fieldName: 'Bio',
      }),
      createdAt: new Date(),
    };

    const updated = await this.userRepo.updateUser(
      userId,
      (draft) => {
        if (draft.characters.length >= 5) {
          throw new ValidationError(
            'You can store up to 5 RP characters. Delete an old character first with `/character delete`.',
          );
        }
        draft.characters.push(character);
        draft.activeCharacterId = character.characterId;
        if (!draft.leveling.badges.includes('🎭 Roleplayer')) {
          draft.leveling.badges.push('🎭 Roleplayer');
        }
      },
      username,
    );

    await this.logService.record({
      serverId,
      actorId: userId,
      actorType: 'USER',
      action: 'RP_CHARACTER_CREATED',
      targetType: 'ROLEPLAY',
      targetId: character.characterId,
      afterState: { name: character.name, alignment: character.alignment },
      stream: 'rp',
    });

    return { character, user: updated };
  }

  async switchCharacter({ userId, characterIdOrName }) {
    const query = String(characterIdOrName || '').trim().toLowerCase();
    let chosen = null;

    const updated = await this.userRepo.updateUser(userId, (draft) => {
      const hit = draft.characters.find(
        (c) =>
          c.characterId.toLowerCase() === query || c.name.toLowerCase().includes(query),
      );
      if (!hit) {
        throw new NotFoundError(`No RP character matching \`${characterIdOrName}\` found on your profile.`);
      }
      draft.activeCharacterId = hit.characterId;
      chosen = hit;
    });

    return { character: chosen, user: updated };
  }

  async deleteCharacter({ userId, characterIdOrName }) {
    const query = String(characterIdOrName || '').trim().toLowerCase();
    let removed = null;

    const updated = await this.userRepo.updateUser(userId, (draft) => {
      const idx = draft.characters.findIndex(
        (c) =>
          c.characterId.toLowerCase() === query || c.name.toLowerCase() === query,
      );
      if (idx === -1) {
        throw new NotFoundError(`Character \`${characterIdOrName}\` not found.`);
      }
      [removed] = draft.characters.splice(idx, 1);
      if (draft.activeCharacterId === removed.characterId) {
        draft.activeCharacterId = draft.characters[0]?.characterId || null;
      }
    });

    return { removed, user: updated };
  }

  rollDice(diceExpr = '1d20') {
    const m = /^(\d{1,2})d(\d{2,3}|[2-9])$/i.exec(String(diceExpr || '1d20').trim());
    const count = m ? Math.min(10, Math.max(1, Number(m[1]))) : 1;
    const sides = m ? Math.min(100, Math.max(2, Number(m[2]))) : 20;
    const rolls = [];
    for (let i = 0; i < count; i++) {
      rolls.push(secureRandomInt(1, sides));
    }
    const total = rolls.reduce((acc, n) => acc + n, 0);
    return { notation: `${count}d${sides}`, rolls, total };
  }

  // =========================================================================
  // Live Secret MM2 Mystery Rounds (1 Murderer, 1 Sheriff, Innocents)
  // =========================================================================

  startMysteryRound({ serverId, channelId, hostId, mapName = 'Mansion' }) {
    const map = this.resolveMap(mapName);
    const round = {
      roundId: generateRoundId(),
      serverId,
      channelId,
      hostId,
      map,
      status: 'LOBBY',
      players: [hostId],
      assignments: {},
      createdAt: new Date(),
    };
    this.activeRounds.set(round.roundId, round);
    return round;
  }

  joinMysteryRound({ roundId, userId }) {
    const round = this.activeRounds.get(String(roundId || '').toUpperCase());
    if (!round || round.status !== 'LOBBY') {
      throw new ValidationError('This MurderMystery2 round is no longer accepting players.');
    }
    if (!round.players.includes(userId)) {
      if (round.players.length >= 24) {
        throw new ValidationError('Round lobby is full (24 players max).');
      }
      round.players.push(userId);
    }
    return round;
  }

  leaveMysteryRound({ roundId, userId }) {
    const round = this.activeRounds.get(String(roundId || '').toUpperCase());
    if (!round || round.status !== 'LOBBY') {
      throw new ValidationError('Cannot leave after secret roles have been drawn.');
    }
    round.players = round.players.filter((id) => id !== userId);
    return round;
  }

  async drawMysteryRoles({ serverId, roundId, actorId }) {
    const round = this.activeRounds.get(String(roundId || '').toUpperCase());
    if (!round) throw new NotFoundError(`Mystery round \`${roundId}\` was not found.`);

    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    const access = await this.permissionsApi.resolveMemberAccess(serverId, actorId, cfg);
    if (round.hostId !== actorId && !access.roles.isStaff) {
      throw new AuthorizationError('Only the round host or MurderMystery2 Staff can draw roles.');
    }
    if (round.status !== 'LOBBY') {
      throw new ValidationError('Secret roles have already been drawn for this round.');
    }
    if (round.players.length < 3) {
      throw new ValidationError(
        `Need at least **3 players** to draw Murderer, Sheriff, and Innocent roles (currently ${round.players.length}).`,
      );
    }

    // Cryptographically fair Fisher-Yates shuffle
    const shuffled = [...round.players];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = secureRandomInt(0, i);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    round.assignments = {};
    round.assignments[shuffled[0]] = 'MURDERER';
    round.assignments[shuffled[1]] = 'SHERIFF';
    for (let i = 2; i < shuffled.length; i++) {
      round.assignments[shuffled[i]] = 'INNOCENT';
    }
    round.status = 'ACTIVE';

    return round;
  }

  getPlayerSecretRole({ roundId, userId }) {
    const round = this.activeRounds.get(String(roundId || '').toUpperCase());
    if (!round) throw new NotFoundError('This Mystery Round has ended or expired.');
    if (round.status !== 'ACTIVE') {
      throw new ValidationError('Secret roles have not been drawn yet!');
    }
    const role = round.assignments[userId];
    if (!role) {
      throw new AuthorizationError('You are a spectator in this round (not on the suspect roster).');
    }
    return { round, role };
  }

  async endMysteryRound({ serverId, roundId, actorId }) {
    const round = this.activeRounds.get(String(roundId || '').toUpperCase());
    if (!round) throw new NotFoundError(`Round \`${roundId}\` not found.`);

    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    const access = await this.permissionsApi.resolveMemberAccess(serverId, actorId, cfg);
    if (round.hostId !== actorId && !access.roles.isStaff) {
      throw new AuthorizationError('Only the round host or Staff can end this Mystery Round.');
    }

    round.status = 'ENDED';
    this.activeRounds.delete(round.roundId);
    return round;
  }

  /**
   * Toggles a configured MurderMystery2 RP Self-Role (`mm2:selfrole:<key>` or `/roles toggle`).
   */
  async toggleSelfRole({ serverId, userId, roleKey }) {
    const cfg = await this.serverConfigRepo.getOrCreate(serverId);
    const key = String(roleKey || '').trim().toLowerCase();
    const roleId = cfg.roles.selfRoles?.[key];
    if (!roleId) {
      throw new ValidationError(
        `Self-role \`${roleKey}\` is not configured. Available roles: ${Object.keys(cfg.roles.selfRoles || {}).join(', ') || 'none'}.`,
      );
    }

    const member = await this.permissionsApi.fetchServerMember(serverId, userId, {
      forceRefresh: true,
    });
    if (!member) {
      throw new ValidationError('Could not verify your MurderMystery2 server membership.');
    }
    const currentRoleIds = (member.roles || []).map((r) =>
      typeof r === 'object' ? String(r.id) : String(r),
    );
    const hasRole = currentRoleIds.includes(String(roleId));

    if (hasRole) {
      await this.permissionsApi.removeMemberRole(serverId, userId, roleId);
      return { action: 'removed', roleKey: key, roleId };
    }
    await this.permissionsApi.addMemberRole(serverId, userId, roleId);
    return { action: 'added', roleKey: key, roleId };
  }
}
