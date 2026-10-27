import { api, body, HttpError, requireUser } from '@/lib/auth';
import { getChannel } from '@/lib/channels';
import { processInbound } from '@/lib/inbound';
import { isLive } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

// Test helper: pretend a customer sent a message. Only works on channels with no WhatsApp credentials.
export const POST = api(async (req) => {
  await requireUser();
  const b = await body(req);
  const ch = await getChannel(Number(b.channel));
  if (!ch) throw new HttpError(404, 'Channel not found');
  if (isLive(ch)) throw new HttpError(400, 'Simulation is only available on channels without WhatsApp credentials.');
  const react = await processInbound(ch, {
    phone: String(b.phone || '9999900000'),
    name: String(b.name || 'Test Customer'),
    text: String(b.text || 'Hi'),
    waId: `sim_in_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  });
  await react();
  return { ok: true };
});
