import { BOT_BRAND } from '../config/settings.js';

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderLoginPage({ errorMsg = null } = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(BOT_BRAND.botName)} | ${escapeHtml(BOT_BRAND.serverName)} Staff Console</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: radial-gradient(circle at top, #280a10, #0d1117 65%); color: #e6edf3; display: grid; place-items: center; min-height: 100vh; }
    .card { max-width: 470px; width: 92%; background: #161b22; border: 1px solid #da3633; border-radius: 14px; padding: 2rem; box-shadow: 0 16px 40px rgba(0,0,0,0.65); }
    h1 { margin: 0 0 0.5rem; font-size: 1.4rem; }
    p { color: #8b949e; line-height: 1.5; font-size: 0.94rem; }
    .err { background: rgba(248,81,73,0.15); border: 1px solid #f85149; color: #ffa198; padding: 0.75rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem; }
    .btn { display: inline-block; width: 100%; box-sizing: border-box; text-align: center; background: #da3633; color: #fff; text-decoration: none; font-weight: 700; padding: 0.85rem 1rem; border-radius: 8px; margin-top: 0.75rem; }
    .btn:hover { background: #b62324; }
    .notice { margin-top: 1.25rem; font-size: 0.8rem; color: #8b949e; border-top: 1px solid #21262d; padding-top: 0.85rem; }
  </style>
</head>
<body>
  <main class="card">
    <h1>${escapeHtml(BOT_BRAND.botName)} | Staff Console</h1>
    <p>Sign in securely with your <strong>Yapin.gg</strong> account to access authorized <strong>${escapeHtml(BOT_BRAND.serverName)}</strong> staff tools.</p>
    ${errorMsg ? `<div class="err">${escapeHtml(errorMsg)}</div>` : ''}
    <a class="btn" href="/auth/login">Continue with Yapin</a>
    <div class="notice">Credentials remain server-side. Administrative actions are recorded in the append-only audit log.</div>
  </main>
</body>
</html>`;
}

export function renderStaffConsolePage(session) {
  const isAdmin = Number(session.staffTier) >= 40;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="csrf-token" content="${escapeHtml(session.csrfToken)}" />
  <title>${escapeHtml(BOT_BRAND.botName)} | ${escapeHtml(BOT_BRAND.serverName)} Staff Console</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #0d1117; color: #e6edf3; }
    header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.5rem; background: #161b22; border-bottom: 2px solid #da3633; flex-wrap: wrap; gap: 0.75rem; }
    .badge { background: #d29922; color: #0d1117; padding: 0.2rem 0.6rem; border-radius: 999px; font-size: 0.78rem; font-weight: 800; }
    main { max-width: 1320px; margin: 1.4rem auto; padding: 0 1.25rem 3rem; display: grid; gap: 1.25rem; }
    .grid-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.9rem; }
    .stat, section { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 1rem 1.2rem; }
    .stat h3 { margin: 0; font-size: 0.78rem; color: #8b949e; text-transform: uppercase; letter-spacing: 0.04em; }
    .stat strong { display: block; margin-top: 0.35rem; font-size: 1.6rem; }
    h2 { margin: 0 0 0.75rem; font-size: 0.92rem; letter-spacing: 0.06em; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #30363d; padding-bottom: 0.6rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th, td { text-align: left; padding: 0.55rem 0.5rem; border-bottom: 1px solid #21262d; vertical-align: middle; }
    th { color: #8b949e; font-weight: 600; }
    button, input, select { background: #0d1117; color: #e6edf3; border: 1px solid #30363d; border-radius: 6px; padding: 0.42rem 0.65rem; font-size: 0.84rem; font-family: inherit; }
    button { background: #21262d; cursor: pointer; font-weight: 600; }
    button:hover { background: #30363d; }
    button.primary { background: #238636; border-color: #2ea043; color: #fff; }
    button.danger { background: #da3633; border-color: #f85149; color: #fff; }
    .toolbar { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap; align-items: center; }
    .toast { position: fixed; bottom: 1.25rem; right: 1.25rem; background: #1f6feb; color: #fff; padding: 0.7rem 1rem; border-radius: 8px; display: none; z-index: 50; }
    .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.85rem; margin-top: 0.75rem; }
    .box { background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 0.85rem; }
    code { background: #0d1117; padding: 0.12rem 0.35rem; border-radius: 4px; font-size: 0.8rem; }
  </style>
</head>
<body>
  <header>
    <div>
      <strong>${escapeHtml(BOT_BRAND.botName)} | ${escapeHtml(BOT_BRAND.serverName)} Staff Console</strong>
      <span class="badge">Tier ${escapeHtml(session.staffTier)}</span>
      <span style="color:#8b949e;margin-left:0.5rem;">Server: <code>${escapeHtml(session.serverId)}</code></span>
    </div>
    <div style="display:flex;align-items:center;gap:0.65rem;">
      <span>Signed in as <strong>${escapeHtml(session.username)}</strong> (<code>${escapeHtml(session.yapinUserId)}</code>)</span>
      <button id="refreshAllBtn" type="button">Refresh</button>
      <button id="logoutBtn" type="button">Sign Out</button>
    </div>
  </header>

  <div id="toast" class="toast"></div>

  <main>
    <div class="grid-stats">
      <div class="stat"><h3>VERIFIED MEMBERS</h3><strong id="stVerified">-</strong></div>
      <div class="stat"><h3>PENDING APPLICATIONS</h3><strong id="stApps">-</strong></div>
      <div class="stat"><h3>OPEN SUPPORT CASES</h3><strong id="stTickets">-</strong></div>
      <div class="stat"><h3>PENDING REPORTS</h3><strong id="stReports">-</strong></div>
    </div>

    <section>
      <h2>STAFF APPLICATIONS | REVIEW QUEUE</h2>
      <table id="appsTable">
        <thead><tr><th>App ID</th><th>Applicant</th><th>Level</th><th>Status</th><th>Timezone / Hours</th><th>Why MM2</th><th>Admin Review</th></tr></thead>
        <tbody><tr><td colspan="7">Loading...</td></tr></tbody>
      </table>
    </section>

    <section>
      <h2>SUPPORT CENTER | OPEN CASES</h2>
      <table id="ticketsTable">
        <thead><tr><th>Ticket ID</th><th>Category</th><th>Status</th><th>Creator</th><th>Assigned Officer</th><th>Subject</th><th>Actions</th></tr></thead>
        <tbody><tr><td colspan="7">Loading...</td></tr></tbody>
      </table>
    </section>

    <section>
      <h2>CASE FILES | RECENT STAFF ACTIONS</h2>
      <div class="toolbar">
        <input id="warnUserId" placeholder="Member Yapin UUID" />
        <input id="warnReason" placeholder="Warning reason" style="min-width:240px;" />
        <button id="issueWarnBtn" class="danger" type="button">Create Warning Case</button>
      </div>
      <table id="casesTable">
        <thead><tr><th>Case #</th><th>Case ID</th><th>Action</th><th>Suspect</th><th>Officer</th><th>Reason</th><th>Status</th></tr></thead>
        <tbody><tr><td colspan="7">Loading...</td></tr></tbody>
      </table>
    </section>

    <section>
      <h2>LEVELS | LEADERBOARD</h2>
      <table id="leaderTable">
        <thead><tr><th>#</th><th>Citizen UUID</th><th>Username</th><th>Level &amp; Rank</th><th>Total XP</th></tr></thead>
        <tbody><tr><td colspan="5">Loading...</td></tr></tbody>
      </table>
    </section>

    <section>
      <h2>AUDIT LOG | APPEND-ONLY</h2>
      <div class="toolbar">
        <input id="auditAction" placeholder="Action (e.g. MEMBER_VERIFIED)" />
        <input id="auditActor" placeholder="Actor UUID" />
        <input id="auditTarget" placeholder="Target ID" />
        <button id="searchAuditsBtn" type="button">Search</button>
      </div>
      <table id="auditsTable">
        <thead><tr><th>Timestamp</th><th>Audit ID</th><th>Action</th><th>Actor</th><th>Target</th></tr></thead>
        <tbody><tr><td colspan="5">Loading...</td></tr></tbody>
      </table>
    </section>

    ${
      isAdmin
        ? `<section id="configSection">
      <h2>SERVER CONFIGURATION</h2>
      <div class="form-grid">
        <div class="box">
          <h4>Staff Roles (comma-separated IDs)</h4>
          <label style="font-size:0.78rem;">Admin Roles</label>
          <input id="cfgAdminRoles" style="width:100%;margin-bottom:0.4rem;" />
          <label style="font-size:0.78rem;">Moderator Roles</label>
          <input id="cfgModRoles" style="width:100%;margin-bottom:0.4rem;" />
          <label style="font-size:0.78rem;">Trial Mod Roles</label>
          <input id="cfgTrialRoles" style="width:100%;" />
        </div>
        <div class="box">
          <h4>Citizen Roles &amp; Systems</h4>
          <label style="font-size:0.78rem;">Verified Citizen Role ID</label>
          <input id="cfgVerifiedRole" style="width:100%;margin-bottom:0.4rem;" />
          <label style="font-size:0.78rem;">Muted Role ID</label>
          <input id="cfgMutedRole" style="width:100%;margin-bottom:0.4rem;" />
          <label style="font-size:0.8rem;"><input type="checkbox" id="cfgAppsOpen" /> Mod Applications Open</label><br/>
          <label style="font-size:0.8rem;"><input type="checkbox" id="cfgAutoMod" /> Auto-Mod Enabled</label>
          <div style="margin-top:0.65rem;"><button id="saveConfigBtn" class="primary" type="button">Save Configuration</button></div>
        </div>
      </div>
    </section>`
        : ''
    }
  </main>

  <script>
    const csrf = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

    function notify(msg, isError = false) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.style.background = isError ? '#da3633' : '#1f6feb';
      el.style.display = 'block';
      setTimeout(() => { el.style.display = 'none'; }, 4000);
    }

    async function apiPost(path, body) {
      const res = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      return data;
    }

    async function loadOverview() {
      const res = await fetch('/api/overview', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      document.getElementById('stVerified').textContent = data.verifiedCitizens;
      document.getElementById('stApps').textContent = data.applications.filter((a) => a.status === 'PENDING' || a.status === 'UNDER_REVIEW').length;
      document.getElementById('stTickets').textContent = data.openTickets.length;
      document.getElementById('stReports').textContent = data.pendingReports.length;

      document.querySelector('#appsTable tbody').innerHTML = data.applications.length === 0
        ? '<tr><td colspan="7">No Moderator Applications filed yet.</td></tr>'
        : data.applications.map((a) =>
            '<tr><td><code>' + esc(a.applicationId) + '</code></td><td><code>' + esc(a.applicantId) + '</code></td><td>Lv.' +
            esc(a.levelAtApply) + '</td><td><code>' + esc(a.status) + '</code></td><td>' +
            esc((a.answers?.timezone || '') + ' / ' + (a.answers?.hours || '')) + '</td><td>' + esc((a.answers?.reason || '').slice(0, 80)) +
            '</td><td>' + (a.status === 'ACCEPTED' || a.status === 'DENIED' ? '-' :
              '<button type="button" class="primary" data-app-review="' + esc(a.applicationId) + '" data-decision="ACCEPTED">Accept</button> ' +
              '<button type="button" class="danger" data-app-review="' + esc(a.applicationId) + '" data-decision="DENIED">Deny</button>') +
            '</td></tr>'
          ).join('');

      document.querySelector('#ticketsTable tbody').innerHTML = data.openTickets.length === 0
        ? '<tr><td colspan="7">No open tickets.</td></tr>'
        : data.openTickets.map((tk) =>
            '<tr><td><code>' + esc(tk.ticketId) + '</code></td><td><code>' + esc(tk.type) + '</code></td><td><code>' +
            esc(tk.status) + '</code></td><td><code>' + esc(tk.creatorId) + '</code></td><td><code>' +
            esc(tk.assignedStaffId || 'Unclaimed') + '</code></td><td>' + esc(tk.subject) +
            '</td><td><button type="button" data-claim-ticket="' + esc(tk.ticketId) + '">Claim</button> ' +
            '<button type="button" class="danger" data-close-ticket="' + esc(tk.ticketId) + '">Close</button></td></tr>'
          ).join('');

      document.querySelector('#casesTable tbody').innerHTML = data.recentCases.length === 0
        ? '<tr><td colspan="7">No Case Files recorded yet.</td></tr>'
        : data.recentCases.map((c) =>
            '<tr><td>#' + esc(c.caseNumber) + '</td><td><code>' + esc(c.caseId) + '</code></td><td><code>' +
            esc(c.action) + '</code></td><td><code>' + esc(c.targetUserId) + '</code></td><td><code>' +
            esc(c.moderatorId) + '</code></td><td>' + esc(c.reason) + '</td><td>' +
            (c.active ? '🟢 Active' : '⚪ Cleared') + '</td></tr>'
          ).join('');

      document.querySelector('#leaderTable tbody').innerHTML = data.leaderboard.length === 0
        ? '<tr><td colspan="5">No XP activity yet.</td></tr>'
        : data.leaderboard.map((u, idx) =>
            '<tr><td>#' + (idx + 1) + '</td><td><code>' + esc(u.yapinUserId) + '</code></td><td>' +
            esc(u.lastKnownUsername || '-') + '</td><td>Lv.' + esc(u.leveling?.level) + ' (' + esc(u.leveling?.rankTitle) + ')</td><td><code>' +
            esc(u.leveling?.totalXp || 0) + '</code></td></tr>'
          ).join('');
    }

    async function loadAudits() {
      const qs = new URLSearchParams({ page: '1', limit: '20' });
      const action = document.getElementById('auditAction').value.trim();
      const actorId = document.getElementById('auditActor').value.trim();
      const targetId = document.getElementById('auditTarget').value.trim();
      if (action) qs.set('action', action);
      if (actorId) qs.set('actorId', actorId);
      if (targetId) qs.set('targetId', targetId);

      const res = await fetch('/api/audits?' + qs.toString(), { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      document.querySelector('#auditsTable tbody').innerHTML = data.items.length === 0
        ? '<tr><td colspan="5">No audit entries matched.</td></tr>'
        : data.items.map((a) =>
            '<tr><td>' + esc(a.timestamp) + '</td><td><code>' + esc(a.auditId) + '</code></td><td><code>' +
            esc(a.action) + '</code></td><td><code>' + esc(a.actorId) + '</code></td><td><code>' +
            esc((a.targetType === 'ROLEPLAY' ? 'COMMUNITY' : a.targetType) + ':' + a.targetId) + '</code></td></tr>'
          ).join('');
    }

    async function loadConfigIfAdmin() {
      const sec = document.getElementById('configSection');
      if (!sec) return;
      const res = await fetch('/api/config', { credentials: 'same-origin' });
      if (!res.ok) return;
      const { config } = await res.json();
      document.getElementById('cfgAdminRoles').value = (config.staffRoles?.adminRoleIds || []).join(', ');
      document.getElementById('cfgModRoles').value = (config.staffRoles?.moderatorRoleIds || []).join(', ');
      document.getElementById('cfgTrialRoles').value = (config.staffRoles?.trialModRoleIds || []).join(', ');
      document.getElementById('cfgVerifiedRole').value = config.roles?.verifiedRoleId || '';
      document.getElementById('cfgMutedRole').value = config.roles?.mutedRoleId || '';
      document.getElementById('cfgAppsOpen').checked = Boolean(config.applications?.open);
      document.getElementById('cfgAutoMod').checked = Boolean(config.autoMod?.enabled);
    }

    document.body.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      try {
        if (btn.dataset.appReview) {
          const notes = window.prompt('Review feedback notes (optional):') || '';
          await apiPost('/api/applications/' + encodeURIComponent(btn.dataset.appReview) + '/review', {
            decision: btn.dataset.decision,
            notes,
          });
          notify('Application updated.');
          await loadOverview();
          await loadAudits();
        }
        if (btn.dataset.claimTicket) {
          await apiPost('/api/tickets/' + encodeURIComponent(btn.dataset.claimTicket) + '/claim', {});
          notify('Ticket claimed.');
          await loadOverview();
        }
        if (btn.dataset.closeTicket) {
          const reason = window.prompt('Enter ticket close reason:');
          if (!reason) return;
          await apiPost('/api/tickets/' + encodeURIComponent(btn.dataset.closeTicket) + '/close', { reason });
          notify('Ticket closed and transcript archived.');
          await loadOverview();
        }
      } catch (err) {
        notify(err.message, true);
      }
    });

    document.getElementById('issueWarnBtn').addEventListener('click', async () => {
      try {
        await apiPost('/api/moderation/warn', {
          targetUserId: document.getElementById('warnUserId').value.trim(),
          reason: document.getElementById('warnReason').value.trim(),
        });
        notify('Official Warning Case File issued.');
        await loadOverview();
        await loadAudits();
      } catch (err) { notify(err.message, true); }
    });

    document.getElementById('searchAuditsBtn').addEventListener('click', loadAudits);
    document.getElementById('refreshAllBtn').addEventListener('click', () => { loadOverview(); loadAudits(); });

    const saveCfgBtn = document.getElementById('saveConfigBtn');
    if (saveCfgBtn) {
      saveCfgBtn.addEventListener('click', async () => {
        const splitIds = (id) => document.getElementById(id).value.split(',').map((s) => s.trim()).filter(Boolean);
        try {
          await apiPost('/api/config', {
            adminRoleIds: splitIds('cfgAdminRoles'),
            moderatorRoleIds: splitIds('cfgModRoles'),
            trialModRoleIds: splitIds('cfgTrialRoles'),
            verifiedRoleId: document.getElementById('cfgVerifiedRole').value.trim() || null,
            mutedRoleId: document.getElementById('cfgMutedRole').value.trim() || null,
            applicationsOpen: document.getElementById('cfgAppsOpen').checked,
            autoModEnabled: document.getElementById('cfgAutoMod').checked,
          });
          notify('MurderMystery2 Server Configuration saved.');
          await loadAudits();
        } catch (err) { notify(err.message, true); }
      });
    }

    document.getElementById('logoutBtn').addEventListener('click', async () => {
      await fetch('/auth/logout', { method: 'POST', headers: { 'x-csrf-token': csrf }, credentials: 'same-origin' });
      window.location.href = '/login';
    });

    loadOverview();
    loadAudits();
    loadConfigIfAdmin();
  </script>
</body>
</html>`;
}
