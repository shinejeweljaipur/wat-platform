// Signed session cookie using Web Crypto, so it works in both Edge middleware and Node route handlers.
const enc = new TextEncoder();

export const SESSION_COOKIE = 'session';
const TTL_SECONDS = 14 * 24 * 3600;

async function hmac(data: string): Promise<string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function signSession(userId: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload = `${userId}.${exp}`;
  return `${payload}.${await hmac(payload)}`;
}

export async function verifySession(token?: string | null): Promise<number | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [uid, exp, sig] = parts;
  if (!safeEqual(sig, await hmac(`${uid}.${exp}`))) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  const id = Number(uid);
  return Number.isInteger(id) ? id : null;
}

export const SESSION_MAX_AGE = TTL_SECONDS;
