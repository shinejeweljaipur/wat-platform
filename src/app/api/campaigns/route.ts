import { api, body, channelFromReq, HttpError, requireUser } from '@/lib/auth';
import { q, q1 } from '@/lib/db';
import { countVars } from '@/lib/util';
import { isLive } from '@/lib/whatsapp';
import { unsendableReason } from '@/lib/templates';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  await requireUser();
  const ch = await channelFromReq(req);
  const campaigns = await q(
    `SELECT c.id, c.name, c.template_name, c.tag, c.status, c.total, c.created_at, c.created_by,
            count(r.*) FILTER (WHERE r.status IN ('sent','delivered','read'))::int AS sent,
            count(r.*) FILTER (WHERE r.status IN ('delivered','read'))::int AS delivered,
            count(r.*) FILTER (WHERE r.status = 'read')::int AS read,
            count(r.*) FILTER (WHERE r.status = 'failed')::int AS failed,
            count(r.*) FILTER (WHERE r.status IN ('pending','sending'))::int AS pending
       FROM campaigns c LEFT JOIN campaign_recipients r ON r.campaign_id = c.id
      WHERE c.channel_id=$1 GROUP BY c.id ORDER BY c.id DESC LIMIT 100`,
    [ch.id]
  );
  return { campaigns };
});

export const POST = api(async (req) => {
  const user = await requireUser();
  const ch = await channelFromReq(req);
  const b = await body(req);

  const name = String(b.name || '').trim();
  const tag = String(b.tag || '').trim().toLowerCase();
  const params: string[] = Array.isArray(b.params) ? b.params.map(String) : [];
  if (!name) throw new HttpError(400, 'Campaign name is required');

  const tpl = await q1('SELECT * FROM templates WHERE channel_id=$1 AND name=$2 AND language=$3', [ch.id, String(b.template_name), String(b.language)]);
  if (!tpl) throw new HttpError(400, 'Template not found. Sync templates first.');
  if (isLive(ch) && tpl.status !== 'APPROVED') throw new HttpError(400, `Template is ${tpl.status}, only APPROVED templates can be sent.`);
  const why = unsendableReason(tpl);
  if (why) throw new HttpError(400, `This template ${why}.`);
  const needed = countVars(tpl.body);
  if (params.length !== needed || params.some((p) => !p.trim())) {
    throw new HttpError(400, `This template needs ${needed} variable(s); fill all of them.`);
  }

  // Meta policy: marketing messages only to people who opted in.
  const camp = await q1(
    `INSERT INTO campaigns (channel_id, name, template_name, language, params, tag, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'paused',$7) RETURNING id`,
    [ch.id, name, tpl.name, tpl.language, JSON.stringify(params), tag, user.name]
  );
  const ins = await q(
    `INSERT INTO campaign_recipients (campaign_id, contact_id)
     SELECT $1, id FROM contacts WHERE channel_id=$2 AND opted_in ${tag ? 'AND $3 = ANY(tags)' : 'AND $3::text IS NOT NULL'}
     RETURNING id`,
    [camp!.id, ch.id, tag || '']
  );
  if (!ins.length) {
    await q('DELETE FROM campaigns WHERE id=$1', [camp!.id]);
    throw new HttpError(400, 'No opted-in contacts match this audience.');
  }
  // Only start sending once recipients are fully in place.
  await q("UPDATE campaigns SET total=$2, status='sending' WHERE id=$1", [camp!.id, ins.length]);
  return { id: camp!.id, total: ins.length };
});
