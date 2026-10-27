import { NextResponse } from 'next/server';
import { q } from '@/lib/db';
import { getChannel } from '@/lib/channels';
import { handleShopify, verifyShopifyHmac } from '@/lib/shopify';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { channelId: string } }) {
  const raw = await req.text();
  const ch = await getChannel(Number(params.channelId));
  if (!ch || !verifyShopifyHmac(raw, req.headers.get('x-shopify-hmac-sha256'), ch.shopify_secret)) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Shopify retries on slow responses and can deliver the same event twice: dedupe by webhook id.
  const eventId = req.headers.get('x-shopify-webhook-id');
  if (eventId) {
    const ins = await q('INSERT INTO webhook_events (id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id', [`shopify:${ch.id}:${eventId}`]);
    if (!ins.length) return NextResponse.json({ ok: true, duplicate: true });
  }

  const topic = req.headers.get('x-shopify-topic') || '';
  let payload;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }

  // Shopify wants a 200 within 5s; do the sending in the background.
  void handleShopify(ch, topic, payload).catch((e) => console.error('[shopify]', topic, e.message));
  return NextResponse.json({ ok: true });
}
