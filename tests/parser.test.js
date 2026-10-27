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
  // Phone and account numbers written in groups keep only their last 4 digits.
  assert.strictEqual(MD.redactDesc('REF 2026 1234 5678'), 'REF XXXXXXXX5678');
  assert.strictEqual(MD.redactDesc('UPI/CALL 98765 43210/UPI'), 'UPI/CALL XXXXXX3210/UPI');
  assert.strictEqual(MD.redactDesc('MOB +91-98765-43210 PAID'), 'MOB +XXXXXXXX3210 PAID');
  assert.strictEqual(MD.redactDesc('CALL 987-654-3210'), 'CALL XXXXXX3210');
  assert.strictEqual(MD.redactDesc('CALL 98 7654 3210'), 'CALL XXXXXX3210');
  assert.strictEqual(MD.redactDesc('FY 2025-2026 TAX'), 'FY 2025-2026 TAX');
  assert.strictEqual(MD.redactDesc('PERIOD 2025 2026'), 'PERIOD 2025 2026');
  assert.strictEqual(MD.redactDesc('TXN 25 10 2026 ON 26-10-2026'), 'TXN 25 10 2026 ON 26-10-2026');
  // A run is not allowed to swallow a date or small groups of amounts.
  assert.strictEqual(MD.redactDesc('AT 25-10-2026 14 35 22'), 'AT 25-10-2026 14 35 22');
  assert.strictEqual(MD.redactDesc('PAID 500 100 200 300 50'), 'PAID 500 100 200 300 50');
  assert.strictEqual(MD.redactDesc('ON 5-10-2026 98765 43210'), 'ON 5-10-2026 XXXXXX3210');
  assert.strictEqual(MD.redactDesc('REF 98765 43210 25 10 2026 14 35'), 'REF XXXXXX3210 25 10 2026 14 35');
  assert.strictEqual(MD.redactDesc('TXN 2026-10-25 14:35:22'), 'TXN 2026-10-25 14:35:22');
  assert.strictEqual(MD.redactDesc('REF 2026-10-25 98765 43210'), 'REF 2026-10-25 XXXXXX3210');
  assert.strictEqual(MD.redactDesc('ON 25-10-26 98765 43210'), 'ON 25-10-26 XXXXXX3210');
  assert.strictEqual(MD.redactDesc('98765 43210 2026-10-25'), 'XXXXXX3210 2026-10-25');
  // Two-digit groups are not taken for a date, and a phone number in them is masked.
  assert.strictEqual(MD.redactDesc('CALL 12 34 56 78 90'), 'CALL XXXXXX7890');
  assert.strictEqual(MD.redactDesc('CALL 98 76 54 3210'), 'CALL XXXXXX3210');
  assert.strictEqual(MD.redactDesc('CALL 98 76 54 32 10'), 'CALL XXXXXX3210');
  // d m yy with spaces is not read as a date, so it is masked with the number next to it.
  assert.strictEqual(MD.redactDesc('ON 25 10 26 98765 43210'), 'ON XX3210');
  assert.strictEqual(MD.redactDesc('TXN 25-10-2026 14 35 2026-10-25'), 'TXN 25-10-2026 14 35 2026-10-25');
  // A date in the middle of a run: each side is judged on its own.
  assert.strictEqual(MD.redactDesc('REF 98765 43210 25-10-2026 1234 5678'), 'REF XXXXXX3210 25-10-2026 XXXX5678');
  assert.strictEqual(MD.redactDesc('REF 98765 43210 25-10-2026'), 'REF XXXXXX3210 25-10-2026');
  assert.strictEqual(MD.redactDesc('CALL 98765 43 21 10'), 'CALL XXXXXXX2110');
  assert.strictEqual(MD.redactDesc('AT 14 35 22'), 'AT 14 35 22');
  // Invoice numbers written in 4-digit groups are masked like other references.
  assert.strictEqual(MD.redactDesc('INV-2026-0045'), 'INV-XXXX0045');
  // A merchant name never keeps a number written in groups.
  assert.strictEqual(MD.extractMerchant('POS ACME STORE 987-654-3210').name, 'Acme Store');
  assert.strictEqual(MD.redactDesc('A/C 1234 5678 9012'), 'A/C XXXXXXXX9012');
  assert.strictEqual(MD.redactDesc('UPI 1500 OCT 2026'), 'UPI 1500 OCT 2026');
  assert.strictEqual(MD.redactDesc(MD.redactDesc('UPI/CALL 98765 43210/UPI')), 'UPI/CALL XXXXXX3210/UPI');
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

