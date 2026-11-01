# Verified Yapin.gg API Reference & Feature Matrix

## 1. Official Yapin.gg Documentation Sources Verified

All API calls, headers, limits, event opcodes, and component structures in `src/api/*` were verified directly against Yapin's official developer documentation and official JavaScript SDK:

- **Official Developer Portal**: `https://www.yapin.gg/developers` (mirrored on official Yapin domain `https://www.yapper.website/developers`)
- **Official Yapin JavaScript SDK Reference (`yapin.js`)**: `https://www.yapper.website/sdk/yapper.js`
- **Official Terms & Domain Verification**: `https://www.yapper.website/terms` (confirms `yapin.gg` and `yapper.website` are Yapin's official domains)

---

## 2. Verified API Endpoint Reference Table

| Capability | Method & Verified Endpoint / URL | Auth / Headers | Verified Limits & Notes | Adapter Module |
| :--- | :--- | :--- | :--- | :--- |
| **Bot Identity / Ping** | `GET /api/bot/v1/me` | `Authorization: Bot yb_...` | Returns `{ id, username, display_name, bot }`. Used for startup check & `/ping`. | `src/api/YapinClient.js` |
| **Bot Presence** | `PUT /api/bot/v1/me/status` | `Authorization: Bot yb_...` | `{ status: "online"\|"idle"\|"dnd", activity }` (`activity` <= 60 chars). | `src/api/YapinClient.js` |
| **Realtime Gateway** | `wss://rt.yapper.website/bot` | Identify payload `{ op: "identify", token }` | `hello` (30s heartbeat), `resume` (`seq`), max 2 sockets/bot, 10 connects/min, 24h replay buffer. | `src/api/YapinClient.js` |
| **Long-Poll Events** | `GET /api/bot/v1/events?after=<id>&wait=20` | `Authorization: Bot yb_...` | `wait` 0–25s; shares monotonic event sequence `id` with Gateway `seq`. | `src/api/YapinClient.js` |
| **Event Webhooks** | Inbound HTTPS `POST` (configurable path) | `X-Yapper-Bot`, `X-Yapper-Signature: sha256=<hmac>` | Constant-time HMAC-SHA256 verification over raw request bytes. | `src/api/authentication.js`, `YapinClient.js` |
| **List / Sync Commands** | `GET /api/bot/v1/commands`<br>`PUT /api/bot/v1/commands` | `Authorization: Bot yb_...` | Max 100 commands/bot; `{ name, description }` only (`^[a-z0-9_-]{1,32}$`, desc <= 100 chars). | `src/api/commands.js` |
| **Send / Edit / Delete Message** | `POST /api/bot/v1/channels/:id/messages`<br>`PATCH .../messages/:mid`<br>`DELETE .../messages/:mid` | `Authorization: Bot yb_...` | Content <= 2,000 chars; <= 5 embeds (<= 6,000 total chars); <= 5x5 buttons; 30 msgs/min/server; first 5 `reply_to` answers exempt from global limit. | `src/api/messages.js` |
| **Channel Message History** | `GET /api/bot/v1/channels/:id/messages?limit=100&before=<iso>` | `Authorization: Bot yb_...` | Cursor pagination via `before` timestamp; used for sanitized ticket transcripts. | `src/api/messages.js`, `transcriptService.js` |
| **Button Callback** | `POST /api/bot/v1/interactions/:id/:token/callback` | Interaction `:token` path secret | Must answer within 3s (valid 15m, max 10 callbacks). Types: `reply`, `ephemeral` (text/embeds only, no buttons), `update`, `ack`. | `src/api/messages.js` |
| **Open User DM** | `POST /api/bot/v1/users/:id/dm` | `Authorization: Bot yb_...` | Returns `{ channel_id }`. Outbound notifications only — user DM replies are NOT sent to bots. | `src/api/messages.js` |
| **Server & Member RBAC** | `GET /api/bot/v1/servers/:id`<br>`GET .../servers/:id/roles`<br>`GET .../servers/:id/members/:uid` | `Authorization: Bot yb_...` | Resolves `owner_id`, role flags (`manage_server`, `manage_messages`, `perms.*`), and member role UUIDs. | `src/api/permissions.js` |
| **Channels & Privacy Lock** | `POST /api/bot/v1/servers/:id/channels`<br>`PATCH /api/bot/v1/channels/:id`<br>`DELETE /api/bot/v1/channels/:id` | `Authorization: Bot yb_...` | Channel create limit 10/min/server. `PATCH` supports `{ private: true, role_ids, read_only, post_role_ids, slowmode }`. | `src/api/channels.js` |
| **Scoped Role Management** | `POST /api/bot/v1/servers/:id/roles`<br>`PUT/DELETE .../members/:uid/roles/:rid` | `Authorization: Bot yb_...` | Role creation is documented as beta; adapter supports optional scoped roles with fail-closed fallback to staff role privacy. | `src/api/channels.js` |
| **OAuth2 ("Login with Yapin'")** | `GET https://www.yapin.gg/oauth/authorize`<br>`POST https://www.yapin.gg/api/oauth/token`<br>`GET https://www.yapin.gg/api/oauth/me` | `Bearer yo_...` + PKCE `S256` | Scope `identify`; code valid 60s; token `yo_...` valid 30d (no refresh token). | `src/api/authentication.js`, `src/dashboard/` |

---

## 3. Verified Platform Limitations & Safe Design Adaptations

1. **No Discord-style Slash Option Schemas, Modals, or Select Menus**:
   - *Yapin Reality*: `PUT /commands` accepts `{ name, description }` only, and Yapin supports Buttons + Embeds + Components V2 (`flags: 32768`) — **not** modal popups or dropdown select menus.
   - *Safe Adaptation*: `src/utils/argParser.js` + Zod validate structured `key="value"` arguments with clear usage guidance, paired with interactive 5-button action rows (`Accept`, `Reject`, `Cancel`, `Claim`, `Confirm Middleman`, `Confirm Final Release`) and ephemeral guidance callbacks.
2. **Role-Scoped Channel Privacy (No Per-User Channel Overwrites)**:
   - *Yapin Reality*: `PATCH /channels/:id` restricts `private: true` channels by `role_ids`, not individual user IDs, and `POST /servers/:id/roles` is in beta.
   - *Safe Adaptation*: `YapinChannelsApi.createPrivateChannel` locks ticket channels to verified Bot + Staff Role IDs (with optional scoped role assignment where supported), enforces `STAFF_REPORT` Admin-only role isolation, and **immediately deletes the channel + alerts staff** if `PATCH { private: true }` fails.
3. **One-Way Bot DMs**:
   - *Yapin Reality*: `POST /users/:id/dm` sends messages, but user replies in DMs are not delivered to bots as events.
   - *Safe Adaptation*: All trade invitations, confirmations, deposits, disputes, and tickets operate inside server channels and button interactions — never stranding users in DMs.

---

## 4. Feature Matrix

| Feature / Requirement | Status | Automated Test Coverage | Notes |
| :--- | :--- | :--- | :--- |
| Yapin REST v1 Client, Timeouts, `Retry-After` Backoff & Safe Retries | **Implemented & Tested** | `tests/unit/api-auth-client.test.js` | Never blind-retries non-idempotent `POST`/`PATCH` on network timeout. |
| WebSocket Gateway + Resume + HTTPS Long-Poll Fallback + HMAC Webhooks | **Implemented & Tested** | `gateway-and-webhooks.test.js`, `api-auth-client.test.js` | Cursor persisted in `operational.json` (`EventCursor`) for crash recovery; automatic 4003 fallback to long-polling; live HTTP HMAC webhook deduplication. |
| 13-State Strict Trade State Machine (`CREATED` .. `COMPLETED`, `DISPUTED`, etc.) | **Implemented & Tested** | `tests/unit/state-machine.test.js` | Every transition validated, timestamped, versioned, and audited. |
| Trade Creation, Self-Trade Block, Duplicate Fingerprint & Rules Agreement | **Implemented & Tested** | `tests/unit/trade-workflow.test.js` | Blocks self-trades, spoofed banners, suspended users, and duplicates. |
| Independent Dual Participant Confirmations (Invite, Middleman, Final Release) | **Implemented & Tested** | `trade-workflow.test.js`, `commands-and-interactions.test.js` | Neither trader can confirm on behalf of the other. |
| Middleman Availability, Claim, Assign, Unassign, Reassign & Auto-Assign | **Implemented & Tested** | `trade-workflow.test.js`, `all-commands.test.js` | Blocks conflict-of-interest self-dealing and tracks assignment history. |
| Non-Custodial Deposit Reporting (`REPORTED_SENT`) & Staff Verification | **Implemented & Tested** | `trade-workflow.test.js`, `all-commands.test.js` | Reporting never marks `CONFIRMED`; counterparty evidence URLs redacted for non-staff. |
| Atomic CAS Final Trade Completion (8 Preconditions + Concurrency Lock) | **Implemented & Tested** | `trade-workflow.test.js` | Simultaneous `/complete` calls guaranteed to succeed at most once. |
| Private Tickets (`GENERAL_SUPPORT`, `TRADE_ASSISTANCE`, `DISPUTE`, `SCAM_REPORT`, `STAFF_REPORT`, `APPEAL`) + SHA-256 Transcripts | **Implemented & Tested** | `tickets-disputes.test.js`, `all-commands.test.js` | Fail-closed rollback + staff alert if private lock fails; `STAFF_REPORT` Admin-only. |
| Dispute Freezing (`DISPUTED`) & Documented Staff Resolution (`RESUME` / `CANCEL`) | **Implemented & Tested** | `tickets-disputes.test.js`, `all-commands.test.js` | Freezes trade completion immediately until moderator resolution with `confirm=yes`. |
| Scam Prevention, Cooldowns, Sanitization, Secret Redaction & Moderation | **Implemented & Tested** | `security-and-edge-cases.test.js`, `all-commands.test.js` | `/report` queues `PENDING_REVIEW` and never auto-labels users as scammers. |
| Append-Only `AuditLog` + Crash-Safe Atomic JSON Storage + Stale-Trade Sweep | **Implemented & Tested** | `models-audit-recovery.test.js`, `security-and-edge-cases.test.js` | `Object.freeze` + repository guards block updates/deletes on `audit_logs.json`; atomic `.tmp`+`fsync`+`rename`+`.bak` & ACID rollback. |
| All User & Staff Slash Commands (33 Commands) + Button Action Rows | **Implemented & Tested** | `all-commands.test.js`, `commands-and-interactions.test.js`, `commands-ping-registration.test.js` | All 33 commands executed end-to-end with server-side RBAC on every command and button click. |
| Optional OAuth2 ("Login with Yapin'") Staff Web Dashboard | **Implemented & Tested** | `tests/unit/dashboard.test.js` | PKCE `S256`, server-side RBAC, SHA-256 hashed sessions, Same-Origin + CSRF guards, Zod validation, full trade/dispute/ticket/audit/config UI. |
| Production Deployment Artifacts (Docker, systemd, PM2, Cross-Platform ZIP) | **Implemented & Verified** | `Dockerfile`, `deploy/*`, `scripts/package-zip.js` | Non-root Node 22 container, hardened `systemd` unit, PM2 fork config, and verified PKZIP archive. |
| Discord-style Modal Popups / Dropdown Select Menus / Per-User Channel ACLs | **Unsupported by Platform** | Documented & Adapted | Replaced safely with structured `args` + Buttons + Ephemeral prompts + Role-locked channels. |
| Opt-In Live Yapin Server Integration Test Suite (`npm run test:live`) | **Implemented (Pending Live Credentials)** | `tests/integration/yapin.live.test.js` | Skips cleanly when `YAPIN_LIVE_TEST` is unset; ready to run against a real Yapin test server. |
