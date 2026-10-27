import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { q, Row } from '@/lib/db';
import { processInbound, applyStatus } from '@/lib/inbound';
import { getChannelByPhoneNumberId } from '@/lib/channels';

export const dynamic = 'force-dynamic';

// Meta verification handshake
export async function GET(req: Request) {
  const u = new URL(req.url);
  const token = process.env.WA_VERIFY_TOKEN;
  if (token && u.searchParams.get('hub.mode') === 'subscribe' && u.searchParams.get('hub.verify_token') === token) {
    return new Response(u.searchParams.get('hub.challenge') || '', { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

function messageText(m: Row): string {
  switch (m.type) {
    case 'text': return m.text?.body || '';
    case 'button': return m.button?.text || '';
    case 'interactive': return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '';
    case 'image': case 'video': case 'document': case 'audio': case 'sticker':
      return m[m.type]?.caption ? m[m.type].caption : '';
    case 'location': return `[location] ${m.location?.latitude},${m.location?.longitude}`;
    default: return `[${m.type}]`;
  }
}

export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.WA_APP_SECRET;
  if (!secret) return new Response('WA_APP_SECRET is not configured', { status: 500 });
  const sig = req.headers.get('x-hub-signature-256') || '';
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return new Response('Bad signature', { status: 401 });
  }

  let payload: Row;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const v: Row = change.value || {};

      if (change.field === 'message_template_status_update' && v.message_template_name) {
        await q(
          `UPDATE templates SET status=$3 WHERE name=$1 AND language=$2
             AND channel_id IN (SELECT id FROM channels WHERE waba_id=$4)`,
          [v.message_template_name, v.message_template_language, String(v.event || '').toUpperCase(), String(entry.id)]
        );
        continue;
      }

      const phoneNumberId = v.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const ch = await getChannelByPhoneNumberId(phoneNumberId);
      if (!ch) continue;

      const names: Record<string, string> = Object.fromEntries((v.contacts || []).map((c: Row) => [c.wa_id, c.profile?.name]));
      for (const m of v.messages || []) {
        try {
          const mo = ['image', 'video', 'audio', 'document', 'sticker'].includes(m.type) ? m[m.type] : null;
          const react = await processInbound(ch, {
            phone: m.from, name: names[m.from] || '', text: messageText(m), type: m.type, waId: m.id,
            media: mo?.id ? { id: mo.id, mime: mo.mime_type, filename: mo.filename } : undefined,
          });
          void react().catch((e) => console.error('[bot]', e.message)); // don't hold up Meta's 200
        } catch (e) {
          console.error('[inbound failed]', e);
          return new Response('error', { status: 500 }); // let Meta retry; duplicates are ignored
        }
      }
      for (const s of v.statuses || []) {
        await applyStatus(s.id, s.status, s.errors?.[0]?.title || s.errors?.[0]?.message || '');
      }
    }
  }
  return NextResponse.json({ ok: true });
}
