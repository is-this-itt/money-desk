// Money Desk: UI. All data stays in this browser's localStorage.
(function () {
  'use strict';
  const MD = window.MD;
  const KEY = 'moneydesk.v1';
  const PREF = 'moneydesk.prefs';
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = v => inr0.format(Math.round(v));
  const short = v => { const a = Math.abs(v); return a >= 1e7 ? '₹' + (v / 1e7).toFixed(1) + 'Cr' : a >= 1e5 ? '₹' + (v / 1e5).toFixed(1) + 'L' : a >= 1e3 ? '₹' + (v / 1e3).toFixed(0) + 'k' : '₹' + Math.round(v); };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Both return HTML-safe text even if the stored value is not a real date.
  const fmtDate = d => { const [y, m, dd] = String(d).split('-'); return esc(`${+dd} ${MON[+m - 1]} ${y}`); };
  const monthLabel = ym => { const [y, m] = String(ym).split('-'); return esc(`${MON[+m - 1]} ${String(y).slice(2)}`); };
  const kindOf = cat => (MD.CAT_BY_NAME[cat] || { kind: 'spend' }).kind;
  const SVC_TYPES = ['Bank account', 'Credit card', 'Subscription', 'Mandate / autopay', 'SIP / investment', 'Insurance', 'Loan / EMI', 'Other'];
  const SVC_FREQ = ['Monthly', 'Quarterly', 'Yearly', 'One-time', 'None'];
  const PER_MONTH = { Monthly: 1, Quarterly: 1 / 3, Yearly: 1 / 12 };
  const newId = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(0, 20);

  // ---------- State ----------
  let db = load();
  let prefs = Object.assign({ view: 'overview', period: '6m', account: 'all' }, readJSON(PREF) || {});
  let txFilter = { q: '', category: 'all', kind: 'all', limit: 300 };
  let pending = null; // import preview

  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function load() { return sanitize(readJSON(KEY) || {}); }

  // Everything loaded from the cache, the data file or a backup goes through here, so a
  // tampered file can only contain plain dates, numbers and short strings.
  function sanitize(d) {
    const str = (v, max) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
    const txns = [];
    for (const t of Array.isArray(d && d.txns) ? d.txns : []) {
      if (!t || typeof t !== 'object') continue;
      const date = str(t.date, 10), amount = Number(t.amount);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isFinite(amount)) continue;
      const category = MD.CAT_BY_NAME[t.category] ? t.category : (amount > 0 ? 'Other income' : 'Other');
      const x = { date, amount: Math.round(amount * 100) / 100, desc: str(t.desc, 300), merchant: str(t.merchant, 80) || 'Unknown', account: str(t.account, 60) || 'Unknown', category, source: str(t.source, 200) };
      x.id = typeof t.id === 'string' && /^[a-z0-9]{1,20}$/.test(t.id) ? t.id : MD.txnId(x);
      if (t.manual === true) x.manual = true;
      txns.push(x);
    }
    const rules = Object.create(null);
    if (d && d.rules && typeof d.rules === 'object') for (const [k, v] of Object.entries(d.rules)) if (MD.CAT_BY_NAME[v] && k !== '__proto__') rules[str(k, 80)] = v;
    const accounts = {};
    if (d && d.accounts && typeof d.accounts === 'object') for (const [k, v] of Object.entries(d.accounts)) if (k !== '__proto__') accounts[str(k, 60)] = { kind: v && v.kind === 'card' ? 'card' : 'bank' };
    const services = [];
    for (const v of Array.isArray(d && d.services) ? d.services : []) {
      if (!v || typeof v !== 'object') continue;
      const svc = cleanService(v, str);
      if (svc) services.push(svc);
    }
    return { txns, rules, accounts, services, parserVersion: Number(d && d.parserVersion) || undefined };
  }
  // One entry on My services, from a saved file or the form. Notes are masked like statement
  // lines, so a pasted card or account number is never stored in full.
  function cleanService(v, str) {
    const name = str(v.name, 80).trim();
    if (!name) return null;
    const amount = Number(v.amount), day = Number(v.day);
    return {
      id: typeof v.id === 'string' && /^[a-z0-9]{1,20}$/.test(v.id) ? v.id : newId(),
      type: SVC_TYPES.includes(v.type) ? v.type : 'Other',
      name,
      provider: str(v.provider, 60).trim(),
      last4: /^\d{4}$/.test(v.last4) ? v.last4 : '',
      amount: v.amount !== '' && v.amount != null && isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null,
      freq: SVC_FREQ.includes(v.freq) ? v.freq : 'None',
      day: Number.isInteger(day) && day >= 1 && day <= 31 ? day : null,
      from: str(v.from, 60).trim(),
      notes: MD.redactDesc(str(v.notes, 200)),
      active: v.active !== false,
    };
  }
  // Data is saved to data\money-desk.json by the local helper; localStorage is only a cache
  // so the page opens instantly and survives if the helper is not running.
  let fileMode = false;
  let saving = null, saveAgain = false;
  // The helper gives the window it opens a new key each time it starts (after # in the address).
  const HELPER_KEY = (/[#&]k=([0-9a-f]{16,128})/.exec(location.hash) || [])[1] || '';
  const API = { headers: { 'X-Money-Desk': HELPER_KEY }, cache: 'no-store' };
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* cache only */ }
    if (fileMode) pushToFile();
  }
  function pushToFile() {
    if (saving) { saveAgain = true; return; }
    saving = fetch('/api/data', { method: 'PUT', headers: { 'X-Money-Desk': HELPER_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ app: 'money-desk', version: 1, savedAt: new Date().toISOString(), ...db }) })
      .then(r => { if (!r.ok) throw new Error(r.status); $('#offline').classList.add('hidden'); })
      .catch(() => { $('#offline').classList.remove('hidden'); toast('Could not save to your data file. Your changes are kept in this window; reopen Money Desk to save them.'); })
      .finally(() => { saving = null; if (saveAgain) { saveAgain = false; pushToFile(); } });
  }
  // When the statement reader improves, re-clean names and categories of saved transactions.
  // Categories you picked yourself are kept.
  function refreshParsed() {
    if ((db.parserVersion || 1) >= MD.PARSER_VERSION) return false;
    const seen = new Set();
    db.txns = db.txns.filter(t => {
      const kind = (db.accounts[t.account] || {}).kind || 'bank';
      const oldKey = MD.merchantKey(t.merchant);
      const before = t.desc;
      if (/\.pdf$/i.test(t.source || '')) t.desc = MD.cleanPdfDesc(t.desc, kind);
      const m = MD.extractMerchant(t.desc);
      t.merchant = m.name;
      const key = MD.merchantKey(m.name);
      const own = k => Object.prototype.hasOwnProperty.call(db.rules, k);
      if (own(oldKey) && !own(key) && key !== '__proto__') db.rules[key] = db.rules[oldKey];
      if (!t.manual) {
        let c = MD.categorize(t.desc, m.name, t.amount, db.rules, kind);
        if (c === 'Other' && m.person) c = 'People (UPI)';
        t.category = c;
      }
      // Keep the id unless the line itself was cleaned, so re-imports are still recognised.
      if (t.desc !== before) t.id = MD.txnId(t);
      t.desc = MD.redactDesc(t.desc);
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
    db.parserVersion = MD.PARSER_VERSION;
    return true;
  }

  async function loadFromFile() {
    if (!location.protocol.startsWith('http')) return;
    try {
      const r = await fetch('/api/data', API);
      if (r.status === 404) {
        fileMode = true;
        if (db.txns.length) { pushToFile(); toast(`Moved your ${db.txns.length} transactions into your data file on this laptop.`, null, 5000); }
        render();
        return;
      }
      if (r.status === 403) { $('#offline').classList.remove('hidden'); toast('This window can\'t reach your data file. Close it and open Money Desk from its shortcut.', null, 8000); return; }
      if (!r.ok) return;
      const d = await r.json();
      fileMode = true;
      db = sanitize(d);
      if (refreshParsed()) save();
      else try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* cache only */ }
      render();
    } catch (e) { /* helper not running: stay on the browser cache */ }
  }
  function savePrefs() { try { localStorage.setItem(PREF, JSON.stringify(prefs)); } catch (e) { /* optional */ } }

  // ---------- Periods ----------
  function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function latestDate() { return db.txns.reduce((a, t) => (t.date > a ? t.date : a), '') || today(); }
  function addMonths(ym, n) { let [y, m] = ym.split('-').map(Number); m += n; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return `${y}-${String(m).padStart(2, '0')}`; }
  // Periods anchor on the latest transaction month so old statements still show data.
  function periodRange(p) {
    const end = latestDate().slice(0, 7);
    const span = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 }[p];
    if (p === 'lm') { const m = addMonths(end, -1); return { from: m + '-01', to: m + '-31', months: 1, label: monthLabel(m) }; }
    if (p === 'fy') { const [y, m] = end.split('-').map(Number); const fy = m >= 4 ? y : y - 1; return { from: `${fy}-04-01`, to: `${fy + 1}-03-31`, months: 12, label: `FY ${fy}-${String(fy + 1).slice(2)}` }; }
    if (p === 'all') return { from: '0000', to: '9999', months: 0, label: 'All time' };
    const start = addMonths(end, -(span - 1));
    return { from: start + '-01', to: end + '-31', months: span, label: span === 1 ? monthLabel(end) : `${monthLabel(start)} – ${monthLabel(end)}` };
  }
  function prevRange(r) {
    if (!r.months) return null;
    const s = r.from.slice(0, 7);
    const ps = addMonths(s, -r.months), pe = addMonths(s, -1);
    return { from: ps + '-01', to: pe + '-31' };
  }
  const inRange = (t, r) => t.date >= r.from && t.date <= r.to;
  const byAccount = t => prefs.account === 'all' || t.account === prefs.account;

  function totals(list) {
    const o = { spend: 0, income: 0, invest: 0 };
    for (const t of list) {
      const k = kindOf(t.category);
      if (k === 'spend') o.spend -= t.amount;
      else if (k === 'income') o.income += t.amount;
      else if (k === 'invest') o.invest -= t.amount;
    }
    return o;
  }

  // ---------- Shell ----------
  function setView(v) {
    prefs.view = v; savePrefs();
    document.querySelectorAll('.nav-btn').forEach(b => b.setAttribute('aria-current', b.dataset.view === v ? 'page' : 'false'));
    render();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

  function render() {
    const main = $('#main');
    hideTip();
    if (prefs.view === 'transactions') main.innerHTML = viewTransactions();
    else if (prefs.view === 'import') main.innerHTML = viewImport();
    else if (prefs.view === 'settings') main.innerHTML = viewSettings();
    else if (prefs.view === 'services') main.innerHTML = viewServices();
    else main.innerHTML = viewOverview();
    wire(main);
  }

  function filtersHTML() {
    const accts = [...new Set(db.txns.map(t => t.account))].sort();
    const P = [['1m', 'Latest month'], ['lm', 'Previous month'], ['3m', 'Last 3 months'], ['6m', 'Last 6 months'], ['12m', 'Last 12 months'], ['fy', 'This financial year'], ['all', 'All time']];
    return `<div class="filters">
      <div class="field"><label for="f-period">Period</label><select id="f-period">${P.map(([v, l]) => `<option value="${v}" ${prefs.period === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label for="f-account">Account</label><select id="f-account"><option value="all">All accounts</option>${accts.map(a => `<option ${prefs.account === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></div>
      <button class="icon-btn" id="theme-btn" title="Switch light / dark" aria-label="Switch light or dark theme"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button>
    </div>`;
  }

  function sampleBanner() {
    if (!db.txns.some(t => t.source === 'sample')) return '';
    return `<div class="sample-banner"><span>You're looking at <b>made-up sample data</b>. Import your own statements, then remove it.</span><button class="btn small" data-act="remove-sample">Remove sample data</button></div>`;
  }

  // ---------- Overview ----------
  function viewOverview() {
    if (!db.txns.length) return `
      <div class="top"><div><h1>Overview</h1><div class="sub">Your money, across every account and card</div></div></div>
      <div class="card empty">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none"><rect x="6" y="14" width="52" height="38" rx="8" fill="var(--accent-soft)"/><path d="M16 42V30m10 12V24m10 18v-8m10 8V20" stroke="var(--accent)" stroke-width="4" stroke-linecap="round"/></svg>
        <h2>See where your money goes</h2>
        <p>Import bank and credit card statements (Excel, CSV or PDF). Money Desk sorts every transaction into categories and shows your spending, savings, subscriptions and card charges. It all stays on this laptop.</p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button class="btn primary" data-go="import">Import a statement</button>
          <button class="btn" data-act="load-sample">Try it with sample data</button>
        </div>
      </div>`;

    const r = periodRange(prefs.period);
    const scope = db.txns.filter(byAccount);
    const cur = scope.filter(t => inRange(t, r));
    const pr = prevRange(r);
    const prev = pr ? scope.filter(t => inRange(t, pr)) : [];
    const T = totals(cur), P = totals(prev);
    const rate = T.income > 0 ? Math.round(((T.income - T.spend) / T.income) * 100) : null;
    const hasPrev = prev.length > 0;
    const delta = (a, b) => {
      if (!hasPrev || !b) return '<span class="muted">No earlier period to compare</span>';
      const d = ((a - b) / b) * 100;
      const cls = d > 0 ? 'up' : 'down';
      return `<span class="${cls}">${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(0)}%</span> vs previous ${r.months === 1 ? 'month' : r.months + ' months'}`;
    };
    const months = Math.max(1, new Set(cur.map(t => t.date.slice(0, 7))).size);

    return `
      <div class="top"><div><h1>Overview</h1><div class="sub">${esc(r.label)}${prefs.account !== 'all' ? ' · ' + esc(prefs.account) : ''} · ${cur.length} transactions</div></div>${filtersHTML()}</div>
      ${sampleBanner()}
      <div class="grid kpis">
        <div class="card kpi"><div class="label"><i class="swatch" style="background:var(--spend)"></i>Spent</div><div class="value num">${money(T.spend)}</div><div class="delta">${delta(T.spend, P.spend)}</div></div>
        <div class="card kpi"><div class="label"><i class="swatch" style="background:var(--income)"></i>Income</div><div class="value num">${money(T.income)}</div><div class="delta">${months > 1 ? money(T.income / months) + ' a month on average' : '&nbsp;'}</div></div>
        <div class="card kpi"><div class="label"><i class="swatch" style="background:var(--invest)"></i>Invested</div><div class="value num">${money(T.invest)}</div><div class="delta">${T.income > 0 ? Math.round((T.invest / T.income) * 100) + '% of income' : '&nbsp;'}</div></div>
        <div class="card kpi"><div class="label">Saved</div><div class="value num">${money(T.income - T.spend)}</div><div class="delta">${rate != null ? `<b>${rate}%</b> of income${T.invest > 0 ? ` · ${money(T.invest)} of it invested` : ''}` : 'Import a salary account to see this'}</div></div>
      </div>
      <div class="grid row-2-1 mt">
        <div class="card"><div class="card-head"><h2>Spending and income by month</h2><div class="legend"><span><i style="background:var(--spend)"></i>Spent</span><span><i style="background:var(--income)"></i>Income</span></div></div><div class="chart" id="trend"></div></div>
        <div class="card"><div class="card-head"><h2>Where it went</h2><span class="hint">Click to see transactions</span></div>${categoryBars(cur)}</div>
      </div>
      <div class="grid row-1-1 mt">
        <div class="card"><div class="card-head"><h2>Top places you spend</h2><span class="hint">${esc(r.label)}</span></div>${topMerchants(cur)}</div>
        <div class="card"><div class="card-head"><h2>Recurring payments</h2><span class="hint">Seen in 3+ months</span></div>${recurringList(scope)}</div>
      </div>
      <div class="card mt"><div class="card-head"><h2>Worth a look</h2><span class="hint">Based on ${esc(r.label)}</span></div><div class="insights">${insights(cur, scope, T, P, hasPrev, months)}</div></div>`;
  }

  function categoryBars(list) {
    const by = Object.create(null);
    for (const t of list) if (kindOf(t.category) === 'spend') by[t.category] = (by[t.category] || 0) - t.amount;
    const rows = Object.entries(by).filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]);
    if (!rows.length) return '<p class="muted">No spending in this period.</p>';
    const total = rows.reduce((s, [, v]) => s + v, 0), max = rows[0][1];
    const top = rows.slice(0, 9);
    const rest = rows.slice(9).reduce((s, [, v]) => s + v, 0);
    if (rest > 0) top.push(['All other categories', rest]);
    return `<div class="bars">${top.map(([n, v]) => `
      <button class="bar-row" ${n === 'All other categories' ? '' : `data-cat="${esc(n)}"`}>
        <span class="n">${esc(n)}</span><span class="v num">${money(v)}<small>${Math.round((v / total) * 100)}%</small></span>
        <span class="bar-track"><span class="bar-fill" style="display:block;width:${Math.max(1.5, (v / max) * 100)}%"></span></span>
      </button>`).join('')}</div>`;
  }

  function topMerchants(list) {
    const by = Object.create(null);
    for (const t of list) {
      if (kindOf(t.category) !== 'spend' || t.amount >= 0) continue;
      const k = MD.merchantKey(t.merchant);
      const o = by[k] || (by[k] = { name: t.merchant, cat: t.category, total: 0, n: 0 });
      o.total -= t.amount; o.n++;
    }
    const rows = Object.values(by).sort((a, b) => b.total - a.total).slice(0, 8);
    if (!rows.length) return '<p class="muted">No spending in this period.</p>';
    return `<table class="list"><thead><tr><th>Merchant</th><th>Category</th><th class="r">Times</th><th class="r">Total</th></tr></thead><tbody>${rows.map(m => `
      <tr><td><b>${esc(m.name)}</b></td><td><span class="pill">${esc(m.cat)}</span></td><td class="r num muted">${m.n}</td><td class="r num"><b>${money(m.total)}</b></td></tr>`).join('')}</tbody></table>`;
  }

  function recurringList(scope) {
    const rec = MD.findRecurring(scope).slice(0, 8);
    if (!rec.length) return '<p class="muted">Nothing repeats yet. This fills in once you import 3 or more months.</p>';
    const total = rec.reduce((s, x) => s + x.monthly, 0);
    return `<table class="list"><thead><tr><th>Payment</th><th>Last paid</th><th class="r">Per month</th></tr></thead><tbody>${rec.map(x => `
      <tr><td><b>${esc(x.merchant)}</b><div class="small muted">${esc(x.category)} · ${x.months} months</div></td><td class="muted small">${fmtDate(x.last)}</td><td class="r num"><b>${money(x.monthly)}</b></td></tr>`).join('')}
      <tr><td colspan="2" class="muted">About ${money(total * 12)} a year</td><td class="r num"><b>${money(total)}</b></td></tr></tbody></table>`;
  }

  function insights(cur, scope, T, P, hasPrev, months) {
    const out = [];
    const sumCat = (list, c) => list.filter(t => t.category === c).reduce((s, t) => s - t.amount, 0);
    const fees = sumCat(cur, 'Fees & interest');
    if (fees > 0) out.push(['crit', '!', `${money(fees)} paid in fees and interest`, 'These are usually avoidable: late fees, finance charges and the GST on them. Paying the full card bill by the due date stops them.']);
    const food = cur.filter(t => t.amount < 0 && /swiggy|zomato|eatsure|domino/i.test(t.merchant + ' ' + t.desc) && !/instamart/i.test(t.merchant + t.desc)).reduce((s, t) => s - t.amount, 0);
    if (food > 0) out.push(['warn', '₹', `${money(food / months)} a month on food delivery`, `${money(food)} in this period. Cutting a third of it would free up about ${money((food / months / 3) * 12)} a year.`]);
    const rec = MD.findRecurring(scope);
    const subs = rec.filter(x => x.category === 'Subscriptions');
    if (subs.length) out.push(['info', '↻', `${subs.length} subscriptions, ${money(subs.reduce((s, x) => s + x.monthly, 0))} a month`, subs.slice(0, 4).map(x => x.merchant).join(', ') + '. Worth checking you still use each one.']);
    else {
      const subT = cur.filter(t => t.category === 'Subscriptions');
      const total = subT.reduce((s, t) => s - t.amount, 0);
      if (total > 0) {
        const names = [...new Set(subT.sort((a, b) => a.amount - b.amount).map(t => t.merchant))].slice(0, 4).join(', ');
        out.push([T.spend > 0 && total / T.spend > 0.25 ? 'warn' : 'info', '↻', `${money(total)} on subscriptions${T.spend > 0 ? ` (${Math.round((total / T.spend) * 100)}% of spending)` : ''}`, `${names}. Check whether each is monthly or yearly, and that you still use it.`]);
      }
    }
    if (hasPrev && P.spend > 0) {
      const d = ((T.spend - P.spend) / P.spend) * 100;
      if (Math.abs(d) >= 10) out.push([d > 0 ? 'warn' : 'good', d > 0 ? '▲' : '▼', `Spending ${d > 0 ? 'up' : 'down'} ${Math.abs(d).toFixed(0)}%`, `${money(T.spend)} against ${money(P.spend)} in the previous period.`]);
    }
    if (T.income > 0) {
      const rate = ((T.income - T.spend) / T.income) * 100;
      out.push([rate >= 30 ? 'good' : rate >= 15 ? 'info' : 'warn', '%', `You kept ${rate.toFixed(0)}% of your income`, rate >= 30 ? 'A healthy rate. Make sure the surplus goes into investments, not just the savings account.' : 'A common target is 20 to 30%. The biggest categories above are where to look first.']);
    }
    const people = sumCat(cur, 'People (UPI)');
    if (people > 0 && T.spend > 0 && people / T.spend > 0.1) out.push(['info', '@', `${money(people)} sent to people over UPI`, 'Some of this may really be rent, shopping or bills. Recategorise them in Transactions so the picture is accurate.']);
    const cash = sumCat(cur, 'Cash withdrawal');
    if (cash > 0) out.push(['info', '₹', `${money(cash)} withdrawn as cash`, 'Cash spending is invisible here. If it is regular, note what it goes on.']);
    const other = sumCat(cur, 'Other');
    if (other > 0 && T.spend > 0 && other / T.spend > 0.12) out.push(['info', '?', `${money(other)} is uncategorised`, 'Open Transactions, filter by "Other" and set a category. Money Desk remembers it for that merchant.']);
    if (!out.length) out.push(['good', '✓', 'Nothing stands out', 'No fees, unusual jumps or unchecked subscriptions in this period.']);
    return out.map(([k, ic, t, d]) => `<div class="insight"><span class="ic ${k}">${ic}</span><div><div class="t">${esc(t)}</div><div class="d">${esc(d)}</div></div></div>`).join('');
  }

  // Grouped bar chart: spent vs income per month (last 12 months of data in scope).
  function drawTrend() {
    const el = $('#trend');
    if (!el) return;
    const scope = db.txns.filter(byAccount);
    const r = periodRange(prefs.period);
    const end = latestDate().slice(0, 7);
    const span = Math.max(6, Math.min(12, r.months || 12));
    const months = [];
    for (let i = span - 1; i >= 0; i--) months.push(addMonths(end, -i));
    const data = months.map(m => { const T = totals(scope.filter(t => t.date.startsWith(m))); return { m, spend: Math.max(0, T.spend), income: Math.max(0, T.income) }; });
    el.innerHTML = '';
    const card = el.closest('.card');
    const room = card ? card.getBoundingClientRect().bottom - el.getBoundingClientRect().top - 20 : 300;
    const W = Math.max(320, el.clientWidth), H = Math.max(260, Math.min(460, Math.floor(room))), padL = 52, padB = 26, padT = 10;
    const max = Math.max(1, ...data.map(d => Math.max(d.spend, d.income)));
    const step = niceStep(max / 4);
    const top = Math.ceil(max / step) * step;
    const y = v => padT + (H - padT - padB) * (1 - v / top);
    const band = (W - padL) / data.length;
    const bw = Math.min(22, (band - 14) / 2);
    let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Monthly spending and income">`;
    for (let v = 0; v <= top + 0.1; v += step) s += `<line class="gridline" x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><g class="axis"><text x="${padL - 10}" y="${y(v) + 4}" text-anchor="end">${short(v)}</text></g>`;
    data.forEach((d, i) => {
      const cx = padL + band * i + band / 2;
      const sel = r.months && d.m + '-01' >= r.from && d.m + '-01' <= r.to;
      s += `<g class="axis"><text x="${cx}" y="${H - 6}" text-anchor="middle" style="${sel ? 'fill:var(--text);font-weight:600' : ''}">${monthLabel(d.m)}</text></g>`;
      s += barPath(cx - bw - 1, y(d.spend), bw, H - padB - y(d.spend), 'var(--spend)');
      s += barPath(cx + 1, y(d.income), bw, H - padB - y(d.income), 'var(--income)');
      s += `<rect x="${padL + band * i}" y="${padT}" width="${band}" height="${H - padT - padB}" fill="transparent" data-i="${i}" class="hit"/>`;
    });
    s += '</svg>';
    el.innerHTML = s;
    el.querySelectorAll('.hit').forEach(h => {
      h.addEventListener('mousemove', e => {
        const d = data[+h.dataset.i];
        showTip(e, `<b>${monthLabel(d.m)}</b><div class="r"><span>Spent</span><span class="num">${money(d.spend)}</span></div><div class="r"><span>Income</span><span class="num">${money(d.income)}</span></div>${d.income ? `<div class="r"><span>Kept</span><span class="num">${Math.round(((d.income - d.spend) / d.income) * 100)}%</span></div>` : ''}`);
        h.setAttribute('fill', 'rgba(127,127,127,.08)');
      });
      h.addEventListener('mouseleave', () => { hideTip(); h.setAttribute('fill', 'transparent'); });
    });
  }
  function barPath(x, yTop, w, h, fill) {
    if (h <= 0.5) return '';
    const r = Math.min(4, w / 2, h);
    return `<path d="M${x},${yTop + h} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + w - r} Q${x + w},${yTop} ${x + w},${yTop + r} V${yTop + h} Z" fill="${fill}" pointer-events="none"/>`;
  }
  function niceStep(v) { const p = Math.pow(10, Math.floor(Math.log10(v || 1))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
  function showTip(e, html) {
    const t = $('#tip'); t.innerHTML = html; t.style.opacity = 1;
    const w = t.offsetWidth, h = t.offsetHeight;
    let x = e.clientX + 14, yy = e.clientY - h - 10;
    if (x + w > innerWidth - 8) x = e.clientX - w - 14;
    if (yy < 8) yy = e.clientY + 16;
    t.style.left = x + 'px'; t.style.top = yy + 'px';
  }
  function hideTip() { const t = $('#tip'); if (t) t.style.opacity = 0; }

  // ---------- Transactions ----------
  function filteredTxns() {
    const r = periodRange(prefs.period);
    const q = txFilter.q.trim().toLowerCase();
    return db.txns.filter(t => byAccount(t) && inRange(t, r)
      && (txFilter.category === 'all' || t.category === txFilter.category)
      && (txFilter.kind === 'all' || (txFilter.kind === 'out' ? t.amount < 0 : t.amount > 0))
      && (!q || (t.desc + ' ' + t.merchant + ' ' + t.category + ' ' + t.account).toLowerCase().includes(q) || String(Math.abs(t.amount)).includes(q)))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }
  function catOptions(sel) {
    const groups = [['spend', 'Spending'], ['income', 'Income'], ['invest', 'Investing'], ['transfer', 'Not counted']];
    return groups.map(([k, l]) => `<optgroup label="${l}">${MD.CATEGORIES.filter(c => c.kind === k).map(c => `<option ${c.name === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
  }
  function viewTransactions() {
    if (!db.txns.length) return `<div class="top"><div><h1>Transactions</h1></div></div><div class="card empty"><h2>No transactions yet</h2><p>Import a statement to get started.</p><button class="btn primary" data-go="import">Import a statement</button></div>`;
    const list = filteredTxns();
    const out = list.filter(t => t.amount < 0).reduce((s, t) => s - t.amount, 0);
    const inn = list.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const shown = list.slice(0, txFilter.limit);
    return `
      <div class="top"><div><h1>Transactions</h1><div class="sub">Change a category and Money Desk can remember it for that merchant</div></div>${filtersHTML()}</div>
      ${sampleBanner()}
      <div class="card">
        <div class="toolbar">
          <div class="grow"><div class="field"><label for="q">Search</label><input id="q" placeholder="Merchant, description or amount" value="${esc(txFilter.q)}" autocomplete="off"></div></div>
          <div class="field"><label for="f-cat">Category</label><select id="f-cat"><option value="all">All</option>${MD.CATEGORIES.map(c => `<option ${txFilter.category === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="f-kind">Type</label><select id="f-kind"><option value="all">In and out</option><option value="out" ${txFilter.kind === 'out' ? 'selected' : ''}>Money out</option><option value="in" ${txFilter.kind === 'in' ? 'selected' : ''}>Money in</option></select></div>
          <button class="btn" data-act="export-csv">Export CSV</button>
        </div>
        <div class="summary-strip"><span><b>${list.length}</b> transactions</span><span>Out <b class="num">${money(out)}</b></span><span>In <b class="num">${money(inn)}</b></span></div>
        <div class="table-wrap"><table class="tx-table"><thead><tr><th style="width:110px">Date</th><th>Merchant</th><th>Account</th><th>Category</th><th style="text-align:right">Amount</th></tr></thead><tbody>
        ${shown.map(t => `<tr>
          <td class="muted num" style="white-space:nowrap">${fmtDate(t.date)}</td>
          <td><div class="tx-merchant">${esc(t.merchant)}</div><div class="tx-desc" title="${esc(t.desc)}">${esc(t.desc)}</div></td>
          <td class="small muted" style="white-space:nowrap">${esc(t.account)}</td>
          <td><select class="cat-select" data-id="${esc(t.id)}" aria-label="Category">${catOptions(t.category)}</select></td>
          <td class="amt num ${t.amount > 0 ? 'in' : ''}">${t.amount > 0 ? '+' : '−'}${inr2.format(Math.abs(t.amount)).replace('-', '')}</td></tr>`).join('')}
        </tbody></table></div>
        ${list.length > shown.length ? `<div style="text-align:center;margin-top:12px"><button class="btn" data-act="more">Show ${Math.min(300, list.length - shown.length)} more</button></div>` : ''}
        ${!list.length ? '<p class="muted" style="text-align:center;padding:30px">Nothing matches these filters.</p>' : ''}
      </div>`;
  }

  function changeCategory(id, cat) {
    const t = db.txns.find(x => x.id === id);
    if (!t) return;
    t.category = cat; t.manual = true; save();
    const key = MD.merchantKey(t.merchant);
    const others = db.txns.filter(x => x !== t && MD.merchantKey(x.merchant) === key && x.category !== cat);
    toast(`${esc(t.merchant)} set to ${esc(cat)}.`, [
      [`Apply to ${others.length ? others.length + ' other' + (others.length > 1 ? 's' : '') + ' and ' : ''}future imports`, () => {
        if (key !== '__proto__') db.rules[key] = cat;
        others.forEach(x => (x.category = cat)); save(); render(); toast(`Saved. ${esc(t.merchant)} will always be ${esc(cat)}.`);
      }, true],
      ['Just this one', () => { render(); hideToast(); }],
    ], 9000);
  }

  function exportCSV() {
    const list = filteredTxns();
    const q = v => `"${String(v).replace(/"/g, '""')}"`;
    const csv = ['Date,Merchant,Description,Account,Category,Amount'].concat(list.map(t => [t.date, q(t.merchant), q(t.desc), q(t.account), q(t.category), t.amount].join(','))).join('\r\n');
    download('money-desk-transactions.csv', '﻿' + csv, 'text/csv');
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------- Import ----------
  const SUGGEST = ['SBI Savings', 'Kotak Savings', 'SBI Credit Card', 'HDFC Credit Card', 'ICICI Credit Card'];
  let importForm = { account: '', kind: 'bank' };

  function viewImport() {
    const known = Object.keys(db.accounts);
    const names = [...new Set(known.concat(SUGGEST))];
    return `
      <div class="top"><div><h1>Import statements</h1><div class="sub">Excel, CSV or PDF from net banking or your card's email. Files are read here and never leave your laptop.</div></div></div>
      <div class="grid row-2-1">
        <div class="card">
          <div class="form-row">
            <div><label class="l" for="acct">Which account is this?</label><input class="input" id="acct" list="acct-list" placeholder="e.g. SBI Savings" value="${esc(importForm.account)}"><datalist id="acct-list">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>
            <div><span class="l">Type</span><div class="seg" role="group"><button data-kind="bank" aria-pressed="${importForm.kind === 'bank'}">Bank account</button><button data-kind="card" aria-pressed="${importForm.kind === 'card'}">Credit card</button></div></div>
          </div>
          <div class="drop mt" id="drop" tabindex="0" role="button" aria-label="Choose statement files">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.6"><path d="M12 15V3m0 0L8 7m4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>
            <div class="big">Drop statement files here, or click to choose</div>
            <div class="muted small">.xlsx · .xls · .csv · .pdf (password-protected PDFs are fine)</div>
          </div>
          <div id="import-status" class="mt"></div>
          <div id="import-preview"></div>
        </div>
        <div class="card how">
          <h2>Where to get each file</h2>
          <ol style="padding-left:18px;margin:12px 0 0">
            <li><b>SBI and Kotak savings:</b> net banking → Account statement → pick dates → download as <b>Excel</b>. Excel reads more reliably than PDF.</li>
            <li><b>HDFC, ICICI and SBI cards:</b> the monthly statement PDF from your email. Enter its password when asked (usually based on your name and date of birth).</li>
            <li><b>Investments:</b> SIPs and transfers to Groww or Wealthy show up from your bank statement as <b>Invested</b>.</li>
          </ol>
          <p class="note mt">Import the same file twice and nothing is duplicated. Card bill payments are counted once: they're marked as transfers so the purchases on the card aren't double-counted.</p>
        </div>
      </div>`;
  }

  async function handleFiles(files) {
    const status = $('#import-status');
    importForm.account = ($('#acct').value || '').trim();
    if (!importForm.account) { status.innerHTML = '<div class="note err">Name the account first, for example "SBI Savings".</div>'; $('#acct').focus(); return; }
    for (const f of files) {
      status.innerHTML = `<div class="note">Reading ${esc(f.name)}…</div>`;
      let res = null;
      try {
        res = await parseFile(f);
        if (res === 'password') res = await askPassword(f);
        if (res) showPreview(res, f);
      } catch (e) {
        status.innerHTML = `<div class="note err">Couldn't read ${esc(f.name)}: ${esc(e.message || e)}. Try the Excel or CSV download instead.</div>`;
      }
      if (res && files.length > 1) await new Promise(ok => { pending.onDone = ok; });
    }
  }

  async function parseFile(f, password) {
    const opts = { account: importForm.account, accountKind: importForm.kind, rules: db.rules, source: f.name };
    const name = f.name.toLowerCase();
    if (name.endsWith('.pdf')) {
      const pdfjs = window.pdfjsLib;
      pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
      const data = new Uint8Array(await f.arrayBuffer());
      // Passwords are never stored or reused: each locked file asks for its own.
      let doc;
      try { doc = await pdfjs.getDocument({ data, password: password || undefined, isEvalSupported: false, disableFontFace: true }).promise; }
      catch (e) {
        if (e && e.name === 'PasswordException') return 'password';
        throw e;
      }
      const lines = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        lines.push(...MD.itemsToLines(tc.items));
      }
      const r = MD.linesToTxns(lines, opts);
      return { kind: 'pdf', opts, ...r, lineCount: lines.length };
    }
    let rows;
    if (name.endsWith('.csv') || name.endsWith('.txt')) {
      const text = await f.text();
      const wb = XLSX.read(text, { type: 'string', raw: true });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
    } else {
      const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array', cellDates: true });
      // Use the sheet with the most rows.
      let best = null;
      for (const sn of wb.SheetNames) {
        const rr = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' });
        if (!best || rr.length > best.length) best = rr;
      }
      rows = best || [];
    }
    const det = MD.detectColumns(rows);
    if (!det) throw new Error('no date and amount columns found');
    return { kind: 'table', opts, rows, det, ...MD.rowsToTxns(rows, det, opts) };
  }

  // Resolves with the parsed file once a password works, or null if the file is skipped.
  function askPassword(f, wrong) {
    return new Promise((resolve, reject) => {
      $('#import-status').innerHTML = `<div class="note ${wrong ? 'err' : ''}">${wrong ? `That password didn't open <b>${esc(f.name)}</b>. Try again.` : `<b>${esc(f.name)}</b> is password-protected. Enter its password. It's only used to open this file and is never saved.`}</div>
        <div class="form-row mt"><div><input class="input" type="password" id="pdf-pass" placeholder="Statement password" autocomplete="off"></div><button class="btn primary" id="pdf-go">Open</button><button class="btn" id="pdf-skip">Skip this file</button></div>`;
      const go = async () => {
        const pw = $('#pdf-pass').value;
        if (!pw) return;
        try {
          const res = await parseFile(f, pw);
          if (res === 'password') { askPassword(f, true).then(resolve, reject); return; }
          resolve(res);
        } catch (e) { reject(e); }
      };
      $('#pdf-go').onclick = go;
      $('#pdf-skip').onclick = () => { $('#import-status').innerHTML = `<div class="note">Skipped ${esc(f.name)}.</div>`; resolve(null); };
      $('#pdf-pass').onkeydown = e => { if (e.key === 'Enter') go(); };
      $('#pdf-pass').focus();
    });
  }

  function showPreview(res, f) {
    const existing = new Set(db.txns.map(t => t.id));
    const fresh = res.txns.filter(t => !existing.has(t.id));
    const dupes = res.txns.length - fresh.length;
    pending = { res, f, fresh, onDone: pending && pending.onDone };
    const out = fresh.filter(t => t.amount < 0).reduce((s, t) => s - t.amount, 0);
    const inn = fresh.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const dates = res.txns.map(t => t.date).sort();
    $('#import-status').innerHTML = res.txns.length
      ? `<div class="note"><b>${esc(f.name)}</b>: found ${res.txns.length} transactions${dates.length ? ` from ${fmtDate(dates[0])} to ${fmtDate(dates[dates.length - 1])}` : ''}. ${dupes ? `${dupes} already imported and will be skipped. ` : ''}Money out ${money(out)}, money in ${money(inn)}. Check a few rows below before importing.</div>`
      : `<div class="note err">No transactions found in ${esc(f.name)}. ${res.kind === 'pdf' ? 'This PDF layout may not be supported; the Excel or CSV download usually works.' : 'Check the column choices below.'}</div>`;
    let mapHTML = '';
    if (res.kind === 'table') {
      const hdr = res.det.headers;
      const opt = (k) => `<select data-map="${k}"><option value="">—</option>${hdr.map((h, i) => `<option value="${i}" ${res.det.map[k] === i ? 'selected' : ''}>${esc(h || 'Column ' + (i + 1))}</option>`).join('')}</select>`;
      mapHTML = `<details class="mt" ${res.txns.length ? '' : 'open'}><summary class="small muted" style="cursor:pointer">Columns used (change if something looks wrong)</summary><div class="map-grid mt">
        <label>Date${opt('date')}</label><label>Description${opt('desc')}</label><label>Money out (debit)${opt('debit')}</label><label>Money in (credit)${opt('credit')}</label><label>Single amount column${opt('amount')}</label><label>Dr / Cr column${opt('type')}</label></div></details>`;
    }
    $('#import-preview').innerHTML = `${mapHTML}
      ${res.txns.length ? `<div class="table-wrap mt" style="max-height:340px"><table class="tx-table"><thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th style="text-align:right">Amount</th></tr></thead><tbody>
      ${res.txns.slice(0, 60).map(t => `<tr style="${existing.has(t.id) ? 'opacity:.45' : ''}"><td class="muted num" style="white-space:nowrap">${fmtDate(t.date)}</td><td><div class="tx-merchant">${esc(t.merchant)}</div><div class="tx-desc">${esc(t.desc)}</div></td><td><span class="pill">${esc(t.category)}</span></td><td class="amt num ${t.amount > 0 ? 'in' : ''}">${t.amount > 0 ? '+' : '−'}${inr2.format(Math.abs(t.amount))}</td></tr>`).join('')}
      </tbody></table></div>${res.txns.length > 60 ? `<p class="small muted">Showing 60 of ${res.txns.length}.</p>` : ''}` : ''}
      <div class="form-row mt">${fresh.length ? `<button class="btn primary" id="do-import">Import ${fresh.length} transactions into ${esc(res.opts.account)}</button>` : ''}<button class="btn" id="cancel-import">Cancel</button></div>`;
    $('#import-preview').querySelectorAll('[data-map]').forEach(s => s.addEventListener('change', () => {
      const v = s.value === '' ? undefined : +s.value;
      if (v === undefined) delete res.det.map[s.dataset.map]; else res.det.map[s.dataset.map] = v;
      Object.assign(res, MD.rowsToTxns(res.rows, res.det, res.opts));
      showPreview(res, f);
    }));
    const done = () => { const cb = pending && pending.onDone; pending = null; if (cb) cb(); };
    if ($('#do-import')) $('#do-import').onclick = () => {
      db.txns.push(...fresh);
      db.accounts[res.opts.account] = { kind: res.opts.accountKind };
      save();
      $('#import-preview').innerHTML = '';
      $('#import-status').innerHTML = `<div class="note">Imported ${fresh.length} transactions into <b>${esc(res.opts.account)}</b>. <a href="#" data-go="overview">See the overview</a> or import another file.</div>`;
      wire($('#import-status'));
      done();
    };
    $('#cancel-import').onclick = () => { $('#import-preview').innerHTML = ''; $('#import-status').innerHTML = ''; done(); };
  }

  // ---------- My services ----------
  let svcForm = null; // the entry being added or edited
  const ordinal = n => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

  // Accounts already imported and repeating payments that aren't on the list yet.
  function serviceSuggestions() {
    const have = new Set(db.services.map(v => MD.merchantKey(v.name)));
    const out = [];
    for (const [name, a] of Object.entries(db.accounts)) {
      if (!have.has(MD.merchantKey(name))) out.push({ type: a.kind === 'card' ? 'Credit card' : 'Bank account', name, freq: 'None', why: 'Imported account' });
    }
    for (const r of MD.findRecurring(db.txns)) {
      if (have.has(MD.merchantKey(r.merchant))) continue;
      const type = kindOf(r.category) === 'invest' ? 'SIP / investment' : r.category === 'Subscriptions' ? 'Subscription'
        : r.category === 'Insurance' ? 'Insurance' : r.category === 'EMI & loans' ? 'Loan / EMI' : 'Other';
      out.push({ type, name: r.merchant, amount: Math.round(r.monthly), freq: 'Monthly', day: +r.last.slice(8, 10), why: `Paid ${r.months} months running` });
    }
    return out;
  }

  function serviceFormHTML() {
    const v = svcForm;
    const sel = (id, opts, cur) => `<select id="${id}">${opts.map(o => `<option ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    return `<div class="card mt"><div class="card-head"><h2>${v.id ? 'Edit' : 'Add'} a service</h2></div>
      <div class="svc-form">
        <label>Type${sel('svc-type', SVC_TYPES, v.type)}</label>
        <label>Name<input id="svc-name" maxlength="80" placeholder="e.g. Netflix, HDFC Regalia" value="${esc(v.name)}"></label>
        <label>Bank or provider<input id="svc-provider" maxlength="60" placeholder="e.g. HDFC, Groww" value="${esc(v.provider)}"></label>
        <label>Last 4 digits (optional)<input id="svc-last4" maxlength="4" inputmode="numeric" placeholder="1234" value="${esc(v.last4)}"></label>
        <label>Amount, ₹<input id="svc-amount" inputmode="decimal" placeholder="e.g. 649" value="${v.amount == null ? '' : esc(v.amount)}"></label>
        <label>How often${sel('svc-freq', SVC_FREQ, v.freq)}</label>
        <label>Day of month (bill or debit)<input id="svc-day" inputmode="numeric" maxlength="2" placeholder="1–31" value="${v.day == null ? '' : esc(v.day)}"></label>
        <label>Paid from<input id="svc-from" list="svc-accts" maxlength="60" placeholder="e.g. SBI Savings" value="${esc(v.from)}"><datalist id="svc-accts">${Object.keys(db.accounts).map(n => `<option value="${esc(n)}">`).join('')}</datalist></label>
        <label class="wide">Notes<input id="svc-notes" maxlength="200" placeholder="e.g. renews in March, cancel before trial ends" value="${esc(v.notes)}"></label>
      </div>
      <p class="small muted">Don't put passwords, PINs, CVVs or full card or account numbers here. Long numbers are masked automatically.</p>
      <div id="svc-err"></div>
      <div class="form-row mt"><button class="btn primary" id="svc-save">${v.id ? 'Save changes' : 'Add to my services'}</button><button class="btn" id="svc-cancel">Cancel</button></div>
    </div>`;
  }

  function viewServices() {
    const active = db.services.filter(v => v.active);
    const monthly = active.filter(v => v.amount && PER_MONTH[v.freq] && v.type !== 'Bank account' && v.type !== 'Credit card')
      .reduce((s, v) => s + v.amount * PER_MONTH[v.freq], 0);
    const sugg = serviceSuggestions();
    const row = v => {
      const sub = [v.provider, v.last4 ? '••' + v.last4 : ''].filter(Boolean).map(esc).join(' · ');
      const when = [v.amount ? inr2.format(v.amount) + (v.freq !== 'None' ? ' · ' + esc(v.freq.toLowerCase()) : '') : (v.freq !== 'None' ? esc(v.freq) : ''), v.day ? `on the ${ordinal(v.day)}` : ''].filter(Boolean).join(' ');
      return `<tr style="${v.active ? '' : 'opacity:.5'}"><td><b>${esc(v.name)}</b>${v.active ? '' : ' <span class="pill">Stopped</span>'}<div class="small muted">${sub}</div></td>
        <td class="small">${when || '<span class="muted">—</span>'}</td><td class="small muted">${esc(v.from) || '—'}</td><td class="small muted">${esc(v.notes)}</td>
        <td class="r" style="white-space:nowrap"><button class="btn small" data-svc-edit="${esc(v.id)}">Edit</button> <button class="btn small" data-svc-toggle="${esc(v.id)}">${v.active ? 'Mark stopped' : 'Mark active'}</button> <button class="btn small danger" data-svc-del="${esc(v.id)}">Delete</button></td></tr>`;
    };
    const groups = SVC_TYPES.map(t => [t, db.services.filter(v => v.type === t).sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name))]).filter(([, l]) => l.length);
    return `
      <div class="top"><div><h1>My services</h1><div class="sub">Every account, card, subscription, mandate, SIP and policy you have, in one place. Saved only on this laptop.</div></div>
        <button class="btn primary" data-act="svc-new">Add a service</button></div>
      ${svcForm ? serviceFormHTML() : ''}
      <div class="grid kpis mt">
        <div class="card kpi"><div class="label">Active services</div><div class="value num">${active.length}</div></div>
        <div class="card kpi"><div class="label">Regular payments a month</div><div class="value num">${money(monthly)}</div><div class="small muted">Subscriptions, mandates, SIPs, insurance and EMIs with an amount</div></div>
        <div class="card kpi"><div class="label">A year</div><div class="value num">${money(monthly * 12)}</div></div>
        <div class="card kpi"><div class="label">Stopped</div><div class="value num">${db.services.length - active.length}</div></div>
      </div>
      ${groups.length ? groups.map(([t, l]) => `<div class="card mt"><div class="card-head"><h2>${esc(t)}</h2><span class="hint">${l.length}</span></div>
        <table class="list"><thead><tr><th>Name</th><th>Amount and date</th><th>Paid from</th><th>Notes</th><th></th></tr></thead><tbody>${l.map(row).join('')}</tbody></table></div>`).join('')
        : `<div class="card mt empty"><h2>Nothing here yet</h2><p>Add your bank accounts, cards, subscriptions, autopay mandates, SIPs and insurance, or pick from the suggestions below.</p></div>`}
      ${sugg.length ? `<div class="card mt"><div class="card-head"><h2>Suggestions from your statements</h2><span class="hint">${sugg.length}</span></div>
        <table class="list"><tbody>${sugg.map((x, i) => `<tr><td><b>${esc(x.name)}</b><div class="small muted">${esc(x.why)}</div></td><td><span class="pill">${esc(x.type)}</span></td><td class="r num">${x.amount ? money(x.amount) + ' a month' : ''}</td><td class="r"><button class="btn small" data-svc-sugg="${i}">Add</button></td></tr>`).join('')}</tbody></table></div>` : ''}`;
  }

  function saveServiceForm() {
    const val = id => $('#' + id).value;
    const last4 = val('svc-last4').trim(), day = val('svc-day').trim(), amount = val('svc-amount').replace(/[₹,\s]/g, '');
    const err = !val('svc-name').trim() ? 'Give it a name.'
      : last4 && !/^\d{4}$/.test(last4) ? 'Last 4 digits must be exactly 4 numbers.'
      : amount && !(+amount > 0) ? 'Amount must be a number, like 649.'
      : day && !(Number.isInteger(+day) && +day >= 1 && +day <= 31) ? 'Day of month must be between 1 and 31.' : '';
    if (err) { $('#svc-err').innerHTML = `<div class="note err">${esc(err)}</div>`; return; }
    const str = (v, max) => String(v == null ? '' : v).slice(0, max);
    const v = cleanService({ id: svcForm.id, type: val('svc-type'), name: val('svc-name'), provider: val('svc-provider'), last4, amount, freq: val('svc-freq'), day: day ? +day : null, from: val('svc-from'), notes: val('svc-notes'), active: svcForm.active }, str);
    const i = db.services.findIndex(x => x.id === v.id);
    if (i >= 0) db.services[i] = v; else db.services.push(v);
    svcForm = null; save(); render();
    toast(`Saved ${esc(v.name)}.`);
  }

  // ---------- Settings ----------
  function viewSettings() {
    const accts = Object.create(null);
    for (const t of db.txns) {
      const a = accts[t.account] || (accts[t.account] = { n: 0, from: t.date, to: t.date });
      a.n++; if (t.date < a.from) a.from = t.date; if (t.date > a.to) a.to = t.date;
    }
    const rules = Object.entries(db.rules);
    return `
      <div class="top"><div><h1>Accounts &amp; data</h1><div class="sub">Your accounts, category rules and where your data is kept</div></div></div>
      <div class="grid row-1-1">
        <div class="card"><div class="card-head"><h2>Accounts</h2></div>
          ${Object.keys(accts).length ? `<table class="list"><thead><tr><th>Account</th><th>Covers</th><th class="r">Transactions</th><th></th></tr></thead><tbody>${Object.entries(accts).sort().map(([n, a]) => `
            <tr><td><b>${esc(n)}</b><div class="small muted">${(db.accounts[n] || {}).kind === 'card' ? 'Credit card' : 'Bank account'}</div></td><td class="small muted">${fmtDate(a.from)} – ${fmtDate(a.to)}</td><td class="r num">${a.n}</td><td class="r"><button class="btn small danger" data-del-acct="${esc(n)}">Delete</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">No accounts yet.</p>'}
        </div>
        <div class="card"><div class="card-head"><h2>Your category rules</h2><span class="hint">${rules.length} saved</span></div>
          ${rules.length ? `<table class="list"><tbody>${rules.sort().map(([k, c]) => `<tr><td>${esc(k)}</td><td><span class="pill">${esc(c)}</span></td><td class="r"><button class="btn small" data-del-rule="${esc(k)}">Remove</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">When you change a category in Transactions and choose "apply to future imports", the rule shows up here.</p>'}
        </div>
      </div>
      <div class="card mt"><div class="card-head"><h2>Backup</h2></div>
        <p class="muted" style="margin-top:0">${fileMode ? 'Your data is saved in <b>data\\money-desk.json</b> inside your Money Desk folder, and a copy is kept in <b>data\\backups</b> for each of the last 30 days. Clearing browser data does not touch it. For extra safety, download a backup to another drive or cloud folder now and then.' : '<b>Not connected to your data file.</b> Open Money Desk from its Start menu shortcut so changes are saved to disk. Until then they are kept only in this browser.'}</p>
        <div class="form-row"><button class="btn primary" data-act="backup">Download backup</button><button class="btn" data-act="restore">Restore from backup</button><button class="btn" data-act="load-sample">Load sample data</button><button class="btn danger" data-act="clear">Delete everything</button></div>
      </div>`;
  }

  // ---------- Wiring ----------
  function wire(root) {
    root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); setView(b.dataset.go); }));
    root.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => act(b.dataset.act)));
    const per = $('#f-period', root), acc = $('#f-account', root);
    if (per) per.onchange = () => { prefs.period = per.value; savePrefs(); render(); };
    if (acc) acc.onchange = () => { prefs.account = acc.value; savePrefs(); render(); };
    const th = $('#theme-btn', root);
    if (th) th.onclick = () => {
      const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.dataset.theme = dark ? 'light' : 'dark';
      prefs.theme = document.documentElement.dataset.theme; savePrefs();
    };
    root.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => { txFilter.category = b.dataset.cat; txFilter.q = ''; setView('transactions'); }));
    drawTrend();
    // Transactions
    const q = $('#q', root);
    if (q) {
      let tm;
      q.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { txFilter.q = q.value; txFilter.limit = 300; const pos = q.selectionStart; render(); const nq = $('#q'); nq.focus(); nq.setSelectionRange(pos, pos); }, 180); };
    }
    const fc = $('#f-cat', root), fk = $('#f-kind', root);
    if (fc) fc.onchange = () => { txFilter.category = fc.value; render(); };
    if (fk) fk.onchange = () => { txFilter.kind = fk.value; render(); };
    root.querySelectorAll('.cat-select').forEach(s => s.addEventListener('change', () => changeCategory(s.dataset.id, s.value)));
    // Import
    const drop = $('#drop', root);
    if (drop) {
      const fileIn = $('#file');
      drop.onclick = () => fileIn.click();
      drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } };
      fileIn.onchange = () => { const fs = [...fileIn.files]; fileIn.value = ''; handleFiles(fs); };
      drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); handleFiles([...e.dataTransfer.files]); };
      root.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { importForm.kind = b.dataset.kind; root.querySelectorAll('[data-kind]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
      const acct = $('#acct', root);
      acct.oninput = () => {
        importForm.account = acct.value;
        const known = db.accounts[acct.value.trim()];
        const guess = known ? known.kind : /card/i.test(acct.value) ? 'card' : /saving|bank|current|salary/i.test(acct.value) ? 'bank' : null;
        if (guess) { importForm.kind = guess; root.querySelectorAll('[data-kind]').forEach(x => x.setAttribute('aria-pressed', x.dataset.kind === guess)); }
      };
    }
    // Settings
    root.querySelectorAll('[data-del-acct]').forEach(b => b.onclick = () => {
      const n = b.dataset.delAcct;
      if (!confirm(`Delete all ${db.txns.filter(t => t.account === n).length} transactions in "${n}"?`)) return;
      db.txns = db.txns.filter(t => t.account !== n); delete db.accounts[n];
      if (prefs.account === n) prefs.account = 'all';
      save(); render();
    });
    root.querySelectorAll('[data-del-rule]').forEach(b => b.onclick = () => { delete db.rules[b.dataset.delRule]; save(); render(); });
    // My services
    const blank = { type: 'Subscription', name: '', provider: '', last4: '', amount: null, freq: 'Monthly', day: null, from: '', notes: '', active: true };
    const openForm = v => { svcForm = Object.assign({}, blank, v); render(); const n = $('#svc-name'); if (n) { n.focus(); n.scrollIntoView({ block: 'center' }); } };
    root.querySelectorAll('[data-svc-edit]').forEach(b => b.onclick = () => openForm(db.services.find(v => v.id === b.dataset.svcEdit)));
    root.querySelectorAll('[data-svc-sugg]').forEach(b => b.onclick = () => openForm(serviceSuggestions()[+b.dataset.svcSugg]));
    root.querySelectorAll('[data-svc-toggle]').forEach(b => b.onclick = () => { const v = db.services.find(x => x.id === b.dataset.svcToggle); if (v) { v.active = !v.active; save(); render(); } });
    root.querySelectorAll('[data-svc-del]').forEach(b => b.onclick = () => {
      const v = db.services.find(x => x.id === b.dataset.svcDel);
      if (!v || !confirm(`Delete "${v.name}" from My services?`)) return;
      db.services = db.services.filter(x => x !== v); save(); render();
    });
    const svcSave = $('#svc-save', root);
    if (svcSave) { svcSave.onclick = saveServiceForm; $('#svc-cancel', root).onclick = () => { svcForm = null; render(); }; }
  }

  function act(a) {
    if (a === 'svc-new') {
      svcForm = { type: 'Subscription', name: '', provider: '', last4: '', amount: null, freq: 'Monthly', day: null, from: '', notes: '', active: true };
      render(); $('#svc-name').focus();
    } else if (a === 'load-sample') {
      const sample = window.MDSample.build(MD, new Date());
      const have = new Set(db.txns.map(t => t.id));
      db.txns.push(...sample.filter(t => !have.has(t.id)));
      for (const t of sample) db.accounts[t.account] = { kind: /card/i.test(t.account) ? 'card' : 'bank' };
      prefs.period = '6m'; prefs.account = 'all';
      save(); savePrefs(); setView('overview');
    } else if (a === 'remove-sample') {
      db.txns = db.txns.filter(t => t.source !== 'sample');
      const left = new Set(db.txns.map(t => t.account));
      for (const k of Object.keys(db.accounts)) if (!left.has(k)) delete db.accounts[k];
      prefs.account = 'all'; save(); render();
    } else if (a === 'export-csv') exportCSV();
    else if (a === 'more') { txFilter.limit += 300; render(); }
    else if (a === 'backup') download(`money-desk-backup-${today()}.json`, JSON.stringify({ app: 'money-desk', version: 1, ...db }), 'application/json');
    else if (a === 'restore') {
      const fi = $('#backup-file');
      fi.onchange = async () => {
        const f = fi.files[0]; fi.value = '';
        if (!f) return;
        try {
          const d = JSON.parse(await f.text());
          if (!Array.isArray(d.txns)) throw new Error('not a Money Desk backup');
          if (!confirm(`Replace current data with ${d.txns.length} transactions from this backup?`)) return;
          db = sanitize(d); refreshParsed(); save(); render(); toast('Backup restored.');
        } catch (e) { toast("That file isn't a Money Desk backup."); }
      };
      fi.click();
    } else if (a === 'clear') {
      if (!confirm('Delete every transaction, account and rule from Money Desk? Download a backup first if you might want them.')) return;
      db = { txns: [], rules: {}, accounts: {}, services: [], parserVersion: MD.PARSER_VERSION }; save(); setView('overview');
    }
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(html, actions, ms = 3500) {
    const t = $('#toast');
    t.innerHTML = `<span>${html}</span>` + (actions || []).map((a, i) => `<button class="btn small ${a[2] ? 'primary' : ''}" data-i="${i}">${esc(a[0])}</button>`).join('');
    (actions || []).forEach((a, i) => { t.querySelector(`[data-i="${i}"]`).onclick = () => { a[1](); }; });
    t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, ms);
  }
  function hideToast() { $('#toast').classList.remove('show'); }

  // ---------- Keep-alive ----------
  // Tells the local helper the window is still open.
  const PAGE_ID = Math.random().toString(36).slice(2, 10);
  function ping() {
    fetch('/__alive?id=' + PAGE_ID, API)
      .then(r => { if (!r.ok) throw new Error(r.status); })
      .then(() => $('#offline').classList.add('hidden'))
      .catch(() => $('#offline').classList.remove('hidden'));
  }
  if (location.protocol.startsWith('http')) {
    ping(); setInterval(ping, 30000);
    // Closing the window lets the helper stop straight away (a reload cancels it).
    addEventListener('pagehide', () => { try { fetch('/__bye?id=' + PAGE_ID, { method: 'POST', headers: { 'X-Money-Desk': HELPER_KEY }, body: 'bye', keepalive: true }); } catch (e) { /* idle timeout covers it */ } });
  }

  // ---------- Start ----------
  if (prefs.theme) document.documentElement.dataset.theme = prefs.theme;
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(drawTrend, 120); });
  if (refreshParsed()) save();
  setView(prefs.view);
  loadFromFile();
})();
