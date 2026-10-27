import crypto from 'crypto';

/**
 * Field-level encryption for secrets stored in Postgres (WhatsApp access tokens, Shopify signing secrets).
 * AES-256-GCM, random 96-bit IV per value. Key comes from ENCRYPTION_KEY (preferred) or SESSION_SECRET.
 * Plain-text values from older versions are passed through on read and encrypted by the startup migration.
 */
const PREFIX = 'enc:v1:';

function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!raw) throw new Error('ENCRYPTION_KEY (or SESSION_SECRET) is not set');
  return crypto.createHash('sha256').update(`wa-platform:${raw}`).digest();
}

export const isEncrypted = (s: string) => typeof s === 'string' && s.startsWith(PREFIX);

export function encryptSecret(plain: string): string {
  if (!plain) return '';
  if (isEncrypted(plain)) return plain;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return PREFIX + [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join(':');
}

export function decryptSecret(stored: string): string {
  if (!stored || !isEncrypted(stored)) return stored || '';
  try {
    const [iv, tag, ct] = stored.slice(PREFIX.length).split(':').map((p) => Buffer.from(p, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch {
    throw new Error('Cannot decrypt a stored secret. Did ENCRYPTION_KEY / SESSION_SECRET change? Re-enter the token in Settings.');
  }
}

/** Returns a copy of a channels row with secrets decrypted (for server-side use only; never send to the browser). */
export function decryptChannel<T extends Record<string, any> | null>(row: T): T {
  if (!row) return row;
  return { ...row, access_token: decryptSecret(row.access_token), shopify_secret: decryptSecret(row.shopify_secret) };
}
