// Money Desk: opens password-protected Excel files (Office "agile" and "standard" encryption,
// MS-OFFCRYPTO) on this laptop. No network, no dependencies beyond the browser's Web Crypto and
// the vendored SheetJS CFB reader, which the caller passes in. The password is used only for the
// one file and is never stored. The agile format's data-integrity HMAC is not checked: the
// password verifier already proves the key, and a tampered file just fails to parse.
(function (root) {
  'use strict';

  // The browser always has Web Crypto; the require fallback is for the Node tests.
  const subtle = () => (root.crypto && root.crypto.subtle) || require('crypto').webcrypto.subtle;

  // ---------- Hashes ----------
  // The key is derived by hashing up to 100,000 times. Web Crypto's digest is asynchronous and far
  // too slow for that, so SHA-1 and SHA-512 are implemented here; other hashes fall back to it.
  // Lengths are kept in 32-bit integers, which is fine for these short key-derivation inputs.
  function sha1(msg) {
    const len = msg.length, words = new Int32Array((((len + 8) >> 6) + 1) * 16);
    for (let i = 0; i < len; i++) words[i >> 2] |= msg[i] << (24 - (i % 4) * 8);
    words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
    words[words.length - 1] = len * 8;
    let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476, e = 0xc3d2e1f0;
    const w = new Int32Array(80);
    for (let i = 0; i < words.length; i += 16) {
      for (let t = 0; t < 80; t++) {
        w[t] = t < 16 ? words[i + t] : ((x => (x << 1) | (x >>> 31))(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]));
      }
      let A = a, B = b, C = c, D = d, E = e;
      for (let t = 0; t < 80; t++) {
        const f = t < 20 ? (B & C) | (~B & D) : t < 40 ? B ^ C ^ D : t < 60 ? (B & C) | (B & D) | (C & D) : B ^ C ^ D;
        const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
        const tmp = (((A << 5) | (A >>> 27)) + f + E + k + w[t]) | 0;
        E = D; D = C; C = (B << 30) | (B >>> 2); B = A; A = tmp;
      }
      a = (a + A) | 0; b = (b + B) | 0; c = (c + C) | 0; d = (d + D) | 0; e = (e + E) | 0;
    }
    const out = new Uint8Array(20), dv = new DataView(out.buffer);
    [a, b, c, d, e].forEach((v, i) => dv.setInt32(i * 4, v));
    return out;
  }

  const K512 = [
    0x428a2f98, 0xd728ae22, 0x71374491, 0x23ef65cd, 0xb5c0fbcf, 0xec4d3b2f, 0xe9b5dba5, 0x8189dbbc, 0x3956c25b, 0xf348b538, 0x59f111f1, 0xb605d019, 0x923f82a4, 0xaf194f9b, 0xab1c5ed5, 0xda6d8118,
    0xd807aa98, 0xa3030242, 0x12835b01, 0x45706fbe, 0x243185be, 0x4ee4b28c, 0x550c7dc3, 0xd5ffb4e2, 0x72be5d74, 0xf27b896f, 0x80deb1fe, 0x3b1696b1, 0x9bdc06a7, 0x25c71235, 0xc19bf174, 0xcf692694,
    0xe49b69c1, 0x9ef14ad2, 0xefbe4786, 0x384f25e3, 0x0fc19dc6, 0x8b8cd5b5, 0x240ca1cc, 0x77ac9c65, 0x2de92c6f, 0x592b0275, 0x4a7484aa, 0x6ea6e483, 0x5cb0a9dc, 0xbd41fbd4, 0x76f988da, 0x831153b5,
    0x983e5152, 0xee66dfab, 0xa831c66d, 0x2db43210, 0xb00327c8, 0x98fb213f, 0xbf597fc7, 0xbeef0ee4, 0xc6e00bf3, 0x3da88fc2, 0xd5a79147, 0x930aa725, 0x06ca6351, 0xe003826f, 0x14292967, 0x0a0e6e70,
    0x27b70a85, 0x46d22ffc, 0x2e1b2138, 0x5c26c926, 0x4d2c6dfc, 0x5ac42aed, 0x53380d13, 0x9d95b3df, 0x650a7354, 0x8baf63de, 0x766a0abb, 0x3c77b2a8, 0x81c2c92e, 0x47edaee6, 0x92722c85, 0x1482353b,
    0xa2bfe8a1, 0x4cf10364, 0xa81a664b, 0xbc423001, 0xc24b8b70, 0xd0f89791, 0xc76c51a3, 0x0654be30, 0xd192e819, 0xd6ef5218, 0xd6990624, 0x5565a910, 0xf40e3585, 0x5771202a, 0x106aa070, 0x32bbd1b8,
    0x19a4c116, 0xb8d2d0c8, 0x1e376c08, 0x5141ab53, 0x2748774c, 0xdf8eeb99, 0x34b0bcb5, 0xe19b48a8, 0x391c0cb3, 0xc5c95a63, 0x4ed8aa4a, 0xe3418acb, 0x5b9cca4f, 0x7763e373, 0x682e6ff3, 0xd6b2b8a3,
    0x748f82ee, 0x5defb2fc, 0x78a5636f, 0x43172f60, 0x84c87814, 0xa1f0ab72, 0x8cc70208, 0x1a6439ec, 0x90befffa, 0x23631e28, 0xa4506ceb, 0xde82bde9, 0xbef9a3f7, 0xb2c67915, 0xc67178f2, 0xe372532b,
    0xca273ece, 0xea26619c, 0xd186b8c7, 0x21c0c207, 0xeada7dd6, 0xcde0eb1e, 0xf57d4f7f, 0xee6ed178, 0x06f067aa, 0x72176fba, 0x0a637dc5, 0xa2c898a6, 0x113f9804, 0xbef90dae, 0x1b710b35, 0x131c471b,
    0x28db77f5, 0x23047d84, 0x32caab7b, 0x40c72493, 0x3c9ebe0a, 0x15c9bebc, 0x431d67c4, 0x9c100d4c, 0x4cc5d4be, 0xcb3e42b6, 0x597f299c, 0xfc657e2a, 0x5fcb6fab, 0x3ad6faec, 0x6c44198c, 0x4a475817,
  ];
  // SHA-512 on 32-bit halves (hi, lo), since JavaScript has no fast 64-bit integers.
  function sha512(msg) {
    const len = msg.length, blocks = ((len + 17 + 127) >> 7);
    const buf = new Uint8Array(blocks * 128);
    buf.set(msg); buf[len] = 0x80;
    const bdv = new DataView(buf.buffer);
    bdv.setUint32(buf.length - 8, Math.floor(len / 0x20000000)); bdv.setUint32(buf.length - 4, (len * 8) >>> 0);
    const H = new Int32Array([0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1,
      0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179]);
    const W = new Int32Array(160);
    for (let off = 0; off < buf.length; off += 128) {
      for (let i = 0; i < 32; i++) W[i] = bdv.getInt32(off + i * 4);
      for (let i = 16; i < 80; i++) {
        const xh = W[(i - 15) * 2], xl = W[(i - 15) * 2 + 1];
        const s0h = ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
        const s0l = ((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25));
        const yh = W[(i - 2) * 2], yl = W[(i - 2) * 2 + 1];
        const s1h = ((yh >>> 19) | (yl << 13)) ^ ((yl >>> 29) | (yh << 3)) ^ (yh >>> 6);
        const s1l = ((yl >>> 19) | (yh << 13)) ^ ((yh >>> 29) | (yl << 3)) ^ ((yl >>> 6) | (yh << 26));
        let l = (s0l >>> 0) + (s1l >>> 0) + (W[(i - 7) * 2 + 1] >>> 0) + (W[(i - 16) * 2 + 1] >>> 0);
        const h = s0h + s1h + W[(i - 7) * 2] + W[(i - 16) * 2] + Math.floor(l / 0x100000000);
        W[i * 2] = h | 0; W[i * 2 + 1] = l | 0;
      }
      let ah = H[0], al = H[1], bh = H[2], bl = H[3], ch = H[4], cl = H[5], dh = H[6], dl = H[7];
      let eh = H[8], el = H[9], fh = H[10], fl = H[11], gh = H[12], gl = H[13], hh = H[14], hl = H[15];
      for (let i = 0; i < 80; i++) {
        const S1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
        const S1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
        const chh = (eh & fh) ^ (~eh & gh), chl = (el & fl) ^ (~el & gl);
        let l = (hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + (K512[i * 2 + 1] >>> 0) + (W[i * 2 + 1] >>> 0);
        const t1h = (hh + S1h + chh + K512[i * 2] + W[i * 2] + Math.floor(l / 0x100000000)) | 0, t1l = l | 0;
        const S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
        const S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
        const majh = (ah & bh) ^ (ah & ch) ^ (bh & ch), majl = (al & bl) ^ (al & cl) ^ (bl & cl);
        l = (S0l >>> 0) + (majl >>> 0);
        const t2h = (S0h + majh + Math.floor(l / 0x100000000)) | 0, t2l = l | 0;
        hh = gh; hl = gl; gh = fh; gl = fl; fh = eh; fl = el;
        l = (dl >>> 0) + (t1l >>> 0); eh = (dh + t1h + Math.floor(l / 0x100000000)) | 0; el = l | 0;
        dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
        l = (t1l >>> 0) + (t2l >>> 0); ah = (t1h + t2h + Math.floor(l / 0x100000000)) | 0; al = l | 0;
      }
      const add = (i, h, lo) => { const s = (H[i + 1] >>> 0) + (lo >>> 0); H[i] = (H[i] + h + Math.floor(s / 0x100000000)) | 0; H[i + 1] = s | 0; };
      add(0, ah, al); add(2, bh, bl); add(4, ch, cl); add(6, dh, dl); add(8, eh, el); add(10, fh, fl); add(12, gh, gl); add(14, hh, hl);
    }
    const out = new Uint8Array(64), dv = new DataView(out.buffer);
    for (let i = 0; i < 16; i++) dv.setInt32(i * 4, H[i]);
    return out;
  }

  // Hash names as Office writes them. SHA-256 and SHA-384 use Web Crypto, which is slower.
  const HASHES = {
    'SHA1': [sha1, 'SHA-1'], 'SHA-1': [sha1, 'SHA-1'],
    'SHA512': [sha512, 'SHA-512'], 'SHA-512': [sha512, 'SHA-512'],
    'SHA256': [null, 'SHA-256'], 'SHA-256': [null, 'SHA-256'],
    'SHA384': [null, 'SHA-384'], 'SHA-384': [null, 'SHA-384'],
  };
  async function hasher(name) {
    const h = HASHES[String(name).toUpperCase()];
    if (!h) throw new Error(UNSUPPORTED);
    if (h[0]) return h[0];
    const s = subtle();
    return async m => new Uint8Array(await s.digest(h[1], m));
  }

  const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
  const u32 = n => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
  const utf16 = s => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { b[i * 2] = s.charCodeAt(i) & 255; b[i * 2 + 1] = s.charCodeAt(i) >> 8; } return b; };
  const fit = (b, n, pad) => { const out = new Uint8Array(n).fill(pad); out.set(b.subarray(0, n)); return out; };
  const equal = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  // ---------- AES without padding ----------
  // Web Crypto only offers AES-CBC with PKCS#7 padding, while Office data has none. Appending one
  // block that decrypts to a full padding block makes the browser accept it.
  async function aesCbcRaw(keyBytes, iv, data) {
    const s = subtle();
    const key = await s.importKey('raw', keyBytes, 'AES-CBC', false, ['encrypt', 'decrypt']);
    const last = data.length ? data.subarray(data.length - 16) : iv;
    const padBlock = new Uint8Array(await s.encrypt({ name: 'AES-CBC', iv: last }, key, new Uint8Array(16).fill(16))).subarray(0, 16);
    return new Uint8Array(await s.decrypt({ name: 'AES-CBC', iv }, key, concat(data, padBlock)));
  }
  // ECB is CBC decryption with a zero IV, after undoing the chaining XOR.
  async function aesEcbRaw(keyBytes, data) {
    const out = await aesCbcRaw(keyBytes, new Uint8Array(16), data);
    for (let i = 16; i < out.length; i++) out[i] ^= data[i - 16];
    return out;
  }

  // ---------- File structure ----------
  const AES_KEY_BYTES = [16, 24, 32], MAX_SPIN = 1000000;
  const DAMAGED = 'this locked file looks damaged. Download it again';
  const UNSUPPORTED = "this file uses a kind of password lock Money Desk can't open yet";
  // The decrypted size is stored as 8 bytes before the data; it can't be larger than the data.
  function packageSize(pkg) {
    if (pkg.length < 8) throw new Error(DAMAGED);
    const dv = new DataView(pkg.buffer, pkg.byteOffset, pkg.byteLength);
    const size = dv.getUint32(0, true);
    if (dv.getUint32(4, true) !== 0 || size > pkg.length - 8) throw new Error(DAMAGED);
    return size;
  }
  function streams(CFB, bytes) {
    let cfb;
    try { cfb = CFB.read(bytes, { type: 'array' }); } catch (e) { return null; }
    const get = n => { const f = CFB.find(cfb, n); return f && f.content ? Uint8Array.from(f.content) : null; };
    const info = get('EncryptionInfo'), pkg = get('EncryptedPackage');
    return info && pkg ? { info, pkg } : null;
  }
  const isEncrypted = (CFB, bytes) => bytes.length > 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0 && !!streams(CFB, bytes);
  const b64 = s => { try { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); } catch (e) { throw new Error(DAMAGED); } };
  const attr = (xml, tag, name) => { const m = new RegExp('<(?:\\w+:)?' + tag + '\\b[^>]*\\s' + name + '="([^"]*)"').exec(xml); return m ? m[1] : null; };

  async function decryptAgile(info, pkg, password) {
    const xml = new TextDecoder().decode(info.subarray(8));
    // A missing attribute means the file is damaged, not that the password is wrong.
    const need = v => { if (v == null || v === '') throw new Error(DAMAGED); return v; };
    const kd = n => need(attr(xml, 'keyData', n)), ek = n => need(attr(xml, 'encryptedKey', n));
    const opt = (tag, n) => attr(xml, tag, n);
    const blockSize = +kd('blockSize'), keyBytes = +ek('keyBits') / 8, dataKeyBytes = +kd('keyBits') / 8;
    // Values from the file are checked so a damaged or hostile file can't hang or exhaust the page.
    if (blockSize !== 16 || !AES_KEY_BYTES.includes(keyBytes) || !AES_KEY_BYTES.includes(dataKeyBytes)) throw new Error(UNSUPPORTED);
    if (!/AES/i.test(opt('encryptedKey', 'cipherAlgorithm') || 'AES') || !/ChainingModeCBC/i.test(opt('encryptedKey', 'cipherChaining') || 'ChainingModeCBC')) throw new Error(UNSUPPORTED);
    const hash = await hasher(ek('hashAlgorithm')), dataHash = await hasher(kd('hashAlgorithm'));
    const salt = b64(ek('saltValue'));
    let h = await hash(concat(salt, utf16(password)));
    const spin = +ek('spinCount');
    if (!Number.isInteger(spin) || spin < 0 || spin > MAX_SPIN) throw new Error(UNSUPPORTED);
    const buf = new Uint8Array(4 + h.length);
    for (let i = 0; i < spin; i++) { buf.set(u32(i)); buf.set(h, 4); h = await hash(buf); }
    const derive = async block => fit(await hash(concat(h, Uint8Array.from(block))), keyBytes, 0x36);
    const iv = fit(salt, blockSize, 0x36);
    const dec = async (block, val) => aesCbcRaw(await derive(block), iv, b64(val));
    const input = await dec([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79], ek('encryptedVerifierHashInput'));
    const expected = await dec([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e], ek('encryptedVerifierHashValue'));
    const got = await hash(input.subarray(0, salt.length));
    if (!equal(got, expected.subarray(0, got.length))) return null;
    const secret = (await dec([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6], ek('encryptedKeyValue'))).subarray(0, dataKeyBytes);
    const size = packageSize(pkg);
    const keySalt = b64(kd('saltValue')), out = new Uint8Array(size);
    for (let seg = 0, off = 8; off < pkg.length && seg * 4096 < size; seg++, off += 4096) {
      const chunk = pkg.subarray(off, Math.min(off + 4096, pkg.length));
      const segIv = fit(await dataHash(concat(keySalt, u32(seg))), blockSize, 0x36);
      const plain = await aesCbcRaw(secret, segIv, chunk.subarray(0, chunk.length - (chunk.length % 16)));
      out.set(plain.subarray(0, Math.min(plain.length, size - seg * 4096)), seg * 4096);
    }
    return out;
  }

  async function decryptStandard(info, pkg, password) {
    const dv = new DataView(info.buffer, info.byteOffset, info.byteLength);
    if (info.length < 12 + 32) throw new Error(DAMAGED);
    const headerSize = dv.getUint32(8, true), h0 = 12;
    // The header, a 16-byte salt and the 16 + 32 byte verifier must all fit in the stream.
    if (headerSize < 32 || h0 + headerSize + 4 > info.length) throw new Error(DAMAGED);
    const algId = dv.getUint32(h0 + 8, true), keyBits = dv.getUint32(h0 + 16, true);
    if (![0x660e, 0x660f, 0x6610].includes(algId) || !AES_KEY_BYTES.includes(keyBits / 8)) throw new Error(UNSUPPORTED);
    const v = h0 + headerSize, saltSize = dv.getUint32(v, true);
    if (saltSize !== 16 || v + 56 + saltSize > info.length) throw new Error(DAMAGED);
    const salt = info.subarray(v + 4, v + 4 + saltSize);
    const encVerifier = info.subarray(v + 4 + saltSize, v + 20 + saltSize);
    const encVerifierHash = info.subarray(v + 24 + saltSize, v + 56 + saltSize);
    let h = sha1(concat(salt, utf16(password)));
    const buf = new Uint8Array(24);
    for (let i = 0; i < 50000; i++) { buf.set(u32(i)); buf.set(h, 4); h = sha1(buf); }
    h = sha1(concat(h, u32(0)));
    const x = pad => { const b = new Uint8Array(64).fill(pad); for (let i = 0; i < 20; i++) b[i] ^= h[i]; return sha1(b); };
    const key = concat(x(0x36), x(0x5c)).subarray(0, keyBits / 8);
    const verifier = await aesEcbRaw(key, encVerifier);
    const verifierHash = await aesEcbRaw(key, encVerifierHash);
    if (!equal(sha1(verifier), verifierHash.subarray(0, 20))) return null;
    const size = packageSize(pkg);
    const body = pkg.subarray(8, 8 + Math.ceil(size / 16) * 16);
    return (await aesEcbRaw(key, body.subarray(0, body.length - (body.length % 16)))).subarray(0, size);
  }

  // Returns the decrypted file, or null when the password is wrong.
  async function decrypt(CFB, bytes, password) {
    const s = streams(CFB, bytes);
    if (!s) throw new Error('Not an encrypted Office file');
    const major = s.info[0] | (s.info[1] << 8), minor = s.info[2] | (s.info[3] << 8);
    let out;
    if (major === 4 && minor === 4) out = await decryptAgile(s.info, s.pkg, password);
    else if ((major === 3 || major === 4) && minor === 2) out = await decryptStandard(s.info, s.pkg, password);
    else throw new Error(UNSUPPORTED);
    // A right password always gives a zip (.xlsx); anything else means the file is damaged.
    if (out && !(out.length >= 4 && out[0] === 0x50 && out[1] === 0x4b)) throw new Error(DAMAGED);
    return out;
  }

  // sha1 and sha512 are exported only so the tests can compare them with Node's.
  const api = { isEncrypted, decrypt, sha1, sha512 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MDCrypto = api;
})(typeof window !== 'undefined' ? window : globalThis);
