// Money Desk: made-up sample data so the dashboard can be tried before importing real statements.
(function (root) {
  'use strict';
  function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }

  function build(MD, today) {
    const r = rng(42);
    const pick = a => a[Math.floor(r() * a.length)];
    const between = (a, b) => Math.round((a + r() * (b - a)) / 10) * 10;
    const out = [];
    const add = (y, m, d, desc, amount, account, kind) => {
      const last = new Date(y, m, 0).getDate();
      const dt = new Date(y, m - 1, Math.min(d, last));
      if (dt > today) return;
      const date = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const t = MD.makeTxn({ date, desc, amount, account, accountKind: kind, rules: {}, source: 'sample' });
      out.push(t);
    };
    for (let k = 5; k >= 0; k--) {
      const ref = new Date(today.getFullYear(), today.getMonth() - k, 1);
      const y = ref.getFullYear(), m = ref.getMonth() + 1;
      const SB = ['SBI Savings', 'bank'], KO = ['Kotak Savings', 'bank'], HD = ['HDFC Credit Card', 'card'], IC = ['ICICI Credit Card', 'card'];
      add(y, m, 1, 'BY TRANSFER-NEFT*ACME TECHNOLOGIES PVT LTD*SALARY', 92000, ...SB);
      add(y, m, 3, 'TO TRANSFER-UPI/DR/6275' + m + '1234/RAMESH KUMAR/SBIN/ramesh.k@oksbi/Rent', -22000, ...SB);
      add(y, m, 5, 'ACH DR GROWW SIP NEXTBILLION TECHNOLOGY', -10000, ...SB);
      add(y, m, 5, 'ACH DR WEALTHY MUTUAL FUND SIP', -5000, ...SB);
      add(y, m, 7, 'TO TRANSFER-UPI/DR/6277' + m + '9911/BESCOM/YESB/bescom@ybl/Bill', -between(900, 1700), ...SB);
      add(y, m, 9, 'TO TRANSFER-UPI/DR/6278' + m + '1212/AIRTEL/AIRP/airtel@airtel/Recharge', -999, ...SB);
      add(y, m, 12, 'TO TRANSFER-INB HDFC CREDIT CARD PAYMENT', -between(14000, 21000), ...SB);
      add(y, m, 14, 'TO TRANSFER-INB ICICI CREDIT CARD PAYMENT', -between(6000, 11000), ...SB);
      add(y, m, 15, 'TO TRANSFER-UPI/DR/6279' + m + '4545/SELF/KKBK/self@kotak/Transfer', -8000, ...SB);
      add(y, m, 15, 'UPI/SELF/SBI SAVINGS/Transfer from self own account', 8000, ...KO);
      for (let i = 0; i < 3; i++) add(y, m, 4 + i * 9, 'UPI/BLINKIT/42781' + m + i + '678/Payment', -between(350, 1400), ...KO);
      for (let i = 0; i < 2; i++) add(y, m, 8 + i * 12, 'UPI/ZEPTO MARKETPLACE/4279' + m + i + '22/Payment', -between(300, 900), ...KO);
      add(y, m, 18, 'UPI/' + pick(['ANKIT VERMA', 'PRIYA NAIR', 'SURESH PATIL']) + '/42' + m + '55/Dinner split', -between(400, 1500), ...KO);
      add(y, m, 21, 'ATM WDL SBI ATM KORAMANGALA', -2000, ...KO);
      add(y, m, 28, 'Int.Pd:5521:quarterly SB interest', k % 3 === 0 ? 410 : 0, ...KO);
      const food = ['SWIGGY BANGALORE IN', 'ZOMATO LTD GURGAON IN', 'SWIGGY INSTAMART BANGALORE', 'DOMINOS PIZZA BANGALORE'];
      for (let i = 0; i < 9 + Math.floor(r() * 4); i++) add(y, m, 1 + Math.floor(r() * 28), pick(food), -between(220, 780), ...HD);
      add(y, m, 2, 'NETFLIX.COM MUMBAI IN', -649, ...HD);
      add(y, m, 4, 'SPOTIFY INDIA MUMBAI', -119, ...HD);
      add(y, m, 6, 'GOOGLE YOUTUBE PREMIUM', -149, ...HD);
      add(y, m, 10, 'CULTFIT CUREFIT HEALTHCARE BANGALORE', -1499, ...HD);
      for (let i = 0; i < 2 + Math.floor(r() * 2); i++) add(y, m, 3 + Math.floor(r() * 25), pick(['AMAZON PAY INDIA PRIVATE BANGALORE', 'FLIPKART INTERNET BANGALORE', 'MYNTRA DESIGNS BANGALORE']), -between(500, 4200), ...HD);
      add(y, m, 13, 'PAYMENT RECEIVED - THANK YOU', between(14000, 21000), ...HD);
      if (k === 2) { add(y, m, 20, 'FINANCE CHARGES', -486.2, ...HD); add(y, m, 20, 'IGST ON FINANCE CHARGES', -87.5, ...HD); add(y, m, 20, 'LATE PAYMENT FEE', -700, ...HD); }
      for (let i = 0; i < 6 + Math.floor(r() * 4); i++) add(y, m, 1 + Math.floor(r() * 28), pick(['UBER INDIA SYSTEMS PVT BANGALORE', 'OLA CABS ANI TECHNOLOGIES', 'RAPIDO BIKE TAXI']), -between(120, 520), ...IC);
      add(y, m, 11, 'HPCL FUEL STATION BANGALORE', -between(1500, 2600), ...IC);
      add(y, m, 16, 'APOLLO PHARMACY BANGALORE', -between(250, 900), ...IC);
      if (k % 2 === 0) add(y, m, 22, 'BOOKMYSHOW MUMBAI', -between(500, 1100), ...IC);
      if (k === 1) add(y, m, 9, 'MAKEMYTRIP INDIA PVT LTD', -14850, ...IC);
      if (k === 1) add(y, m, 24, 'REFUND AMAZON PAY INDIA', 1299, ...IC);
      add(y, m, 14, 'BBPS PAYMENT RECEIVED', between(6000, 11000), ...IC);
    }
    return out.filter(t => t.amount !== 0);
  }

  root.MDSample = { build };
})(typeof window !== 'undefined' ? window : globalThis);
