import { api, body, HttpError, requireUser } from '@/lib/auth';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

// pause / resume
export const PATCH = api(async (req, { params }) => {
  await requireUser();
  const b = await body(req);
  const id = Number(params.id);
  if (b.action === 'pause') await q("UPDATE campaigns SET status='paused' WHERE id=$1 AND status='sending'", [id]);
  else if (b.action === 'resume') await q("UPDATE campaigns SET status='sending' WHERE id=$1 AND status='paused'", [id]);
  else throw new HttpError(400, 'Unknown action');
  return { ok: true };
});

// failure reasons for a campaign
export const GET = api(async (_req, { params }) => {
  await requireUser();
  const failures = await q(
    `SELECT c.phone, c.name, r.error FROM campaign_recipients r JOIN contacts c ON c.id=r.contact_id
      WHERE r.campaign_id=$1 AND r.status='failed' ORDER BY r.id LIMIT 200`,
    [Number(params.id)]
  );
  return { failures };
});
