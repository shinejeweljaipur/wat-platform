import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession } from './lib/session';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!process.env.SESSION_SECRET) {
    return new NextResponse('SESSION_SECRET is not set. Add it in your environment variables.', { status: 503 });
  }

  const isApi = pathname.startsWith('/api/');

  // CSRF defence for cookie-authenticated writes: the browser's Origin must match our host.
  if (isApi && req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.get('origin');
    if (origin && new URL(origin).host !== req.headers.get('host')) {
      return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 });
    }
  }

  const uid = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (uid) return NextResponse.next();

  if (isApi) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.redirect(new URL('/login', req.url));
}

// Public: login page/endpoint, Meta + Shopify webhooks (they verify signatures themselves), cron (secret header).
export const config = {
  matcher: ['/((?!_next/|favicon.ico|login|api/login|api/webhook/|api/cron/).*)'],
};
