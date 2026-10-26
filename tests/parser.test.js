// Parser tests with made-up statement rows (never real data).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const MD = require('../app/parser.js');

const pick = r => r.txns.map(t => [t.date, t.merchant, t.amount, t.category]);

test('SBI-style Excel rows with preamble and debit/credit columns', () => {
  const rows = [
    ['Account Name', ':', 'Test User'], [],
    ['Txn Date', 'Value Date', 'Description', 'Ref No./Cheque No.', 'Debit', 'Credit', 'Balance'],
    ['1 Oct 2026', '1 Oct 2026', 'BY TRANSFER-NEFT*ACME TECH PVT LTD*SALARY OCT', 'N1', '', '85,000.00', '1,20,000.00'],
    ['2 Oct 2026', '2 Oct 2026', 'TO TRANSFER-UPI/DR/627512345678/SWIGGY/YESB/swiggy@ybl/Payment', 'T', '450.00', '', '1,19,550.00'],
    ['3 Oct 2026', '3 Oct 2026', 'TO TRANSFER-UPI/DR/627598765432/RAHUL SHARMA/SBIN/rahul.s@oksbi/UPI', 'T', '2,000.00', '', '1,17,550.00'],
    ['5 Oct 2026', '5 Oct 2026', 'TO TRANSFER-INB HDFC CREDIT CARD PAYMENT', '', '15,000.00', '', '1,02,550.00'],
    ['7 Oct 2026', '7 Oct 2026', 'ACH DR GROWW SIP NEXTBILLION', '', '5,000.00', '', '97,550.00'],
  ];
  const det = MD.detectColumns(rows);
  assert.deepStrictEqual(det.map, { balance: 6, date: 0, desc: 2, debit: 4, credit: 5 });
  assert.deepStrictEqual(pick(MD.rowsToTxns(rows, det, { account: 'SBI', accountKind: 'bank', rules: {} })), [
    ['2026-10-01', 'Acme Tech Pvt Ltd', 85000, 'Salary'],
    ['2026-10-02', 'Swiggy', -450, 'Food & dining'],
    ['2026-10-03', 'Rahul Sharma', -2000, 'People (UPI)'],
    ['2026-10-05', 'HDFC Credit Card Payment', -15000, 'Card payments & transfers'],
    ['2026-10-07', 'Groww SIP Nextbillion', -5000, 'Investments'],
  ]);
});

test('Kotak-style rows with a single amount and Dr/Cr column', () => {
  const rows = [
    ['Sl. No.', 'Transaction Date', 'Value Date', 'Description', 'Chq / Ref No.', 'Amount', 'Dr / Cr', 'Balance', 'Dr / Cr'],
    ['1', '04/10/2026', '04/10/2026', 'UPI/BLINKIT/427812345678/Payment', 'U', '612.50', 'DR', '10,000.00', 'CR'],
    ['2', '06/10/2026', '06/10/2026', 'Int.Pd:1234:01-07-2026 to 30-09-2026', '', '312.00', 'CR', '10,312.00', 'CR'],
  ];
  const det = MD.detectColumns(rows);
  assert.strictEqual(det.map.amount, 5);
  assert.strictEqual(det.map.type, 6);
  const r = MD.rowsToTxns(rows, det, { account: 'Kotak', accountKind: 'bank', rules: {} });
  assert.deepStrictEqual(r.txns.map(t => [t.amount, t.category]), [[-612.5, 'Groceries'], [312, 'Interest & dividends']]);
});

test('Card PDF lines: Cr marker, AM/PM-like merchant names, reward points and footer text', () => {
  const lines = [
    '12/10/2026 13:22:01  ZOMATO LTD GURGAON  540.00',
    '28/09/2026 13:22:01 AMAZON PAY INDIA PRIVATE BANGALORE 2,349.00',
    '15/10/2026  BBPS PAYMENT RECEIVED 12,000.00 Cr',
    '14/08/2026 AMAZON PAY WALLET LOAD BANGALORE 33 IN 1,658.00',
    '30/08/2026 AMAZON PAY IN UTILITY BANGALORE IN 16 Others-100% # International Spends 830.00',
    '18/08/2026 RAZ*Furlenco Bengaluru KA IN 13 1,325.02',
  ];
  assert.deepStrictEqual(pick(MD.linesToTxns(lines, { account: 'Card', accountKind: 'card', rules: {} })), [
    ['2026-10-12', 'Zomato Ltd', -540, 'Food & dining'],
    ['2026-09-28', 'Amazon Pay India Private', -2349, 'Shopping'],
    ['2026-10-15', 'Bbps Payment Received', 12000, 'Card payments & transfers'],
    ['2026-08-14', 'Amazon Pay Wallet Load', -1658, 'Shopping'],
    ['2026-08-30', 'Amazon Pay In Utility', -830, 'Bills & utilities'],
    ['2026-08-18', 'Furlenco', -1325.02, 'Rent & housing'],
  ]);
});

