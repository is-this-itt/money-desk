#!/usr/bin/env node
// Money Desk MCP server: read-only access to your Money Desk data file for Claude.
// Speaks MCP over stdio. No network access, no dependencies, never writes to the data file.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
// The packaged extension carries its own copy of the app's parser; in the repo it lives in app/.
const MD = fs.existsSync(path.join(__dirname, 'parser.js')) ? require('./parser.js') : require('../../app/parser.js');

const SERVER = { name: 'money-desk', version: '1.0.0' };
const DEFAULT_FILE = path.join(os.homedir(), 'Documents', 'money-desk', 'money-desk', 'data', 'money-desk.json');

function dataFile() {
  const v = (process.env.MONEY_DESK_DATA || '').trim();
  return v && !v.includes('${') ? v : DEFAULT_FILE;
}

// Read fresh on every call so Claude always sees what the app last saved.
function loadData() {
  const file = dataFile();
  if (!fs.existsSync(file)) throw new Error(`Money Desk data file not found at ${file}. Open Money Desk once (it creates the file) or set the data file location in the extension settings.`);
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { txns: Array.isArray(d.txns) ? d.txns : [], rules: d.rules || {}, accounts: d.accounts || {}, savedAt: d.savedAt || null };
}

const kindOf = cat => (MD.CAT_BY_NAME[cat] || { kind: 'spend' }).kind;
const r2 = v => Math.round(v * 100) / 100;

// ---------- Filters ----------
function normDate(v, end) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return end ? s + '-31' : s + '-01';
  if (/^\d{4}$/.test(s)) return end ? s + '-12-31' : s + '-01-01';
  throw new Error(`Dates must look like 2026-08-14, 2026-08 or 2026 (got "${s}")`);
}
function applyFilters(txns, a) {
  const from = normDate(a.from, false), to = normDate(a.to, true);
  const acct = a.account ? String(a.account).toLowerCase() : null;
  const cat = a.category ? String(a.category).toLowerCase() : null;
  const q = a.search ? String(a.search).toLowerCase() : null;
  return txns.filter(t =>
    (!from || t.date >= from) && (!to || t.date <= to)
    && (!acct || t.account.toLowerCase().includes(acct))
    && (!cat || t.category.toLowerCase() === cat)
    && (!q || `${t.merchant} ${MD.redactDesc(t.desc)} ${t.category}`.toLowerCase().includes(q))
    && (a.direction === 'out' ? t.amount < 0 : a.direction === 'in' ? t.amount > 0 : true)
    && (a.min_amount == null || Math.abs(t.amount) >= a.min_amount)
    && (a.max_amount == null || Math.abs(t.amount) <= a.max_amount));
}
function rangeOf(list) {
  if (!list.length) return null;
  let a = list[0].date, b = a;
  for (const t of list) { if (t.date < a) a = t.date; if (t.date > b) b = t.date; }
  return { from: a, to: b };
}
function totals(list) {
  const o = { spent: 0, income: 0, invested: 0 };
  for (const t of list) {
    const k = kindOf(t.category);
    if (k === 'spend') o.spent -= t.amount;
    else if (k === 'income') o.income += t.amount;
    else if (k === 'invest') o.invested -= t.amount;
  }
  o.spent = r2(o.spent); o.income = r2(o.income); o.invested = r2(o.invested);
  o.saved = r2(o.income - o.spent);
  o.savings_rate_pct = o.income > 0 ? Math.round((o.saved / o.income) * 1000) / 10 : null;
  return o;
}
const publicTxn = t => ({ date: t.date, account: t.account, merchant: t.merchant, category: t.category, kind: kindOf(t.category), amount: t.amount, description: MD.redactDesc(t.desc) });

