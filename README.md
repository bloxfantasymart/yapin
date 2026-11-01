# MM2 Helper | MurderMystery2 Server Assistant for Yapin.gg

**MM2 Helper** is a modular server assistant for **MurderMystery2** on **Yapin.gg**. It provides account verification, private support cases, staff applications, moderation, audit logging, leveling, character tools, and mystery events.

- **Zero External Database Needed**: Powered by a crash-safe, ACID-transactional local JSON storage engine (`./data/*.json`) with `.tmp` + `fsync` + `.bak` automatic power-loss recovery.
- **Native Yapin.gg Adapter (`src/api/`)**: Built strictly against Yapin's verified REST v1 API (`https://www.yapin.gg/api/bot/v1`), Realtime WebSocket Gateway (`wss://rt.yapper.website/bot`), HTTPS Long-Polling fallback, Ephemeral & Update Button Interactions, and `"Login with Yapin'"` OAuth2 PKCE.

---

## MURDERMYSTERY2 | CORE SYSTEMS

### 01 | Verification Center
- Deploy an interactive verification panel via `/panel verify`.
- **Button-first clearance:** new servers default to `INSTANT`; citizens complete entry by pressing **Verify Account** on the panel. `/verify` explains where to find the official panel and does not bypass it.
- Optional `CODE` mode issues the `MM2-XXXX` passcode privately from that button. If a code is typed in a command, MM2 Helper first tries to delete that command message; it refuses to check the code if Yapin denies deletion.
- Clearance is recorded only after the configured `verifiedRoleId` is successfully granted. It removes `unverifiedRoleId`, awards a **+50 XP** starter bonus + `🛡️ Verified Citizen` badge, posts a themed welcome card, and blocks actively banned accounts. Missing role configuration or a Yapin role-permission failure is reported without claiming success.
- Staff override via `/verifyuser <verify|unverify> <@user>`.

### 02 | Staff Applications
- Deploy an interactive recruitment hub via `/panel applications`.
- Configurable open/closed status (`/config apps open=true minlevel=5`) and rejection cooldowns.
- Structured `/apply` command (`Age | Timezone | Hours | Experience | Motivation | Incident Review Scenario`) generates tracked `APP-...` dossiers and posts live Staff Review cards with **Mark Under Review**, **Accept**, and **Decline** buttons.
- Accepting an application **automatically assigns your configured `trialModRoleIds`**, grants the `⭐ Trial Sheriff` badge, updates the review card, and DMs the applicant.

### 03 | Support Center
- Deploy a 1-click multi-category ticket panel via `/panel tickets`:
  - `GENERAL_SUPPORT` — Server questions & role help
  - `RP_CHARACTER` — Character profile or community support
  - `RULE_VIOLATION` — Private reports about server conduct or suspected exploits
  - `APPEAL` — Punishment appeals
  - `STAFF_REPORT` — Visible only to authorized administrators
- **Fail-Closed Security**: If private channel permission locking (`PATCH /channels/:id { private: true, role_ids }`) fails, the channel is immediately deleted and rolled back so private tickets **never** leak publicly.
- Closing a ticket archives a **SHA-256 tamper-evident transcript** (`transcripts` channel + `tickets.json`).

### 04 | Moderation & Case Files
- Monotonic numbered Case Files (`CASE-...`) for `/warn`, `/clearwarn`, `/mute` (grants `mutedRoleId` + automatic background unmute sweep), `/unmute`, `/kick`, `/ban`, `/unban`, `/case`, and `/modlogs`.
- **Automatic Warning Escalation**: Hitting `autoWarnThreshold` (default `3` active warnings) automatically issues a timed Sheriff Mute.
- **Channel Control**: `/purge <1-100> [@user]`, `/slowmode <seconds|off>`, `/lock`, and `/unlock`.
- **Smart Auto-Mod**: Blocks phishing/scam links, unauthorized server invites, mass-mention spam, and custom blocked words while exempting verified Staff.
- **`/report` Review Queue**: Routes member reports privately to staff **without** automatically banning or labeling accused players.

### 05 | Levels, Ranks & Rewards
- Anti-spam message XP engine with **Character Scene Bonus XP** for detailed character posts (`*actions*` / dialogue).
- 10 Murder Mystery 2 Prestige Ranks (`🎭 New Suspect` → `🔦 Junior Investigator` → `🕵️ Lead Detective` → `🔫 Head Sheriff` → `🌈 Chroma Master` → `👑 Nikilis's Chosen`).
- Automatic milestone role rewards (`/config levelrole 10 <roleId>`), `/rank` progress bars, `/leaderboard`, `/daily` Daily Mystery Crates with streak bonuses, and `/xp` staff controls.

### 06 | Characters & Mystery Events
- **Character Registry**: `/character create|list|switch|delete` (up to 5 personas with Alignment, Signature Gear & Backstory).
- **Character & Investigation Tools**: `/rp say`, `/rp scene <Map>` across 10 iconic MM2 maps (*The Mansion, Nikilis Factory, Grand Hotel, Military Base, Police Station HQ, BioLab, Downtown Bank, Research Facility, House 2, Office 3*), `/rp clue`, and `/rp roll 1d20`.
- **Live Secret MM2 Mystery Rounds (`/mystery start [Map]`)**: Opens an interactive lobby where players click **Join**, the host/staff clicks **Draw Secret Roles** (cryptographically assigning **1 Murderer**, **1 Sheriff**, and **Innocents**), and each player clicks **🎭 Reveal My Secret Role** to view their assignment via a **100% private Ephemeral callback**!
- **Member Notification Roles**: `/panel roles` & `/roles toggle <key>`.

