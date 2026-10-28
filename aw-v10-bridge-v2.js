/* AW V10 bridge v2 — guarded API adapter; explicit writes only; no automatic migration or sync. */
(function (root) {
  'use strict';
  const state = { baseUrl: '', token: '', companyId: '', deviceId: '', lastHealth: null };
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const currencyRe = /^[A-Z]{3}$/;

  function configure(opts = {}) {
    const raw = String(opts.baseUrl || '').trim();
    if (!raw) throw new Error('V10_API_BASE_REQUIRED');
    const u = new URL(raw, root.location.href);
    if (u.username || u.password || u.hash || u.search || (u.pathname !== '/' && u.pathname !== '')) throw new Error('V10_API_URL_INVALID');
    if (u.origin !== root.location.origin) throw new Error('V10_API_MUST_BE_SAME_ORIGIN');
    if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') throw new Error('V10_API_HTTPS_REQUIRED');
    state.baseUrl = u.origin;
    if (opts.companyId !== undefined) {
      const id = String(opts.companyId || '').trim();
      if (id && !uuidRe.test(id)) throw new Error('V10_COMPANY_UUID_INVALID');
      state.companyId = id;
    }
    if (opts.deviceId !== undefined) {
      const id = String(opts.deviceId || '').trim();
      if (id.length > 128 || /[\r\n]/.test(id)) throw new Error('V10_DEVICE_ID_INVALID');
      state.deviceId = id;
    }
    return status();
  }
  function status() {
    return Object.freeze({ configured: !!state.baseUrl, authenticated: !!state.token, companyConfigured: !!state.companyId, mode: 'EXPLICIT_API_CALLS_ONLY', apiBase: state.baseUrl || null, lastHealth: state.lastHealth });
  }
  async function request(path, opts = {}) {
    if (!state.baseUrl) throw new Error('V10_BRIDGE_NOT_CONFIGURED');
    if (!path.startsWith('/api/') && !path.startsWith('/health/')) throw new Error('V10_PATH_NOT_ALLOWED');
    const headers = new Headers(opts.headers || {});
    headers.set('Accept', 'application/json');
    if (opts.body !== undefined) headers.set('Content-Type', 'application/json');
    if (state.token && opts.auth !== false) headers.set('Authorization', 'Bearer ' + state.token);
    if (state.deviceId) headers.set('X-Device-ID', state.deviceId);
    const response = await fetch(state.baseUrl + path, { method: opts.method || 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), cache: 'no-store', credentials: 'omit', redirect: 'error' });
    const raw = await response.text(); let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch (_) { throw new Error('V10_RESPONSE_NOT_JSON'); }
    if (!response.ok) { const err = new Error((body && body.error) || ('V10_HTTP_' + response.status)); err.status = response.status; err.details = body && body.details; throw err; }
    return body;
  }
  async function health() {
    const live = await request('/health/live', { auth: false });
    let ready;
    try { ready = await request('/health/ready', { auth: false }); }
    catch (e) { ready = { status: 'not_ready', error: e.message }; }
    state.lastHealth = { checkedAt: new Date().toISOString(), live, ready };
    return state.lastHealth;
  }
  async function login(username, password) {
    if (!String(username || '').trim() || !String(password || '')) throw new Error('V10_CREDENTIALS_REQUIRED');
    const body = await request('/api/auth/login', { method: 'POST', auth: false, body: { username: String(username).trim(), password: String(password) } });
    if (!body || typeof body.access_token !== 'string' || !body.access_token) throw new Error('V10_LOGIN_RESPONSE_INVALID');
    state.token = body.access_token; // memory only; never localStorage/sessionStorage
    return { user: body.user || null, expiresIn: body.expires_in || null, status: status() };
  }
  function logout() { state.token = ''; return status(); }
  async function listDocuments(options = {}) {
    if (!state.companyId || !uuidRe.test(state.companyId)) throw new Error('V10_COMPANY_ID_REQUIRED');
    const params = new URLSearchParams();
    params.set('limit', String(Math.max(1, Math.min(100, Number(options.limit) || 50))));
    if (options.before) params.set('before', String(options.before));
    return request('/api/companies/' + encodeURIComponent(state.companyId) + '/documents?' + params.toString());
  }
  function scaled4(value, field) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('V10_AMOUNT_MUST_BE_NONNEGATIVE_NUMBER:' + field);
    const s = String(value);
    if (!/^(?:0|[1-9]\d{0,19})(?:\.\d{1,4})?$/.test(s)) throw new Error('V10_AMOUNT_PRECISION_INVALID:' + field);
    const parts = s.split('.');
    return BigInt(parts[0]) * 10000n + BigInt(((parts[1] || '') + '0000').slice(0, 4));
  }
  function validateDocumentPayload(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('V10_DOCUMENT_PAYLOAD_INVALID');
    if (typeof p.docType !== 'string' || !p.docType.trim() || p.docType.length > 40) throw new Error('V10_DOC_TYPE_INVALID');
    if (typeof p.docNo !== 'string' || !p.docNo.trim() || p.docNo.length > 80) throw new Error('V10_DOC_NO_INVALID');
    if (typeof p.currency !== 'string' || !currencyRe.test(p.currency)) throw new Error('V10_CURRENCY_INVALID');
    if (typeof p.exchangeRate !== 'number' || !Number.isFinite(p.exchangeRate) || p.exchangeRate <= 0) throw new Error('V10_EXCHANGE_RATE_INVALID');
    if (!uuidRe.test(String(p.idempotencyKey || ''))) throw new Error('V10_IDEMPOTENCY_UUID_REQUIRED');
    if (!p.payload || typeof p.payload !== 'object' || Array.isArray(p.payload)) throw new Error('V10_PAYLOAD_OBJECT_REQUIRED');
    if (!Array.isArray(p.lines) || p.lines.length < 2 || p.lines.length > 500) throw new Error('V10_DOCUMENT_LINES_INVALID');
    let debit = 0n, credit = 0n;
    for (let i = 0; i < p.lines.length; i++) {
      const l = p.lines[i];
      if (!l || typeof l !== 'object' || !uuidRe.test(String(l.accountId || ''))) throw new Error('V10_ACCOUNT_UUID_INVALID:' + i);
      if (typeof l.currency !== 'string' || !currencyRe.test(l.currency)) throw new Error('V10_LINE_CURRENCY_INVALID:' + i);
      const d = scaled4(l.debit, 'debit'), c = scaled4(l.credit, 'credit');
      const bd = scaled4(l.baseDebit, 'baseDebit'), bc = scaled4(l.baseCredit, 'baseCredit');
      if (!((d === 0n && c > 0n) || (c === 0n && d > 0n))) throw new Error('V10_LINE_DEBIT_CREDIT_INVALID:' + i);
      if (!((bd === 0n && bc > 0n) || (bc === 0n && bd > 0n))) throw new Error('V10_BASE_LINE_DEBIT_CREDIT_INVALID:' + i);
      if (l.description !== undefined && (typeof l.description !== 'string' || l.description.length > 500)) throw new Error('V10_LINE_DESCRIPTION_INVALID:' + i);
      debit += bd; credit += bc;
    }
    if (debit !== credit) throw new Error('V10_BASE_CURRENCY_NOT_BALANCED');
    return p;
  }
  async function postDocument(payload) {
    if (!state.companyId || !uuidRe.test(state.companyId)) throw new Error('V10_COMPANY_ID_REQUIRED');
    const safe = validateDocumentPayload(payload);
    return request('/api/companies/' + encodeURIComponent(state.companyId) + '/documents', { method: 'POST', body: safe });
  }
  // Read-only diagnostic. It never writes to the supplied SQL.js database.
  function localMigrationPreview(sqlDb) {
    if (!sqlDb || typeof sqlDb.exec !== 'function') throw new Error('SQLJS_DATABASE_HANDLE_REQUIRED');
    const tables = ['clients','suppliers','treasuries','documents','journal','audit_log','audit_chain','sync_outbox'];
    const counts = {};
    for (const table of tables) {
      const exists = sqlDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table]);
      if (!exists.length || !exists[0].values.length) { counts[table] = { exists: false, count: null }; continue; }
      const rows = sqlDb.exec('SELECT COUNT(*) FROM "' + table + '"');
      counts[table] = { exists: true, count: Number(rows[0].values[0][0]) };
    }
    const journal = counts.journal.exists ? sqlDb.exec('SELECT COUNT(*), COALESCE(ROUND(SUM(amount),4),0), COALESCE(ROUND(SUM(base_amount),4),0) FROM journal') : [];
    const docs = counts.documents.exists ? sqlDb.exec('SELECT currency, COUNT(*), COALESCE(ROUND(SUM(amount),4),0), COALESCE(ROUND(SUM(base_amount),4),0) FROM documents GROUP BY currency ORDER BY currency') : [];
    return { readOnly: true, generatedAt: new Date().toISOString(), counts, journal: journal.length ? { rows: Number(journal[0].values[0][0]), sumAmount: Number(journal[0].values[0][1]), sumBaseAmount: Number(journal[0].values[0][2]) } : null, documentsByCurrency: docs.length ? docs[0].values.map(r => ({ currency: r[0], count: Number(r[1]), sumAmount: Number(r[2]), sumBaseAmount: Number(r[3]) })) : [] };
  }
  root.AWV10Bridge = Object.freeze({ configure, status, health, login, logout, listDocuments, validateDocumentPayload, postDocument, localMigrationPreview });
  function addStatusPanel() {
    const settings = root.document && root.document.getElementById('tab-settings');
    if (!settings || root.document.getElementById('awV10BridgePanel')) return;
    const panel = root.document.createElement('section'); panel.id = 'awV10BridgePanel'; panel.className = 'card'; panel.dir = 'rtl';
    panel.innerHTML = '<h3>جسر AW V10 — فحص تكامل آمن</h3><p class="muted">هذه طبقة فحص وطلبات صريحة فقط. لا تهاجر البيانات ولا تزامن المستندات تلقائياً. يلزم نشر الخادم وتكوين الحسابات والشركة قبل أي ترحيل.</p><label for="awV10ApiBase">عنوان API (نفس الأصل فقط)</label><input id="awV10ApiBase" inputmode="url" placeholder="https://accounting.example" autocomplete="url"><div class="op-actions"><button type="button" id="awV10Check">فحص جاهزية الخادم</button><button type="button" class="secondary" id="awV10Logout">إنهاء جلسة الجسر</button></div><p id="awV10Status" role="status" aria-live="polite">غير مهيأ — التخزين المحلي لم يتغير.</p>';
    settings.appendChild(panel);
    panel.querySelector('#awV10Check').addEventListener('click', async function () {
      const out = panel.querySelector('#awV10Status'); this.disabled = true;
      try { configure({ baseUrl: panel.querySelector('#awV10ApiBase').value }); const h = await health(); out.className = h.ready && h.ready.status === 'ready' ? 'success' : 'error'; out.textContent = 'LIVE: ' + String(h.live.status) + ' | READY: ' + String(h.ready.status) + (h.ready.error ? ' (' + h.ready.error + ')' : ''); }
      catch (e) { out.className = 'error'; out.textContent = 'فشل الفحص: ' + String(e.message || e); }
      finally { this.disabled = false; }
    });
    panel.querySelector('#awV10Logout').addEventListener('click', function () { logout(); panel.querySelector('#awV10Status').textContent = 'تم إنهاء رمز جلسة الجسر من الذاكرة فقط.'; });
  }
  if (root.document) { if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', addStatusPanel, { once: true }); else addStatusPanel(); }
})(window);
