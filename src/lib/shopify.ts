import crypto from 'crypto';
import { q, Row } from './db';
import { upsertContact } from './inbound';
import { sendTemplateToContact } from './messaging';

export function verifyShopifyHmac(raw: string, header: string | null, secret: string) {
  if (!secret || !header) return false;
  const digest = crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('base64');
  const a = Buffer.from(digest);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const pickPhone = (o: Row) =>
  o.phone || o.shipping_address?.phone || o.billing_address?.phone || o.customer?.phone || o.customer?.default_address?.phone || '';
const pickName = (o: Row) => o.customer?.first_name || o.shipping_address?.first_name || o.billing_address?.first_name || '';

export async function handleShopify(ch: Row, topic: string, p: Row) {
  const lang = ch.template_language || 'en';

  if (topic === 'orders/create') {
    if (p.checkout_token) {
      // Order placed -> cancel the pending abandoned-cart reminder
      await q("UPDATE scheduled_messages SET status='cancelled' WHERE channel_id=$1 AND ref=$2 AND status='pending'", [ch.id, String(p.checkout_token)]);
    }
    const phone = pickPhone(p);
    const isCod = (p.payment_gateway_names || []).some((g: string) => /cod|cash on delivery/i.test(g));
    const tpl = (isCod && ch.tpl_cod) || ch.tpl_order;
    if (!phone || !tpl) return;
    const first = pickName(p) || 'there';
    const contact = await upsertContact(ch, {
      phone,
      name: first,
      email: p.email || '',
      tags: ['shopify-customer'],
      optedIn: !!p.customer?.accepts_marketing || p.buyer_accepts_marketing === true,
    });
    // Order confirmations are transactional (utility) -> allowed without marketing opt-in.
    await sendTemplateToContact(contact, tpl, lang, [first, String(p.name || p.order_number || ''), `${p.currency || ''} ${p.total_price || ''}`.trim()], 'shopify');
    return;
  }

  if (topic === 'orders/fulfilled') {
    const phone = pickPhone(p);
    if (!phone || !ch.tpl_shipped) return;
    const f = (p.fulfillments || [])[0] || {};
    const first = pickName(p) || 'there';
    const contact = await upsertContact(ch, { phone, name: first, email: p.email || '', tags: ['shopify-customer'] });
    await sendTemplateToContact(contact, ch.tpl_shipped, lang, [first, String(p.name || ''), f.tracking_url || f.tracking_number || '-'], 'shopify');
    return;
  }

  if (topic === 'checkouts/create' || topic === 'checkouts/update') {
    const phone = pickPhone(p);
    if (!ch.tpl_cart || !phone || !p.abandoned_checkout_url) return;
    const ref = String(p.token || p.id);
    const exists = await q("SELECT 1 FROM scheduled_messages WHERE channel_id=$1 AND ref=$2 AND kind='cart'", [ch.id, ref]);
    if (exists.length) return;
    const first = pickName(p) || 'there';
    // Record opt-in state so the queue can decide at send time.
    await upsertContact(ch, { phone, name: first, email: p.email || '', optedIn: p.buyer_accepts_marketing === true });
    await q(
      `INSERT INTO scheduled_messages (channel_id, kind, ref, phone, name, template, language, params, send_at)
       VALUES ($1,'cart',$2,$3,$4,$5,$6,$7, now() + ($8 || ' minutes')::interval)`,
      [ch.id, ref, phone, first, ch.tpl_cart, lang, JSON.stringify([first, p.abandoned_checkout_url]), String(ch.cart_delay_min || 60)]
    );
  }
}
