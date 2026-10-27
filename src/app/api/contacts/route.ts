import { api, body, channelFromReq, HttpError, requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { upsertContact } from '@/lib/inbound';
import { cleanTags } from '@/lib/util';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  await requireUser();
  const ch = await channelFromReq(req);
  const u = new URL(req.url);
  const search = (u.searchParams.get('q') || '').trim();
  const tag = (u.searchParams.get('tag') || '').trim().toLowerCase();
  const where = ['channel_id=$1'];
  const vals: any[] = [ch.id];
  if (search) { vals.push(`%${search}%`); where.push(`(name ILIKE $${vals.length} OR phone LIKE $${vals.length} OR email ILIKE $${vals.length})`); }
  if (tag) { vals.push(tag); where.push(`$${vals.length} = ANY(tags)`); }
  const contacts = await q(
    `SELECT id, phone, name, email, tags, opted_in, created_at FROM contacts WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 500`,
    vals
  );
  const stats = await q(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE opted_in)::int AS opted_in FROM contacts WHERE channel_id=$1`,
    [ch.id]
  );
  const tags = await q('SELECT t AS tag, count(*)::int AS n FROM contacts, unnest(tags) t WHERE channel_id=$1 GROUP BY t ORDER BY n DESC', [ch.id]);
  return { contacts, stats: stats[0], tags };
});

// Create one or many (CSV import). `optedIn` must be explicitly confirmed by the user in the UI.
export const POST = api(async (req) => {
  await requireUser();
  const ch = await channelFromReq(req);
  const b = await body(req);
  const list: any[] = Array.isArray(b.contacts) ? b.contacts : [b];
  if (list.length > 5000) throw new HttpError(400, 'Max 5000 contacts per import');
  let added = 0;
  const errors: string[] = [];
  for (const [i, c] of list.entries()) {
    try {
      await upsertContact(ch, {
        phone: String(c.phone || ''),
        name: String(c.name || '').trim(),
        email: String(c.email || '').trim(),
        tags: cleanTags(c.tags),
        optedIn: c.opted_in === true,
      });
      added++;
    } catch {
      if (errors.length < 20) errors.push(`Row ${i + 1}: invalid phone "${c.phone}"`);
    }
  }
  return { added, skipped: list.length - added, errors };
});