test('Bank PDF lines use the running balance for direction', () => {
  const lines = ['Opening Balance 50,000.00',
    '01-10-2026 01-10-2026 UPI/DR/1234567890/ZEPTO MARKETPLACE/ICIC 845.00 49,155.00',
    '02-10-2026 02-10-2026 NEFT CR SALARY ACME 60,000.00 1,09,155.00'];
  assert.deepStrictEqual(MD.linesToTxns(lines, { account: 'K', accountKind: 'bank', rules: {} }).txns.map(t => t.amount), [-845, 60000]);
});

test('Sensitive values are masked, not removed, and ids ignore masking', () => {
  assert.strictEqual(MD.redactDesc('UPI/DR/627512345678/RAHUL SHARMA/SBIN/rahul.s@oksbi/UPI'), 'UPI/DR/XXXXXXXX5678/RAHUL SHARMA/SBIN/ra***@oksbi/UPI');
  assert.strictEqual(MD.redactDesc('POS 4386XXXXXXXX1234 SWIGGY'), 'POS XX1234 SWIGGY');
  const a = MD.makeTxn({ date: '2026-10-03', desc: 'UPI/DR/627512345678/X Y/SBIN/xy@oksbi/UPI', amount: -1, account: 'A', accountKind: 'bank', rules: {} });
  const b = MD.makeTxn({ date: '2026-10-03', desc: 'UPI/DR/627512345678/X Y/SBIN/xy@oksbi/UPI', amount: -1, account: 'A', accountKind: 'bank', rules: {} });
  assert.strictEqual(a.id, b.id);
  assert.ok(!a.desc.includes('627512345678') && !a.desc.includes('xy@oksbi'));
});

test('Card numbers written in groups are masked', () => {
  assert.strictEqual(MD.redactDesc('PAYMENT TO 4111 1111 1111 1234 THANK YOU'), 'PAYMENT TO XX1234 THANK YOU');
  assert.strictEqual(MD.redactDesc('CARD 4111-1111-1111-1234'), 'CARD XX1234');
  assert.strictEqual(MD.redactDesc('AMEX 3782 822463 10005'), 'AMEX XX0005');
  assert.strictEqual(MD.redactDesc('TXN 25-10-2026 SWIGGY'), 'TXN 25-10-2026 SWIGGY');
  assert.strictEqual(MD.redactDesc('DINERS 3056 930902 5904'), 'DINERS XX5904');
  assert.strictEqual(MD.redactDesc('REF 2026 1234 5678'), 'REF 2026 1234 5678');
});

test('Saved rules win, and a __proto__ merchant cannot hijack categorisation', () => {
  assert.strictEqual(MD.categorize('SWIGGY', 'Swiggy', -10, { swiggy: 'Groceries' }, 'card'), 'Groceries');
  assert.strictEqual(MD.categorize('x', '__proto__', -5, {}, 'bank'), 'Other');
});

test('Dates: Indian day-first formats and Excel serials', () => {
  assert.strictEqual(MD.parseDate('04/10/2026'), '2026-10-04');
  assert.strictEqual(MD.parseDate('1 Oct 26'), '2026-10-01');
  assert.strictEqual(MD.parseDate('2026-10-05'), '2026-10-05');
  assert.strictEqual(MD.parseDate(46300), '2026-10-05');
  assert.strictEqual(MD.parseDate('31/02/2026'), null);
});

