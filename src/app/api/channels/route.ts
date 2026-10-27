import { api, body, requireAdmin } from '@/lib/auth';
import { q, q1 } from '@/lib/db';
import { DEFAULT_FLOWS } from '@/lib/schema';
import { encryptSecret } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

// Full channel config (incl. secrets) is admin-only.
export const GET = api(async () => {
  await requireAdmin();
  const rows = await q('SELECT * FROM channels ORDER BY id');
  // Never send secrets back to the browser; just whether they are set.
  return {
    channels: rows.map(({ access_token, shopify_secret, ...c }) => ({ ...c, has_token: !!access_token, has_shopify_secret: !!shopify_secret })),
  };
});

export const POST = api(async (req) => {
  await requireAdmin();
  const b = await body(req);
  const name = String(b.name || '').trim();
  if (!name) return Response.json({ error: 'Name is required' }, { status: 400 });
  const pnid = String(b.phone_number_id || '').trim() || null;
  if (pnid && (await q1('SELECT 1 FROM channels WHERE phone_number_id=$1', [pnid]))) {
    return Response.json({ error: 'This Phone Number ID is already connected' }, { status: 409 });
  }
  const ch = await q1(
    `INSERT INTO channels (name, phone_number_id, waba_id, access_token, default_country, template_language, shopify_secret)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      name,
      pnid,
      String(b.waba_id || '').trim(),
      encryptSecret(String(b.access_token || '').trim()),
      String(b.default_country || '91').replace(/\D/g, '') || '91',
      String(b.template_language || 'en').trim(),
      encryptSecret(String(b.shopify_secret || '').trim()),
    ]
  );
  for (const f of DEFAULT_FLOWS) {
    await q('INSERT INTO flows (channel_id, name, trigger_type, trigger_value, steps) VALUES ($1,$2,$3,$4,$5)', [
      ch!.id, f.name, f.trigger_type, f.trigger_value, JSON.stringify(f.steps),
    ]);
  }
  return { id: ch!.id };
});
