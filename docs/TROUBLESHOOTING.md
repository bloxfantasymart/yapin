# Troubleshooting Guide — Yapin.gg Middleman Bot

This guide covers common local setup, Yapin API permission, local JSON storage, Windows 11 PowerShell, and Staff Dashboard issues.

---

## 1. Startup Fails Immediately with `Invalid environment configuration`

**Symptom:**
```text
[FATAL] Invalid environment configuration:
  - YAPIN_BOT_TOKEN: YAPIN_BOT_TOKEN must start with "yb_"
  - YAPIN_SERVER_ID: YAPIN_SERVER_ID is required
```

**Cause & Fix:**
1. Verify you copied `.env.example` to `.env` in the repository root (`Copy-Item .env.example .env` in PowerShell).
2. Open Yapin.gg -> **Settings -> Developer -> Your Bot** and copy the Bot Token starting with `yb_` (never paste your personal user session token or OAuth2 client secret into `YAPIN_BOT_TOKEN`).
3. Enable **Settings -> Advanced -> Developer Mode** in Yapin, right-click your target server icon, and copy the Server UUID into `YAPIN_SERVER_ID`.

---

## 2. `401 Unauthorized` on `npm run test:connection`

**Symptom:**
`YapinApiError: Invalid bot token (401)` during `GET /me`.

**Cause & Fix:**
- Your `YAPIN_BOT_TOKEN` was regenerated or revoked in Yapin Developer Settings, or contains stray quotes/spaces.
- Generate a fresh `yb_...` token in Yapin Developer Settings and update `.env`.

---

## 3. Private Ticket Creation Fails & Rolls Back (`Unable to provision a private ticket channel securely`)

**Symptom:**
Running `/ticket open ...` replies with an error stating the channel was rolled back and staff were alerted (`TICKET_PRIVATE_LOCK_FAILED`).

**Why This Happens (By Design — Fail-Closed Security):**
Yapin creates channels via `POST /servers/:id/channels` and locks privacy via `PATCH /channels/:id` (`{ private: true, role_ids: [...] }`). If the bot lacks the **Manage Channels** permission or no valid staff/bot role IDs can be applied, the bot **immediately deletes the newly created channel** so confidential scam reports or trade proofs are never exposed publicly.

**Fix:**
1. Ensure the bot's auto-role in your Yapin server has **Manage Channels** enabled (and **Manage Roles** if `useScopedParticipantRole` is enabled).
2. Configure at least one staff role ID using `/config set-role tier=middleman roles=<role_id>` and `/config set-role tier=admin roles=<role_id>`.
3. Optionally configure a staff alert channel via `/config set-channel key=alertChannelId value=<channel_id>`.

---

## 4. Staff Commands Reject Authorized Staff (`Insufficient server permissions`)

**Symptom:**
Running `/claim`, `/verifydeposit`, or `/complete` fails even though the user has a custom "Middleman" role in Yapin.

**Cause & Fix:**
- Custom role names are never trusted automatically (an attacker could name a cosmetic role "Middleman"). You must register the verified **Role ID** in `ServerConfig` as the Server Owner or a member with Yapin's `manage_server` permission:
  ```text
  /config set-role tier=middleman roles=<middleman_role_id>
  /config set-role tier=moderator roles=<moderator_role_id>
  /config set-role tier=admin roles=<admin_role_id>
  ```

---

## 5. WebSocket Gateway Closes with `4003` or `4008`

**Symptom:**
Logs show Gateway close code `4003` (Gateway disabled for bot) or `4008` (Too many open sockets; Yapin allows max 2 concurrent Gateway sockets per bot).

**Cause & Fix:**
- **Code `4003`**: `YapinClient` automatically falls back to Yapin's official HTTPS Long-Polling endpoint (`GET /events?after=<seq>&wait=20`) with zero lost events. You can also set `YAPIN_ENABLE_GATEWAY=false` in `.env`.
- **Code `4008`**: Stop duplicate running instances of the bot using the same `yb_` token before starting a new process.

---

## 6. Local JSON Storage Permissions or Container Volume Persistence

**Symptom:**
- `EACCES: permission denied, mkdir './data'` on Linux/Docker, OR trades reset after redeploying a cloud container.

**Cause & Fix:**
- **Permissions**: Ensure the user running Node owns the `DATA_DIR` folder (e.g. `chown -R yapinbot:yapinbot /opt/yapin-middleman-bot/data` on Linux).
- **Cloud Container Persistence (Railway / Render / Fly.io / Docker)**: Cloud containers wipe ephemeral filesystems when redeployed unless a **Persistent Volume** is attached. Mount a persistent volume to `/app/data` (or set `DATA_DIR` to your mounted volume path) so `trades.json`, `users.json`, `tickets.json`, `audit_logs.json`, and `server_configs.json` persist across redeploys!
- **Automatic Crash Recovery**: Every write uses atomic `*.tmp` + `fsync` + `rename` and keeps a `.bak` copy — if power fails mid-write, `JsonDatabase` automatically cleans up `.tmp` files and restores from `.bak` if needed.

---

## 7. Windows 11 PowerShell Blocks `npm` (`running scripts is disabled on this system`)

**Symptom:**
`npm : File C:\Program Files\nodejs\npm.ps1 cannot be loaded because running scripts is disabled on this system.`

**Fix:**
Run this once in your user PowerShell window (no Administrator prompt needed):
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

---

## 8. Staff Web Dashboard Returns `403` After "Login with Yapin'" or Rejects POST Requests

**Causes & Fixes:**
1. **`403 Access denied` after OAuth2 callback**: Your Yapin account authenticated cleanly via OAuth2, but `GET /servers/:serverId/members/:userId` showed your account does not hold the Server Owner role, `manage_server`, or a configured `staffRoles.*` ID on `YAPIN_SERVER_ID`.
2. **`Invalid or expired OAuth2 state`**: Ensure `YAPIN_OAUTH_REDIRECT_URI` matches the exact host and port you opened in your browser (e.g., `http://localhost:3200/auth/callback` vs `http://127.0.0.1:3200/auth/callback` — cookies are host-scoped!).
3. **`CSRF token validation failed`**: Every `POST` request to the dashboard must send the session's `x-csrf-token` header from `/api/me` or `<meta name="csrf-token">`.
