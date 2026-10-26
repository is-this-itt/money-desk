// Password-protected Excel files. The fixtures are made-up statements, encrypted with the
// password "test1234" by msoffcrypto-tool (agile, SHA-512 and SHA-256) and by Office's standard AES scheme.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const XLSX = require('../app/vendor/xlsx.full.min.js');
const C = require('../app/officecrypto.js');
const MD = require('../app/parser.js');

const load = n => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', n)));

test('sha1 and sha512 match Node for many lengths', () => {
  for (const n of [0, 1, 55, 56, 64, 111, 112, 128, 1000]) {
    const m = crypto.randomBytes(n);
    assert.strictEqual(Buffer.from(C.sha1(new Uint8Array(m))).toString('hex'), crypto.createHash('sha1').update(m).digest('hex'));
    assert.strictEqual(Buffer.from(C.sha512(new Uint8Array(m))).toString('hex'), crypto.createHash('sha512').update(m).digest('hex'));
  }
});

// locked-agile-sha256.xlsx uses SHA-256 (the Web Crypto path) with AES-128.
for (const name of ['locked-agile.xlsx', 'locked-standard.xlsx', 'locked-agile-sha256.xlsx']) {
  test(`${name}: detected, wrong password refused, right password opens the statement`, async () => {
    const bytes = load(name);
    assert.ok(C.isEncrypted(XLSX.CFB, bytes));
    assert.throws(() => XLSX.read(bytes, { type: 'array' }), /password/i);
    assert.strictEqual(await C.decrypt(XLSX.CFB, bytes, 'wrong'), null);
    const plain = await C.decrypt(XLSX.CFB, bytes, 'test1234');
    const wb = XLSX.read(plain, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
    const r = MD.rowsToTxns(rows, MD.detectColumns(rows), { account: 'SBI Savings', accountKind: 'bank', rules: {} });
    assert.strictEqual(r.txns.length, 202);
    assert.deepStrictEqual(r.txns.slice(0, 2).map(t => [t.date, t.amount]), [['2026-10-01', 85000], ['2026-10-02', -450]]);
  });
}

test('plain files are not treated as encrypted', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a']]), 'S');
  assert.strictEqual(C.isEncrypted(XLSX.CFB, new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }))), false);
  assert.strictEqual(C.isEncrypted(XLSX.CFB, new Uint8Array(XLSX.write(wb, { bookType: 'biff8', type: 'array' }))), false);
});

test('file values that could hang or exhaust the page are refused', async () => {
  const tamper = (from, to) => {
    const cfb = XLSX.CFB.read(load('locked-agile.xlsx'), { type: 'array' });
    const e = XLSX.CFB.find(cfb, 'EncryptionInfo');
    e.content = Buffer.from(Buffer.from(e.content).toString('latin1').replace(from, to), 'latin1');
    return new Uint8Array(XLSX.CFB.write(cfb, { type: 'array' }));
  };
  await assert.rejects(C.decrypt(XLSX.CFB, tamper(/spinCount="\d+"/, 'spinCount="4000000000"'), 'test1234'), /can.t open yet/);
  await assert.rejects(C.decrypt(XLSX.CFB, tamper(/(keyData[^>]*?)blockSize="16"/, '$1blockSize="32"'), 'test1234'), /can.t open yet/);
  const cfb = XLSX.CFB.read(load('locked-standard.xlsx'), { type: 'array' });
  const pkg = XLSX.CFB.find(cfb, 'EncryptedPackage');
  const c = Buffer.from(pkg.content); c.writeUInt32LE(0xffffff00, 0); pkg.content = c;
  await assert.rejects(C.decrypt(XLSX.CFB, new Uint8Array(XLSX.CFB.write(cfb, { type: 'array' })), 'test1234'), /damaged/);
});

test('a truncated standard encryption header is reported as damaged', async () => {
  const cfb = XLSX.CFB.read(load('locked-standard.xlsx'), { type: 'array' });
  const info = XLSX.CFB.find(cfb, 'EncryptionInfo');
  info.content = Buffer.from(info.content).subarray(0, 60);
  await assert.rejects(C.decrypt(XLSX.CFB, new Uint8Array(XLSX.CFB.write(cfb, { type: 'array' })), 'test1234'), /damaged/);
});

test('every guide link host can be opened by the helper', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app', 'app.js'), 'utf8');
  const ps = fs.readFileSync(path.join(__dirname, '..', 'serve.ps1'), 'utf8');
  const guide = new Set([...app.matchAll(/url: '(https:\/\/[^']+)'/g)].map(m => new URL(m[1]).host));
  const allowed = new Set([...(/\$linkHosts = @\(([\s\S]*?)\)/.exec(ps) || [])[1].matchAll(/'([^']+)'/g)].map(m => m[1]));
  assert.ok(guide.size > 10);
  assert.deepStrictEqual([...guide].sort(), [...allowed].sort());
});
