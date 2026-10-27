import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { q1, Row } from './db';
import { getChannel } from './channels';
import { SESSION_COOKIE, verifySession } from './session';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function currentUser(): Promise<Row | null> {
  const uid = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!uid) return null;
  return q1('SELECT id, name, email, role FROM users WHERE id=$1', [uid]);
}

export async function requireUser(): Promise<Row> {
  const u = await currentUser();
  if (!u) throw new HttpError(401, 'Unauthorized');
  return u;
}

export async function requireAdmin(): Promise<Row> {
  const u = await requireUser();
  if (u.role !== 'admin') throw new HttpError(403, 'Admin only');
  return u;
}

/** Wraps a route handler: JSON errors, auth failures, no stack traces leaked. */
export function api(handler: (req: Request, ctx: any) => Promise<Response | object>) {
  return async (req: Request, ctx: any) => {
    try {
      const out = await handler(req, ctx);
      return out instanceof Response ? out : NextResponse.json(out);
    } catch (e: any) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error('[api]', req.method, new URL(req.url).pathname, e);
      return NextResponse.json({ error: e?.message?.startsWith('WhatsApp') ? e.message : 'Internal error' }, { status: 500 });
    }
  };
}

/** Resolves ?channel=ID to a channel row (404 if it doesn't exist). */
export async function channelFromReq(req: Request): Promise<Row> {
  const id = Number(new URL(req.url).searchParams.get('channel'));
  if (!id) throw new HttpError(400, 'channel is required');
  const ch = await getChannel(id);
  if (!ch) throw new HttpError(404, 'Channel not found');
  return ch;
}

export async function body<T = any>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}
