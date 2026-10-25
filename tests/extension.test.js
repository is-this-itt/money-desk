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
  ];
  fs.writeFileSync(file, JSON.stringify({ txns, rules: {}, accounts: { Card: { kind: 'card' } } }));
  const before = fs.readFileSync(file, 'utf8');
  const res = await call(file, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_summary', arguments: {} } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'spending_breakdown', arguments: { group_by: 'merchant' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_transactions', arguments: { from: 'Aug 2026' } } },
  ]);
  const byId = Object.fromEntries(res.map(r => [r.id, r]));
  assert.ok(byId[2].result.tools.every(t => t.annotations.readOnlyHint));
  assert.strictEqual(byId[3].result.structuredContent.totals.spent, 700);
  assert.deepStrictEqual(byId[4].result.structuredContent.groups.map(g => g.name).sort(), ['Swiggy', '__proto__'].sort());
  assert.strictEqual(byId[5].result.isError, true);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before, 'data file must not change');
});
