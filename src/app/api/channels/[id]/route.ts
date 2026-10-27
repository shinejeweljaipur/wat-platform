import { api, body, HttpError, requireAdmin } from '@/lib/auth';
import { q } from '@/lib/db';
import { encryptSecret } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

const TEXT_FIELDS = ['name', 'waba_id', 'default_country', 'template_language', 'tpl_order', 'tpl_cod', 'tpl_cart', 'tpl_shipped'] as const;
// Secrets: only updated when a non-empty value is sent (so editing other fields never wipes them).
const SECRET_FIELDS = ['access_token', 'shopify_secret'] as const;

export const PATCH = api(async (req, { params }) => {
  await requireAdmin();
  const id = Number(params.id);
  const b = await body(req);
  const sets: string[] = [];
  const vals: any[] = [];
  const add = (col: string, v: any) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };

  for (const f of TEXT_FIELDS) if (typeof b[f] === 'string') add(f, b[f].trim());
  for (const f of SECRET_FIELDS) if (typeof b[f] === 'string' && b[f].trim()) add(f, encryptSecret(b[f].trim()));
  if ('phone_number_id' in b) {
    const v = String(b.phone_number_id || '').trim() || null;
    if (v) {
      const dup = await q('SELECT 1 FROM channels WHERE phone_number_id=$1 AND id<>$2', [v, id]);
      if (dup.length) throw new HttpError(409, 'This Phone Number ID is already connected');
    }
    add('phone_number_id', v);
  }
  if (b.cart_delay_min !== undefined) add('cart_delay_min', Math.max(1, Math.min(1440, Number(b.cart_delay_min) || 60)));
  if (!sets.length) return { ok: true };
  vals.push(id);
  await q(`UPDATE channels SET ${sets.join(', ')} WHERE id=$${vals.length}`, vals);
  return { ok: true };
});

export const DELETE = api(async (_req, { params }) => {
  await requireAdmin();
  await q('DELETE FROM channels WHERE id=$1', [Number(params.id)]); // cascades to contacts, messages, campaigns, flows
  return { ok: true };
});
