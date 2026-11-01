# MM2 Helper — Verified Yapin.gg API Reference & Feature Matrix

All platform calls in **MM2 Helper** are isolated inside `src/api/` and strictly target documented **Yapin.gg** (`yapin.gg` / `yapper.website`) endpoints. No Discord-only endpoints, modal dialogs, or select menus are assumed.

## 1. Verified Yapin Endpoints Used by MM2 Helper

| Domain | Method & Endpoint | Used For in MurderMystery2 |
|---|---|---|
| **Identity & Status** | `GET /me`, `PUT /status` | Token verification, bot UUID discovery, online status `"/verify • MurderMystery2"` |
| **Slash Commands** | `GET /commands`, `PUT /commands` | Syncing all 36 MM2 Helper commands (`{ name, description }`, `<= 100` commands) |
| **Realtime Events** | `wss://rt.yapper.website/bot` & `GET /events` | WebSocket Gateway (`hello` → `identify`/`resume` → `heartbeat`) with automatic HTTPS Long-Polling fallback (`4003` or network drop) and persisted cursor (`operational.json`) |
| **Messages & Embeds** | `GET/POST/PATCH/DELETE /channels/:id/messages[/:mid]` | Rich MM2 embeds (`<= 5` embeds, `<= 6000` chars), `reply_to` quoting, live application/round card updates, Auto-Mod message removal |
| **Bulk Purge** | `POST /channels/:id/messages/bulk-delete` | `/purge <1-100>` crime-scene message cleanup |
| **Button Callbacks** | `POST /interactions/:id/:token/callback` | `ephemeral` (private Sheriff passcodes & secret Murderer/Sheriff/Innocent reveals), `update` (live ticket/application/round cards), `reply` |
| **Private Channels** | `POST /servers/:id/channels`, `PATCH /channels/:id`, `DELETE /channels/:id` | Fail-closed private Detective Ticket channels (`private: true, role_ids`), `/slowmode`, `/lock`, `/unlock` |
| **Roles & RBAC** | `GET /servers/:id`, `GET /servers/:id/roles`, `GET /servers/:id/members/:uid`, `PUT/DELETE .../roles/:rid` | Server-side Staff RBAC (`Owner`, `Admin`, `Moderator`, `Trial Mod`, `Support`), Verified/Unverified/Muted role enforcement, Trial Mod auto-promotion, Level-Up rewards & member notification roles |
| **Direct Messages** | `POST /users/:id/dm` | Outbound Moderator Application decision notifications |
| **OAuth2 PKCE** | `GET /oauth/authorize`, `POST /api/oauth/token`, `GET /api/oauth/me` | Sheriff HQ Staff Web Console (`scope=identify` + PKCE `S256`) |

## 2. Platform Constraints & Safe Architectural Choices

1. **No Modal Popups or Select Menus on Yapin**:
   - Interactive panels use **Button Rows** (`<= 5x5`), **Ephemeral Callbacks** (`type: "ephemeral"`), and pipe-delimited `/apply` & `/character create` templates.
2. **Private Mystery Role Assignment**:
   - Because normal channel messages are visible to everyone in the channel, `/mystery` stores secret `MURDERER` / `SHERIFF` / `INNOCENT` assignments in memory and reveals them **exclusively** via `type: "ephemeral"` button callbacks when each player clicks **Reveal My Secret Role**.
3. **Local Atomic JSON Storage (`./data/*.json`)**:
   - Collections: `users.json`, `cases.json`, `applications.json`, `tickets.json`, `reports.json`, `audit_logs.json`, `server_configs.json`, `operational.json`.
   - Every write serializes to `.tmp`, calls `fsync`, rotates the previous valid file to `.bak`, and atomically renames over the target file (with Windows `EPERM`/`EBUSY` retry).
