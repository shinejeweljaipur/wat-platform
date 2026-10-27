import { api, HttpError, requireUser } from '@/lib/auth';
import { q, q1 } from '@/lib/db';
import { sendMediaToContact } from '@/lib/messaging';

export const dynamic = 'force-dynamic';

// multipart/form-data: file (required), caption (optional)
export const POST = api(async (req, { params }) => {
  const user = await requireUser();
  const c = await q1('SELECT * FROM contacts WHERE id=$1', [Number(params.id)]);
  if (!c) throw new HttpError(404, 'Conversation not found');

  let form: FormData;
  try { form = await req.formData(); } catch { throw new HttpError(400, 'Expected a file upload'); }
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'No file attached');
  if (file.size > 16 * 1024 * 1024) throw new HttpError(413, 'File too large (max 16 MB)');

  try {
    await sendMediaToContact(
      c,
      { data: Buffer.from(await file.arrayBuffer()), mime: file.type || 'application/octet-stream', filename: file.name, caption: String(form.get('caption') || '').trim().slice(0, 1000) },
      user.name
    );
  } catch (e: any) {
    throw new HttpError(422, e.message);
  }
  await q('UPDATE contacts SET assigned_to = COALESCE(assigned_to, $2), bot_paused=true WHERE id=$1', [c.id, user.id]);
  return { ok: true };
});