test('service types: specific words win over account/card, guesses are noted', () => {
  const r = t => MD.readServiceRows([['Type', 'Name'], [t, 'x']]).rows[0];
  assert.deepStrictEqual(['Home loan account', 'PPF account', 'Mutual fund account', 'Health insurance card', 'Salary account'].map(t => r(t).value.type),
    ['Loan / EMI', 'SIP / investment', 'SIP / investment', 'Insurance', 'Bank account']);
  assert.deepStrictEqual(r('Home loan account').notes, ['Type read as Loan / EMI']);
  assert.deepStrictEqual(r('Insurance').notes, []);
  assert.deepStrictEqual(r('').notes, []);
});

test('services header row needs Name plus another known column; amount 0 and row cap', () => {
  const res = MD.readServiceRows([['Service'], ['Name', 'Amount'], ['Netflix', 0]]);
  assert.deepStrictEqual(res.rows.map(r => [r.row, r.value.name, r.problems]), [[3, 'Netflix', ['Amount must be more than 0']]]);
  assert.ok(MD.readServiceRows([['Name']]).error);
  const many = [['Name', 'Amount']].concat(Array.from({ length: 1001 }, (_, i) => ['s' + i, 1]));
  assert.match(MD.readServiceRows(many).error, /more than 1000 rows/);
});

test('planServiceImport sorts rows into ready, duplicate and problem', () => {
  const existing = [{ type: 'Subscription', name: 'Netflix', last4: '', amount: 649, day: 5, active: false }];
  const { rows } = MD.readServiceRows([
    ['Type', 'Name', 'Amount', 'Day'],
    ['Subscription', 'NETFLIX', 649, 5], // same as a stopped saved service
    ['Subscription', 'Spotify', 119, 1],
    ['Subscription', 'spotify ', 119, 1], // repeats the row above
    ['Subscription', 'Card 4111111111111111', 10, 1],
    ['Subscription', '', 10, 1],
  ]);
  const clean = v => (v.name ? { ...v, name: MD.redactDesc(v.name), amount: v.amount === '' ? null : v.amount } : null);
  const plan = MD.planServiceImport(rows, existing, clean);
  assert.deepStrictEqual(plan.lines.map(l => [l.row, l.kind, l.status]), [
    [2, 'dup', 'Already on your list'], [3, 'ok', 'Ready'], [4, 'dup', 'Repeats an earlier row'], [5, 'ok', 'Ready'], [6, 'bad', 'Name is empty'],
  ]);
  assert.deepStrictEqual(plan.ready.map(v => v.name), ['Spotify', 'Card XXXXXXXXXXXX1111']);
  assert.deepStrictEqual([plan.dup, plan.bad], [2, 1]);
  // a masked name matches the same masked name already saved
  assert.strictEqual(MD.planServiceImport(rows.slice(3, 4), plan.ready, clean).dup, 1);
});

test('readServiceBook keeps CSV leading zeros and prefers the Services sheet', () => {
  const XLSX = require('../app/vendor/xlsx.full.min.js');
  const csv = MD.readServiceBook(XLSX, 'Name,Last 4 digits\nICICI card,0123\n', true);
  assert.strictEqual(csv.rows[0].value.last4, '0123');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Notes'], ['ignore me']]), 'Read me');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name', 'Last 4 digits'], ['ICICI card', 123]]), 'Services');
  const xlsx = MD.readServiceBook(XLSX, new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' })), false);
  assert.deepStrictEqual(xlsx.rows.map(r => [r.value.name, r.value.last4]), [['ICICI card', '0123']]);
});

