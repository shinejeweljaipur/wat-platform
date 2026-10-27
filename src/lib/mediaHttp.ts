import { HttpError } from './auth';
import { MAX_BYTES } from './templates';

// Only these are rendered inline; anything a customer sends beyond this is forced to download.
const INLINE = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|3gpp)|audio\/(aac|mp4|mpeg|amr|ogg))$/;

export function mediaHeaders(mime: string, filename: string, size: number | null): HeadersInit {
  const clean = String(mime).split(';')[0].trim().toLowerCase();
  const inline = INLINE.test(clean);
  const safeName = (filename || 'file').replace(/[\r\n"\\]/g, '_');
  return {
    'Content-Type': inline ? clean : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, max-age=86400',
    ...(size ? { 'Content-Length': String(size) } : {}),
  };
}

const HEADER_RULES: Record<string, { mimes: string[]; max: number; label: string }> = {
  IMAGE: { mimes: ['image/jpeg', 'image/png'], max: MAX_BYTES.image, label: 'JPG or PNG up to 5 MB' },
  VIDEO: { mimes: ['video/mp4'], max: MAX_BYTES.video, label: 'MP4 up to 16 MB' },
  DOCUMENT: { mimes: ['application/pdf'], max: MAX_BYTES.document, label: 'PDF up to 16 MB' },
};

export function validateHeaderFile(format: string, file: File) {
  const rule = HEADER_RULES[format];
  if (!rule) throw new HttpError(400, 'This template has no media header');
  if (!rule.mimes.includes(file.type) || file.size > rule.max || file.size === 0) {
    throw new HttpError(400, `${format.toLowerCase()} header must be ${rule.label}`);
  }
}
