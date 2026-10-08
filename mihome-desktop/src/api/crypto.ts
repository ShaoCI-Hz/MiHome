/**
 * 小米云请求签名与加解密
 * 算法对照 python-miio/mijia-api 使用的 miutils（源自 micloud, MIT），
 * 本文件为独立的 TypeScript 实现。
 *
 * - nonce: 8字节随机 + 分钟级时间戳 → base64
 * - signed_nonce: SHA256(b64decode(ssecurity) + b64decode(nonce)) → base64
 * - signature:  base64(SHA1("POST&uri&k=v&...&signed_nonce"))
 * - 参数值用 RC4(key=signed_nonce, drop=1024) 加密
 */

const te = new TextEncoder();

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function sha(kind: 'SHA-1' | 'SHA-256', data: Uint8Array): Promise<Uint8Array> {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest(kind, buf);
  return new Uint8Array(digest);
}

/** 生成 nonce：8 字节随机 + 分钟级时间戳（变长编码），base64 */
export function genNonce(): string {
  const rand = crypto.getRandomValues(new Uint8Array(8));
  const millis = Date.now();
  const part2 = Math.floor(millis / 60000);
  // 模拟 Python: part2.to_bytes(((part2.bit_length()+7)//8), "big")
  const byteLen = part2 === 0 ? 0 : Math.floor((part2.toString(2).length + 7) / 8);
  const ts = new Uint8Array(byteLen);
  let v = part2;
  for (let i = byteLen - 1; i >= 0; i--) {
    ts[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  const all = new Uint8Array(rand.length + ts.length);
  all.set(rand, 0);
  all.set(ts, rand.length);
  return toB64(all);
}

/** signed_nonce = base64(sha256(ssecurity_bytes + nonce_bytes)) */
export async function signedNonce(ssecurity: string, nonce: string): Promise<Uint8Array> {
  const a = fromB64(ssecurity);
  const b = fromB64(nonce);
  const concat = new Uint8Array(a.length + b.length);
  concat.set(a, 0);
  concat.set(b, a.length);
  return sha('SHA-256', concat);
}

/** gen_enc_signature: base64(sha1(UPPER&uri&k=v&...&signed_nonce)) */
export async function encSignature(
  uri: string,
  method: string,
  signedNonceB64: string,
  params: Record<string, string>,
): Promise<string> {
  const parts = [method.toUpperCase(), uri];
  for (const [k, v] of Object.entries(params)) parts.push(`${k}=${v}`);
  parts.push(signedNonceB64);
  const sig = await sha('SHA-1', te.encode(parts.join('&')));
  return toB64(sig);
}

/** RC4 流密码，dropN 字节后输出 */
export function rc4(key: Uint8Array, data: Uint8Array, drop = 0): Uint8Array {
  // KSA
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
  }
  // PRGA（含 drop）
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let n = 0; n < data.length + drop; n++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
    const k = S[(S[i] + S[j]) & 0xff];
    if (n >= drop) out[n - drop] = data[n - drop] ^ k;
  }
  return out;
}

/** encrypt_rc4: RC4(b64decode(signed_nonce)) 先丢 1024 字节再加密 */
export function encryptRc4(signedNonceBytes: Uint8Array, payload: string): string {
  return toB64(rc4(signedNonceBytes, te.encode(payload), 1024));
}

/**
 * 生成加密请求参数（generate_enc_params）
 * 返回可直接作为 form body 发送的键值对
 */
export async function generateEncParams(
  uri: string,
  method: string,
  signedNonceBytes: Uint8Array,
  nonce: string,
  params: Record<string, string>,
  ssecurity: string,
): Promise<Record<string, string>> {
  const signedNonceB64 = toB64(signedNonceBytes);
  params.rc4_hash__ = await encSignature(uri, method, signedNonceB64, params);
  for (const k of Object.keys(params)) {
    params[k] = encryptRc4(signedNonceBytes, params[k]);
  }
  params.signature = await encSignature(uri, method, signedNonceB64, params);
  params.ssecurity = ssecurity;
  params._nonce = nonce;
  return params;
}

/** 解密响应：RC4；先按 UTF-8 解码，失败则按 gzip 解压 */
export async function decryptResponse(
  signedNonceBytes: Uint8Array,
  payload: string,
): Promise<string> {
  const raw = rc4(signedNonceBytes, fromB64(payload), 1024);
  // fatal:true —— gzip 字节必须触发异常才能进入解压分支（宽松模式会把二进制硬解成乱码）
  const strict = () => new TextDecoder('utf-8', { fatal: true });
  try {
    return strict().decode(raw);
  } catch {
    const ds = new DecompressionStream('gzip');
    const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    const stream = new Blob([ab]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return strict().decode(new Uint8Array(buf));
  }
}
