# Yapin.gg Middleman Bot

A complete, modular, security-first **Middleman Trade Coordination, Verification, Ticket & Dispute Bot** purpose-built for **[Yapin.gg](https://www.yapin.gg)** in modern JavaScript (**Node.js 22+ LTS**, ES Modules, **zero-dependency crash-safe JSON storage**, Zod, Pino, and Vitest).

> **Important Non-Custodial Coordination Model:**  
> This bot **never** claims to hold, custody, wallet-control, or automatically transfer assets, items, or funds. It operates transparently as an **audited coordination, participant-confirmation, deposit-verification, and dispute-freeze system** supervised by verified server middlemen.

---

## Key Capabilities

- **Verified Yapin.gg Native Adapter (`src/api/`)**: Built strictly against Yapin's official Bot REST API v1 (`https://www.yapin.gg/api/bot/v1`), Realtime WebSocket Gateway (`wss://rt.yapper.website/bot`) with automatic fallback to HTTPS Long-Polling (`GET /events`), HMAC-SHA256 Event Webhooks, Buttons/Embeds, and OAuth2 (`identify` + PKCE `S256`). Zero Discord.js assumptions.
- **Strict 13-State Trade Lifecycle (`src/middleman/`)**:
  ```text
  CREATED -> WAITING_FOR_PARTICIPANTS -> WAITING_FOR_MIDDLEMAN -> MIDDLEMAN_ASSIGNED
          -> WAITING_FOR_DEPOSITS -> DEPOSIT_CONFIRMATION -> WAITING_FOR_FINAL_CONFIRMATION -> COMPLETED
  (+ CANCELLED, REJECTED, EXPIRED, DISPUTED, UNDER_REVIEW)
  ```
  Every transition is precondition-checked, optimistic-concurrency guarded (`version` CAS + ACID multi-collection JSON transactions), timestamped, and written to an **append-only `AuditLog`** (`audit_logs.json`).
- **Independent Dual Confirmations & Conflict-of-Interest Protection**: Neither trader can accept or confirm for the other; middlemen are blocked from claiming or resolving trades in which they are a participant; self-reported deposits (`REPORTED_SENT`) never auto-confirm without independent staff `/verifydeposit`.
- **Fail-Closed Private Tickets & Dispute Freezing (`src/tickets/`)**: Supports `GENERAL_SUPPORT`, `TRADE_ASSISTANCE`, `DISPUTE`, `SCAM_REPORT`, `STAFF_REPORT` (Admin-only isolation), and `APPEAL` tickets with SHA-256 checksummed transcripts. If private channel locking (`PATCH /channels/:id { private: true }`) fails, the channel is immediately deleted (never left public) and staff are alerted.
- **33 User & Staff Slash Commands + Interactive Button Cards (`src/commands/`)**: Server-side role & permission verification (`GET /servers/:id`, `/roles`, `/members/:uid`) on every command and button click.
- **Optional OAuth2 Staff Web Dashboard (`src/dashboard/`)**: "Login with Yapin'" OAuth2 + PKCE (`S256`), server-side RBAC re-verification, SHA-256 hashed session storage, constant-time CSRF protection, rate limiting, active trade/deposit/dispute queues, searchable audit logs, and server configuration.

---

## Project Structure

```text
yapin/
├── src/
│   ├── index.js                        # Main startup & graceful shutdown entrypoint
│   ├── config/
│   │   ├── env.js                      # Zod startup environment validator
│   │   └── settings.js                 # Verified Yapin limits, permissions, rules & defaults
│   ├── api/                            # Isolated Yapin.gg Platform Adapter Layer
│   │   ├── YapinClient.js              # REST v1, Gateway WS, Long-Polling, Retry-After & Webhooks
│   │   ├── authentication.js           # Bot token auth, HMAC webhook verifier & OAuth2 PKCE client
│   │   ├── commands.js                 # GET/PUT /commands validator & sync
│   │   ├── messages.js                 # Messages, EmbedBuilder, ButtonBuilder, callbacks & pagination
│   │   ├── channels.js                 # Fail-closed private channels, read_only locks & categories
│   │   └── permissions.js              # Server-side UUID & RBAC resolver
│   ├── database/
│   │   ├── jsonStore.js                # Crash-safe atomic JSON engine (.tmp + fsync + rename + .bak + ACID rollback)
│   │   ├── connection.js               # JSON directory bootstrap, health check & transaction helper
│   │   ├── models/                     # Zod-validated User, Trade, Ticket, Dispute, AuditLog, ServerConfig, Report, Operational
│   │   └── repositories/               # Atomic CAS & transactional JSON repositories
│   ├── middleman/                      # Core Trade Lifecycle Domain Services
│   │   ├── tradeStateMachine.js        # Strict transition table & invariants
│   │   ├── tradeService.js             # Creation, viewer redaction, cancellation, CAS completion & expiry
│   │   ├── confirmationService.js      # Invite accept/reject, MM confirmation & final release
│   │   ├── assignmentService.js        # Availability, claim, assign/unassign/reassign & auto-assign
│   │   ├── depositService.js           # Non-custodial deposit reporting & staff verification
│   │   ├── disputeService.js           # Immediate trade freeze & documented moderator resolution
│   │   ├── auditService.js             # Append-only audit writer & optional audit-channel broadcaster
│   │   └── createServices.js           # Service container wiring
│   ├── tickets/
│   │   ├── ticketService.js            # Fail-closed private tickets, notes, claim/assign, close/reopen
│   │   └── transcriptService.js        # Sanitized SHA-256 transcript generator
│   ├── moderation/
│   │   └── moderationService.js        # Warnings, trade suspensions & non-auto-labeling /report queue
│   ├── security/
│   │   ├── sanitizer.js                # BiDi/mention stripping & HTTPS SSRF-safe evidence URL validator
│   │   ├── rateLimiter.js              # Per-user cooldowns & burst anti-spam guard
│   │   ├── idempotency.js              # Replay & duplicate action guard
│   │   └── antiScam.js                 # Trade fingerprinting, conflict-of-interest & staff alerts
│   ├── commands/                       # 18 general/trader commands + 15 staff/admin commands
│   │   └── admin/
│   ├── events/                         # ready, messageCreate, interactionCreate, memberUpdate
│   ├── handlers/                       # commandHandler, interactionHandler, eventHandler, errorHandler
│   ├── dashboard/                      # Optional OAuth2 + PKCE Staff Web Console
│   └── utils/                          # Redacting errors, Pino correlation logger, CSPRNG IDs, argParser, embeds
├── scripts/
│   ├── test-connection.js              # Verifies live Yapin Bot API connectivity
│   ├── register-commands.js            # Syncs all 33 commands via PUT /commands
│   ├── db-check.js                     # Initializes & validates local ./data/*.json collections
│   └── package-zip.js                  # Cross-platform pure-Node ZIP packager
├── docs/
│   ├── API_REFERENCE_AND_FEATURE_MATRIX.md
│   └── TROUBLESHOOTING.md
└── tests/
    ├── helpers/                        # Deterministic Yapin REST/OAuth2 mock + JSON CAS store
    ├── unit/                           # 11 unit test suites (37 tests)
    └── integration/yapin.live.test.js  # Opt-in live Yapin test server suite
```

---

## Step-by-Step Windows 11 Local Setup Guide (PowerShell)

### Step 1 — Install Prerequisites on Windows 11 (No External Database Needed!)
1. **Node.js LTS (v22.12.0 or newer)**: Download the Windows `.msi` installer from [https://nodejs.org](https://nodejs.org) (LTS) and install with default options.
2. **Git for Windows**: Download from [https://git-scm.com/download/win](https://git-scm.com/download/win).
3. **Zero Database Setup Required**: All trades, tickets, disputes, audit logs, and server settings are stored automatically in crash-safe local `.json` files inside `./data/`.
4. Open **Windows Terminal (PowerShell)** and verify your tools:
   ```powershell
   node -v
   npm -v
   ```
   *(If PowerShell says running scripts is disabled, run once: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`)*

### Step 2 — Create Your Bot & Copy IDs in Yapin.gg
1. Sign in to **[https://www.yapin.gg](https://www.yapin.gg)**.
2. Enable Developer Mode: go to **Settings -> Advanced -> Developer Mode** and toggle it **ON**.
3. Create your bot: go to **Settings -> Developer -> Create Bot**, give it a name (e.g., `MiddlemanBot`), and copy its **Bot Token** (starts with `yb_...`).
4. Invite the bot to your Yapin server and grant its bot role **Manage Channels** and **Manage Messages** (so it can lock private ticket channels and manage trade cards).
5. Right-click your Yapin server icon and click **Copy Server ID** (a UUID like `550e8400-e29b-41d4-a716-446655440000`).

### Step 3 — Configure `.env` & Install Dependencies
```powershell
cd path\to\yapin
Copy-Item .env.example .env
notepad .env
```
Fill in the **two** required values in `.env`:
```ini
YAPIN_BOT_TOKEN=yb_paste_your_real_bot_token_here
YAPIN_SERVER_ID=paste_your_server_uuid_here
DATA_DIR=./data
```
Save and close Notepad, then install dependencies:
```powershell
npm install
```

### Step 4 — Verify Tests, JSON Storage, API Connection & Commands
```powershell
# 1. Run the offline unit test suite (no external network or live bot required)
npm test

# 2. Initialize & validate local ./data/*.json collections
npm run db:check

# 3. Verify live Yapin API authentication and server visibility
npm run test:connection

# 4. Register all 33 slash commands with Yapin
npm run register:commands
```

### Step 5 — Start the Bot & Configure Server Staff Roles
```powershell
npm start
```
In your Yapin server (as the **Server Owner**), register your staff role IDs:
```text
/ping
/config set-role tier=middleman roles=<your_middleman_role_id>
/config set-role tier=moderator roles=<your_moderator_role_id>
/config set-role tier=admin roles=<your_admin_role_id>
/config set-channel key=alertChannelId value=<your_staff_alerts_channel_id>
/config set-channel key=auditLogChannelId value=<your_audit_log_channel_id>
```

---

## Command Reference

### User & Trader Commands
| Command | Purpose & Syntax |
| :--- | :--- |
| `/ping` | Check live Yapin REST latency, event transport, and cursor status. |
| `/help [cmd]` | List commands or view detailed syntax for a specific command. |
| `/rules` | View server middleman rules and non-custodial coordination notice. |
| `/middleman` | `/middleman partner=<@uuid> item="Asset" giving="Offer A" receiving="Offer B" [cash=100 currency=USD payer=B] [preferred=<@staff>] rules=yes` |
| `/trade [id]` | Render interactive trade card + action buttons, or list your recent trades. |
| `/status <id>` | View full lifecycle checklist, dual confirmations, and deposit statuses. |
| `/accept <id>` | Accept a pending trade invitation and confirm initial trade terms. |
| `/reject <id>` | Reject a pending trade invitation (`/reject <id> [reason="..."]`). |
| `/cancel <id>` | Cancel a pre-deposit trade (`/cancel <id> [reason="..."]`). |
| `/deposit <id>` | Report sending deposit: `/deposit <id> ref="Transfer ID" [proof=https://...] [notes="..."]` (marks `REPORTED_SENT` only). |
| `/confirm <id>` | Submit your required confirmation for the current trade stage. |
| `/release <id>` | Confirm final release once deposits are verified (`WAITING_FOR_FINAL_CONFIRMATION`). |
| `/dispute <id>` | Freeze trade immediately: `/dispute <id> reason="Detailed issue" [proof=https://...]`. |
| `/report` | Report suspicious behavior for staff review (never auto-labels as scammer): `/report user=<@uuid> category=IMPERSONATION reason="..."`. |
| `/ticket` | Open/manage private tickets (`open`, `view`, `claim`, `assign`, `note`, `close`, `reopen`). |
| `/profile [user]` | View verified trade completions and trade standing. |
| `/stats` | View server-wide completed/active trades and available middlemen count. |

### Staff & Admin Commands (Server-Side Role Checked)
| Command | Required Role | Purpose & Syntax |
| :--- | :--- | :--- |
| `/claim <id>` | `middleman` | Claim an unassigned `WAITING_FOR_MIDDLEMAN` trade. |
| `/availability` | `middleman` | `/availability status=on\|off [note="..."]` |
| `/review <id>` | `middleman` | Inspect full state history, deposit references, and evidence records. |
| `/verifydeposit` | `middleman` | `/verifydeposit <id> trader=A\|B status=CONFIRMED\|REJECTED\|UNDER_REVIEW\|NOT_REQUIRED notes="..."` |
| `/complete <id>` | `middleman` | Finalize trade (`confirm=yes` required): `/complete <id> notes="..." confirm=yes`. |
| `/unassign <id>` | `middleman` | Return a `MIDDLEMAN_ASSIGNED` trade to `WAITING_FOR_MIDDLEMAN` with reason. |
| `/staffstats` | `middleman` | View middleman workload and completion leaderboard. |
| `/tradehistory` | `middleman` | Search paginated server trade history by user, middleman, or state. |
| `/assign <id>` | `middleman` / `moderator` | `/assign <id> middleman=<@uuid> [reason="..."]` |
| `/reassign <id>` | `moderator` | `/reassign <id> middleman=<@uuid> reason="..."` |
| `/resolve` | `moderator` | Resolve dispute (`confirm=yes` required): `/resolve <DSP-...> outcome=RESUME_TRADE\|CANCEL_TRADE decision="..." confirm=yes`. |
| `/canceltrade` | `moderator` | Force-cancel trade (`confirm=yes` required): `/canceltrade <id> reason="..." confirm=yes`. |
| `/warnuser` | `moderator` | Issue audited warning: `/warnuser user=<@uuid> reason="..."`. |
| `/suspenduser` | `moderator` | Suspend user from trades (`confirm=yes` required): `/suspenduser user=<@uuid> reason="..." [hours=24] confirm=yes`. |
| `/unsuspenduser` | `moderator` | Lift trade suspension: `/unsuspenduser user=<@uuid> [reason="..."]`. |
| `/config` | `admin` / `owner` | Manage staff role IDs, alert/audit channels, and workload auto-assignment. |

---

## Optional OAuth2 Staff Web Dashboard

To enable the Staff Operations Console (`src/dashboard/`):
1. Register an OAuth2 Redirect URI on your bot in **Yapin Settings -> Developer -> OAuth2** (e.g. `https://mm-admin.yourdomain.com/auth/callback` or `http://localhost:3200/auth/callback` locally).
2. Generate a random 32+ character `DASHBOARD_SESSION_SECRET` (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
3. Set `DASHBOARD_ENABLED=true`, `YAPIN_OAUTH_CLIENT_ID`, `YAPIN_OAUTH_CLIENT_SECRET`, and `YAPIN_OAUTH_REDIRECT_URI` in `.env`.
4. Only Yapin users verified via the Bot API as holding a configured server staff role (or Server Owner / `manage_server`) can obtain a session.
5. **Capabilities & Security**:
   - Interactive **Trade Detail Drawer** (`Inspect`, `Assign` / `Reassign` Middleman, `Verify` / `Reject` Deposits, `Complete Trade`, `Force Cancel`)
   - **Open Disputes Queue** (`Resume Trade` / `Cancel Trade` with mandatory documented decision)
   - **Open Tickets Queue** (`Claim` / `Close` with `STAFF_REPORT` Admin-only visibility isolation)
   - **Staff Workload & Stats**, **Searchable Paginated Audit Logs** (filter by action, actor, target, or correlation ID), and **Admin Server Configuration** editor
   - Hardened with **OAuth2 + PKCE (`S256`)**, SHA-256 hashed MongoDB session tokens, live Bot API RBAC re-verification, constant-time `X-CSRF-Token` + Same-Origin (`Origin` / `Sec-Fetch-Site`) write guards, per-IP rate limiting, strict CSP headers, and Zod payload schemas. Never exposes `YAPIN_BOT_TOKEN` or OAuth secrets to the browser.

---

## Production Deployment Guide (Linux VPS, Docker, systemd, or PM2)

1. **Provision Infrastructure**:
   - **Node.js 22 LTS** runtime on Ubuntu 24.04 LTS, Docker, Railway, Render, or Fly.io (run **1 replica per `yb_` bot token** so you stay well within Yapin's 2-socket Gateway limit).
   - **Persistent Disk Volume for JSON Storage**: Mount a persistent folder/volume at `DATA_DIR` (default `./data`, or `/app/data` in Docker) so `.json` files persist across container redeploys. No external database is needed!
2. **Environment & Secrets**:
   - Inject `NODE_ENV=production`, `YAPIN_BOT_TOKEN`, `YAPIN_SERVER_ID`, and `DATA_DIR=/app/data` (or `./data`) via host secret manager or `/etc/yapin-middleman/bot.env` (`chmod 600 bot.env`).
   - If enabling `DASHBOARD_ENABLED=true` or `YAPIN_WEBHOOK_ENABLED=true`, place **Nginx** or **Caddy** in front with HTTPS TLS termination so `Secure; HttpOnly; SameSite=Lax` cookies are encrypted in transit.
3. **Run via Docker, `systemd`, or PM2** (ready-to-use manifests included):
   - **Docker**: `docker build -t yapin-middleman-bot . && docker run -v yapin-data:/app/data --env-file .env -p 3200:3200 yapin-middleman-bot`
   - **systemd**: Copy `deploy/yapin-middleman.service` to `/etc/systemd/system/`, run `sudo systemctl daemon-reload && sudo systemctl enable --now yapin-middleman`
   - **PM2**: `npm ci --omit=dev && npx pm2 start deploy/ecosystem.config.cjs`
   - **Direct CLI**:
     ```bash
     npm ci --omit=dev
     npm run db:check
     npm run register:commands
     NODE_ENV=production npm start
     ```
   Graceful shutdown (`SIGTERM` / `SIGINT`) automatically closes the HTTP dashboard, stops the Gateway/poller, checkpoints `lastEventId` to `operational.json`, and flushes all pending JSON disk writes cleanly.

---

## Testing Modes

- **Offline Unit Suite — 11 Suites / 37 Tests (Mocked Yapin API + Real Atomic JSON Storage & Zod Validation)**:
  ```bash
  npm test
  ```
- **Opt-In Live Integration Suite (Real Yapin Test Server)**:
  Never mocked — runs only when explicitly opted in with real test credentials (`YAPIN_LIVE_TEST=true`, `YAPIN_BOT_TOKEN`, `YAPIN_SERVER_ID`, `YAPIN_TEST_CHANNEL_ID`):
  ```bash
  YAPIN_LIVE_TEST=true npm run test:live
  ```
  *(On Windows PowerShell: `$env:YAPIN_LIVE_TEST="true"; npm run test:live`)*

See also:
- [`docs/API_REFERENCE_AND_FEATURE_MATRIX.md`](./docs/API_REFERENCE_AND_FEATURE_MATRIX.md) — Verified Yapin endpoints, official docs URLs, platform constraints, and full feature matrix.
- [`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md) — Solutions for setup, RBAC, rate limits, private channel locks, MongoDB, and PowerShell issues.
