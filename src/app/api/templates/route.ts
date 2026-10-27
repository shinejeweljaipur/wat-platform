import { api, channelFromReq, HttpError, requireUser } from '@/lib/auth';
import { q, q1, Row } from '@/lib/db';
import { createTemplate, fetchTemplates, isLive } from '@/lib/whatsapp';
import { TemplateButton, unsendableReason } from '@/lib/templates';
import { validateHeaderFile } from '@/lib/mediaHttp';

export const dynamic = 'force-dynamic';

const COLS = 'id, name, language, category, status, body, header_format, header_text, footer, buttons, (header_media_ref IS NOT NULL) AS has_header_media';

export const GET = api(async (req) => {
  await requireUser();
  const ch = await channelFromReq(req);
  const rows = await q(`SELECT ${COLS} FROM templates WHERE channel_id=$1 ORDER BY name, language`, [ch.id]);
  const templates = rows.map((t) => ({ ...t, unsendable_reason: unsendableReason({ ...t, header_media_ref: t.has_header_media ? 1 : null }) }));
  return { templates, live: isLive(ch), media_headers_ready: !!process.env.META_APP_ID };
});

function parseButtons(raw: unknown): TemplateButton[] {
  let list: any = raw;
  if (typeof raw === 'string' && raw.trim()) { try { list = JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid buttons'); } }
  if (!Array.isArray(list)) return [];
  if (list.length > 3) throw new HttpError(400, 'Use at most 3 buttons');
  return list.map((b: any) => {
    const text = String(b?.text || '').trim();
    if (!text || text.length > 25) throw new HttpError(400, 'Button text must be 1–25 characters');
    if (b.type === 'URL') {
      const url = String(b.url || '').trim();
      if (!/^https:\/\/[^\s{}]+$/.test(url)) throw new HttpError(400, 'Button URL must start with https:// (variables are not supported yet)');
      return { type: 'URL', text, url };
    }
    if (b.type === 'PHONE_NUMBER') {
      const phone = String(b.phone_number || '').trim();
      if (!/^\+\d{6,15}$/.test(phone)) throw new HttpError(400, 'Phone button needs a number with country code, like +919876543210');
      return { type: 'PHONE_NUMBER', text, phone_number: phone };
    }
    return { type: 'QUICK_REPLY', text };
  });
}

async function readCreateInput(req: Request): Promise<{ f: Record<string, any>; file: File | null }> {
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('multipart/form-data')) {
    const form = await req.formData();
    const f: Record<string, any> = {};
    form.forEach((v, k) => { if (typeof v === 'string') f[k] = v; });
    const file = form.get('file');
    return { f, file: file instanceof File && file.size > 0 ? file : null };
  }
  try { return { f: await req.json(), file: null }; } catch { throw new HttpError(400, 'Invalid request body'); }
}

const UPSERT = `INSERT INTO templates (channel_id, name, language, category, status, body, header_format, header_text, footer, buttons, header_media_ref)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
  ON CONFLICT (channel_id, name, language) DO UPDATE SET category=EXCLUDED.category, status=EXCLUDED.status, body=EXCLUDED.body,
    header_format=EXCLUDED.header_format, header_text=EXCLUDED.header_text, footer=EXCLUDED.footer, buttons=EXCLUDED.buttons,
    header_media_ref=COALESCE(EXCLUDED.header_media_ref, templates.header_media_ref)`;

export const POST = api(async (req) => {
  await requireUser();
  const ch = await channelFromReq(req);
  const { f, file } = await readCreateInput(req);

  if (f.action === 'sync') {
    const list = await fetchTemplates(ch);
    for (const t of list) {
      await q(UPSERT, [ch.id, t.name, t.language, t.category, t.status, t.body, t.header_format, t.header_text, t.footer, JSON.stringify(t.buttons), null]);
    }
    return { synced: list.length };
  }

  // create a new template and submit it to Meta for approval
  const name = String(f.name || '').trim().toLowerCase();
  const body = String(f.body || '').trim();
  const language = String(f.language || ch.template_language || 'en');
  const category = ['MARKETING', 'UTILITY'].includes(f.category) ? f.category : 'UTILITY';
  const footer = String(f.footer || '').trim();
  const headerFormat = ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'].includes(f.header_format) ? f.header_format : 'NONE';
  const headerText = headerFormat === 'TEXT' ? String(f.header_text || '').trim() : '';

  if (!/^[a-z0-9_]{1,512}$/.test(name)) throw new HttpError(400, 'Name: only lowercase letters, numbers and underscores');
  if (!body) throw new HttpError(400, 'Body is required');
  if (body.length > 1024) throw new HttpError(400, 'Body can be at most 1024 characters');
  if (footer.length > 60) throw new HttpError(400, 'Footer can be at most 60 characters');
  if (headerFormat === 'TEXT') {
    if (!headerText || headerText.length > 60) throw new HttpError(400, 'Header text must be 1–60 characters');
    if (/\{\{/.test(headerText)) throw new HttpError(400, 'Variables in the header are not supported yet');
  }
  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormat)) {
    if (!file) throw new HttpError(400, `Attach a sample ${headerFormat.toLowerCase()} for the header. It is also the file sent to customers.`);
    validateHeaderFile(headerFormat, file);
  }
  const buttons = parseButtons(f.buttons);

  const headerFile = file ? { data: Buffer.from(await file.arrayBuffer()), mime: file.type, filename: file.name } : undefined;
  let r;
  try {
    r = await createTemplate(ch, { name, category, language, body, footer, header_format: headerFormat, header_text: headerText, buttons, headerFile });
  } catch (e: any) {
    throw new HttpError(422, e.message);
  }

  let mediaRef: number | null = null;
  if (headerFile) {
    const m = await q1('INSERT INTO media (channel_id, mime, filename, size, data) VALUES ($1,$2,$3,$4,$5) RETURNING id', [
      ch.id, headerFile.mime, headerFile.filename.slice(0, 120), headerFile.data.length, headerFile.data,
    ]);
    mediaRef = m!.id;
  }
  await q(UPSERT, [ch.id, name, language, category, r.status || 'PENDING', body, headerFormat, headerText, footer, JSON.stringify(buttons), mediaRef]);
  return { status: r.status };
});
