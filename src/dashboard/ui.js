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
  <title>Yapin Middleman Staff Console — Login</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #0d1117; color: #e6edf3; display: grid; place-items: center; min-height: 100vh; }
    .card { max-width: 460px; width: 92%; background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 2rem; box-shadow: 0 12px 32px rgba(0,0,0,0.45); }
    h1 { margin: 0 0 0.5rem; font-size: 1.35rem; }
    p { color: #8b949e; line-height: 1.5; font-size: 0.94rem; }
    .err { background: rgba(248,81,73,0.15); border: 1px solid #f85149; color: #ffa198; padding: 0.75rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem; }
    .btn { display: inline-block; width: 100%; box-sizing: border-box; text-align: center; background: #5865f2; color: #fff; text-decoration: none; font-weight: 600; padding: 0.8rem 1rem; border-radius: 8px; margin-top: 0.75rem; }
    .btn:hover { background: #4752c4; }
    .notice { margin-top: 1.25rem; font-size: 0.8rem; color: #8b949e; border-top: 1px solid #21262d; padding-top: 0.85rem; }
  </style>
</head>
<body>
  <main class="card">
    <h1>🛡️ Yapin Middleman Staff Console</h1>
    <p>Authenticate with your verified <strong>Yapin.gg</strong> account (<code>identify</code> OAuth2 + PKCE). Access is restricted server-side to authorized server staff roles.</p>
    ${errorMsg ? `<div class="err">${escapeHtml(errorMsg)}</div>` : ''}
    <a class="btn" href="/auth/login">Login with Yapin'</a>
    <div class="notice">Bot credentials are isolated on the server and never exposed to browsers. Non-custodial coordination &amp; audit console.</div>
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
  <title>Yapin Middleman Staff Dashboard</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #0d1117; color: #e6edf3; }
    header { display: flex; justify-content: space-between; align-items: center; padding: 0.95rem 1.5rem; background: #161b22; border-bottom: 1px solid #30363d; flex-wrap: wrap; gap: 0.75rem; }
    .badge { background: #238636; color: #fff; padding: 0.2rem 0.55rem; border-radius: 999px; font-size: 0.78rem; font-weight: 600; }
    main { max-width: 1320px; margin: 1.4rem auto; padding: 0 1.25rem 3rem; display: grid; gap: 1.25rem; }
    .grid-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.9rem; }
    .stat, section { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 1rem 1.2rem; }
    .stat h3 { margin: 0; font-size: 0.8rem; color: #8b949e; text-transform: uppercase; letter-spacing: 0.03em; }
    .stat strong { display: block; margin-top: 0.35rem; font-size: 1.55rem; }
    h2 { margin: 0 0 0.75rem; font-size: 1.05rem; display: flex; justify-content: space-between; align-items: center; }
    table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
    th, td { text-align: left; padding: 0.55rem 0.5rem; border-bottom: 1px solid #21262d; vertical-align: middle; }
    th { color: #8b949e; font-weight: 600; }
    button, input, select, textarea { background: #0d1117; color: #e6edf3; border: 1px solid #30363d; border-radius: 6px; padding: 0.42rem 0.65rem; font-size: 0.84rem; font-family: inherit; }
    button { background: #21262d; cursor: pointer; font-weight: 600; }
    button:hover { background: #30363d; }
    button.primary { background: #238636; border-color: #2ea043; color: #fff; }
    button.danger { background: #da3633; border-color: #f85149; color: #fff; }
    .toolbar { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap; align-items: center; }
    .toast { position: fixed; bottom: 1.25rem; right: 1.25rem; background: #1f6feb; color: #fff; padding: 0.7rem 1rem; border-radius: 8px; display: none; z-index: 50; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
    .drawer { background: #0d1117; border: 1px solid #5865f2; border-radius: 10px; padding: 1.1rem; display: none; }
    .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.85rem; margin-top: 0.75rem; }
    .box { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 0.85rem; }
    .box h4 { margin: 0 0 0.5rem; font-size: 0.9rem; }
    code { background: #0d1117; padding: 0.12rem 0.35rem; border-radius: 4px; font-size: 0.8rem; }
  </style>
</head>
<body>
  <header>
    <div>
      <strong>🛡️ Yapin Middleman Staff Console</strong>
      <span class="badge">Staff Tier ${escapeHtml(session.staffTier)}</span>
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
      <div class="stat"><h3>Active Trades</h3><strong id="stActive">-</strong></div>
      <div class="stat"><h3>Deposit Verification Queue</h3><strong id="stDepositQueue">-</strong></div>
      <div class="stat"><h3>Open Disputes (Frozen)</h3><strong id="stDisputes">-</strong></div>
      <div class="stat"><h3>Open Tickets</h3><strong id="stTickets">-</strong></div>
    </div>

    <div id="tradeDetailDrawer" class="drawer">
      <h2>
        <span id="detailTitle">Trade Detail</span>
        <button id="closeDetailBtn" type="button">Close</button>
      </h2>
      <pre id="detailSummary" style="white-space:pre-wrap;font-size:0.82rem;color:#c9d1d9;margin:0;"></pre>
      <div class="form-grid">
        <div class="box">
          <h4>Assign / Reassign Middleman</h4>
          <div class="toolbar">
            <input id="assignMmId" placeholder="Middleman Yapin UUID" style="width:100%" />
            <input id="assignReason" placeholder="Assignment reason" style="width:100%" />
            <label style="font-size:0.8rem;"><input type="checkbox" id="assignReassignFlag" /> Reassign existing</label>
            <button id="submitAssignBtn" class="primary" type="button">Save Assignment</button>
          </div>
        </div>
        <div class="box">
          <h4>Verify / Reject Deposit</h4>
          <div class="toolbar">
            <select id="depSide"><option value="A">Trader A</option><option value="B">Trader B</option></select>
            <select id="depDecision">
              <option value="CONFIRMED">CONFIRMED</option>
              <option value="REJECTED">REJECTED</option>
              <option value="UNDER_REVIEW">UNDER_REVIEW</option>
              <option value="NOT_REQUIRED">NOT_REQUIRED</option>
            </select>
            <input id="depNotes" placeholder="Verification notes" style="width:100%" />
            <button id="submitVerifyDepBtn" class="primary" type="button">Record Verification</button>
          </div>
        </div>
        <div class="box">
          <h4>Finalize or Cancel Trade</h4>
          <div class="toolbar">
            <input id="completeNotes" placeholder="Completion or cancellation notes (min 10 chars)" style="width:100%" />
            <button id="submitCompleteBtn" class="primary" type="button">Complete Trade</button>
            <button id="submitCancelTradeBtn" class="danger" type="button">Force Cancel</button>
          </div>
        </div>
      </div>
    </div>

    <section>
      <h2>Active Trades &amp; Deposit Queue</h2>
      <table id="tradesTable">
        <thead><tr><th>Trade ID</th><th>State</th><th>Asset</th><th>Trader A / B</th><th>Deposits (A / B)</th><th>Middleman</th><th>Action</th></tr></thead>
        <tbody><tr><td colspan="7">Loading...</td></tr></tbody>
      </table>
    </section>

    <section>
      <h2>Open Disputes Queue (Frozen Trades)</h2>
      <table id="disputesTable">
        <thead><tr><th>Dispute ID</th><th>Trade ID</th><th>Reporter</th><th>Status</th><th>Reason</th><th>Staff Resolution</th></tr></thead>
        <tbody><tr><td colspan="6">Loading...</td></tr></tbody>
      </table>
    </section>

    <section>
      <h2>Open Private Tickets</h2>
      <table id="ticketsTable">
        <thead><tr><th>Ticket ID</th><th>Type</th><th>Status</th><th>Creator</th><th>Assigned Staff</th><th>Subject</th><th>Actions</th></tr></thead>
        <tbody><tr><td colspan="7">Loading...</td></tr></tbody>
      </table>
    </section>

    <section>
      <h2>Staff Middleman Workload &amp; Stats</h2>
      <table id="staffTable">
        <thead><tr><th>Staff UUID</th><th>Username</th><th>Availability</th><th>Active Load</th><th>Completed as MM</th></tr></thead>
        <tbody><tr><td colspan="5">Loading...</td></tr></tbody>
      </table>
    </section>

    <section>
      <h2>Searchable Append-Only Audit Logs</h2>
      <div class="toolbar">
        <input id="auditAction" placeholder="Action (e.g. TRADE_COMPLETED)" />
        <input id="auditActor" placeholder="Actor UUID" />
        <input id="auditTarget" placeholder="Target ID (TRD-... / TKT-...)" />
        <input id="auditCorr" placeholder="Correlation ID" />
        <button id="searchAuditsBtn" type="button">Search</button>
        <button id="prevAuditPageBtn" type="button">Prev</button>
        <span id="auditPageLabel" style="font-size:0.84rem;color:#8b949e;">Page 1</span>
        <button id="nextAuditPageBtn" type="button">Next</button>
      </div>
      <table id="auditsTable">
        <thead><tr><th>Timestamp</th><th>Audit ID</th><th>Action</th><th>Actor</th><th>Target</th><th>Correlation</th></tr></thead>
        <tbody><tr><td colspan="6">Loading...</td></tr></tbody>
      </table>
    </section>

    ${
      isAdmin
        ? `<section id="configSection">
      <h2>⚙️ Admin Server Configuration</h2>
      <div class="form-grid">
        <div class="box">
          <h4>Staff Role IDs (comma-separated)</h4>
          <label style="font-size:0.8rem;">Middleman Roles</label>
          <input id="cfgMmRoles" style="width:100%;margin-bottom:0.45rem;" />
          <label style="font-size:0.8rem;">Moderator Roles</label>
          <input id="cfgModRoles" style="width:100%;margin-bottom:0.45rem;" />
          <label style="font-size:0.8rem;">Admin Roles</label>
          <input id="cfgAdminRoles" style="width:100%;" />
        </div>
        <div class="box">
          <h4>Channels &amp; Limits</h4>
          <label style="font-size:0.8rem;">Staff Alert Channel ID</label>
          <input id="cfgAlertCh" style="width:100%;margin-bottom:0.45rem;" />
          <label style="font-size:0.8rem;">Audit Log Channel ID</label>
          <input id="cfgAuditCh" style="width:100%;margin-bottom:0.45rem;" />
          <label style="font-size:0.8rem;"><input type="checkbox" id="cfgAutoAssign" /> Enable Workload Auto-Assignment</label>
          <div style="margin-top:0.65rem;"><button id="saveConfigBtn" class="primary" type="button">Save Server Config</button></div>
        </div>
      </div>
    </section>`
        : ''
    }
  </main>

  <script>
    const csrf = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    let selectedTradeId = null;
    let auditPage = 1;

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

    async function inspectTrade(tradeId) {
      const res = await fetch('/api/trades/' + encodeURIComponent(tradeId), { credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok) return notify(data.error || 'Failed to load trade detail', true);
      selectedTradeId = data.trade.tradeId;
      document.getElementById('detailTitle').textContent = 'Trade ' + data.trade.tradeId + ' (' + data.trade.state + ')';
      document.getElementById('detailSummary').textContent = JSON.stringify({
        items: data.trade.items,
        confirmations: data.trade.confirmations,
        deposits: data.trade.deposits,
        assignedMiddlemanId: data.trade.assignedMiddlemanId,
        activeDisputeId: data.trade.activeDisputeId,
        stateHistory: (data.trade.stateHistory || []).slice(-6),
      }, null, 2);
      document.getElementById('tradeDetailDrawer').style.display = 'block';
    }

    async function loadOverview() {
      const res = await fetch('/api/overview', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      document.getElementById('stActive').textContent = data.activeTrades.length;
      document.getElementById('stDepositQueue').textContent = data.depositQueue.length;
      document.getElementById('stDisputes').textContent = data.openDisputes.length;
      document.getElementById('stTickets').textContent = data.openTickets.length;

      document.querySelector('#tradesTable tbody').innerHTML = data.activeTrades.length === 0
        ? '<tr><td colspan="7">No active trades.</td></tr>'
        : data.activeTrades.map((t) =>
            '<tr><td><code>' + esc(t.tradeId) + '</code></td><td><code>' + esc(t.state) + '</code></td><td>' +
            esc(t.items?.primaryAsset) + '</td><td><code>' + esc(t.traderAId) + '</code> / <code>' + esc(t.traderBId) +
            '</code></td><td><code>' + esc(t.deposits?.traderA?.status) + ' / ' + esc(t.deposits?.traderB?.status) +
            '</code></td><td><code>' + esc(t.assignedMiddlemanId || 'Unassigned') +
            '</code></td><td><button type="button" data-inspect-trade="' + esc(t.tradeId) + '">Inspect / Act</button></td></tr>'
          ).join('');

      document.querySelector('#disputesTable tbody').innerHTML = data.openDisputes.length === 0
        ? '<tr><td colspan="6">No open disputes.</td></tr>'
        : data.openDisputes.map((d) =>
            '<tr><td><code>' + esc(d.disputeId) + '</code></td><td><code>' + esc(d.tradeId) + '</code></td><td><code>' +
            esc(d.reporterId) + '</code></td><td><code>' + esc(d.status) + '</code></td><td>' + esc(d.reason) +
            '</td><td><button type="button" data-resolve-dispute="' + esc(d.disputeId) + '" data-outcome="RESUME_TRADE">Resume</button> ' +
            '<button type="button" class="danger" data-resolve-dispute="' + esc(d.disputeId) + '" data-outcome="CANCEL_TRADE">Cancel Trade</button></td></tr>'
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

      document.querySelector('#staffTable tbody').innerHTML = data.staffStats.length === 0
        ? '<tr><td colspan="5">No middleman stats recorded yet.</td></tr>'
        : data.staffStats.map((s) =>
            '<tr><td><code>' + esc(s.yapinUserId) + '</code></td><td>' + esc(s.lastKnownUsername || '-') + '</td><td>' +
            (s.staffAvailability?.available ? '🟢 Available' : '⚪ Offline') + '</td><td>' +
            esc(s.tradeStats?.activeMiddlemanLoad || 0) + '</td><td>' + esc(s.tradeStats?.asMiddlemanCompleted || 0) + '</td></tr>'
          ).join('');
    }

    async function loadAudits() {
      const qs = new URLSearchParams({ page: String(auditPage), limit: '20' });
      const action = document.getElementById('auditAction').value.trim();
      const actorId = document.getElementById('auditActor').value.trim();
      const targetId = document.getElementById('auditTarget').value.trim();
      const correlationId = document.getElementById('auditCorr').value.trim();
      if (action) qs.set('action', action);
      if (actorId) qs.set('actorId', actorId);
      if (targetId) qs.set('targetId', targetId);
      if (correlationId) qs.set('correlationId', correlationId);

      const res = await fetch('/api/audits?' + qs.toString(), { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      document.getElementById('auditPageLabel').textContent = 'Page ' + data.page + ' (' + data.total + ' total)';
      document.querySelector('#auditsTable tbody').innerHTML = data.items.length === 0
        ? '<tr><td colspan="6">No audit entries matched.</td></tr>'
        : data.items.map((a) =>
            '<tr><td>' + esc(a.timestamp) + '</td><td><code>' + esc(a.auditId) + '</code></td><td><code>' +
            esc(a.action) + '</code></td><td><code>' + esc(a.actorId) + '</code></td><td><code>' +
            esc(a.targetType + ':' + a.targetId) + '</code></td><td><code>' + esc(a.correlationId || '-') + '</code></td></tr>'
          ).join('');
    }

    async function loadConfigIfAdmin() {
      const sec = document.getElementById('configSection');
      if (!sec) return;
      const res = await fetch('/api/config', { credentials: 'same-origin' });
      if (!res.ok) return;
      const { config } = await res.json();
      document.getElementById('cfgMmRoles').value = (config.staffRoles?.middlemanRoleIds || []).join(', ');
      document.getElementById('cfgModRoles').value = (config.staffRoles?.moderatorRoleIds || []).join(', ');
      document.getElementById('cfgAdminRoles').value = (config.staffRoles?.adminRoleIds || []).join(', ');
      document.getElementById('cfgAlertCh').value = config.channels?.alertChannelId || '';
      document.getElementById('cfgAuditCh').value = config.channels?.auditLogChannelId || '';
      document.getElementById('cfgAutoAssign').checked = Boolean(config.tradeLimits?.autoAssignMiddleman);
    }

    document.body.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      try {
        if (btn.dataset.inspectTrade) return await inspectTrade(btn.dataset.inspectTrade);
        if (btn.dataset.resolveDispute) {
          const decisionSummary = window.prompt('Enter documented dispute resolution summary (min 10 chars):');
          if (!decisionSummary) return;
          await apiPost('/api/disputes/' + encodeURIComponent(btn.dataset.resolveDispute) + '/resolve', {
            outcome: btn.dataset.outcome,
            decisionSummary,
            confirm: true,
          });
          notify('Dispute resolved.');
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
          notify('Ticket closed and transcript recorded.');
          await loadOverview();
        }
      } catch (err) {
        notify(err.message, true);
      }
    });

    document.getElementById('closeDetailBtn').addEventListener('click', () => {
      document.getElementById('tradeDetailDrawer').style.display = 'none';
    });

    document.getElementById('submitAssignBtn').addEventListener('click', async () => {
      if (!selectedTradeId) return;
      try {
        await apiPost('/api/trades/' + encodeURIComponent(selectedTradeId) + '/assign', {
          targetMiddlemanId: document.getElementById('assignMmId').value.trim(),
          reason: document.getElementById('assignReason').value.trim() || 'Assigned via dashboard',
          reassign: document.getElementById('assignReassignFlag').checked,
        });
        notify('Middleman assignment updated.');
        await inspectTrade(selectedTradeId);
        await loadOverview();
      } catch (err) { notify(err.message, true); }
    });

    document.getElementById('submitVerifyDepBtn').addEventListener('click', async () => {
      if (!selectedTradeId) return;
      try {
        await apiPost('/api/trades/' + encodeURIComponent(selectedTradeId) + '/verify-deposit', {
          traderSideOrUserId: document.getElementById('depSide').value,
          decision: document.getElementById('depDecision').value,
          notes: document.getElementById('depNotes').value.trim(),
        });
        notify('Deposit verification saved.');
        await inspectTrade(selectedTradeId);
        await loadOverview();
      } catch (err) { notify(err.message, true); }
    });

    document.getElementById('submitCompleteBtn').addEventListener('click', async () => {
      if (!selectedTradeId) return;
      try {
        await apiPost('/api/trades/' + encodeURIComponent(selectedTradeId) + '/complete', {
          decisionNotes: document.getElementById('completeNotes').value.trim(),
          confirm: true,
        });
        notify('Trade marked COMPLETED!');
        await inspectTrade(selectedTradeId);
        await loadOverview();
      } catch (err) { notify(err.message, true); }
    });

    document.getElementById('submitCancelTradeBtn').addEventListener('click', async () => {
      if (!selectedTradeId) return;
      try {
        await apiPost('/api/trades/' + encodeURIComponent(selectedTradeId) + '/cancel', {
          reason: document.getElementById('completeNotes').value.trim(),
          confirm: true,
        });
        notify('Trade cancelled by staff.');
        await inspectTrade(selectedTradeId);
        await loadOverview();
      } catch (err) { notify(err.message, true); }
    });

    document.getElementById('searchAuditsBtn').addEventListener('click', () => { auditPage = 1; loadAudits(); });
    document.getElementById('prevAuditPageBtn').addEventListener('click', () => { if (auditPage > 1) { auditPage--; loadAudits(); } });
    document.getElementById('nextAuditPageBtn').addEventListener('click', () => { auditPage++; loadAudits(); });
    document.getElementById('refreshAllBtn').addEventListener('click', () => { loadOverview(); loadAudits(); });

    const saveCfgBtn = document.getElementById('saveConfigBtn');
    if (saveCfgBtn) {
      saveCfgBtn.addEventListener('click', async () => {
        const splitIds = (id) => document.getElementById(id).value.split(',').map((s) => s.trim()).filter(Boolean);
        try {
          await apiPost('/api/config', {
            middlemanRoleIds: splitIds('cfgMmRoles'),
            moderatorRoleIds: splitIds('cfgModRoles'),
            adminRoleIds: splitIds('cfgAdminRoles'),
            alertChannelId: document.getElementById('cfgAlertCh').value.trim() || null,
            auditLogChannelId: document.getElementById('cfgAuditCh').value.trim() || null,
            autoAssignMiddleman: document.getElementById('cfgAutoAssign').checked,
          });
          notify('Server configuration saved.');
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