test('services: a long number typed in Excel is a problem, row numbers follow the sheet', () => {
  const r = MD.readServiceRows([['Name', 'Last 4 digits'], ['card', 4111111111111110], ['card', '4111111111111111']], 3).rows;
  assert.deepStrictEqual(r.map(x => [x.row, x.value.last4, x.problems]), [
    [4, undefined, ['Last 4 digits: type only the last 4 (Excel changes long numbers)']], [5, '1111', []],
  ]);
  const XLSX = require('../app/vendor/xlsx.full.min.js');
  const ws = XLSX.utils.aoa_to_sheet([['Name', 'Amount'], ['Netflix', 649]], { origin: 'B3' });
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Services');
  const res = MD.readServiceBook(XLSX, new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' })), false);
  assert.deepStrictEqual(res.rows.map(x => [x.row, x.value.name]), [[4, 'Netflix']]);
});

test('the downloadable template reads back cleanly and keeps Last 4 as text', () => {
  const XLSX = require('../app/vendor/xlsx.full.min.js');
  const wb = MD.serviceTemplateBook(XLSX);
  assert.deepStrictEqual(wb.SheetNames, ['Services', 'How to fill']);
  const bytes = new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
  assert.deepStrictEqual(MD.readServiceBook(XLSX, bytes, false), { rows: [] });
  const back = XLSX.read(bytes, { type: 'array', cellNF: true }).Sheets.Services;
  assert.strictEqual(back.D2.z, '@');
  // every template column is recognised as a header
  XLSX.utils.sheet_add_aoa(wb.Sheets.Services, [['Bank account', 'Savings', 'HDFC', '0123', 1, 'None', 1, 'x', 'y', 'Active']], { origin: 'A2' });
  const filled = MD.readServiceBook(XLSX, new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' })), false);
  assert.deepStrictEqual(filled.rows[0].value, { name: 'Savings', provider: 'HDFC', from: 'x', notes: 'y', active: true, type: 'Bank account', freq: 'None', last4: '0123', amount: 1, day: 1 });
});

test('service key includes the provider; short numeric last 4 has the plain message', () => {
  const a = { type: 'Bank account', name: 'Savings', provider: 'HDFC', last4: '', amount: null, day: null };
  assert.notStrictEqual(MD.serviceKey(a), MD.serviceKey({ ...a, provider: 'SBI' }));
  assert.deepStrictEqual(MD.readServiceRows([['Name', 'Last 4 digits'], ['x', 12345]]).rows[0].problems, ['Last 4 digits must be 4 numbers']);
});

test('SBI 2026 descriptions: words cut by the statement still give the payee and category', () => {
  const cat = (desc, amount) => { const m = MD.extractMerchant(desc); let c = MD.categorize(desc, m.name, amount, {}, 'bank'); if (c === 'Other' && m.person) c = 'People (UPI)'; return [m.name, c]; };
  const tail = ' 12345672091 AT 01234 TESTPUR';
  assert.deepStrictEqual(cat('WDL TFR UPI/DR/612345678901/Blinkit/HDFC/bl inkit.rz/Payvi' + tail, -250), ['Blinkit', 'Groceries']);
  assert.deepStrictEqual(cat('WDL TFR UPI/DR/612345678902/RAHUL SH/SBIN/r ahulsharm/UPI' + tail, -500), ['Rahul Sh', 'People (UPI)']);
  assert.deepStrictEqual(cat('WDL TFR UPI/DR/612345678903/BHARTI A/YESB/a irtelprep/UPI' + tail, -299), ['Bharti A', 'Bills & utilities']);
  assert.deepStrictEqual(cat('WDL TFR UPI/DR/612345678904/SBI Card/YESB/s bicardp.b/UPI' + tail, -3000), ['SBI Card', 'Card payments & transfers']);
  assert.deepStrictEqual(cat('WDL TFR UPI/DR/612345678905/9876543210/utib/9 87654321/UPI' + tail, -100), ['UPI payment', 'People (UPI)']);
  assert.deepStrictEqual(cat('DEP TFR NEFT*IDFB0001234*IDFBH2601234567*R ZPX PVT LTD PA 12345674300 AT 01234 TESTPUR', 90000), ['Rzpx Pvt Ltd Pa', 'Salary']);
  assert.deepStrictEqual(cat('DEP TFR NEFT*UTIB0000004*AXISCN012345678*A XIS MUTUAL FUN 12345674300 AT 01234 TESTPUR', 20000), ['Axis Mutual Fun', 'Investments']);
  assert.deepStrictEqual(cat('DEBIT ACHDr YESB00709 123458661 Indian Clearin', -5000), ['Indian Clearin', 'Investments']);
  assert.deepStrictEqual(cat('WDL TFR SBIY1234567890123456789/P/Bill Payment 0 12349104 OF TEST JEWELLERS AT 01234 TESTPUR', -40000), ['Test Jewellers', 'Shopping']);
  assert.deepStrictEqual(cat('WDL TFR INB TEST LIFE INSURANCE CO MPAN 12345672090 AT 01234 TESTPUR', -10000), ['Test Life Insurance Co Mpan', 'Insurance']);
  assert.deepStrictEqual(cat('INTERES T CREDIT', 65), ['Interes T Credit', 'Interest & dividends']);
  assert.deepStrictEqual(cat('DEP TFR UPI/CR/612345678906/PRIYA KU/KKBK/p riyak.ok/UPI' + tail, 1500), ['Priya Ku', 'Other income']);
  assert.deepStrictEqual(cat('DEP TFR IMPS*HDFC0001234*612345678907*T EST TRADERS 2020', 4000), ['Test Traders 2020', 'Other income']);
  assert.deepStrictEqual(cat('DEP TFR NEFT*KKBK0001234*KKBKH2601234567*T EST PAYER', 4000), ['Test Payer', 'Other income']);
  assert.deepStrictEqual(cat('WDL TFR UPI/DR/612345678908/SAFE GOLD/YESB/ sa***@y/UPI' + tail, -1000), ['Safe Gold', 'Investments']);
  assert.deepStrictEqual(cat('WDL TFR UPI/DR/612345678909/THYROCAR/YESB/t hyrocare3/UPI' + tail, -900), ['Thyrocar', 'Health & fitness']);
  // A long name is checked in full, not after it is shortened for display.
  const long = MD.extractMerchant('WDL TFR UPI/DR/612345678910/ANNAPURNA SRINIVASA RAGHAVENDRA TRADERS/YESB/q 1234/UPI' + tail);
  assert.strictEqual(long.person, false);
  assert.deepStrictEqual(cat('WDL TFR INB HOUSE OF FASHION 12345672090 AT 01234 TESTPUR', -2500), ['House Of Fashion', 'Other']);
  assert.deepStrictEqual(cat('WDL TFR SBIY1234567890123456789/P/Bill Payment 0 12349104 OF BANK OF TESTPUR AT 01234 TESTPUR', -500), ['Bank Of Testpur', 'Other']);
  // The cut words still match other banks' full words.
  assert.deepStrictEqual(cat('POS TANISHQ JEWELLERY BANGALORE', -15000), ['Tanishq Jewellery', 'Shopping']);
  assert.deepStrictEqual(cat('ACH D- INDIAN CLEARING CORP-ABC123', -5000)[1], 'Investments');
  // Lines from other banks are not read as SBI lines.
  assert.strictEqual(MD.sbiParts('TO TRANSFER-UPI/DR/627512345678/SWIGGY/YESB/swiggy@ybl/Payment'), null);
  assert.strictEqual(MD.sbiParts('UPI-RAHUL SHARMA-rahul@okhdfcbank-HDFC0001234-612345678901-UPI'), null);
  // The same rows as saved (masked) read the same way, so saved data can be re-labelled.
  const masked = MD.redactDesc('WDL TFR UPI/DR/612345678901/Blinkit/HDFC/bl inkit.rz/Payvi' + tail);
  assert.deepStrictEqual(cat(masked, -250), ['Blinkit', 'Groceries']);
});

test('Kotak lines: card, ATM, NACH and interest payees; merchant names never keep long numbers', () => {
  const cat = (desc, amount) => { const m = MD.extractMerchant(desc); let c = MD.categorize(desc, m.name, amount, {}, 'bank'); if (c === 'Other' && m.person) c = 'People (UPI)'; return [m.name, c]; };
  assert.deepStrictEqual(cat('PCD/1234/BHARTI AIRTEL LIMITED/NOIDA090126/18:13', -859), ['Bharti Airtel Limited', 'Bills & utilities']);
  assert.deepStrictEqual(cat('ATL/1234/601530/+TESTPUR MAIN ROAD N060526/19:32', -4000), ['ATM withdrawal', 'Cash withdrawal']);
  assert.deepStrictEqual(cat('NACH-10-DR-TEST AUTO CREDIT LI-B2WBAN0012345', -2200), ['Test Auto Credit Li', 'EMI & loans']);
  assert.deepStrictEqual(cat('Int.Pd:0123456789:01-07-2026 to 30-09-2026', 106), ['Interest', 'Interest & dividends']);
  assert.deepStrictEqual(cat('811 SUPER PROGRAM FEE', -499), ['Super Program Fee', 'Fees & interest']);
  assert.deepStrictEqual(cat('Ac xfr from gl 12048 to 12042', -100), ['Ac Xfr From Gl To', 'Card payments & transfers']);
  assert.deepStrictEqual(cat('KOTAK811/626912345678', 5000), ['Kotak811', 'Other income']);
  assert.deepStrictEqual(cat('UPI/testname1398/601512345678/UPI', -100), ['Testname', 'People (UPI)']);
  assert.deepStrictEqual(cat('UPI/9876543210@ybl/601012345678/UPI', -100), ['UPI payment', 'People (UPI)']);
  assert.deepStrictEqual(cat(MD.redactDesc('UPI/9876543210@ybl/601012345678/UPI'), -100), ['UPI payment', 'People (UPI)']);
  assert.strictEqual(MD.extractMerchant('SWEEP TRANSFER TO [1234567890]').name, 'Sweep Transfer To');
  assert.strictEqual(MD.extractMerchant(MD.redactDesc('SWEEP TRANSFER TO [1234567890]')).name, 'Sweep Transfer To');
  for (const d of ['KOTAK811/626912345678', 'UPI/9876543210@ybl/601012345678/UPI', 'NACH-10-DR-TEST AUTO CREDIT LI-B2WBAN0012345', 'Int.Pd:0123456789:01-07-2026'])
    assert.ok(!/\d{5,}/.test(MD.extractMerchant(d).name), d);
});

test('reading check: layouts keep only bank words, counts flag unread and unmasked rows', () => {
  assert.strictEqual(MD.lineShape('WDL TFR UPI/DR/XXXXXXXX3937/Rahul Sh/KKBK/r ahul811pa/RUSH XXXXXXXXX2091 AT 00426 TESTPUR'), 'WDL TFR UPI/DR/x9/a/a/a9a/a x9 AT 9 a');
  assert.strictEqual(MD.lineShape('UPI/ra***@oksbi/XXXXXXXX8068/UPI'), 'UPI/a*@a/x9/UPI');
  // Names in any script, and digits in any script, are taken out.
  assert.strictEqual(MD.lineShape('UPI/राहुल शर्मा/XXXX१२३४/UPI'), 'UPI/a/x9/UPI');
  assert.strictEqual(MD.lineShape('TO P AC GL SI BY'), 'a');
  const shape = MD.lineShape('DEP TFR NEFT*IDFB0001234*IDFBH2601234567*PRIYA SHARMA ENTERPRISES 12345674300 AT 01234 TESTPUR');
  assert.ok(!/priya|sharma|\d{2,}/i.test(shape), shape);
  const txns = [
    { account: 'B', desc: 'UPI/XXXX1234/a', merchant: 'Shop', category: 'Other' },
    { account: 'B', desc: 'UPI/XXXX5678/b', merchant: 'Shop', category: 'Other' },
    { account: 'B', desc: 'NEFT/ACME', merchant: 'Acme', category: 'Other income' },
    { account: 'B', desc: 'SALARY ACME', merchant: 'Acme', category: 'Salary' },
    { account: 'A', desc: 'TO 123456789 rahul.s@oksbi', merchant: 'Rahul', category: 'People (UPI)' },
    { account: 'A', desc: 'UPI/XXXX1234', merchant: 'Kotak811 98765', category: 'People (UPI)' },
    { account: 'A', desc: 'UPI/XXXX1234', merchant: 'pay@ybl', category: 'People (UPI)' },
    { account: 'A', merchant: 'No line', category: 'Other' },
  ];
  const rep = MD.readingReport(txns);
  assert.deepStrictEqual(rep.map(a => [a.account, a.rows, a.unread, a.unmasked]), [['A', 4, 1, 3], ['B', 4, 3, 0]]);
  assert.deepStrictEqual(rep[1].shapes, [{ shape: 'UPI/x9/a', count: 2 }, { shape: 'NEFT/a', count: 1 }]);
  assert.deepStrictEqual(rep[0].unmaskedShapes, [{ shape: '(merchant name)', count: 2 }, { shape: 'a 9 a@a', count: 1 }]);
  assert.deepStrictEqual(rep[0].shapes, [{ shape: '(no description)', count: 1 }]);
  assert.ok(!/Shop|Acme|Rahul|rahul|123456789/.test(JSON.stringify(rep.map(a => [a.shapes, a.unmaskedShapes]))));
  assert.strictEqual(MD.readingReport(txns, 1)[1].shapes.length, 1);
  assert.deepStrictEqual(MD.readingReport([]), []);
  // A number in groups is masked now, but a line saved before that is still flagged.
  assert.strictEqual(MD.readingReport([{ account: 'C', desc: MD.redactDesc('UPI/CALL 98765 43210/UPI'), merchant: 'X', category: 'People (UPI)' }])[0].unmasked, 0);
  assert.strictEqual(MD.readingReport([{ account: 'C', desc: 'UPI/CALL 98765 43210/UPI', merchant: 'X', category: 'People (UPI)' }])[0].unmasked, 1);
  assert.strictEqual(MD.readingReport([{ account: 'C', desc: 'CALL 987-654-3210', merchant: 'X', category: 'People (UPI)' }])[0].unmasked, 1);
  assert.strictEqual(MD.readingReport([{ account: 'C', desc: 'FY 2025-2026 TAX ON 26-10-2026', merchant: 'X', category: 'Fees & interest' }])[0].unmasked, 0);
  // The parser steps refreshParsed (app.js) relies on for a line saved by an older version:
  // re-masking gives the same text as a fresh import, and the id of the original line still
  // matches, so importing the same statement again is still detected.
  const raw = { date: '2026-10-01', desc: 'UPI/CALL 98765 43210/UPI', amount: -500, account: 'Kotak', accountKind: 'bank', rules: {} };
  const fresh = MD.makeTxn(raw);
  const saved = { ...fresh, desc: raw.desc };
  assert.strictEqual(MD.redactDesc(saved.desc), fresh.desc);
  assert.strictEqual(fresh.desc, 'UPI/CALL XXXXXX3210/UPI');
  assert.strictEqual(MD.txnId(saved), fresh.id);
  const text = MD.readingReportText(rep, acc => acc === 'B' ? 'card' : 'bank');
  assert.ok(text.includes('Account 1 (bank account): 4 rows, 1 uncategorised (Other), 3 may hold an unmasked number'));
  assert.ok(text.includes('Account 2 (credit card): 4 rows, 3 uncategorised (Other), 0 may hold an unmasked number'));
  assert.ok(text.includes('    2x  (merchant name)') && text.includes('    1x  (no description)'));
  assert.ok(!/Shop|Acme|Rahul|rahul|123456789|\bA\b|\bB\b/.test(text.split('\n').slice(1).join('\n')));
  assert.strictEqual(MD.readingReportText([]), text.split('\n')[0]);
  assert.strictEqual(MD.lineShape('BILL PAYMENT'), 'a PAYMENT');
});

test('SBI UPI reversals are refunds', () => {
  const t = MD.makeTxn({ date: '2026-05-01', desc: 'DEP TFR UPI/REV/612345678901 00000012345678901 AT 04321 TESTPUR', amount: 250, account: 'S', accountKind: 'bank', rules: {} });
  assert.strictEqual(t.merchant, 'UPI Reversal');
  assert.strictEqual(t.category, 'Refunds & cashback');
  assert.ok(!/612345678901/.test(t.desc));
  // "SAL" counts only as a word of its own.
  assert.strictEqual(MD.categorize('NEFT/SAL/ACME', 'Acme', 50000, {}, 'bank'), 'Salary');
  assert.strictEqual(MD.categorize('NEFT-SAL-OCT', 'Acme', 50000, {}, 'bank'), 'Salary');
  assert.strictEqual(MD.categorize('UPI/CR/Universal Traders', 'Universal Traders', 500, {}, 'bank'), 'Other income');
  assert.strictEqual(MD.categorize('NEFT*SAL*OCT', 'Acme', 50000, {}, 'bank'), 'Salary');
  assert.strictEqual(MD.categorize('IMPS PAYMENT REVERSAL', 'Imps Payment Reversal', 500, {}, 'bank'), 'Refunds & cashback');
  assert.strictEqual(MD.categorize('UPI/CR/Nasal Care', 'Nasal Care', 500, {}, 'bank'), 'Other income');
  // The saved, masked line reads the same way when the app relabels it on open.
  const again = MD.makeTxn({ date: '2026-05-01', desc: t.desc, amount: 250, account: 'S', accountKind: 'bank', rules: {} });
  assert.deepStrictEqual([again.merchant, again.category], ['UPI Reversal', 'Refunds & cashback']);
});

test('Repeated lines keep their own ids; re-imports and reworded copies are found', () => {
  const opts = { account: 'Card', accountKind: 'card', rules: {}, source: 'x.pdf' };
  const lines = ['05/01/2026 UPI- -TEA STALL IN 30.00', '05/01/2026 UPI- -TEA STALL IN 30.00', '06/01/2026 UPI- -TEA STALL IN 30.00'];
  const a = MD.linesToTxns(lines, opts).txns;
  assert.strictEqual(new Set(a.map(t => t.id)).size, 3);
  assert.strictEqual(a[1].id, a[0].id + 'd2');
  // The same file again: every line is already saved.
  assert.strictEqual(MD.findImported(a, MD.linesToTxns(lines, opts).txns).size, 3);
  // A second download of a statement can word a line a little differently.
  const mk = (desc, account, source) => MD.makeTxn({ date: '2026-02-10', desc, amount: -499, account, accountKind: 'card', rules: {}, source });
  const saved = [mk('ACME STREAMING MUMBAI IN', 'Card', 'a.pdf')];
  const again = [mk('ACME STREAMING MUMBAI', 'Card', 'b.pdf'), mk('ACME STREAMING MUMBAI', 'Card', 'b.pdf'), mk('ACME STREAMING MUMBAI', 'Other card', 'b.pdf')];
  // Each saved line matches once, and only in its own account.
  assert.deepStrictEqual([...MD.findImported(saved, again)], [0]);
});

test('HDFC newer card layout: "+ C" is a credit, time and Ref# are dropped', () => {
  const opts = { account: 'HDFC', accountKind: 'card', rules: {}, source: 'h.pdf' };
  const [pay, emi] = MD.linesToTxns([
    '02/02/2026 | | 10:15 BPPY CC PAYMENT AB11112222333344 (Ref# ST000011112222333344) + C 1,500.00',
    '14/02/2026 | | 00:00 OFFUS EMI,PRIN NB:03, (Ref# ) C 640.00',
  ], opts).txns;
  assert.strictEqual(pay.amount, 1500);
  assert.strictEqual(pay.category, 'Card payments & transfers');
  assert.ok(/^BPPY CC PAYMENT/.test(pay.desc) && !/Ref#|10:15|\+ C/.test(pay.desc));
  assert.strictEqual(emi.amount, -640);
  assert.strictEqual(emi.desc, 'OFFUS EMI,PRIN NB:03,');
  assert.strictEqual(emi.category, 'EMI & loans');
  // A line saved by an older version is cleaned the same way when the app relabels it.
  assert.strictEqual(MD.cleanPdfDesc('| | 00:00 OFFUS EMI,PRIN NB:03, (Ref# ) C', 'card'), 'OFFUS EMI,PRIN NB:03,');
  assert.ok(MD.pdfCredit('| | 10:15 BPPY CC PAYMENT ABXX3344 (Ref# STXXXX3344) + C'));
  assert.ok(!MD.pdfCredit('| | 00:00 OFFUS EMI,PRIN NB:03, (Ref# ) C'));
  // A merchant name ending in "+" is still a purchase.
  assert.ok(!MD.pdfCredit('STREAMPLUS+'));
  assert.ok(!MD.pdfCredit('GADGETS PLUS+ C'));
  assert.strictEqual(MD.linesToTxns(['03/02/2026 STREAMPLUS+ MUMBAI IN 299.00', '04/02/2026 ACME PLUS+ 150.00'], opts).txns.map(t => t.amount).join(), '-299,-150');
  // Reward points that a refund takes back are not part of the merchant name.
  assert.strictEqual(MD.cleanPdfDesc('ACME TRAVELS PVT NEW DELHI IN -40', 'card'), 'ACME TRAVELS PVT NEW DELHI IN');
});

test('Long numbers in statement file names are masked', () => {
  assert.strictEqual(MD.maskSource('1234567890123456_01022026.pdf'), 'XXXXXXXXXXXX3456_01022026.pdf');
  assert.strictEqual(MD.maskSource('4111XXXXXXXX1111_12345_Statement.pdf'), '4111XXXXXXXX1111_12345_Statement.pdf');
});

test('Moving a statement gives new ids that never clash with lines already there', () => {
  const mk = (account, source) => MD.makeTxn({ date: '2026-03-01', desc: 'TEA STALL', amount: -30, account, accountKind: 'card', rules: {}, source });
  const txns = MD.numberRepeats([mk('Target', 'a.pdf'), mk('Target', 'a.pdf'), mk('Wrong', 'b.pdf'), mk('Wrong', 'b.pdf'), mk('Wrong', 'c.pdf')]);
  // b.pdf holds the same two lines that a.pdf already put in Target: they are dropped, not doubled.
  const r = MD.moveStatement(txns, t => t.account === 'Wrong' && t.source === 'b.pdf', 'Target', 'card', {});
  assert.deepStrictEqual([r.moved.length, r.dropped, r.txns.length], [0, 2, 3]);
  // One of the line already there and two in the moved statement: only one is dropped.
  const one = MD.numberRepeats([mk('Target', 'a.pdf'), mk('Wrong', 'b.pdf'), mk('Wrong', 'b.pdf')]);
  const r1 = MD.moveStatement(one, t => t.source === 'b.pdf', 'Target', 'card', {});
  assert.deepStrictEqual([r1.moved.length, r1.dropped, r1.txns.length, new Set(r1.txns.map(t => t.id)).size], [1, 1, 2, 2]);
  // A statement with lines Target doesn't have yet moves, with ids that don't clash.
  const more = MD.numberRepeats([mk('Target', 'a.pdf'), mk('Wrong', 'e.pdf'), mk('Wrong', 'e.pdf')]);
  more[1].desc = more[2].desc = 'BAKERY';
  more[1].id = more[2].id = MD.txnId(more[1]);
  const r2 = MD.moveStatement(more, t => t.source === 'e.pdf', 'Target', 'card', {});
  assert.deepStrictEqual([r2.moved.length, r2.dropped], [2, 0]);
  assert.strictEqual(new Set(r2.txns.map(t => t.id)).size, 3);
  assert.ok(r2.txns.every(t => t.account === 'Target'));
  // A category picked by hand stays.
  const manual = [Object.assign(mk('Wrong', 'd.pdf'), { category: 'Health & fitness', manual: true })];
  assert.strictEqual(MD.moveStatement(manual, () => true, 'Target', 'card', {}).moved[0].category, 'Health & fitness');
});

test('Short look-alike descriptions are not taken for the same line', () => {
  const mk = (desc, source) => MD.makeTxn({ date: '2026-03-02', desc, amount: -200, account: 'Bank', accountKind: 'bank', rules: {}, source });
  assert.strictEqual(MD.findImported([mk('UPI-RAHUL', 'a.csv')], [mk('UPI-RAHUL KUMAR', 'b.csv')]).size, 0);
});

test('Refreshing saved lines keeps repeats, merges copies from two files and fixes HDFC credits', () => {
  const card = { kind: 'card' };
  const line = (desc, amount, source) => ({ id: MD.txnId({ account: 'Card', date: '2026-02-02', amount, desc }), date: '2026-02-02', desc, merchant: 'Old', amount, account: 'Card', category: 'Other', source });
  const data = {
    accounts: { Card: card }, rules: {},
    txns: [
      line('TEA STALL', -30, 'a.pdf'), line('TEA STALL', -30, 'a.pdf'),       // a real repeat
      line('TEA STALL', -30, 'b.pdf'),                                        // the same line from another file
      line('| | 10:15 BPPY CC PAYMENT AB12 (Ref# ST12) + C', -1500, 'h.pdf'),   // saved by an older version
      line('BAKERY', -80, '1234567890123456_01022026.pdf'),
    ],
  };
  MD.refreshSaved(data);
  assert.strictEqual(data.txns.length, 4);
  assert.strictEqual(new Set(data.txns.map(t => t.id)).size, 4);
  const pay = data.txns.find(t => /BPPY/.test(t.desc));
  assert.deepStrictEqual([pay.amount, pay.category, pay.desc], [1500, 'Card payments & transfers', 'BPPY CC PAYMENT AB12']);
  assert.ok(data.txns.some(t => t.source === 'XXXXXXXXXXXX3456_01022026.pdf'));
  // Running it again changes nothing.
  const ids = data.txns.map(t => t.id + t.amount).join();
  MD.refreshSaved(data);
  assert.strictEqual(data.txns.map(t => t.id + t.amount).join(), ids);
});

test('A card line with no D or C on a statement that marks them is a note, not a charge', () => {
  const opts = { account: 'Card', accountKind: 'card', rules: {}, source: 's.pdf' };
  const lines = [
    '01 Mar 26 GROCERY MART 410.00 D', '02 Mar 26 BOOK HOUSE 250.00 D', '03 Mar 26 PAYMENT RECEIVED 5,000.00 C',
    '04 Mar 26 ONLINE STORE IN 12,000.00 D', '04 Mar 26 CONVERTED TO INSTALMENTS 12,000.00', '05 Mar 26 CAFE 90.00 D',
    '06 Mar 26 TRANSFER TO MERCHANT EMI 12,000.00',
  ];
  assert.deepStrictEqual(MD.linesToTxns(lines, opts).txns.map(t => t.amount), [-410, -250, 5000, -12000, -90]);
  // An unmarked line with an amount of its own is kept, in case its letter was lost.
  assert.deepStrictEqual(MD.linesToTxns([...lines, '07 Mar 26 PETROL PUMP 1,800.00', '08 Mar 26 PHARMACY 120.00 D', '09 Mar 26 BAKERY 60.00 D', '10 Mar 26 TAXI 300.00 D'], opts).txns.map(t => t.amount),
    [-410, -250, 5000, -12000, -90, -1800, -120, -60, -300]);
  // Statements that never mark lines (most card PDFs) keep every line.
  assert.strictEqual(MD.linesToTxns(['01 Mar 26 GROCERY MART 410.00', '02 Mar 26 BOOK HOUSE 250.00'], opts).txns.length, 2);
  // The EMI note saved by an older version is dropped when the app relabels.
  const data = { accounts: { Card: { kind: 'card' } }, rules: {}, txns: [
    MD.makeTxn({ date: '2026-03-04', desc: 'ONLINE STORE IN', amount: -12000, account: 'Card', accountKind: 'card', rules: {}, source: 's.pdf' }),
    MD.makeTxn({ date: '2026-03-06', desc: 'TRANSFER TO MERCHANT EMI', amount: -12000, account: 'Card', accountKind: 'card', rules: {}, source: 's.pdf' }),
  ] };
  MD.refreshSaved(data);
  assert.deepStrictEqual(data.txns.map(t => t.desc), ['ONLINE STORE IN']);
});

test('Coverage lists months with no lines per card and flags old accounts as due', () => {
  const t = (date, account, source) => ({ date, account, source, amount: -1, desc: 'X' });
  const txns = [
    t('2026-01-05', 'Cards', '1111XXXXXXXX2222_1_Retail.pdf'), t('2026-04-02', 'Cards', '1111XXXXXXXX2222_2_Retail.pdf'),
    t('2026-02-10', 'Cards', '3333XXXXXXXX4444_1_Retail.pdf'), t('2026-03-10', 'Cards', '3333XXXXXXXX4444_2_Retail.pdf'),
    t('2026-01-01', 'Bank', 'statement.xlsx'), t('2026-10-20', 'Bank', 'statement.xlsx'), t('2026-05-01', 'Bank', 'sample'),
    t('2026-06-10', 'Solo', 'XXXXXXXX9999_01.pdf'), t('2026-08-10', 'Solo', 'MonthlyStatement.pdf'),
  ];
  const c = MD.coverage(txns, '2026-10-27');
  assert.deepStrictEqual(c.map(x => [x.account, x.card, x.missing, x.due]), [
    ['Bank', '', ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'], false],
    ['Cards', '2222', ['2026-02', '2026-03'], true],
    ['Cards', '4444', [], true],
    ['Solo', '9999', ['2026-07'], true],
  ]);
});
