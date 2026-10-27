import { api, requireUser, HttpError } from '@/lib/auth';
import { q1 } from '@/lib/db';
import { getChannel } from '@/lib/channels';
import { fetchMedia } from '@/lib/whatsapp';
import { mediaHeaders } from '@/lib/mediaHttp';

export const dynamic = 'force-dynamic';

// :id is a message id. Outbound media comes from our DB; inbound media is streamed from Meta on demand.
export const GET = api(async (_req, { params }) => {
  await requireUser();
  const msg = await q1(
    `SELECT m.media_id, m.media_ref, m.mime, m.filename, c.channel_id
       FROM messages m JOIN contacts c ON c.id = m.contact_id WHERE m.id=$1`,
    [Number(params.id)]
  );
  if (!msg || (!msg.media_ref && !msg.media_id)) throw new HttpError(404, 'No media');

  if (msg.media_ref) {
    const row = await q1('SELECT mime, filename, size, data FROM media WHERE id=$1', [msg.media_ref]);
    if (!row) throw new HttpError(404, 'Media not found');
    return new Response(new Uint8Array(row.data), { headers: mediaHeaders(row.mime, row.filename, row.size) });
  }

  const ch = await getChannel(msg.channel_id);
  if (!ch) throw new HttpError(404, 'Channel not found');
  try {
    const r = await fetchMedia(ch, msg.media_id);
    return new Response(r.body, { headers: mediaHeaders(msg.mime || r.mime, msg.filename, r.size) });
  } catch (e: any) {
    throw new HttpError(502, e.message);
  }
});
