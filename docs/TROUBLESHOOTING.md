# MM2 Helper — Troubleshooting Guide

### 1. `[FATAL] Invalid environment configuration: YAPIN_BOT_TOKEN must start with "yb_"`
- Open **Yapin Settings → Developer → MM2 Helper**, copy the Bot Token starting with `yb_`, and paste it into `.env` (`YAPIN_BOT_TOKEN=yb_...`). Never commit `.env` to Git.

### 2. Verified Role, Muted Role, or Trial Mod Role Is Not Assigned Automatically
- In **MurderMystery2 Server Settings → Roles**:
  1. Ensure **MM2 Helper**'s bot role has **Manage Roles** enabled.
  2. Drag **MM2 Helper**'s bot role **above** the Verified Citizen, Unverified, Muted, Trial Mod, and Level Reward roles in the role hierarchy.
  3. Verify role IDs with `/config view`.

### 3. Opening a Ticket Fails with `"Unable to provision a private encrypted ticket channel"`
- **MM2 Helper** uses **fail-closed ticket security**: if `PATCH /channels/:id` (`{ private: true, role_ids }`) is rejected (e.g., missing **Manage Channels** permission), the bot immediately deletes the newly created channel so private reports never become public.
- Fix: Grant **Manage Channels** to **MM2 Helper** and configure at least one staff role (`/config role admin <roleId>`).

### 4. Gateway Closes with `4003`
- Yapin closes WebSocket connections with `4003` when realtime gateway access is disabled on a bot profile. **MM2 Helper** automatically falls back to HTTPS Long-Polling (`GET /events?after=<seq>&wait=20`) with zero lost events.

### 5. Backing Up or Moving `./data` JSON Files
- All **MurderMystery2** XP, ranks, RP characters, Case Files, Mod Applications, Tickets, and Audit Logs live inside `./data/*.json`.
- To back up or migrate servers, stop the bot cleanly (`Ctrl+C` or `pm2 stop mm2-helper-bot`) and copy the `./data` folder.
