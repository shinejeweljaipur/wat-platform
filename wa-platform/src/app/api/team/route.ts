import { api, body, HttpError, requireAdmin, requireUser } from '@/lib/auth';
import { q, q1 } from '@/lib/db';
import { hashPassword } from '@/lib/password';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  await requireUser(); // agents need the list to assign chats
  return { users: await q('SELECT id, name, email, role FROM users ORDER BY id') };
});

export const POST = api(async (req) => {
  await requireAdmin();
  const b = await body(req);
  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  if (!name || !email.includes('@')) throw new HttpError(400, 'Name and a valid email are required');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (await q1('SELECT 1 FROM users WHERE email=$1', [email])) throw new HttpError(409, 'Email already exists');
  const role = b.role === 'admin' ? 'admin' : 'agent';
  const u = await q1('INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id', [name, email, await hashPassword(password), role]);
  return { id: u!.id };
});

export const DELETE = api(async (req) => {
  const me = await requireAdmin();
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (id === me.id) throw new HttpError(400, "You can't remove yourself");
  await q('DELETE FROM users WHERE id=$1', [id]);
  return { ok: true };
});
