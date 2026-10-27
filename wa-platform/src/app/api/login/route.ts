import { NextResponse } from 'next/server';
import { q1 } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Simple in-memory brute-force guard: 8 failures / 15 min per IP+email.
const fails = new Map<string, { n: number; until: number }>();

export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  const e = String(email || '').trim().toLowerCase();
  const key = `${req.headers.get('x-forwarded-for') || 'ip'}:${e}`;
  const f = fails.get(key);
  if (f && f.n >= 8 && f.until > Date.now()) return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });

  const user = e && password ? await q1('SELECT id, password_hash FROM users WHERE email=$1', [e]) : null;
  const ok = user ? await verifyPassword(String(password), user.password_hash) : false;
  if (!user || !ok) {
    fails.set(key, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 15 * 60000 });
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }
  fails.delete(key);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await signSession(user.id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