test('services template rows: aliases, padding, masking hints and problems', () => {
  const rows = [
    ['My list'], [],
    ['Type', 'Name', 'Bank or provider', 'Last 4 digits', 'Amount', 'How often', 'Day', 'Paid from', 'Notes', 'Status'],
    ['subscription', 'Netflix', '', '', '649', 'monthly', '5th', 'HDFC card', '', ''],
    ['card', 'ICICI Amazon Pay', 'ICICI', 123, '', '', 18, '', '', 'Active'],
    ['SIP', 'Groww SIP', 'Groww', '', '₹5,000', 'Monthly', '7', 'SBI Savings', '', 'stopped'],
    ['Bank account', 'Kotak Savings', 'Kotak', '1234567890123456', '', 'None', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', ''],
    ['Insurance', '', 'LIC', '', 'abc', 'fortnightly', '40', '', '', ''],
    ['Gadget', 'Something', '', '12a4', '', '', '', '', '', ''],
  ];
  const { rows: out } = MD.readServiceRows(rows);
  assert.strictEqual(out.length, 6);
  assert.deepStrictEqual(out[0].value, { name: 'Netflix', provider: '', from: 'HDFC card', notes: '', active: true, type: 'Subscription', freq: 'Monthly', last4: '', amount: 649, day: 5 });
  assert.deepStrictEqual([out[1].value.type, out[1].value.last4, out[1].value.day], ['Credit card', '0123', 18]);
  assert.deepStrictEqual([out[2].value.type, out[2].value.amount, out[2].value.active], ['SIP / investment', 5000, false]);
  assert.deepStrictEqual([out[3].value.last4, out[3].notes], ['3456', ['Kept only the last 4 digits']]);
  assert.strictEqual(out[4].row, 9);
  assert.deepStrictEqual(out[4].problems, ['Name is empty', '"How often" must be Monthly, Quarterly, Yearly, One-time, None', 'Amount must be a number, like 649', 'Day must be between 1 and 31']);
  assert.deepStrictEqual([out[5].value.type, out[5].notes, out[5].problems], ['Other', ['Type "Gadget" saved as Other'], ['Last 4 digits must be 4 numbers']]);
});

test('services sheet without a Name column is rejected', () => {
  assert.ok(MD.readServiceRows([['Date', 'Amount'], ['1 Oct', '5']]).error);
});

test('service type words match whole words only', () => {
  const type = t => MD.readServiceRows([['Type', 'Name'], [t, 'x']]).rows[0].value.type;
  assert.deepStrictEqual(['Debit card', 'card', 'FD', 'Mutual funds', 'NACH', 'self-drive', 'offday'].map(type),
    ['Bank account', 'Credit card', 'SIP / investment', 'SIP / investment', 'Mandate / autopay', 'Other', 'Other']);
});

test('service frequency accepts plain words and flags anything ambiguous', () => {
  const read = f => { const r = MD.readServiceRows([['Name', 'How often'], ['x', f]]).rows[0]; return r.problems.length ? 'problem' : r.value.freq; };
  assert.deepStrictEqual(['Monthly', 'every  month', 'Annual', 'p.a.', 'One-time', 'once', 'Quarterly', 'none', ''].map(read),
    ['Monthly', 'Monthly', 'Yearly', 'Yearly', 'One-time', 'One-time', 'Quarterly', 'None', 'None']);
  assert.deepStrictEqual(['Bi-monthly', 'Every 2 months', 'Half-yearly', 'Biannual', 'Money', 'Phone'].map(read), Array(6).fill('problem'));
});

test('service status, amount and day formats, and duplicate keys', () => {
  const rows = MD.readServiceRows([
    ['Name', 'Amount', 'Day', 'Status'],
    ['a', 'Rs 649', new Date(2026, 9, 18), 'Active'],
    ['b', 'INR 1,200.50', '', 'Closed'],
    ['c', '', '', 'paused'],
    ['d', '', '', 'yes'],
  ]).rows;
  assert.deepStrictEqual(rows.map(r => [r.value.amount, r.value.day, r.value.active, r.problems]), [
    [649, 18, true, []], [1200.5, null, false, []], ['', null, true, ['Status must be Active or Stopped']], ['', null, true, []],
  ]);
  const base = { type: 'Subscription', name: 'Netflix', last4: '', amount: 649, day: 5 };
  assert.strictEqual(MD.serviceKey(base), MD.serviceKey({ ...base, name: 'NETFLIX ' }));
  assert.notStrictEqual(MD.serviceKey(base), MD.serviceKey({ ...base, amount: 199 }));
  assert.strictEqual(MD.serviceKey({ ...base, amount: null, day: null }), MD.serviceKey({ ...base, amount: '', day: null }));
});
