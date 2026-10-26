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
    { name: 'Cash withdrawal', kind: 'spend', words: ['atm', 'cash wdl', 'cash withdrawal', ' atl/', 'nwd', 'atw', 'cwdr'] },
    { name: 'Fees & interest', kind: 'spend', words: ['annual fee', 'late fee', 'late payment', 'finance charge', 'interest charged', 'interest on', 'overlimit', 'charges', 'sms alert', 'membership fee', 'program fee', 'joining fee', 'renewal fee', 'gst', 'igst', 'cgst', 'sgst', 'penalty', 'surcharge', 'markup'] },
    { name: 'Investments', kind: 'invest', words: ['groww', 'nextbillion', 'zerodha', 'upstox', 'wealthy', 'kuvera', 'mutual fun', 'mutualfund', ' mf ', 'sip ', 'bse ltd', 'bsestarmf', 'nse clearing', 'indian clearin', 'iccl', 'cams', 'kfin', 'ppf', 'nps', 'smallcase', 'angel one', 'angel broking', 'dhan', 'paytm money', 'icici direct', 'hdfc securities', 'fixed deposit', ' fd ', 'recurring deposit', 'sgb', 'safegold', 'safe gold'] },
    { name: 'Card payments & transfers', kind: 'transfer', words: ['credit card payment', 'cc payment', 'card payment', 'payment received', 'payment - thank', 'thank you', 'cred club', 'dreamplug', 'cred ', 'autopay', 'self transfer', ' self ', 'own account', 'ac xfr from gl', 'sweep', 'cardbill', 'card bill', 'billdesk', 'sbicardp'] },
    { name: 'Salary', kind: 'income', words: ['salary', 'payroll', 'rzpx pvt ltd pa',
      // "SAL" only as a word of its own, so names ending in "sal" ("Reversal") don't match.
      ...[' ', '/', '-', '*'].flatMap(a => [' ', '/', '-', '*'].map(b => a + 'sal' + b))] },
    { name: 'Interest & dividends', kind: 'income', words: ['interest credit', 'interes t credit', 'int.pd', 'int pd', 'int.coll', 'interest paid', 'sb interest', 'dividend', 'div '] },
    { name: 'Refunds & cashback', kind: 'spend', words: ['refund', 'reversal', 'cashback', 'cash back', 'rev-', 'upi/rev/', 'chargeback'] },
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
    let s = clean(d);
    // HDFC's newer card layout: "| | hh:mm <details> (Ref# ...) + C", where C is the
    // rupee sign and "+" marks a credit (see pdfCredit).
    if (/^\|/.test(s)) s = s.replace(/^[|\s]+/, '').replace(/^\d{1,2}:\d{2}\s+/, '').replace(/\s*\(Ref#[^)]*\)/gi, ' ').replace(/\s*\+?\s*C$/, '');
    s = s.replace(/\s+\S*%.*$/, '').replace(/\s+#.*$/, '');
    // Card lines end in reward points, negative when a refund takes them back ("... IN -125").
    if (kind === 'card') s = s.replace(/\s-?\d{1,5}(?=(\s[A-Za-z]{2})?$)/, '');
    return s.trim();
  }

  // True when a card line marks its amount as a credit with "+" before the rupee sign (HDFC).
  // Only HDFC's layout starts with "|", so a merchant ending in "+ C" elsewhere stays a purchase.
  const pdfCredit = text => /^\s*\|.*\+\s*(?:C|₹)\s*$/.test(text);

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
    // A failed UPI payment comes back as "DEP TFR UPI/REV/<ref> ..." with no payee.
    if (/^DEP TFR UPI\/REV\//i.test(d)) return { name: 'UPI Reversal', handle: '', upi: false };
    m = /^DEP TFR (?:NEFT|IMPS|RTGS)\*[^*]*\*[^*]*\*(.*?)(?:\s+(?:X{4,}\d{4}|\d{8,}))?(?:\s+AT\s+\d+\b.*)?$/i.exec(d);
    // The payer's name starts right after a cut, so its first letter stands alone ("A XIS MUTUAL").
    if (m) return { name: m[1].replace(/^([a-z]) (?=[a-z]{2})/i, '$1').trim(), handle: '', upi: false };
    m = /^(?:WDL|DEP) TFR (?:INB|CMP|SBIY\S*)\s+(.*?)(?:\s+(?:X{4,}\d{4}|\d{8,}))?\s+AT\s+\d+\b/i.exec(d);
    // YONO and CMP lines end "<note> 0 <reference> OF <payee>"; other lines are the payee itself.
    if (m) { const of = /\s0\s+(?:X+\d{4}|\d{6,})\s+OF\s+(.+)$/i.exec(m[1]); return { name: (of ? of[1] : m[1]).trim(), handle: '', upi: false }; }
    m = /^DEBIT ACHDr \S+ \S+ (.+)$/i.exec(d);
    if (m) return { name: m[1].trim(), handle: '', upi: false };
    return null;
  }

  // Kotak lines that name the payee in a fixed place: card spends, ATM withdrawals,
  // NACH debits and interest. Returns a merchant or null.
  function kotakMerchant(d) {
    let m = /^PCD\/\d+\/([^/]+)/i.exec(d);
    if (m) return { name: titleCase(m[1].trim().slice(0, 40)), person: false };
    if (/^ATL\//i.test(d)) return { name: 'ATM withdrawal', person: false };
    m = /^NACH-\d+-DR-(.+?)-[A-Z0-9]*$/i.exec(d);
    if (m) return { name: titleCase(m[1].trim().slice(0, 40)), person: false };
    if (/^Int\.Pd:/i.test(d)) return { name: 'Interest', person: false };
    return null;
  }

  // Merchant names are labels shown everywhere (and to Claude through the extension), so they
  // never keep account, card, phone or reference numbers; the masked line stays in desc.
  function extractMerchant(desc) {
    const m = readMerchant(desc);
    // No numbers in a name: drop long digit runs and numbers written in groups (see maskGroup).
    const name = m.name.replace(GROUPED, n => maskGroup(n) === n ? n : ' ').replace(/\d{5,}/g, ' ').replace(/[\[(]\s*[\])]/g, ' ').replace(/[\s/:.-]+$/, '').replace(/^[\s/:.-]+/, '').replace(/\s+/g, ' ').trim();
    return { name: name || 'Unknown', person: m.person };
  }

  function readMerchant(desc) {
    const d = clean(desc);
    const low = d.toLowerCase();
    const kotak = kotakMerchant(d);
    if (kotak) return kotak;
    const sbi = sbiParts(d);
    if (sbi) {
      const w = sbi.name;
      // A UPI payee can be named by a phone number, which the statement masks.
      // The person check uses the whole name; only the shown name is cut to 40 characters.
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
      // A UPI ID written without its @handle ("UPI/aravind1398/..."): keep its letters.
      const handle = tokens.map(t => t.replace(/\d+/g, '').trim()).find(w => w.length >= 3 && /^[a-z][a-z ._]*$/i.test(w) && !/^x+$/i.test(w) && !BANK_CODES.test(w) && !/^upi$/i.test(w));
      if (vpa) {
        const v = vpa.replace(/[._]/g, ' ').replace(/\d+/g, '').trim();
        return { name: v.length >= 2 ? titleCase(v) : 'UPI payment', person: true };
      }
      if (/^upi\//i.test(d)) return handle ? { name: titleCase(handle.replace(/[._]/g, ' ')), person: true } : { name: 'UPI payment', person: true };
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

  // Numbers written in groups of digits joined by spaces or dashes ("98765 43210"). Dates inside
  // a run are split out and kept; the rest is masked only when it looks like a number, not like
  // years or small amounts. Examples are in tests/parser.test.js.
  // GROUPED is global: use it only with replace and match, which reset lastIndex, never test().
  const GROUPED = /\b\d{1,6}(?:[ -]\d{1,6})+\b/g;
  const isYear = x => /^(?:19|20)\d\d$/.test(x);
  const inRange = (x, max) => /^\d{1,2}$/.test(x) && +x >= 1 && +x <= max;
  // d-m-yyyy and yyyy-m-d with any one separator, and d-m-yy with dashes only, so that a number
  // in two-digit groups ("98 76 54 32 10") is not taken for a date.
  const isDate = (a, b, c, s1, s2) => s1 === s2 && c !== undefined && inRange(b, 12) &&
    ((inRange(a, 31) && (isYear(c) || (s1 === '-' && /^\d\d$/.test(c)))) || (isYear(a) && inRange(c, 31)));
  const onlyYears = g => g.every(isYear);
  // All groups of 4+ digits and 8+ in all, or 10+ digits with a group of 4+ or only groups of 1-2
  // (phone numbers). Runs of 3-digit groups, such as amounts, stay readable.
  const looksLikeNumber = g => {
    const digits = g.join('').length;
    if (g.every(x => x.length >= 4)) return digits >= 8;
    return digits >= 10 && (g.some(x => x.length >= 4) || g.every(x => x.length <= 2));
  };
  function maskGroup(n) {
    const g = n.split(/[ -]/), sep = n.match(/[ -]/g) || []; // sep[i] sits between g[i] and g[i + 1]
    const join = (from, to) => g.slice(from, to).map((x, k) => (k ? sep[from + k - 1] : '') + x).join('');
    for (let i = 0; i + 2 < g.length; i++) {
      if (!isDate(g[i], g[i + 1], g[i + 2], sep[i], sep[i + 1])) continue;
      // Keep the date and judge what comes before and after it on its own.
      const end = i + 3;
      return (i ? maskGroup(join(0, i)) + sep[i - 1] : '') + join(i, end) + (end < g.length ? sep[end - 1] + maskGroup(join(end, g.length)) : '');
    }
    if (onlyYears(g) || !looksLikeNumber(g)) return n;
    const d = g.join('');
    // Card numbers (4-4-4-4, Amex 4-6-5, Diners 4-6-4) keep the card style, XX1234. A longer run,
    // such as a card number with its expiry, keeps the run's last 4 digits, which is still masked.
    if (d.length >= 13 && d.length <= 19) return 'XX' + d.slice(-4);
    // Phone and account numbers keep only their last 4 digits.
    return 'X'.repeat(d.length - 4) + d.slice(-4);
  }

  // Masks UPI IDs, reference/account numbers and card numbers in a description line,
  // keeping enough to recognise them: ra***@oksbi, XXXXXXXX5678, XX1234.
  function redactDesc(d) {
    return clean(d)
      .replace(/\b\d{4,6}[xX*]{4,}(\d{4})\b/g, 'XX$1')
      .replace(GROUPED, maskGroup)
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

  // The same line can really happen twice (two identical small payments at one shop on one day). The second and
  // later copies get "d2", "d3"... on their id, so they are kept and a re-import still matches.
  // Ids already in use in txns are skipped, so numbering a list that includes saved lines never
  // gives two lines one id.
  function numberRepeats(txns) {
    const taken = new Set(), last = new Map();
    for (const t of txns) {
      if (!taken.has(t.id)) { taken.add(t.id); continue; }
      const base = t.id;
      let n = last.get(base) || 1;
      do n++; while (taken.has(base + 'd' + n));
      last.set(base, n);
      t.id = base + 'd' + n;
      taken.add(t.id);
    }
    return txns;
  }

  // Moves the lines that inStatement picks into another account: new ids (the account is part of
  // the id), numbered against lines already there, and categories for the new account's type.
  // Categories you picked yourself are kept. Lines already in that account (findImported) are
  // dropped instead of being added twice. Returns { txns, moved, dropped }.
  function moveStatement(txns, inStatement, account, accountKind, rules) {
    const there = txns.filter(t => t.account === account);
    let moved = txns.filter(inStatement);
    for (const t of moved) {
      t.account = account;
      t.id = txnId(t);
      if (!t.manual) {
        let c = categorize(t.desc, t.merchant, t.amount, rules, accountKind);
        if (c === 'Other' && extractMerchant(t.desc).person) c = 'People (UPI)';
        t.category = c;
      }
    }
    numberRepeats(moved);
    const known = findImported(there, moved);
    const drop = new Set(moved.filter((t, i) => known.has(i)));
    moved = moved.filter(t => !drop.has(t));
    numberRepeats([...there, ...moved]);
    return { txns: txns.filter(t => !drop.has(t)), moved, dropped: drop.size };
  }

  // After the reader improves (PARSER_VERSION), re-clean saved lines in data ({ txns, rules,
  // accounts }): descriptions, merchant names and categories (yours are kept), file names, and
  // HDFC credits older versions read as spending. Rules follow a merchant whose name changes.
  function refreshSaved(data) {
    const firstSource = new Map();
    const own = k => Object.prototype.hasOwnProperty.call(data.rules, k);
    data.txns = data.txns.filter(t => {
      const kind = (data.accounts[t.account] || {}).kind || 'bank';
      const oldKey = merchantKey(t.merchant);
      const before = t.desc;
      t.source = maskSource(t.source);
      if (/\.pdf$/i.test(t.source || '')) {
        if (kind === 'card' && t.amount < 0 && pdfCredit(t.desc)) t.amount = -t.amount;
        t.desc = cleanPdfDesc(t.desc, kind);
      }
      const m = extractMerchant(t.desc);
      t.merchant = m.name;
      const key = merchantKey(m.name);
      if (own(oldKey) && !own(key) && key !== '__proto__') data.rules[key] = data.rules[oldKey];
      if (!t.manual) {
        let c = categorize(t.desc, m.name, t.amount, data.rules, kind);
        if (c === 'Other' && m.person) c = 'People (UPI)';
        t.category = c;
      }
      // Keep the id unless the line was cleaned (a flipped amount always comes with a cleaned
      // line), so re-imports are still recognised.
      if (t.desc !== before) t.id = txnId(t);
      t.desc = redactDesc(t.desc);
      // One id from two statements is one line imported twice. From one statement it is a real
      // repeat: imports skip lines whose id is already saved, so one file can't come in twice.
      // The trade-off: two different statements that overlap in dates and both list the very
      // same line (same date, amount and wording) keep only one copy of it.
      if (!firstSource.has(t.id)) { firstSource.set(t.id, t.source); return true; }
      return firstSource.get(t.id) === t.source;
    });
    numberRepeats(data.txns);
    return data;
  }

  // Letters and digits a description needs before a prefix match counts, so short names
  // ("UPI-RAHUL" vs "UPI-RAHUL KUMAR") stay apart.
  const SAME_LINE_MIN = 16;

  // Which newly read lines are already saved: the same id, or the same account, date and amount
  // with one description starting the other ("... MUMBAI" vs "... MUMBAI IN"), since two
  // downloads of one statement can be laid out differently. Each saved line matches once.
  // Returns a Set of indexes into fresh.
  function findImported(saved, fresh) {
    const ids = new Set(saved.map(t => t.id));
    const norm = d => String(d || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const pool = new Map();
    for (const t of saved) {
      const k = `${t.account}|${t.date}|${t.amount}`;
      if (!pool.has(k)) pool.set(k, []);
      pool.get(k).push({ d: norm(t.desc), id: t.id, used: false });
    }
    const out = new Set();
    fresh.forEach((t, i) => {
      const list = pool.get(`${t.account}|${t.date}|${t.amount}`) || [];
      if (ids.has(t.id)) {
        const hit = list.find(x => x.id === t.id && !x.used);
        if (hit) { hit.used = true; out.add(i); return; }
      }
      const d = norm(t.desc);
      const hit = d.length >= SAME_LINE_MIN && list.find(x => !x.used && x.d.length >= SAME_LINE_MIN && (x.d.startsWith(d) || d.startsWith(x.d)));
      if (hit) { hit.used = true; out.add(i); }
    });
    return out;
  }

  // File names can carry a card or statement number: keep only the last 4 digits of long ones.
  const maskSource = name => String(name || '').replace(/\d{10,}/g, n => 'X'.repeat(n.length - 4) + n.slice(-4));

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
      txns: numberRepeats(out.map(t => makeTxn({ date: t.date, desc: t.desc + (t.__more || ''), amount: t.amount, account: opts.account, accountKind: opts.accountKind, rules: opts.rules, source: opts.source }))),
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
        else if (opts.accountKind === 'card') amount = CREDIT_WORDS.test(desc) || pdfCredit(rest.slice(0, amts[amts.length - 1].index)) ? v : -v;
        else amount = a.value < 0 ? a.value : -v;
      }
      if (!desc && !amount) { skipped++; continue; }
      last = { date, desc: desc || 'Transaction', amount };
      out.push(last);
    }
    return {
      txns: numberRepeats(out.map(t => makeTxn({ date: t.date, desc: t.desc, amount: t.amount, account: opts.account, accountKind: opts.accountKind, rules: opts.rules, source: opts.source }))),
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

  // ---------- Reading check ----------
  // How a statement line is laid out, with every name, number and amount taken out, e.g.
  // "WDL TFR UPI/DR/x9/a/a/a/UPI x9 AT 9 a". Only the bank's own fixed words are kept, so the
  // shape can be shared to improve the reader without sharing what the line says.
  // Keep this list to banking terms of 3+ letters (plus DR, CR, AT): nothing that could be a name.
  const SHAPE_WORDS = new Set(['WDL', 'DEP', 'TFR', 'UPI', 'DR', 'CR', 'AT', 'NEFT', 'IMPS', 'RTGS', 'ACH', 'ACHDR', 'NACH', 'ECS',
    'DEBIT', 'CREDIT', 'ATM', 'ATL', 'PCD', 'POS', 'INB', 'CMP', 'BIL', 'ONL', 'ECOM', 'REV', 'INT', 'FROM', 'TRANSFER', 'SWEEP',
    'TRF', 'XFR', 'CHQ', 'CLG', 'EMI', 'FEE', 'CHARGES', 'GST', 'INTEREST', 'CASHBACK', 'REFUND', 'REVERSAL', 'SALARY', 'PAYMENT',
    'CARD', 'AUTOPAY', 'MANDATE']);
  function lineShape(desc) {
    return clean(desc).slice(0, 200)
      // Words and numbers in any script: a name written in Devanagari is still just "a".
      .replace(/[\p{L}\p{M}]+|\p{N}+/gu, w => /^\p{N}+$/u.test(w) ? '9' : /^x+$/i.test(w) ? 'x' : SHAPE_WORDS.has(w.toUpperCase()) ? w.toUpperCase() : 'a')
      .replace(/[^\x20-\x7e]/g, '?')
      .replace(/a(?:[ .,&'-]+a)+/g, 'a')
      .replace(/\*+/g, '*');
  }

  // Saved lines go through redactDesc, which leaves at most 4 digits of a number and 2 letters
  // of a UPI ID; anything longer, or a number still written in groups, means a number or ID got
  // through unmasked (for example a line saved by an older version).
  const unmaskedDesc = d => /\d{6,}|[\w.+-]{3,}@[a-z]/i.test(d) || (d.match(GROUPED) || []).some(n => maskGroup(n) !== n);
  const UNMASKED_MERCHANT = /\d{5,}|@/;

  // Per account: rows, rows in Other / Other income, rows that may still hold an unmasked
  // number or UPI ID, and the shapes of both kinds of line. Counts and shapes only.
  function readingReport(txns, topShapes = 15) {
    const by = new Map();
    const top = m => [...m].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, topShapes).map(([shape, count]) => ({ shape, count }));
    for (const t of txns) {
      const a = by.get(t.account) || { account: t.account, rows: 0, unread: 0, unmasked: 0, shapes: new Map(), unmaskedShapes: new Map() };
      by.set(t.account, a);
      a.rows++;
      const desc = String(t.desc || '');
      const merchant = String(t.merchant || '');
      const descUnmasked = unmaskedDesc(desc);
      const unmasked = descUnmasked || UNMASKED_MERCHANT.test(merchant);
      const unread = t.category === 'Other' || t.category === 'Other income';
      const layout = !(unmasked || unread) ? '' : clean(desc) ? lineShape(desc) : '(no description)';
      // When only the merchant name trips the check, the line's layout would point at the wrong
      // thing. If the line is also uncategorised, it is listed there by its layout as usual.
      const unmaskedLayout = descUnmasked ? layout : '(merchant name)';
      if (unmasked) { a.unmasked++; a.unmaskedShapes.set(unmaskedLayout, (a.unmaskedShapes.get(unmaskedLayout) || 0) + 1); }
      if (unread) { a.unread++; a.shapes.set(layout, (a.shapes.get(layout) || 0) + 1); }
    }
    return [...by.values()].sort((x, y) => String(x.account).localeCompare(String(y.account))).map(a => ({
      account: a.account, rows: a.rows, unread: a.unread, unmasked: a.unmasked, shapes: top(a.shapes), unmaskedShapes: top(a.unmaskedShapes),
    }));
  }

  // The report to copy: accounts by number only. kindOf(account) gives the account's kind
  // ('card' or 'bank'); without it every account is listed as a bank account.
  // Besides real layouts, the lists can hold two fixed labels: (merchant name) for a line flagged
  // only by its merchant name, and (no description) for a line with no text.
  function readingReportText(rep, kindOf = () => 'bank') {
    const lines = ['Money Desk reading check: line layouts and counts only (no names, numbers, amounts, dates or account names)'];
    rep.forEach((a, i) => {
      const kind = kindOf(a.account) === 'card' ? 'credit card' : 'bank account';
      lines.push('', `Account ${i + 1} (${kind}): ${a.rows} rows, ${a.unread} uncategorised (Other), ${a.unmasked} may hold an unmasked number`);
      if (a.shapes.length) lines.push('  Uncategorised layouts:', ...a.shapes.map(s => `    ${s.count}x  ${s.shape}`));
      if (a.unmaskedShapes.length) lines.push('  Layouts that may be unmasked:', ...a.unmaskedShapes.map(s => `    ${s.count}x  ${s.shape}`));
    });
    return lines.join('\n');
  }

  const PARSER_VERSION = 9;
  const api = { PARSER_VERSION, sbiParts, cleanPdfDesc, redactDesc, CATEGORIES, CAT_BY_NAME, parseDate, parseAmount, detectColumns, rowsToTxns, linesToTxns, itemsToLines, extractMerchant, categorize, makeTxn, merchantKey, findRecurring, txnId, numberRepeats, moveStatement, refreshSaved, findImported, maskSource, pdfCredit, lineShape, readingReport, readingReportText, SVC_TYPES, SVC_FREQ, SVC_COLUMNS, readServiceRows, readServiceBook, serviceTemplateBook, planServiceImport, serviceKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MD = api;
})(typeof window !== 'undefined' ? window : globalThis);
