import { api, body, HttpError, requireUser } from '@/lib/auth';
import { q, q1, Row } from '@/lib/db';
import { addMessage, sendTemplateToContact, sendTextToContact, windowOpen } from '@/lib/messaging';
import { cleanTags } from '@/lib/util';

export const dynamic = 'force-dynamic';

async function load(id: number): Promise<Row> {
  const c = await q1('SELECT * FROM contacts WHERE id=$1', [id]);
  if (!c) throw new HttpError(404, 'Conversation not found');
  return c;
}

export const GET = api(async (req, { params }) => {
  await requireUser();
  const c = await load(Number(params.id));
  const after = Number(new URL(req.url).searchParams.get('after')) || 0;
  const messages = await q(
    `SELECT id, direction, type, body, status, sender, error, created_at, mime, filename,
            (media_id IS NOT NULL OR media_ref IS NOT NULL) AS has_media FROM messages
      WHERE contact_id=$1 AND id > $2 ORDER BY id DESC LIMIT 300`,
    [c.id, after]
  );
  if (c.unread) await q('UPDATE contacts SET unread=0 WHERE id=$1', [c.id]);
  return {
    contact: { ...c, window_open: windowOpen(c) },
    messages: messages.reverse(),
  };
});

// Send a reply / template / internal note
export const POST = api(async (req, { params }) => {
  const user = await requireUser();
  const c = await load(Number(params.id));
  const b = await body(req);

  if (b.kind === 'note') {
    const text = String(b.text || '').trim();
    if (!text) throw new HttpError(400, 'Note is empty');
    await addMessage({ contactId: c.id, direction: 'note', type: 'note', body: text, sender: user.name });
    return { ok: true };
  }

  if (b.kind === 'template') {
    const params_: string[] = Array.isArray(b.params) ? b.params.map(String) : [];
    await sendTemplateToContact(c, String(b.name), String(b.language || 'en'), params_, user.name);
  } else {
    const text = String(b.text || '').trim();
    if (!text) throw new HttpError(400, 'Message is empty');
    try {
      await sendTextToContact(c, text, user.name);
    } catch (e: any) {
      throw new HttpError(422, e.message);
    }
  }
  // An agent replying takes the chat (if unassigned) and stops the bot from talking over them.
  await q('UPDATE contacts SET assigned_to = COALESCE(assigned_to, $2), bot_paused=true WHERE id=$1', [c.id, user.id]);
  return { ok: true };
});

// Assign / close / tags / bot toggle
export const PATCH = api(async (req, { params }) => {
  await requireUser();
  const c = await load(Number(params.id));
  const b = await body(req);
  if ('assigned_to' in b) {
    const v = b.assigned_to ? Number(b.assigned_to) : null;
    if (v && !(await q1('SELECT 1 FROM users WHERE id=$1', [v]))) throw new HttpError(400, 'Unknown user');
    await q('UPDATE contacts SET assigned_to=$2 WHERE id=$1', [c.id, v]);
  }
  if (b.status === 'open' || b.status === 'closed') await q('UPDATE contacts SET status=$2 WHERE id=$1', [c.id, b.status]);
  if ('tags' in b) await q('UPDATE contacts SET tags=$2 WHERE id=$1', [c.id, cleanTags(b.tags)]);
  if (typeof b.bot_paused === 'boolean') await q('UPDATE contacts SET bot_paused=$2 WHERE id=$1', [c.id, b.bot_paused]);
  return { ok: true };
});
