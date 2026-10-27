import { api, HttpError, requireUser } from '@/lib/auth';
import { q, q1 } from '@/lib/db';
import { MEDIA_HEADERS } from '@/lib/templates';
import { mediaHeaders, validateHeaderFile } from '@/lib/mediaHttp';

export const dynamic = 'force-dynamic';

// View the header file saved for a template
export const GET = api(async (_req, { params }) => {
  await requireUser();
  const t = await q1('SELECT header_media_ref FROM templates WHERE id=$1', [Number(params.id)]);
  if (!t?.header_media_ref) throw new HttpError(404, 'No header file');
  const m = await q1('SELECT mime, filename, size, data FROM media WHERE id=$1', [t.header_media_ref]);
  if (!m) throw new HttpError(404, 'No header file');
  return new Response(new Uint8Array(m.data), { headers: mediaHeaders(m.mime, m.filename, m.size) });
});

// Upload / replace the header file (needed for templates synced from Meta, whose sample file we don't have)
export const POST = api(async (req, { params }) => {
  await requireUser();
  const t = await q1('SELECT id, channel_id, header_format FROM templates WHERE id=$1', [Number(params.id)]);
  if (!t) throw new HttpError(404, 'Template not found');
  if (!MEDIA_HEADERS.includes(t.header_format)) throw new HttpError(400, 'This template has no image/video/document header');
  let form: FormData;
  try { form = await req.formData(); } catch { throw new HttpError(400, 'Expected a file upload'); }
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'No file attached');
  validateHeaderFile(t.header_format, file);
  const data = Buffer.from(await file.arrayBuffer());
  const m = await q1('INSERT INTO media (channel_id, mime, filename, size, data) VALUES ($1,$2,$3,$4,$5) RETURNING id', [
    t.channel_id, file.type, file.name.slice(0, 120), data.length, data,
  ]);
  // Clear the cached Meta media id so the new file is uploaded on next send.
  await q('UPDATE templates SET header_media_ref=$2, header_meta_id=NULL, header_meta_at=NULL WHERE id=$1', [t.id, m!.id]);
  return { ok: true };
});
