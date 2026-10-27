// Pure helpers (no DB access) so both server and browser can use them.

export type TemplateButton = { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | string; text: string; url?: string; phone_number?: string };
export const MEDIA_HEADERS = ['IMAGE', 'VIDEO', 'DOCUMENT'];

type T = {
  body?: string; header_format?: string; header_text?: string; footer?: string;
  buttons?: TemplateButton[]; header_media_ref?: number | string | null;
};

/** Why we can't send this template from the app yet (null = OK). */
export function unsendableReason(t: T): string | null {
  for (const b of t.buttons || []) {
    if (!['QUICK_REPLY', 'URL', 'PHONE_NUMBER'].includes(b.type)) return `has a ${b.type} button, which isn't supported yet`;
    if (b.type === 'URL' && /\{\{/.test(b.url || '')) return "has a dynamic-URL button, which isn't supported yet";
  }
  const hf = t.header_format || 'NONE';
  if (hf === 'LOCATION') return "has a location header, which isn't supported yet";
  if (hf === 'TEXT' && /\{\{/.test(t.header_text || '')) return "has a variable in its header, which isn't supported yet";
  if (MEDIA_HEADERS.includes(hf) && !t.header_media_ref) return `needs a ${hf.toLowerCase()} for its header. Upload one on the Templates page`;
  return null;
}

/** Plain-text rendering used for inbox history and previews. */
export function renderTemplateText(t: T, params: string[] = []): string {
  const fill = (s: string) => String(s || '').replace(/\{\{(\d+)\}\}/g, (_, i) => params[Number(i) - 1] ?? `{{${i}}}`);
  const parts: string[] = [];
  if ((t.header_format || 'NONE') === 'TEXT' && t.header_text) parts.push(`*${t.header_text}*`);
  parts.push(fill(t.body || ''));
  if (t.footer) parts.push(t.footer);
  const btns = (t.buttons || []).map((b) => `[ ${b.text} ]`).join('  ');
  if (btns) parts.push(btns);
  return parts.join('\n\n');
}

export function mediaKind(mime: string): 'image' | 'video' | 'audio' | 'document' {
  const m = String(mime).split(';')[0].trim().toLowerCase();
  if (m === 'image/jpeg' || m === 'image/png') return 'image';
  if (m === 'video/mp4' || m === 'video/3gpp') return 'video';
  if (['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg'].includes(m)) return 'audio';
  return 'document';
}

export const MAX_BYTES = { image: 5 * 1024 * 1024, video: 16 * 1024 * 1024, audio: 16 * 1024 * 1024, document: 16 * 1024 * 1024 };
