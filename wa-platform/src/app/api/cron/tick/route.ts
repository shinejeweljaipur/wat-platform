import { NextResponse } from 'next/server';
import { tick } from '@/lib/queue';

export const dynamic = 'force-dynamic';

// For hosts without a long-running process: call this every minute from an external cron with
// "Authorization: Bearer <CRON_SECRET>".
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Unauthorized', { status: 401 });
  await tick();
  return NextResponse.json({ ok: true });
}
export const GET = run;
export const POST = run;
