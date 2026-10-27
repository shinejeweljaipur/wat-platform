import { api, body, HttpError, requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { cleanSteps } from '@/lib/flows';

export const dynamic = 'force-dynamic';

export const PATCH = api(async (req, { params }) => {
  await requireUser();
  const id = Number(params.id);
  const b = await body(req);
  if (typeof b.name === 'string' && b.name.trim()) await q('UPDATE flows SET name=$2 WHERE id=$1', [id, b.name.trim()]);
  if (['keyword', 'welcome', 'fallback'].includes(b.trigger_type)) await q('UPDATE flows SET trigger_type=$2 WHERE id=$1', [id, b.trigger_type]);
  if (typeof b.trigger_value === 'string') await q('UPDATE flows SET trigger_value=$2 WHERE id=$1', [id, b.trigger_value]);
  if (typeof b.active === 'boolean') await q('UPDATE flows SET active=$2 WHERE id=$1', [id, b.active]);
  if ('steps' in b) await q('UPDATE flows SET steps=$2 WHERE id=$1', [id, JSON.stringify(cleanSteps(b.steps))]);
  return { ok: true };
});

export const DELETE = api(async (_req, { params }) => {
  await requireUser();
  await q('DELETE FROM flows WHERE id=$1', [Number(params.id)]);
  return { ok: true };
});
