import type { Row } from './db';
import { countVars } from './util';
import type { TemplateButton } from './templates';

// WA_GRAPH_BASE exists so tests can point the app at a mock Graph server.
const GRAPH = process.env.WA_GRAPH_BASE || `https://graph.facebook.com/${process.env.WA_GRAPH_VERSION || 'v21.0'}`;

/** A channel without credentials runs in simulation mode so the UI can be tested end to end. */
export const isLive = (ch: Row) => !!(ch.phone_number_id && ch.access_token);

async function graph(ch: Row, path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}) {
  const headers: Record<string, string> = { Authorization: `Bearer ${ch.access_token}` };
  if (!opts.form) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${GRAPH}${path}`, {
    method: opts.method || 'POST',
    headers,
    body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
    signal: AbortSignal.timeout(60000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error;
    throw new Error(`WhatsApp: ${e?.error_user_msg || e?.message || `API error ${res.status}`}`);
  }
  return data;
}

const simId = (p = 'sim') => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export async function sendText(ch: Row, to: string, body: string): Promise<{ id: string; simulated?: boolean }> {
  if (!isLive(ch)) return { id: simId(), simulated: true };
  const d = await graph(ch, `/${ch.phone_number_id}/messages`, {
    body: { messaging_product: 'whatsapp', to, type: 'text', text: { body, preview_url: true } },
  });
  return { id: d.messages?.[0]?.id };
}

/** Up to 3 quick-reply buttons (titles max 20 chars). Customer's tap arrives as an `interactive` message with the title. */
export async function sendButtons(ch: Row, to: string, body: string, titles: string[]) {
  if (!isLive(ch)) return { id: simId(), simulated: true };
  const d = await graph(ch, `/${ch.phone_number_id}/messages`, {
    body: {
      messaging_product: 'whatsapp', to, type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body },
        action: { buttons: titles.slice(0, 3).map((t, i) => ({ type: 'reply', reply: { id: `b${i}`, title: t.slice(0, 20) } })) },
      },
    },
  });
  return { id: d.messages?.[0]?.id as string };
}

export type HeaderMedia = { format: string; mediaId: string; filename?: string };

export async function sendTemplate(ch: Row, to: string, name: string, language: string, params: string[] = [], header?: HeaderMedia) {
  if (!isLive(ch)) return { id: simId(), simulated: true };
  const components: Row[] = [];
  if (header) {
    const kind = header.format.toLowerCase(); // image | video | document
    const obj: Row = { id: header.mediaId };
    if (kind === 'document' && header.filename) obj.filename = header.filename;
    components.push({ type: 'header', parameters: [{ type: kind, [kind]: obj }] });
  }
  if (params.length) components.push({ type: 'body', parameters: params.map((t) => ({ type: 'text', text: String(t) })) });
  const d = await graph(ch, `/${ch.phone_number_id}/messages`, {
    body: { messaging_product: 'whatsapp', to, type: 'template', template: { name, language: { code: language }, components } },
  });
  return { id: d.messages?.[0]?.id as string };
}

// ---------------- media ----------------

/** Upload a file to WhatsApp; returns a media id valid for ~30 days. */
export async function uploadMedia(ch: Row, data: Buffer, mime: string, filename: string): Promise<{ id: string }> {
  if (!isLive(ch)) return { id: simId('sim_media') };
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([new Uint8Array(data)], { type: mime }), filename || 'file');
  const d = await graph(ch, `/${ch.phone_number_id}/media`, { form });
  return { id: d.id as string };
}

export async function sendMedia(
  ch: Row, to: string, kind: 'image' | 'video' | 'audio' | 'document', mediaId: string, caption = '', filename = ''
) {
  if (!isLive(ch)) return { id: simId() };
  const obj: Row = { id: mediaId };
  if (caption && kind !== 'audio') obj.caption = caption;
  if (kind === 'document' && filename) obj.filename = filename;
  const d = await graph(ch, `/${ch.phone_number_id}/messages`, {
    body: { messaging_product: 'whatsapp', to, type: kind, [kind]: obj },
  });
  return { id: d.messages?.[0]?.id as string };
}

/** Streams a customer's media from Meta (two hops: id -> short-lived URL -> bytes, both need the token). */
export async function fetchMedia(ch: Row, mediaId: string): Promise<{ body: ReadableStream<Uint8Array>; mime: string; size: number | null }> {
  const meta = await graph(ch, `/${mediaId}`, { method: 'GET' });
  if (!meta.url) throw new Error('WhatsApp: media URL not available (it may have expired after 30 days)');
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${ch.access_token}` }, signal: AbortSignal.timeout(60000) });
  if (!res.ok || !res.body) throw new Error(`WhatsApp: could not download media (${res.status})`);
  // Use the size of the actual download (not the metadata's file_size) so a wrong number can never truncate the file.
  return { body: res.body, mime: meta.mime_type || res.headers.get('content-type') || 'application/octet-stream', size: Number(res.headers.get('content-length')) || null };
}