### 07 | Staff Web Console (`src/dashboard/`)
- Optional dark-themed web console secured with official `"Login with Yapin'"` OAuth2 + PKCE (`S256`), server-side RBAC, HttpOnly signed session cookies, CSRF tokens, and Same-Origin protection.

---

## COMMAND REFERENCE | 36 COMMANDS

| Category | Commands |
|---|---|
| **Verification & Info** | `/verify`, `/rules`, `/help`, `/ping`, `/serverinfo`, `/profile` |
| **Ranks & XP** | `/rank`, `/leaderboard`, `/daily` |
| **Characters & Events** | `/character`, `/rp`, `/mystery`, `/roles` |
| **Tickets, Reports & Apps** | `/ticket`, `/report`, `/apply` |
| **Staff Moderation** | `/warn`, `/warnings`, `/clearwarn`, `/mute`, `/unmute`, `/kick`, `/ban`, `/unban`, `/case`, `/modlogs`, `/purge`, `/slowmode`, `/lock`, `/unlock`, `/verifyuser` |
| **Server Administration** | `/applications`, `/appreview`, `/xp`, `/panel`, `/config` |

---

## QUICK START | HOSTING GUIDE

### Prerequisites
- **Node.js 22.12+ LTS** (or Node.js 24 LTS) — download from [nodejs.org](https://nodejs.org/)
- A **Yapin.gg Bot Token** (`yb_...`) created in **Yapin Settings → Developer → New Bot** (name it **MM2 Helper** and invite it to **MurderMystery2** with *Manage Roles*, *Manage Channels*, and *Manage Messages* permissions)
- Your **MurderMystery2 Server ID** (enable *Settings → Advanced → Developer Mode*, right-click **MurderMystery2**, click **Copy Server ID**)

---

### Option A: Run on Windows 11 PC (Command Prompt)

Open **Command Prompt** in the folder where you want the project. Use these commands one at a time (the `main` branch may not yet contain the open pull request, so check out the session branch):

```cmd
git clone https://github.com/bloxfantasymart/yapin.git
cd yapin
git fetch origin
git checkout arena/2e5cd636-yapin
npm install
copy .env.example .env
notepad .env
```

In Notepad, fill in `YAPIN_BOT_TOKEN=yb_...` and `YAPIN_SERVER_ID=...`, save, then return to Command Prompt:

```cmd
npm run db:check
npm run test:connection
npm start
```

---

### Option B: Yapin' Official Bot Hosting (`mm2-helper-bot.zip`)
1. Run `npm run package:zip` (or use the pre-built `mm2-helper-bot.zip` in the project root).
2. Open **Yapin Settings → Developer → MM2 Helper → Hosting**.
3. Upload `mm2-helper-bot.zip` and set `YAPIN_SERVER_ID` in the hosting environment variables (`YAPPER_BOT_TOKEN` is auto-detected automatically).
4. Click **Start**!

---

### Option C: 24/7 Linux Cloud VPS (Ubuntu / Debian + PM2)

```bash
git clone https://github.com/bloxfantasymart/yapin.git mm2-helper
cd mm2-helper
npm ci --omit=dev

cp .env.example .env
nano .env   # Set YAPIN_BOT_TOKEN and YAPIN_SERVER_ID

npm install -g pm2
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup
```

*(A hardened `systemd` unit is also provided at `deploy/mm2-helper.service`.)*

---

### Option D: Docker Container (Persistent `./data` Volume)

```bash
docker build -t mm2-helper-bot .
docker run -d \
  --name mm2-helper \
  --restart unless-stopped \
  --env-file .env \
  -v "$(pwd)/data:/app/data" \
  mm2-helper-bot
```

---

## MURDERMYSTERY2 | INITIAL SERVER SETUP

Once **MM2 Helper** is online in **MurderMystery2**, run these commands as the Server Owner / Admin. The bot needs Yapin's supported role/channel/message management permissions. Its role must sit above every role it is expected to grant or remove. Do not treat a displayed username as proof of staff access: configure staff role IDs here, and keep the Server Owner account as the ultimate authority.

Existing installations preserve their saved rule text. To replace it with the refreshed MurderMystery2 standards, run `/config rules reset` (this overwrites the current custom rules).

```text
# 1. Configure Staff & Citizen Roles
/config role admin <AdminRoleID>
/config role mod <ModeratorRoleID>
/config role trialmod <TrialModRoleID>
/config role verified <VerifiedCitizenRoleID>
/config role unverified <UnverifiedRoleID>
/config role muted <MutedRoleID>

# 2. Configure Log & Operational Channels
/config channel welcome <WelcomeChannelID>
/config channel modlog <ModLogsChannelID>
/config channel applog <ModAppsReviewChannelID>
/config channel ticketlog <TicketLogsChannelID>
/config channel transcript <TranscriptsChannelID>
/config channel rplog <CommunityLogsChannelID>
/config channel ticketcategory <TicketsCategoryID>

# 3. Deploy Interactive Button Hubs in Their Channels!
/panel verify         (run in #checkpoint-verify)
/panel tickets        (run in #support-tickets)
/panel applications   (run in #mod-applications)
/panel roles          (run in #self-roles)
```

---

## 🧪 Running Automated Tests

```bash
# Run full unit, security, dashboard, E2E command & native Node ESM test suite
npm test

# Opt-in live Yapin.gg integration test (requires YAPIN_LIVE_TEST=true + test channel)
npm run test:live
```
