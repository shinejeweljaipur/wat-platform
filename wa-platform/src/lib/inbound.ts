import { q, q1, Row } from './db';
import { addMessage, sendTextToContact } from './messaging';
import { handleInbound } from './bot';
import { isValidPhone, normalizePhone } from './util';

export async function upsertContact(
  channel: Row,
  c: { phone: string; name?: string; email?: string; tags?: string[]; optedIn?: boolean }
): Promise<Row> {
  const phone = normalizePhone(c.phone, channel.default_country);
  if (!isValidPhone(phone)) throw new Error('Invalid phone number');
  const row = await q1(
    `INSERT INTO contacts (channel_id, phone, name, email, tags, opted_in)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (channel_id, phone) DO UPDATE SET
       name = CASE WHEN contacts.name = '' THEN EXCLUDED.name ELSE contacts.name END,
       email = CASE WHEN contacts.email = '' THEN EXCLUDED.email ELSE contacts.email END,
       tags = (SELECT ARRAY(SELECT DISTINCT unnest(contacts.tags || EXCLUDED.tags))),
       opted_in = contacts.opted_in OR EXCLUDED.opted_in
     RETURNING *`,
    [channel.id, phone, c.name || '', c.email || '', c.tags || [], !!c.optedIn]
  );
  return row!;
}

/**
 * Stores the inbound message (this part must succeed before we ack Meta), and returns a "reaction" thunk that
 * runs STOP/START handling and bot flows. The webhook fires the thunk in the background so Meta gets a fast 200.
 */
export async function processInbound(
  channel: Row,
  m: { phone: string; name?: string; text: string; type?: string; waId?: string | null; media?: { id?: string; mime?: string; filename?: string } }
): Promise<() => Promise<void>> {
  let c = await upsertContact(channel, { phone: m.phone, name: m.name });
  const msg = await addMessage({ contactId: c.id, direction: 'in', type: m.type || 'text', body: m.text, waId: m.waId, status: 'received',
    mediaId: m.media?.id, mime: m.media?.mime, filename: m.media?.filename });
  if (!msg) return async () => {}; // duplicate delivery from Meta
  c = (await q1("UPDATE contacts SET status='open', unread=unread+1 WHERE id=$1 RETURNING *", [c.id]))!;

  return async () => {
    const t = m.text.trim().toLowerCase();
    if (['stop', 'unsubscribe', 'stop all'].includes(t)) {
      await q('UPDATE contacts SET opted_in=false WHERE id=$1', [c.id]);
      await sendTextToContact(c, 'You have been unsubscribed and will not receive promotional messages. Reply START to subscribe again.', 'bot').catch(() => {});
      return;
    }
    if (['start', 'subscribe'].includes(t)) {
      await q('UPDATE contacts SET opted_in=true WHERE id=$1', [c.id]);
      await sendTextToContact(c, 'You are subscribed again. Thank you!', 'bot').catch(() => {});
      return;
    }
    await handleInbound(c, m.text);
  };
}

/** Delivery receipts. Only moves status forward (sent -> delivered -> read); failed always wins. */
export async function applyStatus(waId: string, status: string, errorText = '') {
  if (!waId || !['sent', 'delivered', 'read', 'failed'].includes(status)) return;
  await q(`UPDATE messages SET status=$2, error=$3 WHERE wa_message_id=$1 AND wa_rank($2) > wa_rank(status)`, [waId, status, errorText]);
  await q(`UPDATE campaign_recipients SET status=$2, error=$3 WHERE wa_message_id=$1 AND wa_rank($2) > wa_rank(status)`, [waId, status, errorText]);
}
