import { api, requireUser } from '@/lib/auth';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const user = await requireUser();
  const channels = await q(
    `SELECT id, name, phone_number_id, waba_id, default_country, template_language,
            tpl_order, tpl_cod, tpl_cart, tpl_shipped, cart_delay_min,
            (phone_number_id IS NOT NULL AND access_token <> '') AS live,
            (access_token <> '') AS has_token, (shopify_secret <> '') AS has_shopify_secret
       FROM channels ORDER BY id`
  );
  return { user, channels };
});