// ---------- Tools ----------
const dateProps = {
  from: { type: 'string', description: 'Start date, inclusive: YYYY-MM-DD, YYYY-MM or YYYY' },
  to: { type: 'string', description: 'End date, inclusive: YYYY-MM-DD, YYYY-MM or YYYY' },
  account: { type: 'string', description: 'Only this account (case-insensitive, partial match), e.g. "ICICI"' },
};
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const TOOLS = [
  {
    name: 'get_summary',
    title: 'Money summary',
    description: 'Totals for a period: spent, income, invested, saved and savings rate, plus month-by-month totals and spending by category. Amounts are in INR. "Spent" excludes card bill payments and transfers between own accounts, and refunds reduce it. Start here for any overview question.',
    inputSchema: { type: 'object', properties: { ...dateProps }, additionalProperties: false },
    annotations: { ...RO, title: 'Money summary' },
    run(a) {
      const d = loadData();
      const list = applyFilters(d.txns, a);
      const months = Object.create(null);
      for (const t of list) (months[t.date.slice(0, 7)] = months[t.date.slice(0, 7)] || []).push(t);
      const byCat = Object.create(null);
      for (const t of list) if (kindOf(t.category) === 'spend') byCat[t.category] = (byCat[t.category] || 0) - t.amount;
      const T = totals(list);
      return {
        period: rangeOf(list), transaction_count: list.length, totals: T,
        by_month: Object.keys(months).sort().map(m => ({ month: m, ...totals(months[m]) })),
        spending_by_category: Object.entries(byCat).filter(([, v]) => Math.abs(v) > 0.005).sort((x, y) => y[1] - x[1])
          .map(([category, v]) => ({ category, amount: r2(v), share_pct: T.spent > 0 ? Math.round((v / T.spent) * 1000) / 10 : null })),
        accounts_included: [...new Set(list.map(t => t.account))].sort(),
        data_last_saved: d.savedAt,
      };
    },
  },
  {
    name: 'list_transactions',
    title: 'List transactions',
    description: 'Individual transactions with date, account, merchant, category, amount (negative = money out, positive = money in) and the statement description. Filter by dates, account, category, text search, direction or amount. Results are paged.',
    inputSchema: {
      type: 'object',
      properties: {
        ...dateProps,
        category: { type: 'string', description: 'Exact category name, e.g. "Food & dining" (see get_accounts_and_categories)' },
        search: { type: 'string', description: 'Text to find in merchant, description or category, e.g. "swiggy"' },
        direction: { type: 'string', enum: ['out', 'in', 'all'], description: 'Money out, money in, or both (default all)' },
        min_amount: { type: 'number', description: 'Smallest absolute amount in INR' },
        max_amount: { type: 'number', description: 'Largest absolute amount in INR' },
        sort: { type: 'string', enum: ['date_desc', 'date_asc', 'amount_desc'], description: 'Order (default date_desc; amount_desc = largest first)' },
        limit: { type: 'number', description: 'Max rows to return (default 100, max 1000)' },
        offset: { type: 'number', description: 'Rows to skip, for paging' },
      },
      additionalProperties: false,
    },
    annotations: { ...RO, title: 'List transactions' },
    run(a) {
      const list = applyFilters(loadData().txns, a);
      const sort = a.sort || 'date_desc';
      list.sort((x, y) => sort === 'amount_desc' ? Math.abs(y.amount) - Math.abs(x.amount)
        : sort === 'date_asc' ? (x.date < y.date ? -1 : x.date > y.date ? 1 : 0)
        : (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
      const limit = Math.max(1, Math.min(1000, Math.floor(a.limit || 100)));
      const offset = Math.max(0, Math.floor(a.offset || 0));
      const page = list.slice(offset, offset + limit);
      return { total_matching: list.length, offset, returned: page.length, has_more: offset + page.length < list.length, transactions: page.map(publicTxn) };
    },
  },
  {
    name: 'spending_breakdown',
    title: 'Spending breakdown',
    description: 'Spending grouped by category, merchant, account or month, largest first, with transaction counts. Only counts spending (not income, investments or transfers).',
    inputSchema: {
      type: 'object',
      properties: {
        group_by: { type: 'string', enum: ['category', 'merchant', 'account', 'month'], description: 'How to group' },
        ...dateProps,
        category: { type: 'string', description: 'Only this category, e.g. to see merchants within "Shopping"' },
        top: { type: 'number', description: 'How many groups to return (default 25)' },
      },
      required: ['group_by'],
      additionalProperties: false,
    },
    annotations: { ...RO, title: 'Spending breakdown' },
    run(a) {
      const list = applyFilters(loadData().txns, a).filter(t => kindOf(t.category) === 'spend');
      const key = { category: t => t.category, merchant: t => t.merchant, account: t => t.account, month: t => t.date.slice(0, 7) }[a.group_by];
      if (!key) throw new Error('group_by must be category, merchant, account or month');
      const g = Object.create(null);
      for (const t of list) { const k = key(t); const o = g[k] || (g[k] = { name: k, amount: 0, count: 0 }); o.amount -= t.amount; o.count++; }
      let rows = Object.values(g).map(o => ({ ...o, amount: r2(o.amount) }));
      rows.sort(a.group_by === 'month' ? (x, y) => (x.name < y.name ? -1 : 1) : (x, y) => y.amount - x.amount);
      const total = r2(rows.reduce((s, o) => s + o.amount, 0));
      rows = rows.slice(0, Math.max(1, Math.min(500, Math.floor(a.top || 25))));
      return { group_by: a.group_by, period: rangeOf(list), total_spent: total, groups: rows.map(o => ({ ...o, share_pct: total > 0 ? Math.round((o.amount / total) * 1000) / 10 : null })) };
    },
  },
  {
    name: 'find_recurring_payments',
    title: 'Recurring payments',
    description: 'Payments that repeat at a similar amount across months (rent, SIPs, bills, subscriptions), with the typical monthly amount and last payment date. Needs at least 3 months of data for most items.',
    inputSchema: { type: 'object', properties: { account: dateProps.account }, additionalProperties: false },
    annotations: { ...RO, title: 'Recurring payments' },
    run(a) {
      const list = applyFilters(loadData().txns, a);
      const rec = MD.findRecurring(list).map(x => ({ merchant: x.merchant, category: x.category, typical_monthly_amount: r2(x.monthly), months_seen: x.months, last_paid: x.last }));
      return { count: rec.length, estimated_monthly_total: r2(rec.reduce((s, x) => s + x.typical_monthly_amount, 0)), payments: rec };
    },
  },
  {
    name: 'get_accounts_and_categories',
    title: 'Accounts and categories',
    description: 'Which accounts are imported (with date coverage and counts), the category list with what each counts as (spend, income, invest, transfer), and saved merchant-to-category rules. Useful to check what data exists before analysing.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { ...RO, title: 'Accounts and categories' },
    run() {
      const d = loadData();
      const acc = Object.create(null);
      for (const t of d.txns) {
        const o = acc[t.account] || (acc[t.account] = { account: t.account, type: (d.accounts[t.account] || {}).kind === 'card' ? 'credit card' : 'bank account', transactions: 0, first_date: t.date, last_date: t.date });
        o.transactions++; if (t.date < o.first_date) o.first_date = t.date; if (t.date > o.last_date) o.last_date = t.date;
      }
      return {
        data_last_saved: d.savedAt,
        accounts: Object.values(acc).sort((x, y) => x.account.localeCompare(y.account)),
        categories: MD.CATEGORIES.map(c => ({ name: c.name, counts_as: c.kind })),
        saved_rules: Object.entries(d.rules).map(([merchant, category]) => ({ merchant, category })),
      };
    },
  },
];

const INSTRUCTIONS = 'Read-only access to the user\'s Money Desk ledger: transactions imported from their Indian bank and credit card statements. Amounts are INR; negative = money out. Card bill payments and transfers between their own accounts are category "Card payments & transfers" and are not spending. Call get_accounts_and_categories first to see which accounts and months exist, and say when data is missing for a period rather than treating it as zero spending.';

// ---------- JSON-RPC over stdio ----------
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  try {
    if (method === 'initialize') {
      return reply(id, {
        protocolVersion: (params && params.protocolVersion) || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: INSTRUCTIONS,
      });
    }
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') return reply(id, { tools: TOOLS.map(({ run, ...t }) => t) });
    if (method === 'tools/call') {
      const tool = TOOLS.find(t => t.name === (params && params.name));
      if (!tool) return fail(id, -32602, `Unknown tool: ${params && params.name}`);
      try {
        const out = tool.run((params && params.arguments) || {});
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: out, isError: false });
      } catch (e) {
        return reply(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
      }
    }
    if (!isRequest) return; // notifications (e.g. notifications/initialized) need no answer
    return fail(id, -32601, `Method not found: ${method}`);
  } catch (e) {
    if (isRequest) fail(id, -32603, e.message);
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { fail(null, -32700, 'Parse error'); continue; }
    if (Array.isArray(msg)) msg.forEach(handle); else handle(msg);
  }
});
process.stdin.on('end', () => process.exit(0));
