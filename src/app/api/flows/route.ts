import { api, body, channelFromReq, HttpError, requireUser } from '@/lib/auth';
import { q, q1 } from '@/lib/db';
import { cleanSteps } from '@/lib/flows';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  await requireUser();
  const ch = await channelFromReq(req);
  return { flows: await q('SELECT * FROM flows WHERE channel_id=$1 ORDER BY id', [ch.id]) };
});

export const POST = api(async (req) => {
  await requireUser();
  const ch = await channelFromReq(req);
  const b = await body(req);
  if (!String(b.name || '').trim()) throw new HttpError(400, 'Name is required');
  const type = ['keyword', 'welcome', 'fallback'].includes(b.trigger_type) ? b.trigger_type : 'keyword';
  const f = await q1(
    'INSERT INTO flows (channel_id, name, trigger_type, trigger_value, steps) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [ch.id, String(b.name).trim(), type, String(b.trigger_value || ''), JSON.stringify(cleanSteps(b.steps || []))]
  );
  return { id: f!.id };
});
