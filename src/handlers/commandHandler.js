import { BOT_BRAND, BOT_PREFIX, DEFAULT_COOLDOWNS } from '../config/settings.js';
import { parsePrefixedCommand } from '../utils/commandPrefix.js';
import { generateCorrelationId } from '../utils/ids.js';
import { withCorrelationLogger } from '../utils/logger.js';
import { handleCommandError } from './errorHandler.js';

export class CommandHandler {
  constructor({
    client,
    commandRegistry,
    messagesApi,
    channelsApi,
    permissionsApi,
    repositories,
    services,
    cooldowns,
    logger,
  }) {
    this.client = client;
    this.commandRegistry = commandRegistry;
    this.messagesApi = messagesApi;
    this.channelsApi = channelsApi;
    this.permissionsApi = permissionsApi;
    this.repositories = repositories;
    this.services = services;
    this.cooldowns = cooldowns;
    this.logger = logger;
  }

  async handleMessage(event) {
    if (!event || event.author_bot) return false;

    const isPlatformCommand = Boolean(event.command);
    const prefixed = isPlatformCommand ? null : parsePrefixedCommand(event.content || '');
    if (!isPlatformCommand && prefixed === null) return false;

    const botId = this.client?.me?.id || this.client?.botUser?.id;
    if (
      Array.isArray(event.command_for) &&
      event.command_for.length > 0 &&
      (!botId || !event.command_for.includes(botId))
    ) {
      return false;
    }

    const commandName = String(isPlatformCommand ? event.command : prefixed.command).toLowerCase();
    const commandArgs = isPlatformCommand ? (event.args || '') : prefixed.args;
    event = { ...event, command: commandName, args: commandArgs };

    const command = this.commandRegistry.get(commandName);
    if (!command) {
      if (!isPlatformCommand) {
        await this.messagesApi
          .sendMessage(event.channel_id, {
            content: commandName
              ? `Unknown command: **${BOT_PREFIX}${commandName}**. Use **${BOT_PREFIX}help** to see available commands.`
              : `Commands start with **${BOT_PREFIX}**. Try **${BOT_PREFIX}help**.`,
            replyTo: event.id,
          })
          .catch(() => undefined);
        return true;
      }
      return false;
    }

    const correlationId = generateCorrelationId();
    const log = withCorrelationLogger(correlationId, {
      command: commandName,
      serverId: event.server_id,
      userId: event.author_id,
    });

    try {
      if (!event.server_id) {
        await this.messagesApi.sendMessage(event.channel_id, {
          content: `❌ **${BOT_BRAND.botName}** commands can only be executed inside **${BOT_BRAND.serverName}** channels.`,
          replyTo: event.id,
        });
        return true;
      }

      const serverCfg = await this.repositories.serverConfigs.getOrCreate(event.server_id);

      // 1. Cooldown & anti-spam enforcement
      if (this.cooldowns) {
        const cooldownMap = {
          verify: serverCfg.cooldowns?.verifyAttemptMs ?? DEFAULT_COOLDOWNS.verifyAttemptMs,
          ticket: serverCfg.cooldowns?.ticketCreateMs ?? DEFAULT_COOLDOWNS.ticketCreateMs,
          apply: serverCfg.cooldowns?.applicationSubmitMs ?? DEFAULT_COOLDOWNS.applicationSubmitMs,
          report: serverCfg.cooldowns?.reportCreateMs ?? DEFAULT_COOLDOWNS.reportCreateMs,
        };
        const cooldownMs =
          cooldownMap[commandName] ??
          serverCfg.cooldowns?.defaultCommandMs ??
          DEFAULT_COOLDOWNS.defaultCommandMs;

        this.cooldowns.enforce({
          userId: event.author_id,
          actionKey: `cmd:${commandName}`,
          cooldownMs,
        });
      }

      // 2. Server-side RBAC check BEFORE executing any staffOnly command
      if (command.staffOnly) {
        await this.permissionsApi.assertAuthorized({
          serverId: event.server_id,
          userId: event.author_id,
          serverConfig: serverCfg,
          requiredRole: command.requiredRole || 'staff',
          forceRefresh: true,
        });
      }

      // 3. Upsert stable UUID profile (username cached for UI only, never trusted for auth)
      await this.repositories.users.getOrCreate(event.author_id, event.username || null);

      const startedAt = Date.now();
      await command.execute({
        event,
        correlationId,
        logger: log,
        client: this.client,
        commandRegistry: this.commandRegistry,
        messagesApi: this.messagesApi,
        channelsApi: this.channelsApi,
        permissionsApi: this.permissionsApi,
        repositories: this.repositories,
        services: this.services,
        reply: (opts) =>
          this.messagesApi.sendMessage(event.channel_id, {
            ...opts,
            replyTo: opts?.replyTo ?? event.id,
          }),
      });

      log.info({ durationMs: Date.now() - startedAt }, 'MM2 Helper command executed successfully');
      return true;
    } catch (error) {
      await handleCommandError({
        error,
        event,
        correlationId,
        messagesApi: this.messagesApi,
        auditService: this.services?.audit,
        logger: log,
      });
      return true;
    }
  }
}
