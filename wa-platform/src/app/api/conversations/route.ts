import { api, channelFromReq, requireUser } from '@/lib/auth';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  const user = await requireUser();
  const ch = await channelFromReq(req);
  const u = new URL(req.url);
  const filter = u.searchParams.get('filter') || 'open'; // open | mine | unassigned | closed
  const search = (u.searchParams.get('q') || '').trim();

  const where = ['c.channel_id=$1', 'c.last_message_at IS NOT NULL'];
  const vals: any[] = [ch.id];
  if (filter === 'closed') where.push("c.status='closed'");
  else where.push("c.status='open'");
  if (filter === 'mine') { vals.push(user.id); where.push(`c.assigned_to=$${vals.length}`); }
  if (filter === 'unassigned') where.push('c.assigned_to IS NULL');
  if (search) {
    vals.push(`%${search}%`);
    where.push(`(c.name ILIKE $${vals.length} OR c.phone LIKE $${vals.length})`);
  }

  const rows = await q(
    `SELECT c.id, c.phone, c.name, c.tags, c.status, c.assigned_to, c.unread, c.last_message_at, c.last_preview,
            c.bot_paused, u.name AS assigned_name,
            (c.last_inbound_at IS NOT NULL AND c.last_inbound_at > now() - interval '24 hours') AS window_open
       FROM contacts c LEFT JOIN users u ON u.id = c.assigned_to
      WHERE ${where.join(' AND ')}
      ORDER BY c.last_message_at DESC LIMIT 200`,
    vals
  );
  const counts = await q(
    `SELECT count(*) FILTER (WHERE status='open')::int AS open,
            count(*) FILTER (WHERE status='open' AND assigned_to=$2)::int AS mine,
            count(*) FILTER (WHERE status='open' AND assigned_to IS NULL)::int AS unassigned,
            COALESCE(sum(unread) FILTER (WHERE status='open'),0)::int AS unread
       FROM contacts WHERE channel_id=$1 AND last_message_at IS NOT NULL`,
    [ch.id, user.id]
  );
  return { conversations: rows, counts: counts[0] };
});
