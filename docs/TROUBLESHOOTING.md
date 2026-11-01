# MM2 Helper — Troubleshooting Guide

### 1. `[FATAL] Invalid environment configuration: YAPIN_BOT_TOKEN must start with "yb_"`
- Open **Yapin Settings → Developer → MM2 Helper**, copy the Bot Token starting with `yb_`, and paste it into `.env` (`YAPIN_BOT_TOKEN=yb_...`). Never commit `.env` to Git.

### 2. Checkpoint says it is not ready, or a role was not assigned
- The Checkpoint now fails closed: it does not save or announce verified clearance unless Yapin successfully grants the configured Verified Citizen role.
- In **MurderMystery2 Server Settings → Roles**:
  1. Configure `/config role verified <roleId>` and, optionally, `/config role unverified <roleId>`; confirm IDs with `/config view`.
  2. Ensure **MM2 Helper** has Yapin's **Manage Roles** permission.
  3. Move **MM2 Helper**'s role above Verified Citizen, Unverified, Muted, Trial Mod, and every Level Reward role it must manage.
  4. Re-run the button from `/panel verify`. A failed API grant will not be recorded as successful verification.
- The role resolver accepts documented Yapin `manage_server`, `manage_messages`, and `perms.*` role flags. Configure MM2 Helper staff roles with `/config role ...`; usernames and display names never confer access.

### 3. Opening a Ticket Fails to Provision a Private Channel
- **MM2 Helper** uses **fail-closed ticket security**: if Yapin rejects `PATCH /channels/:id` (`{ private: true, role_ids }`) (for example, due to missing **Manage Channels** permission), the bot immediately deletes the newly created channel so private reports never become public.
- Fix: Grant **Manage Channels** to **MM2 Helper** and configure at least one staff role (`/config role admin <roleId>`).

### 4. Gateway Closes with `4003`
- Yapin closes WebSocket connections with `4003` when realtime gateway access is disabled on a bot profile. **MM2 Helper** automatically falls back to HTTPS Long-Polling (`GET /events?after=<seq>&wait=20`) with zero lost events.

### 5. Backing Up or Moving `./data` JSON Files
- All **MurderMystery2** XP, ranks, character profiles, Case Files, Mod Applications, Tickets, and Audit Logs live inside `./data/*.json`.
- To back up or migrate servers, stop the bot cleanly (`Ctrl+C` or `pm2 stop mm2-helper-bot`) and copy the `./data` folder.
