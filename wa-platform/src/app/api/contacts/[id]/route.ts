import { api, body, requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { cleanTags } from '@/lib/util';

export const dynamic = 'force-dynamic';

export const PATCH = api(async (req, { params }) => {
  await requireUser();
  const id = Number(params.id);
  const b = await body(req);
  if (typeof b.name === 'string') await q('UPDATE contacts SET name=$2 WHERE id=$1', [id, b.name.trim()]);
  if (typeof b.email === 'string') await q('UPDATE contacts SET email=$2 WHERE id=$1', [id, b.email.trim()]);
  if ('tags' in b) await q('UPDATE contacts SET tags=$2 WHERE id=$1', [id, cleanTags(b.tags)]);
  if (typeof b.opted_in === 'boolean') await q('UPDATE contacts SET opted_in=$2 WHERE id=$1', [id, b.opted_in]);
  return { ok: true };
});

export const DELETE = api(async (_req, { params }) => {
  await requireUser();
  await q('DELETE FROM contacts WHERE id=$1', [Number(params.id)]);
  return { ok: true };
});