/** Template header examples must be uploaded with Meta's Resumable Upload API, which needs your Meta App ID. */
async function uploadTemplateExample(ch: Row, data: Buffer, mime: string, filename: string): Promise<string> {
  const appId = process.env.META_APP_ID;
  if (!appId) throw new Error('WhatsApp: set the META_APP_ID environment variable (Meta App → Settings → Basic → App ID) to create templates with an image/video/document header.');
  const q = `file_length=${data.length}&file_type=${encodeURIComponent(mime)}&file_name=${encodeURIComponent(filename || 'example')}`;
  const s1 = await fetch(`${GRAPH}/${appId}/uploads?${q}`, { method: 'POST', headers: { Authorization: `Bearer ${ch.access_token}` }, signal: AbortSignal.timeout(60000) });
  const j1: any = await s1.json().catch(() => ({}));
  if (!s1.ok || !j1.id) throw new Error(`WhatsApp: ${j1?.error?.message || 'could not start example upload'}`);
  const s2 = await fetch(`${GRAPH}/${j1.id}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${ch.access_token}`, file_offset: '0' },
    body: new Uint8Array(data),
    signal: AbortSignal.timeout(120000),
  });
  const j2: any = await s2.json().catch(() => ({}));
  if (!s2.ok || !j2.h) throw new Error(`WhatsApp: ${j2?.error?.message || 'could not upload example file'}`);
  return j2.h as string;
}

// ---------------- templates ----------------

export async function fetchTemplates(ch: Row) {
  if (!ch.waba_id || !ch.access_token) throw new Error('WhatsApp: set WhatsApp Business Account ID and Access Token for this channel first.');
  const out: Row[] = [];
  let path: string | null = `/${ch.waba_id}/message_templates?limit=100`;
  for (let i = 0; i < 10 && path; i++) {
    const d: any = await graph(ch, path, { method: 'GET' });
    out.push(...(d.data || []));
    const next: string | undefined = d.paging?.next;
    path = next ? next.replace(GRAPH, '') : null;
  }
  return out.map((t) => {
    const comps: Row[] = t.components || [];
    const header = comps.find((c) => c.type === 'HEADER');
    const buttons: TemplateButton[] = ((comps.find((c) => c.type === 'BUTTONS')?.buttons as Row[]) || []).map((b) => ({
      type: b.type, text: b.text, ...(b.url ? { url: b.url } : {}), ...(b.phone_number ? { phone_number: b.phone_number } : {}),
    }));
    return {
      name: t.name as string,
      language: t.language as string,
      category: t.category as string,
      status: t.status as string,
      body: (comps.find((c) => c.type === 'BODY')?.text as string) || '',
      header_format: (header?.format as string) || 'NONE',
      header_text: header?.format === 'TEXT' ? ((header.text as string) || '') : '',
      footer: (comps.find((c) => c.type === 'FOOTER')?.text as string) || '',
      buttons,
    };
  });
}

export async function createTemplate(
  ch: Row,
  t: {
    name: string; category: string; language: string; body: string; footer?: string;
    header_format?: string; header_text?: string; buttons?: TemplateButton[];
    headerFile?: { data: Buffer; mime: string; filename: string };
  }
) {
  if (!ch.waba_id || !ch.access_token) return { simulated: true, status: 'APPROVED' };
  const comps: Row[] = [];
  const hf = t.header_format || 'NONE';
  if (hf === 'TEXT' && t.header_text) comps.push({ type: 'HEADER', format: 'TEXT', text: t.header_text });
  else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(hf)) {
    if (!t.headerFile) throw new Error('WhatsApp: attach a sample file for the header.');
    const handle = await uploadTemplateExample(ch, t.headerFile.data, t.headerFile.mime, t.headerFile.filename);
    comps.push({ type: 'HEADER', format: hf, example: { header_handle: [handle] } });
  }
  const vars = countVars(t.body);
  const bodyComp: Row = { type: 'BODY', text: t.body };
  if (vars > 0) bodyComp.example = { body_text: [Array.from({ length: vars }, (_, i) => `Sample${i + 1}`)] };
  comps.push(bodyComp);
  if (t.footer) comps.push({ type: 'FOOTER', text: t.footer });
  if (t.buttons?.length) {
    comps.push({
      type: 'BUTTONS',
      buttons: t.buttons.map((b) =>
        b.type === 'URL' ? { type: 'URL', text: b.text, url: b.url }
        : b.type === 'PHONE_NUMBER' ? { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone_number }
        : { type: 'QUICK_REPLY', text: b.text }
      ),
    });
  }
  const d = await graph(ch, `/${ch.waba_id}/message_templates`, {
    body: { name: t.name, category: t.category, language: t.language, components: comps },
  });
  return { id: d.id as string, status: (d.status as string) || 'PENDING' };
}
