// Runs the Claude extension over stdio against a made-up data file.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function call(dataFile, messages) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(__dirname, '..', 'claude-extension', 'server', 'index.js')], { env: { ...process.env, MONEY_DESK_DATA: dataFile } });
    let out = '';
    p.stdout.on('data', d => (out += d));
    p.on('error', reject);
    p.on('close', () => resolve(out.trim().split('\n').map(l => JSON.parse(l))));
    for (const m of messages) p.stdin.write(JSON.stringify(m) + '\n');
    p.stdin.end();
  });
}

test('read-only tools answer over stdio', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-'));
  const file = path.join(dir, 'money-desk.json');
  const txns = [
    { date: '2026-08-14', amount: -500, desc: 'SWIGGY', merchant: 'Swiggy', account: 'Card', category: 'Food & dining', id: 'a1' },
    { date: '2026-08-15', amount: 1000, desc: 'PAYMENT RECEIVED', merchant: 'Payment', account: 'Card', category: 'Card payments & transfers', id: 'a2' },
    { date: '2026-08-16', amount: -200, desc: 'x', merchant: '__proto__', account: 'Card', category: 'Other', id: 'a3' },
    { date: '2026-08-17', amount: -50, desc: 'UPI/DR/627512345678/RAHUL/SBIN/rahul.s@oksbi/UPI', merchant: 'Rahul', account: 'Card', category: 'People (UPI)', id: 'a4' },
    { date: 'bad', amount: 'x' }, null, { date: '2026-08-18', amount: -1, desc: null, merchant: 7, account: 'Card', category: 'Other', id: 'a5' },
  ];
  const services = [
    { id: 's1', type: 'Subscription', name: 'Netflix', amount: 649, freq: 'Monthly', day: 5, from: 'Card', notes: 'card 4111 1111 1111 1234', active: true },
    { id: 's2', type: 'Insurance', name: 'Term plan', provider: 'acct 123456789012', from: 'rahul.s@oksbi', amount: 12000, freq: 'Yearly', active: true },
    { id: 's3', type: 'Subscription', name: 'Old gym', amount: 1500, freq: 'Monthly', active: false },
  ];
  fs.writeFileSync(file, JSON.stringify({ txns, rules: {}, accounts: { Card: { kind: 'card' } }, services }));
  const before = fs.readFileSync(file, 'utf8');
  const res = await call(file, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_summary', arguments: {} } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'spending_breakdown', arguments: { group_by: 'merchant' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_transactions', arguments: { from: 'Aug 2026' } } },
    // Search sees only masked text, so it can't be used to guess hidden digits or UPI IDs.
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'list_transactions', arguments: { search: '6275' } } },
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'list_transactions', arguments: { search: 'rahul.s@' } } },
    { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'list_transactions', arguments: { search: '5678' } } },
    { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'list_services', arguments: {} } },
  ]);
  const byId = Object.fromEntries(res.map(r => [r.id, r]));
  assert.ok(byId[2].result.tools.every(t => t.annotations.readOnlyHint));
  assert.strictEqual(byId[3].result.structuredContent.totals.spent, 751);
  assert.deepStrictEqual(byId[4].result.structuredContent.groups.map(g => g.name).sort(), ['7', 'Rahul', 'Swiggy', '__proto__'].sort());
  assert.strictEqual(byId[5].result.isError, true);
  assert.strictEqual(byId[6].result.structuredContent.total_matching, 0);
  assert.strictEqual(byId[7].result.structuredContent.total_matching, 0);
  const svc = byId[9].result.structuredContent;
  assert.deepStrictEqual(svc.services.map(v => v.name), ['Netflix', 'Term plan']);
  assert.strictEqual(svc.estimated_monthly_payments, 1649);
  assert.strictEqual(svc.services[0].notes, 'card XX1234');
  assert.strictEqual(svc.services[1].provider, 'acct XXXXXXXX9012');
  assert.strictEqual(svc.services[1].paid_from, 'ra***@oksbi');
  assert.strictEqual(byId[8].result.structuredContent.transactions[0].description, 'UPI/DR/XXXXXXXX5678/RAHUL/SBIN/ra***@oksbi/UPI');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before, 'data file must not change');
});
