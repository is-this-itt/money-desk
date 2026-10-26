// Money Desk: statement parsing and categorisation. No network, no dependencies.
(function (root) {
  'use strict';

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

  // ---------- Categories ----------
  // kind: spend (counts as spending), income, invest, transfer (ignored in totals)
  // Some words are cut on purpose to match SBI's cut-up lines, and still match the full text:
  // 'mutual fun', 'indian clearin' (ICCL, which collects SIPs), 'interes t credit', 'jewell'.
  // 'rzpx pvt ltd pa' is how SBI prints RazorpayX Payroll, which pays salaries for many
  // employers; anything else paid through it can be fixed with a rule.
  const CATEGORIES = [
    { name: 'Groceries', kind: 'spend', words: ['bigbasket', 'big basket', 'blinkit', 'grofers', 'zepto', 'dmart', 'd mart', 'avenue supermarts', 'instamart', 'jiomart', 'reliance fresh', 'reliance smart', 'more retail', 'natures basket', 'ratnadeep', 'spencer', 'dunzo', 'supermarket', 'kirana', 'grocery'] },
    { name: 'Food & dining', kind: 'spend', words: ['swiggy', 'zomato', 'eatsure', 'domino', 'mcdonald', 'kfc', 'pizza', 'starbucks', 'cafe', 'coffee', 'restaurant', 'burger', 'haldiram', 'chaayos', 'blue tokai', 'subway', 'barbeque', 'biryani', 'bakery', 'dhaba', 'food'] },
    { name: 'Bills & utilities', kind: 'spend', words: ['electricity', 'bescom', 'msedcl', 'mahavitaran', 'tata power', 'adani elec', 'torrent power', 'tneb', 'airtel', 'jio', 'vodafone', 'vodaidea', 'bsnl', 'act fibernet', 'broadband', 'hathway', 'gas', 'water bill', 'recharge', 'dth', 'tata play', 'bill payment', 'bbps', 'utility', 'utilities'] },
    { name: 'Shopping', kind: 'spend', words: ['amazon', 'amzn', 'flipkart', 'myntra', 'ajio', 'meesho', 'nykaa', 'tata cliq', 'croma', 'reliance digital', 'decathlon', 'ikea', 'lenskart', 'jewell', 'firstcry', 'snapdeal', 'pantaloons', 'westside', 'zudio', 'h&m', 'uniqlo', 'lifestyle', 'shoppers stop'] },
    { name: 'Transport', kind: 'spend', words: ['uber', 'ola ', 'olacabs', 'ani technologies', 'rapido', 'metro', 'fastag', 'parking', 'namma yatri', 'blusmart', 'toll'] },
    { name: 'Travel', kind: 'spend', words: ['irctc', 'redbus', 'indigo', 'interglobe', 'air india', 'vistara', 'akasa', 'spicejet', 'makemytrip', 'make my trip', 'goibibo', 'cleartrip', 'yatra', 'ixigo', 'booking.com', 'airbnb', 'oyo', 'agoda', 'hotel'] },
    { name: 'Fuel', kind: 'spend', words: ['petrol', 'fuel', 'hpcl', 'bpcl', 'indian oil', 'iocl', 'shell', 'filling station', 'service station'] },
    { name: 'Subscriptions', kind: 'spend', words: ['netflix', 'spotify', 'prime video', 'amazon prime', 'primevideo', 'hotstar', 'disney', 'youtube', 'google play', 'googleplay', 'apple.com', 'itunes', 'openai', 'chatgpt', 'anthropic', 'claude.ai', 'notion', 'linkedin', 'zee5', 'sonyliv', 'jiocinema', 'audible', 'kindle', 'icloud', 'microsoft', 'adobe', 'github', 'canva', 'dropbox'] },
    { name: 'Health & fitness', kind: 'spend', words: ['pharmacy', 'apollo', 'medplus', '1mg', 'pharmeasy', 'netmeds', 'hospital', 'clinic', 'diagnostic', 'practo', 'cult.fit', 'cultfit', 'curefit', 'gym', 'fitness', 'medical', 'chemist', 'dental', 'lab ', 'thyrocare'] },
    { name: 'Rent & housing', kind: 'spend', words: ['rent', 'furlenco', 'rentomojo', 'nobroker', 'maintenance', 'society', 'housing', 'landlord'] },
    { name: 'Entertainment', kind: 'spend', words: ['bookmyshow', 'pvr', 'inox', 'district', 'cinepolis', 'steam', 'playstation', 'xbox', 'gaming'] },
    { name: 'Education', kind: 'spend', words: ['udemy', 'coursera', 'school', 'college', 'university', 'tuition', 'byju', 'unacademy', 'upgrad', 'exam fee'] },
    { name: 'Insurance', kind: 'spend', words: ['insurance', 'lic of india', ' lic ', 'policybazaar', 'acko', 'ergo', 'lombard', 'star health', 'go digit', 'max life', 'tata aia', 'hdfc life', 'icici pru', 'premium'] },
    { name: 'EMI & loans', kind: 'spend', words: [' emi', 'emi ', 'loan', 'bajaj finance', 'bajaj fin', 'home credit', 'nach-', 'lazypay', 'simpl', 'slice'] },
    { name: 'Cash withdrawal', kind: 'spend', words: ['atm', 'cash wdl', 'cash withdrawal', 'nwd', 'atw', 'cwdr'] },
    { name: 'Fees & interest', kind: 'spend', words: ['annual fee', 'late fee', 'late payment', 'finance charge', 'interest charged', 'interest on', 'overlimit', 'charges', 'sms alert', 'membership fee', 'joining fee', 'renewal fee', 'gst', 'igst', 'cgst', 'sgst', 'penalty', 'surcharge', 'markup'] },
    { name: 'Investments', kind: 'invest', words: ['groww', 'nextbillion', 'zerodha', 'upstox', 'wealthy', 'kuvera', 'mutual fun', 'mutualfund', ' mf ', 'sip ', 'bse ltd', 'bsestarmf', 'nse clearing', 'indian clearin', 'iccl', 'cams', 'kfin', 'ppf', 'nps', 'smallcase', 'angel one', 'angel broking', 'dhan', 'paytm money', 'icici direct', 'hdfc securities', 'fixed deposit', ' fd ', 'recurring deposit', 'sgb', 'safegold', 'safe gold'] },
    { name: 'Card payments & transfers', kind: 'transfer', words: ['credit card payment', 'cc payment', 'card payment', 'payment received', 'payment - thank', 'thank you', 'cred club', 'dreamplug', 'cred ', 'autopay', 'self transfer', ' self ', 'own account', 'sweep', 'cardbill', 'card bill', 'billdesk', 'sbicardp'] },
    { name: 'Salary', kind: 'income', words: ['salary', 'sal ', 'payroll', 'sal-', 'sal/', 'rzpx pvt ltd pa'] },
    { name: 'Interest & dividends', kind: 'income', words: ['interest credit', 'interes t credit', 'int.pd', 'int pd', 'int.coll', 'interest paid', 'sb interest', 'dividend', 'div '] },
    { name: 'Refunds & cashback', kind: 'spend', words: ['refund', 'reversal', 'cashback', 'cash back', 'rev-', 'chargeback'] },
    { name: 'People (UPI)', kind: 'spend', words: [] },
    { name: 'Other', kind: 'spend', words: [] },
    { name: 'Other income', kind: 'income', words: [] },
  ];
  const CAT_BY_NAME = Object.fromEntries(CATEGORIES.map(c => [c.name, c]));

  // ---------- Small helpers ----------
  const pad = n => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  function validDate(y, m, d) {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100)) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCDate() === d ? iso(y, m, d) : null;
  }
  const fullYear = y => (y < 100 ? 2000 + y : y);

  // Indian statements are day-first. Returns yyyy-mm-dd or null.
  function parseDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number') {
      if (v > 20000 && v < 80000) { // Excel serial date
        const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
        return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
      }
      return null;
    }
    const s = clean(v);
    let m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return validDate(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})(?!\d)/))) return validDate(fullYear(+m[3]), +m[2], +m[1]);
    if ((m = s.match(/^(\d{1,2})[-/ ]?([A-Za-z]{3,9})[-/ ,]*'?(\d{2,4})(?!\d)/))) {
      const mo = MONTHS[m[2].slice(0, 3).toLowerCase()] || MONTHS[m[2].toLowerCase()];
      return mo ? validDate(fullYear(+m[3]), mo, +m[1]) : null;
    }
    if ((m = s.match(/^([A-Za-z]{3,9})[ -](\d{1,2}),? (\d{4})/))) {
      const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
      return mo ? validDate(+m[3], mo, +m[2]) : null;
    }
    return null;
  }

  // Returns { value, marker } where marker is 'cr', 'dr' or ''. value is unsigned unless the text was negative.
  function parseAmount(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? { value: v, marker: '' } : null;
    let s = clean(v);
    let marker = '';
    const mk = s.match(/\b(cr|dr|c|d)\.?\s*$/i);
    if (mk) { marker = mk[1][0].toLowerCase() === 'c' ? 'cr' : 'dr'; s = s.slice(0, mk.index); }
    let neg = false;
    if (/^\(.*\)$/.test(s.trim())) { neg = true; s = s.replace(/[()]/g, ''); }
    s = s.replace(/(₹|rs\.?|inr)/gi, '').replace(/[,\s]/g, '');
    if (s.startsWith('-')) { neg = true; s = s.slice(1); }
    if (s.startsWith('+')) s = s.slice(1);
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const value = parseFloat(s) * (neg ? -1 : 1);
    return { value, marker };
  }

  // ---------- Header detection for CSV / Excel ----------
  const HEAD = {
    date: [/^(txn|tran|transaction|trans|posting|post)\.?\s*date/, /^date$/, /date/],
    desc: [/narration/, /description/, /particular/, /details/, /remark/, /merchant/, /transaction$/, /^txn$/],
    debit: [/withdraw/, /debit/, /^dr\b/, /\bdr\.? ?amount/, /paid out/, /money out/],
    credit: [/deposit/, /credit/, /^cr\b/, /\bcr\.? ?amount/, /paid in/, /money in/],
    amount: [/^amount/, /amount/, /^amt/, /\bamt\b/, /\binr\b/],
    type: [/^(dr|cr)\s*\/\s*(cr|dr)$/, /^type$/, /debit\s*\/\s*credit/, /dr\/cr/, /cr\/dr/, /txn type/, /transaction type/],
    balance: [/balance/, /^bal/],
  };

  function scoreCell(text, key) {
    const t = text.toLowerCase();
    const pats = HEAD[key];
    for (let i = 0; i < pats.length; i++) if (pats[i].test(t)) return pats.length - i;
    return 0;
  }

  function detectColumns(rows) {
    let best = null;
    const limit = Math.min(rows.length, 60);
    for (let r = 0; r < limit; r++) {
      const cells = (rows[r] || []).map(c => clean(c));
      if (cells.filter(Boolean).length < 2) continue;
      const map = {};
      const used = new Set();
      // Type before amount/debit/credit so "Dr/Cr" is not taken as debit.
      for (const key of ['type', 'balance', 'date', 'desc', 'debit', 'credit', 'amount']) {
        let bi = -1, bs = 0;
        cells.forEach((c, i) => {
          if (used.has(i) || !c || c.length > 40) return;
          if (key !== 'type' && scoreCell(c, 'type') > 0) return;
          if (key === 'date' && /value/i.test(c) && cells.some((o, j) => j !== i && /date/i.test(o) && !/value/i.test(o))) return;
          const s = scoreCell(c, key);
          if (s > bs) { bs = s; bi = i; }
        });
        if (bi >= 0) { map[key] = bi; used.add(bi); }
      }
      if (map.date == null) continue;
      if (map.debit == null && map.credit == null && map.amount == null) continue;
      const score = Object.keys(map).length;
      if (!best || score > best.score) best = { headerRow: r, map, score, headers: cells };
    }
    return best;
  }

  // ---------- Merchant extraction ----------
  const BANK_CODES = /^(sbin|hdfc|hdfcbank|icic|icici|utib|axis|kkbk|kotak|yesb|ybl|ibl|okaxis|oksbi|okhdfcbank|okicici|paytm|ptys|ptyes|apl|axl|upi|imps|neft|rtgs|nach|ach|dr|cr|p2a|p2m|pos|ecom|mob|ib|mb|inb|bil|onl|to|by|from|transfer|trf|txn|ref|payment|pay|collect|null|na|sent|received|using|via|ind|in|bank|ltd)$/i;
  const CITIES = /\s+(bangalore|bengaluru|mumbai|new delhi|delhi|gurgaon|gurugram|noida|pune|hyderabad|chennai|kolkata|ahmedabad|jaipur|indore|kochi|thane|navi mumbai|india|ind|in)(\s+(in|ind|india))?$/i;

  const PREFIX = /^(to transfer|by transfer|transfer to|transfer from|pos|ecom|ecs|ach|nach|bil|onl|vps|vin|mmt|inb|ib|pur|neft|imps|rtgs|dr|cr)\b[\s/:*-]*/i;
  function stripPrefix(s) {
    let n = clean(s);
    for (let i = 0; i < 4 && PREFIX.test(n); i++) n = n.replace(PREFIX, '');
    return n.trim();
  }

  const REGION = /\s+(us|usa|gb|uk|sg|ie|nl|ka|mh|dl|tn|ts|ap|up|hr|gj|wb|kl|rj)$/i;

  // Card PDF rows carry reward points and footer text next to the description.
  function cleanPdfDesc(d, kind) {
    let s = clean(d).replace(/\s+\S*%.*$/, '').replace(/\s+#.*$/, '');
    if (kind === 'card') s = s.replace(/\s\d{1,5}(?=(\s[A-Za-z]{2})?$)/, '');
    return s.trim();
  }

  function titleCase(s) {
    return s.toLowerCase().replace(/\b([a-z])/g, (m, c) => c.toUpperCase()).replace(/\b(Upi|Atm|Emi|Sip|Lic|Neft|Imps|Gst|Bse|Nse|Hdfc|Sbi|Icici|Irctc|Kfc|Pvr)\b/g, w => w.toUpperCase());
  }

  // SBI statements cut descriptions into fixed-width pieces joined by spaces, so words get split
  // ("k otak811pa", "C OGNAIZE"). Read the payee from the fields SBI always puts in the same place.
  // Returns { name, handle, upi } (handle: the UPI ID's first part, spaces removed) or null.
  function sbiParts(desc) {
    // Real lines are under 200 characters; the cap keeps the patterns below fast on odd input.
    const d = clean(desc).slice(0, 300);
    let m = /^(?:WDL|DEP) TFR UPI\/(?:DR|CR)\/[^/]*\/([^/]*)\/[^/]*\/([^/]*)/i.exec(d);
    if (m) return { name: m[1].trim(), handle: m[2].replace(/\s+/g, '').toLowerCase(), upi: true };
    m = /^DEP TFR (?:NEFT|IMPS|RTGS)\*[^*]*\*[^*]*\*(.*?)(?:\s+(?:X{4,}\d{4}|\d{8,}))?(?:\s+AT\s+\d+\b.*)?$/i.exec(d);
    // The payer's name starts right after a cut, so its first letter stands alone ("A XIS MUTUAL").
    if (m) return { name: m[1].replace(/^([a-z]) (?=[a-z]{2})/i, '$1').trim(), handle: '', upi: false };
    m = /^(?:WDL|DEP) TFR (?:INB|CMP|SBIY\S*)\s+(.*?)(?:\s+(?:X{4,}\d{4}|\d{8,}))?\s+AT\s+\d+\b/i.exec(d);
    if (m) { const of = m[1].split(/\s+OF\s+/i); return { name: of[of.length - 1].trim(), handle: '', upi: false }; }
    m = /^DEBIT ACHDr \S+ \S+ (.+)$/i.exec(d);
    if (m) return { name: m[1].trim(), handle: '', upi: false };
    return null;
  }

  function extractMerchant(desc) {
    const d = clean(desc);
    const low = d.toLowerCase();
    const sbi = sbiParts(d);
    if (sbi) {
      const w = sbi.name;
      // A UPI payee can be named by a phone number, which the statement masks.
      if (/[a-z]{2,}/i.test(w) && !/x{4,}/i.test(w)) return { name: titleCase(w.slice(0, 40)), person: sbi.upi && !/[0-9]/.test(w) && w.split(' ').length <= 4 && !looksBusiness(w) };
      if (sbi.upi) return { name: 'UPI payment', person: true };
    }
    if (/(^|[\s/:-])upi([\s/:-]|$)/i.test(d) || /@[a-z]{2,}/i.test(d) || /\b(neft|imps|rtgs)\b/i.test(d)) {
      const tokens = d.split(/[\/:|*]|\s-\s|-(?=\S)/).map(t => t.trim()).filter(Boolean);
      let vpa = '';
      for (const t of tokens) {
        if (t.includes('@')) { if (!vpa) vpa = t.split('@')[0]; continue; }
        const w = stripPrefix(t.replace(/^upi\s*/i, ''));
        if (!w || /\d{4,}/.test(w) || BANK_CODES.test(w) || w.length < 3) continue;
        if (/^(to transfer|by transfer|upi ?(dr|cr)|upi ?out|upi ?in|transfer to|transfer from|mps|dr|cr)$/i.test(w)) continue;
        if (!/[a-z]{3,}/i.test(w)) continue;
        return { name: titleCase(w.slice(0, 40)), person: !/[0-9]/.test(w) && w.split(' ').length <= 4 && !looksBusiness(w) };
      }
      if (vpa) return { name: titleCase(vpa.replace(/[._]/g, ' ').replace(/\d+/g, '').trim() || vpa), person: true };
    }
    let name = stripPrefix(d)
      .replace(/\b(xx+|\*+)\d*\b/gi, ' ')
      .replace(/\*/g, ' ')
      .replace(/\b\d+(\.\d+)?\s*(usd|eur|gbp|sgd|aed)\b/gi, ' ')
      .replace(/\b(usd|eur|gbp|sgd|aed)\b/gi, ' ')
      .replace(/(^|\s)\d+(?=\s|$)/g, ' ')
      .replace(/^\s*(raz|rzp|payu|pyu|ccav|cybs)\b/i, ' ')
      .replace(/\bcybs( si)?\b/gi, ' ')
      .replace(/\s+/g, ' ').trim();
    for (let i = 0; i < 4; i++) name = name.replace(CITIES, '').replace(REGION, '').trim();
    // Payment-gateway domains: drop them when other words exist, else keep the name part.
    const words = name.split(' ');
    const plain = words.filter(w => !/\.(com|in|io|ai|net|co)$/i.test(w));
    name = (plain.length ? plain : words.map(w => w.replace(/\.(com|in|io|ai|net|co)$/i, ''))).join(' ');
    for (let i = 0; i < 4; i++) name = name.replace(CITIES, '').replace(REGION, '').trim();
    if (low.includes('atm') || /cash wdl|nwd/i.test(low)) name = 'ATM withdrawal';
    return { name: titleCase(name.slice(0, 40)) || 'Unknown', person: false };
  }
  function looksBusiness(w) {
    return /(ltd|limited|pvt|private|llp|store|stores|mart|enterprises|services|traders|foods|restaurant|technologies|tech|solutions|india|retail|payments|corp|hotel|cafe|medical|pharma|agency|motors|bazaar|shop)/i.test(w);
  }

  // ---------- Categorisation ----------
  function merchantKey(name) { return clean(name).toLowerCase(); }

  function categorize(desc, merchant, amount, rules, accountKind) {
    const key = merchantKey(merchant);
    if (rules && Object.prototype.hasOwnProperty.call(rules, key)) return rules[key];
    const sbi = sbiParts(desc);
    // "P/Bill Payment" is SBI's label for any payment made in YONO, not only bills.
    const d = sbi ? clean(desc).replace(/\/P\/Bill Payment\b/i, ' ') : clean(desc);
    const hay = ' ' + d.toLowerCase() + ' ' + key + ' ' + (sbi ? sbi.handle + ' ' : '');
    // Card statement credits that are bill payments.
    if (accountKind === 'card' && amount > 0 && /(payment|thank you|neft|imps|upi|autopay|bbps|received)/.test(hay) && !/(refund|reversal|cashback)/.test(hay)) return 'Card payments & transfers';
    for (const c of CATEGORIES) {
      if (c.kind === 'income' && amount < 0) continue;
      if (c.name === 'Refunds & cashback' && amount < 0) continue;
      if (c.words.some(w => hay.includes(w))) return c.name;
    }
    return amount > 0 ? 'Other income' : 'Other';
  }

  function makeTxn({ date, desc, amount, account, accountKind, rules, source }) {
    const m = extractMerchant(desc);
    let category = categorize(desc, m.name, amount, rules, accountKind);
    if (category === 'Other' && m.person) category = 'People (UPI)';
    const t = { date, desc: clean(desc), merchant: m.name, amount: Math.round(amount * 100) / 100, account, category, source: source || '' };
    // The id comes from the original line so re-importing a statement is still detected.
    t.id = txnId(t);
    t.desc = redactDesc(t.desc);
    return t;
  }

  // Masks UPI IDs, reference/account numbers and card numbers in a description line,
  // keeping enough to recognise them: ra***@oksbi, XXXXXXXX5678, XX1234.
  function redactDesc(d) {
    return clean(d)
      .replace(/\b\d{4,6}[xX*]{4,}(\d{4})\b/g, 'XX$1')
      // Full card numbers written in groups (4-4-4-4, Amex 4-6-5, Diners 4-6-4): 13 to 19 digits.
      .replace(/\b\d{4,6}(?:[ -]\d{4,6}){2,4}\b/g, n => { const d = n.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 ? 'XX' + d.slice(-4) : n; })
      .replace(/([\w.+-]+)@([a-z][a-z0-9.]*)/gi, (m, user, handle) => (user.length > 2 ? user.slice(0, 2) + '***' : '***') + '@' + handle)
      .replace(/\d{6,}/g, n => 'X'.repeat(n.length - 4) + n.slice(-4))
      .replace(/\s+/g, ' ').trim();
  }

  function txnId(t) {
    const s = `${t.account}|${t.date}|${t.amount}|${t.desc.toLowerCase()}`;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + s.length.toString(36);
  }

  const CREDIT_WORDS = /(refund|reversal|cashback|cash back|payment received|thank you|credited|credit$)/i;

  // rows: array of arrays. map: column indexes. Returns { txns, skipped }
  function rowsToTxns(rows, det, opts) {
    const { map, headerRow } = det;
    const out = [];
    let skipped = 0;
    // Bank statements often split a description across rows; carry continuation text.
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const date = parseDate(row[map.date]);
      const desc = map.desc != null ? clean(row[map.desc]) : '';
      if (!date) {
        if (out.length && desc && row.filter(c => clean(c)).length === 1 && !/total|balance|closing|opening|page/i.test(desc)) out[out.length - 1].__more = (out[out.length - 1].__more || '') + ' ' + desc;
        else if (row.some(c => clean(c))) skipped++;
        continue;
      }
      let amount = null;
      const dr = map.debit != null ? parseAmount(row[map.debit]) : null;
      const cr = map.credit != null ? parseAmount(row[map.credit]) : null;
      if ((dr && dr.value) || (cr && cr.value)) {
        amount = (cr && cr.value ? Math.abs(cr.value) : 0) - (dr && dr.value ? Math.abs(dr.value) : 0);
      } else if (map.amount != null) {
        const a = parseAmount(row[map.amount]);
        if (a && a.value) {
          const typeText = map.type != null ? clean(row[map.type]).toLowerCase() : '';
          let isCredit;
          if (/^(c|cr|credit)/.test(typeText)) isCredit = true;
          else if (/^(d|dr|debit)/.test(typeText)) isCredit = false;
          else if (a.marker) isCredit = a.marker === 'cr';
          else if (a.value < 0) isCredit = opts.accountKind === 'card';
          else isCredit = opts.accountKind === 'card' ? CREDIT_WORDS.test(desc) : false;
          amount = Math.abs(a.value) * (isCredit ? 1 : -1);
          if (opts.accountKind !== 'card' && !typeText && !a.marker && a.value < 0) amount = a.value;
        }
      }
      if (!amount) { skipped++; continue; }
      if (/^(opening|closing) balance|^b\/f|^c\/f|^total/i.test(desc)) { skipped++; continue; }
      out.push({ date, desc, amount });
    }
    return {
      txns: out.map(t => makeTxn({ date: t.date, desc: t.desc + (t.__more || ''), amount: t.amount, account: opts.account, accountKind: opts.accountKind, rules: opts.rules, source: opts.source })),
      skipped,
    };
  }

  // ---------- PDF text lines ----------
  const AMT_RE = /(?:₹|rs\.?|inr)?\s*-?\d{1,3}(?:,\d{2,3})*\.\d{2}(?:\s*(?:cr|dr|c|d)\b)?|(?:₹|rs\.?|inr)?\s*-?\d+\.\d{2}(?:\s*(?:cr|dr|c|d)\b)?/gi;
  const DATE_AT_START = /^(\d{1,2}[-/. ]\d{1,2}[-/. ]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[-/ ]?[A-Za-z]{3,9}[-/ ,]*'?\d{2,4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m\b)?)?/i;

  function linesToTxns(lines, opts) {
    const out = [];
    let prevBal = null, skipped = 0, last = null;
    for (const raw of lines) {
      const line = clean(raw);
      if (!line) continue;
      if (/opening balance|balance b\/f|brought forward/i.test(line)) {
        const am = line.match(AMT_RE);
        if (am) { const a = parseAmount(am[am.length - 1]); if (a) prevBal = a.marker === 'dr' ? -a.value : a.value; }
        continue;
      }
      const dm = line.match(DATE_AT_START);
      const date = dm ? parseDate(dm[1]) : null;
      if (!date) {
        if (last && opts.accountKind === 'bank' && line.length < 80 && !(line.match(AMT_RE)) && !/page|statement|total|balance|date|description|customer|account|summary/i.test(line)) last.desc += ' ' + line;
        continue;
      }
      let rest = line.slice(dm[0].length).trim();
      // Drop a second date (value date) right after the first.
      const dm2 = rest.match(DATE_AT_START);
      if (dm2 && parseDate(dm2[1])) rest = rest.slice(dm2[0].length).trim();
      const amts = [...rest.matchAll(AMT_RE)];
      if (!amts.length) { skipped++; continue; }
      const desc = cleanPdfDesc(rest.slice(0, amts[0].index).replace(/\b\d{8,}\b/g, ' '), opts.accountKind);
      let amount;
      if (opts.accountKind === 'bank' && amts.length >= 2) {
        const balA = parseAmount(amts[amts.length - 1][0]);
        const txA = parseAmount(amts[amts.length - 2][0]);
        if (!balA || !txA) { skipped++; continue; }
        const bal = balA.marker === 'dr' ? -balA.value : balA.value;
        const v = Math.abs(txA.value);
        if (prevBal != null && Math.abs(Math.abs(bal - prevBal) - v) < 0.02) amount = bal - prevBal > 0 ? v : -v;
        else if (txA.marker) amount = txA.marker === 'cr' ? v : -v;
        else amount = CREDIT_WORDS.test(desc) || /\b(by|cr|credit|deposit|salary|interest)\b/i.test(desc) ? v : -v;
        prevBal = bal;
      } else {
        const a = parseAmount(amts[amts.length - 1][0]);
        if (!a || !a.value) { skipped++; continue; }
        const v = Math.abs(a.value);
        if (a.marker) amount = a.marker === 'cr' ? v : -v;
        else if (opts.accountKind === 'card') amount = CREDIT_WORDS.test(desc) ? v : -v;
        else amount = a.value < 0 ? a.value : -v;
      }
      if (!desc && !amount) { skipped++; continue; }
      last = { date, desc: desc || 'Transaction', amount };
      out.push(last);
    }
    return {
      txns: out.map(t => makeTxn({ date: t.date, desc: t.desc, amount: t.amount, account: opts.account, accountKind: opts.accountKind, rules: opts.rules, source: opts.source })),
      skipped,
    };
  }

  // Group pdf.js text items into lines by y-position.
  function itemsToLines(items) {
    const rows = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5], x = it.transform[4];
      let row = rows.find(r => Math.abs(r.y - y) < 3);
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x, s: it.str, w: it.width || 0 });
    }
    rows.sort((a, b) => b.y - a.y);
    return rows.map(r => {
      r.parts.sort((a, b) => a.x - b.x);
      let s = '', end = null;
      for (const p of r.parts) { s += (end != null && p.x - end > 1 ? '  ' : (s ? ' ' : '')) + p.s; end = p.x + p.w; }
      return s;
    });
  }

  // ---------- Recurring payments ----------
  const NOT_RECURRING = new Set(['Food & dining', 'Groceries', 'Shopping', 'Transport', 'Travel', 'Fuel', 'Entertainment', 'Cash withdrawal', 'Refunds & cashback', 'Fees & interest']);
  function findRecurring(txns) {
    const groups = Object.create(null);
    for (const t of txns) {
      if (t.amount >= 0) continue;
      const kind = (CAT_BY_NAME[t.category] || {}).kind;
      if (kind === 'transfer' || NOT_RECURRING.has(t.category)) continue;
      (groups[merchantKey(t.merchant)] = groups[merchantKey(t.merchant)] || []).push(t);
    }
    const res = [];
    for (const list of Object.values(groups)) {
      const months = new Set(list.map(t => t.date.slice(0, 7)));
      if (months.size < 3 && !(months.size >= 2 && list[0].category === 'Subscriptions')) continue;
      const amts = list.map(t => -t.amount).sort((a, b) => a - b);
      const med = amts[Math.floor(amts.length / 2)];
      const close = amts.filter(a => Math.abs(a - med) <= Math.max(med * 0.15, 20)).length;
      if (close / amts.length < 0.6 || list.length > months.size * 2) continue;
      const lastT = list.reduce((a, b) => (a.date > b.date ? a : b));
      res.push({ merchant: lastT.merchant, category: lastT.category, monthly: med, months: months.size, last: lastT.date });
    }
    return res.sort((a, b) => b.monthly - a.monthly);
  }

  // ---------- My services list from a spreadsheet ----------
  const SVC_TYPES = ['Bank account', 'Credit card', 'Subscription', 'Mandate / autopay', 'SIP / investment', 'Insurance', 'Loan / EMI', 'Other'];
  const SVC_FREQ = ['Monthly', 'Quarterly', 'Yearly', 'One-time', 'None'];
  const SVC_COLUMNS = ['Type', 'Name', 'Bank or provider', 'Last 4 digits', 'Amount', 'How often', 'Day', 'Paid from', 'Notes', 'Status'];
  const SVC_HEADERS = {
    type: ['type', 'kind'], name: ['name', 'service', 'service name'],
    provider: ['bank or provider', 'provider', 'bank', 'company'], last4: ['last 4 digits', 'last 4', 'last4', 'last four'],
    amount: ['amount', 'amount (₹)', 'amount rs', 'price', 'emi', 'premium'], freq: ['how often', 'frequency', 'billing', 'cycle'],
    day: ['day', 'bill or debit day', 'debit day', 'bill day', 'due day'], from: ['paid from', 'debited from'],
    notes: ['notes', 'note', 'remarks', 'comments'], status: ['status', 'active'],
  };
  // Most specific first: "Home loan account" is a loan and "Health insurance card" is insurance.
  // "Debit card" comes before everything because the card rule would otherwise call it a credit card.
  const TYPE_WORDS = [
    ['Bank account', /\bdebit card\b/],
    ['Loan / EMI', /\bloans?\b|\bemis?\b/], ['Insurance', /\binsur|\bpolicy\b|\blic\b/],
    ['Mandate / autopay', /\bmandate|\bauto ?pay\b|\bnach\b|\bstanding\b/],
    ['SIP / investment', /\bsips?\b|\binvest|\bmutual\b|\bfunds?\b|\bstocks?\b|\bppf\b|\bnps\b|\bfds?\b|\bdeposit/],
    ['Subscription', /\bsubscri|\bott\b|\bmembership\b/],
    ['Credit card', /\bcredit\b|\bcards?\b/], ['Bank account', /\bbank\b|\bsavings\b|\bcurrent\b|\baccount\b/],
  ];
  const FREQ_WORDS = [
    ['Monthly', /^(monthly|every month|per month|a month|month|pm|p\.m\.)$/], ['Quarterly', /^(quarterly|every 3 months|every quarter|quarter)$/],
    ['Yearly', /^(yearly|annual|annually|every year|per year|a year|year|pa|p\.a\.)$/], ['One-time', /^(one[- ]?time|once)$/], ['None', /^(none|-|na|n\/a)$/],
  ];
  const normHead = h => String(h == null ? '' : h).toLowerCase().replace(/\s+/g, ' ').trim();

  const MAX_SERVICE_ROWS = 1000;
  // Reads rows (arrays of cells) from a filled-in template. Returns one entry per non-empty row:
  // { row, value, problems, notes }, where value has the fields of a service and problems lists
  // why it can't be imported. The caller still cleans and masks each value before saving it.
  function readServiceRows(rows, firstRow = 1) {
    // The header row has a Name column and at least one other known column, so a title such as
    // "Service" above the table isn't mistaken for it.
    const known = new Set(Object.values(SVC_HEADERS).flat());
    const at = rows.findIndex(r => (r || []).some(c => SVC_HEADERS.name.includes(normHead(c))) && (r || []).filter(c => known.has(normHead(c))).length >= 2);
    if (at < 0) return { error: 'No "Name" column found. Use the template, or put the column names in the first row.' };
    const col = {};
    rows[at].forEach((c, i) => {
      const h = normHead(c);
      for (const [k, names] of Object.entries(SVC_HEADERS)) if (!(k in col) && names.includes(h)) col[k] = i;
    });
    const out = [];
    for (let i = at + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const cell = k => (k in col ? r[col[k]] : '');
      const text = k => String(cell(k) == null ? '' : cell(k)).trim();
      if (!r.some(c => String(c == null ? '' : c).trim())) continue;
      if (out.length >= MAX_SERVICE_ROWS) return { error: `This file has more than ${MAX_SERVICE_ROWS} rows. Split it into smaller files.` };
      const problems = [], notes = [];
      const v = { name: text('name'), provider: text('provider'), from: text('from'), notes: text('notes'), active: true };
      if (!v.name) problems.push('Name is empty');

      const t = text('type').toLowerCase();
      const exact = SVC_TYPES.find(x => x.toLowerCase() === t);
      v.type = exact || (t && (TYPE_WORDS.find(([, re]) => re.test(t)) || [])[0]) || '';
      if (!v.type) { v.type = 'Other'; if (t) notes.push(`Type "${redactDesc(text('type').slice(0, 30))}" saved as Other`); }
      else if (!exact) notes.push(`Type read as ${v.type}`);

      const f = text('freq').toLowerCase().replace(/\s+/g, ' ');
      v.freq = SVC_FREQ.find(x => x.toLowerCase() === f) || (f && (FREQ_WORDS.find(([, re]) => re.test(f)) || [])[0]) || 'None';
      if (f && !FREQ_WORDS.some(([, re]) => re.test(f))) problems.push(`"How often" must be ${SVC_FREQ.join(', ')}`);

      // Excel drops leading zeros (0123 becomes 123), so short numbers are padded back.
      const l4raw = cell('last4'), l4 = String(l4raw == null ? '' : l4raw).replace(/[\s•*xX-]/g, '');
      if (!l4) v.last4 = '';
      else if (/^\d{4}$/.test(l4)) v.last4 = l4;
      else if (typeof l4raw === 'number' && /^\d{1,3}$/.test(l4)) v.last4 = l4.padStart(4, '0');
      // Excel keeps only 15 digits of a long number, so its last 4 can't be trusted.
      else if (typeof l4raw === 'number' && l4raw >= 1e15) problems.push('Last 4 digits: type only the last 4 (Excel changes long numbers)');
      else if (typeof l4raw !== 'number' && /^\d{5,19}$/.test(l4)) { v.last4 = l4.slice(-4); notes.push('Kept only the last 4 digits'); }
      else problems.push('Last 4 digits must be 4 numbers');

      const a = cell('amount');
      if (a === '' || a == null) v.amount = '';
      else {
        const n = typeof a === 'number' ? a : Number(String(a).replace(/[₹,\s]|rs\.?|inr/gi, ''));
        if (isFinite(n) && n > 0) v.amount = n; else problems.push(isFinite(n) ? 'Amount must be more than 0' : 'Amount must be a number, like 649');
      }

      const d = cell('day');
      if (d === '' || d == null) v.day = null;
      else if (d instanceof Date) v.day = d.getDate(); // Excel turns "5-Oct" into a date; the day is what was meant
      else {
        const n = Number(String(d).replace(/(st|nd|rd|th)$/i, '').trim());
        if (Number.isInteger(n) && n >= 1 && n <= 31) v.day = n; else problems.push('Day must be between 1 and 31');
      }

      const st = text('status').toLowerCase();
      if (/^(stopped|stop|inactive|closed|cancell?ed|no|false|0)$/.test(st)) v.active = false;
      else if (st && !/^(active|yes|true|1|on)$/.test(st)) problems.push('Status must be Active or Stopped');
      out.push({ row: i + firstRow, value: v, problems, notes });
    }
    return { rows: out };
  }
  // The downloadable template: a Services sheet with the column names and a How to fill sheet.
  // The Last 4 digits column is formatted as text for TEMPLATE_ROWS rows so Excel keeps 0123.
  const TEMPLATE_ROWS = 500;
  function serviceTemplateBook(XLSX) {
    const wb = XLSX.utils.book_new();
    const list = XLSX.utils.aoa_to_sheet([SVC_COLUMNS]);
    list['!cols'] = [18, 24, 18, 13, 11, 12, 7, 18, 34, 10].map(wch => ({ wch }));
    const last4 = XLSX.utils.encode_col(SVC_COLUMNS.indexOf('Last 4 digits'));
    for (let r = 2; r <= TEMPLATE_ROWS + 1; r++) list[last4 + r] = { t: 's', v: '', z: '@' };
    list['!ref'] = 'A1:' + XLSX.utils.encode_col(SVC_COLUMNS.length - 1) + (TEMPLATE_ROWS + 1);
    XLSX.utils.book_append_sheet(wb, list, 'Services');
    const help = XLSX.utils.aoa_to_sheet([
      ['Column', 'Required', 'What to enter'],
      ['Type', 'No', SVC_TYPES.join(', ') + '. Left empty, it is saved as Other.'],
      ['Name', 'Yes', 'What you call it, e.g. Netflix, HDFC Regalia, SBI Savings.'],
      ['Bank or provider', 'No', 'e.g. HDFC, Groww, LIC.'],
      ['Last 4 digits', 'No', `Only the last 4 digits of a card or account. Never the full number. The first ${TEMPLATE_ROWS} rows keep a leading zero; in a CSV file, type all 4 digits, e.g. 0123.`],
      ['Amount', 'No', 'Rupees, e.g. 649.'],
      ['How often', 'No', SVC_FREQ.join(', ') + '.'],
      ['Day', 'No', 'Day of the month it is billed or debited, 1 to 31.'],
      ['Paid from', 'No', 'The account or card it is paid from, e.g. SBI Savings.'],
      ['Notes', 'No', 'Anything else, e.g. renews in March.'],
      ['Status', 'No', 'Active or Stopped. Left empty, it is Active.'],
      [],
      ['Do not enter passwords, PINs, CVVs or full card or account numbers.'],
    ]);
    help['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 90 }];
    XLSX.utils.book_append_sheet(wb, help, 'How to fill');
    return wb;
  }

  // Reads a workbook made by SheetJS (passed in, so tests can use the vendored copy). A CSV is read
  // as plain text so values like 0123 keep their leading zero.
  function readServiceBook(XLSX, data, isCsv) {
    const wb = isCsv ? XLSX.read(data, { type: 'string', raw: true }) : XLSX.read(data, { type: 'array', cellDates: true });
    const sn = wb.SheetNames.find(n => /services/i.test(n)) || wb.SheetNames[0];
    const ws = wb.Sheets[sn];
    // Row numbers in the preview match the spreadsheet even when the data doesn't start at row 1.
    const firstRow = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s.r + 1 : 1;
    return readServiceRows(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }), firstRow);
  }

  // Sorts read rows into ready to add, duplicates and rows with problems. clean turns a value
  // into a saved service (or null), so the same masking applies as for the form.
  function planServiceImport(rows, existing, clean) {
    const have = new Set(existing.map(v => serviceKey(v))), seen = new Set();
    const ready = [], lines = [];
    let dup = 0, bad = 0;
    for (const r of rows) {
      const v = r.problems.length ? null : clean(r.value);
      const key = v && serviceKey(v);
      let status, kind;
      if (!v) { status = r.problems.join('. ') || 'Name is empty'; kind = 'bad'; bad++; }
      else if (have.has(key)) { status = 'Already on your list'; kind = 'dup'; dup++; }
      else if (seen.has(key)) { status = 'Repeats an earlier row'; kind = 'dup'; dup++; }
      else { seen.add(key); ready.push(v); status = ['Ready'].concat(r.notes).join('. '); kind = 'ok'; }
      lines.push({ row: r.row, value: v || r.value, saved: !!v, status, kind });
    }
    return { ready, lines, dup, bad };
  }

  // Two entries are the same service when type, name, provider, last 4 digits, amount and day all match.
  const serviceKey = v => [v.type, merchantKey(v.name), merchantKey(v.provider || ''), v.last4, v.amount == null || v.amount === '' ? '' : Number(v.amount), v.day || ''].join('|');

  const PARSER_VERSION = 5;
  const api = { PARSER_VERSION, sbiParts, cleanPdfDesc, redactDesc, CATEGORIES, CAT_BY_NAME, parseDate, parseAmount, detectColumns, rowsToTxns, linesToTxns, itemsToLines, extractMerchant, categorize, makeTxn, merchantKey, findRecurring, txnId, SVC_TYPES, SVC_FREQ, SVC_COLUMNS, readServiceRows, readServiceBook, serviceTemplateBook, planServiceImport, serviceKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MD = api;
})(typeof window !== 'undefined' ? window : globalThis);
