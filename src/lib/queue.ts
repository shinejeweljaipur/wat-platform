import { q, q1, Row } from './db';
import { sendTemplateToContact } from './messaging';
import { sleep } from './util';
import { upsertContact } from './inbound';
import { getChannel } from './channels';

/**
 * Durable send queue. Work lives in Postgres (campaign_recipients, scheduled_messages), so a restart never loses it.
 * Rows are claimed with FOR UPDATE SKIP LOCKED, so two workers can never send the same message twice.
 */
const BATCH = 25;
const THROTTLE_MS = 90; // ~11 msgs/sec, well under Cloud API limits

async function processCampaigns() {
  const claimed = await q(
    `UPDATE campaign_recipients SET status='sending' WHERE id IN (
       SELECT r.id FROM campaign_recipients r JOIN campaigns c ON c.id = r.campaign_id
       WHERE r.status='pending' AND c.status='sending'
       ORDER BY r.id LIMIT $1 FOR UPDATE OF r SKIP LOCKED)
     RETURNING id, campaign_id, contact_id`,
    [BATCH]
  );
  const camps = new Map<number, Row>();
  for (const r of claimed) {
    try {
      if (!camps.has(r.campaign_id)) camps.set(r.campaign_id, (await q1('SELECT * FROM campaigns WHERE id=$1', [r.campaign_id]))!);
      const camp = camps.get(r.campaign_id)!;
      const c = await q1('SELECT * FROM contacts WHERE id=$1', [r.contact_id]);
      if (!c || !c.opted_in) {
        await q("UPDATE campaign_recipients SET status='failed', error='Contact not opted in' WHERE id=$1", [r.id]);
        continue;
      }
      const params = (camp.params as string[]).map((x) => String(x).replace(/\{\{\s*name\s*\}\}/gi, c.name || 'there'));
      const sent = await sendTemplateToContact(c, camp.template_name, camp.language, params, 'campaign');
      await q("UPDATE campaign_recipients SET status='sent', wa_message_id=$2 WHERE id=$1 AND status='sending'", [r.id, sent.waId]);
    } catch (e: any) {
      await q("UPDATE campaign_recipients SET status='failed', error=$2 WHERE id=$1", [r.id, String(e.message).slice(0, 300)]);
    }
    await sleep(THROTTLE_MS);
  }
  await q(
    `UPDATE campaigns SET status='done' WHERE status='sending'
       AND NOT EXISTS (SELECT 1 FROM campaign_recipients r WHERE r.campaign_id=campaigns.id AND r.status IN ('pending','sending'))`
  );
}

async function processScheduled() {
  const due = await q(
    `UPDATE scheduled_messages SET status='sending' WHERE id IN (
       SELECT id FROM scheduled_messages WHERE status='pending' AND send_at <= now()
       ORDER BY send_at LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING *`,
    [BATCH]
  );
  for (const m of due) {
    try {
      const ch = (await getChannel(m.channel_id))!;
      const contact = await upsertContact(ch, { phone: m.phone, name: m.name });
      // Abandoned-cart nudges are marketing: only opted-in contacts.
      if (m.kind === 'cart' && !contact.opted_in) {
        await q("UPDATE scheduled_messages SET status='skipped', error='not opted in' WHERE id=$1", [m.id]);
        continue;
      }
      await sendTemplateToContact(contact, m.template, m.language, m.params, 'shopify');
      await q("UPDATE scheduled_messages SET status='sent' WHERE id=$1", [m.id]);
    } catch (e: any) {
      await q("UPDATE scheduled_messages SET status='failed', error=$2 WHERE id=$1", [m.id, String(e.message).slice(0, 300)]);
    }
  }
}

async function housekeeping() {
  const g = globalThis as any;
  if (Date.now() - (g.__waCleanAt || 0) < 3600e3) return;
  g.__waCleanAt = Date.now();
  // Media rows nothing points at anymore (failed sends, deleted chats, replaced header files)
  await q(`DELETE FROM media WHERE created_at < now() - interval '1 day'
             AND id NOT IN (SELECT media_ref FROM messages WHERE media_ref IS NOT NULL)
             AND id NOT IN (SELECT header_media_ref FROM templates WHERE header_media_ref IS NOT NULL)`);
  await q("DELETE FROM webhook_events WHERE created_at < now() - interval '30 days'");
}

export async function tick() {
  const g = globalThis as any;
  if (g.__waTicking) return; // never overlap within one process
  g.__waTicking = true;
  try {
    await processScheduled();
    await processCampaigns();
    await housekeeping();
  } finally {
    g.__waTicking = false;
  }
}

export function startWorker() {
  const g = globalThis as any;
  if (g.__waWorker || process.env.ENABLE_WORKER === '0') return;
  g.__waWorker = setInterval(() => tick().catch((e) => console.error('[worker]', e.message)), 5000);
  console.log('[worker] background queue started');
}
