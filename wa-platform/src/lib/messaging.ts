import { q, q1, Row } from './db';
import * as wa from './whatsapp';
import { getChannel } from './channels';
import { MAX_BYTES, MEDIA_HEADERS, mediaKind, renderTemplateText, unsendableReason } from './templates';

export const WINDOW_MS = 24 * 3600 * 1000;

export function windowOpen(contact: Row) {
  return !!contact.last_inbound_at && Date.now() - new Date(contact.last_inbound_at).getTime() < WINDOW_MS;
}

export async function addMessage(m: {
  contactId: number;
  direction: 'in' | 'out' | 'note' | 'sys';
  type?: string;
  body?: string;
  waId?: string | null;
  status?: string;
  sender?: string;
  mediaId?: string | null;
  mediaRef?: number | string | null;
  mime?: string;
  filename?: string;
}): Promise<Row | null> {
  const row = await q1(
    `INSERT INTO messages (contact_id, direction, type, body, wa_message_id, status, sender, media_id, media_ref, mime, filename)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING *`,
    [m.contactId, m.direction, m.type || 'text', m.body || '', m.waId ?? null, m.status || 'sent', m.sender || '',
     m.mediaId ?? null, m.mediaRef ?? null, m.mime || '', m.filename || '']
  );
  if (!row) return null; // duplicate wa_message_id (Meta webhook retry)
  const label = m.body || (m.type && !['text', 'template', 'interactive', 'button'].includes(m.type) ? `[${m.type}]` : '');
  const preview = String(label).slice(0, 80);
  if (m.direction === 'in') {
    await q('UPDATE contacts SET last_message_at=now(), last_inbound_at=now(), last_preview=$2 WHERE id=$1', [m.contactId, preview]);
  } else if (m.direction === 'out') {
    await q('UPDATE contacts SET last_message_at=now(), last_preview=$2 WHERE id=$1', [m.contactId, preview]);
  }
  return row;
}

async function channelOf(contact: Row): Promise<Row> {
  const ch = await getChannel(contact.channel_id);
  if (!ch) throw new Error('Channel not found');
  return ch;
}

const WINDOW_ERR = 'The 24-hour reply window is closed. Send an approved template instead.';

export async function sendTextToContact(contact: Row, text: string, sender = 'agent') {
  if (!windowOpen(contact)) throw new Error(WINDOW_ERR);
  const ch = await channelOf(contact);
  const r = await wa.sendText(ch, contact.phone, text);
  return addMessage({ contactId: contact.id, direction: 'out', type: 'text', body: text, waId: r.id, sender });
}

/** Question with up to 3 tap-to-reply buttons (used by flow "ask" steps). */
export async function sendButtonsToContact(contact: Row, text: string, titles: string[], sender = 'bot') {
  if (!windowOpen(contact)) throw new Error(WINDOW_ERR);
  const ch = await channelOf(contact);
  const r = await wa.sendButtons(ch, contact.phone, text, titles);
  const body = `${text}\n\n${titles.slice(0, 3).map((t) => `[ ${t.slice(0, 20)} ]`).join('  ')}`;
  return addMessage({ contactId: contact.id, direction: 'out', type: 'interactive', body, waId: r.id, sender });
}

/** Image / video / audio / document reply. Bytes are kept in our DB so the inbox can show them. */
export async function sendMediaToContact(
  contact: Row,
  file: { data: Buffer; mime: string; filename: string; caption?: string },
  sender = 'agent'
) {
  if (!windowOpen(contact)) throw new Error(WINDOW_ERR);
  const mime = file.mime.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
  const kind = mediaKind(mime);
  if (file.data.length === 0) throw new Error('The file is empty.');
  if (file.data.length > MAX_BYTES[kind]) {
    throw new Error(`${kind[0].toUpperCase() + kind.slice(1)} is too large (max ${Math.round(MAX_BYTES[kind] / 1048576)} MB).`);
  }
  const ch = await channelOf(contact);
  const filename = file.filename.replace(/[\r\n"\\/]/g, '_').slice(0, 120) || 'file';
  const up = await wa.uploadMedia(ch, file.data, mime, filename);
  const r = await wa.sendMedia(ch, contact.phone, kind, up.id, file.caption || '', filename);
  const m = await q1('INSERT INTO media (channel_id, mime, filename, size, data) VALUES ($1,$2,$3,$4,$5) RETURNING id', [
    ch.id, mime, filename, file.data.length, file.data,
  ]);
  return addMessage({
    contactId: contact.id, direction: 'out', type: kind,
    // Audio can't carry a caption on WhatsApp, so don't show the customer-invisible text in the inbox either.
    body: kind === 'audio' ? '' : file.caption || (kind === 'document' ? filename : ''),
    waId: r.id, sender, mediaRef: m!.id, mime, filename,
  });
}

/** Header media for a template: upload to Meta on first use, then reuse the media id for ~25 days. */
async function ensureHeader(ch: Row, t: Row): Promise<{ header: wa.HeaderMedia; mime: string; filename: string }> {
  const meta = await q1('SELECT id, mime, filename FROM media WHERE id=$1', [t.header_media_ref]);
  if (!meta) throw new Error(`Template "${t.name}": header file is missing. Upload it again on the Templates page.`);
  const fresh = t.header_meta_id && t.header_meta_at && Date.now() - new Date(t.header_meta_at).getTime() < 25 * 86400e3;
  let mediaId: string = t.header_meta_id;
  if (!fresh) {
    const full = await q1('SELECT data FROM media WHERE id=$1', [t.header_media_ref]);
    mediaId = (await wa.uploadMedia(ch, full!.data, meta.mime, meta.filename)).id;
    await q('UPDATE templates SET header_meta_id=$2, header_meta_at=now() WHERE id=$1', [t.id, mediaId]);
  }
  return { header: { format: t.header_format, mediaId, filename: meta.filename }, mime: meta.mime, filename: meta.filename };
}

export async function sendTemplateToContact(contact: Row, name: string, language: string, params: string[] = [], sender = 'agent') {
  const ch = await channelOf(contact);
  const t = await q1('SELECT * FROM templates WHERE channel_id=$1 AND name=$2 AND language=$3', [ch.id, name, language]);

  let header: wa.HeaderMedia | undefined;
  let headerInfo: { mime: string; filename: string } | undefined;
  if (t) {
    const why = unsendableReason(t);
    if (why) throw new Error(`Template "${name}" ${why}.`);
    if (MEDIA_HEADERS.includes(t.header_format)) {
      const h = await ensureHeader(ch, t);
      header = h.header;
      headerInfo = { mime: h.mime, filename: h.filename };
    }
  }

  const r = await wa.sendTemplate(ch, contact.phone, name, language, params, header);
  const body = t ? renderTemplateText(t, params) : `[Template: ${name}]`;
  const msg = await addMessage({
    contactId: contact.id, direction: 'out', type: 'template', body, waId: r.id, sender,
    mediaRef: header ? t!.header_media_ref : null, mime: headerInfo?.mime, filename: headerInfo?.filename,
  });
  return { id: msg?.id, waId: r.id };
}
