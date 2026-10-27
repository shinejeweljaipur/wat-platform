import { q, q1, Row } from './db';
import { sendTextToContact, sendTemplateToContact, sendButtonsToContact, addMessage } from './messaging';
import { fill, sleep } from './util';
import type { Step } from './flows';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function keywordMatches(text: string, list: string) {
  return list
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
    .some((k) => new RegExp(`(^|\\W)${esc(k)}(\\W|$)`, 'i').test(text));
}

/**
 * Flow state: when a flow asks a question it pauses. `path` locates the waiting "ask" step inside the nested step tree.
 * Every segment but the last also names the branch we're inside, e.g. [{i:2,branch:0},{i:1}] = step 2's first branch → step 1.
 */
type Seg = { i: number; branch?: number | 'else' };
type FlowState = { flow_id: number; path: Seg[]; tries: number; at: string };
type Ctx = { flow: Row; contactId: number };

const STATE_TTL_MS = 24 * 3600 * 1000; // matches WhatsApp's reply window
const MAX_RETRIES = 2;

const freshContact = async (id: number) => (await q1('SELECT * FROM contacts WHERE id=$1', [id]))!;
const clearState = (id: number) => q('UPDATE contacts SET flow_state=NULL WHERE id=$1', [id]);
const saveState = (id: number, st: FlowState) => q('UPDATE contacts SET flow_state=$2 WHERE id=$1', [id, JSON.stringify(st)]);

export async function handleInbound(contact: Row, text: string) {
  if (contact.bot_paused) {
    // A human owns this chat: abandon any question we were waiting on.
    if (contact.flow_state) await clearState(contact.id);
    return;
  }
  const t = String(text || '').trim();

  // 1. Are we waiting for an answer to a question?
  const st: FlowState | null = contact.flow_state;
  if (st) {
    const fresh = Date.now() - new Date(st.at).getTime() < STATE_TTL_MS;
    const flow = fresh ? await q1('SELECT * FROM flows WHERE id=$1 AND active', [st.flow_id]) : null;
    if (flow) {
      await resumeFlow(flow, contact, st, t);
      return;
    }
    await clearState(contact.id);
  }

  // 2. Otherwise pick a flow: keyword > welcome (first message) > fallback.
  const flows = await q('SELECT * FROM flows WHERE channel_id=$1 AND active ORDER BY id', [contact.channel_id]);
  let match = flows.find((f) => f.trigger_type === 'keyword' && keywordMatches(t, f.trigger_value));
  if (!match) {
    const n = (await q1("SELECT count(*)::int c FROM messages WHERE contact_id=$1 AND direction='in'", [contact.id]))!.c;
    if (n <= 1) match = flows.find((f) => f.trigger_type === 'welcome');
    if (!match && !contact.assigned_to) {
      // Fallback at most once per hour per contact, so we never spam someone who is just chatting.
      const recent = await q1(
        "SELECT 1 FROM messages WHERE contact_id=$1 AND sender='bot' AND created_at > now() - interval '1 hour' LIMIT 1",
        [contact.id]
      );
      if (!recent) match = flows.find((f) => f.trigger_type === 'fallback');
    }
  }
  if (match) await runFlow(match, contact);
}

export async function runFlow(flow: Row, contact: Row) {
  await clearState(contact.id);
  await run(Array.isArray(flow.steps) ? flow.steps : [], 0, [], { flow, contactId: contact.id });
}

async function sendAsk(ask: Step, contactId: number) {
  const c = await freshContact(contactId);
  const text = fill(ask.text || '', c);
  const buttons = (ask.branches || []).map((b) => b.button?.trim()).filter((b): b is string => !!b).slice(0, 3);
  if (buttons.length) await sendButtonsToContact(c, text, buttons, 'bot');
  else await sendTextToContact(c, text, 'bot');
}

/** Executes steps[start..]. Returns 'paused' if it stopped to wait for the customer's reply. */
async function run(steps: Step[], start: number, prefix: Seg[], ctx: Ctx): Promise<'done' | 'paused'> {
  for (let i = start; i < steps.length; i++) {
    const s = steps[i];
    try {
      const c = await freshContact(ctx.contactId);
      if (s.type === 'text') await sendTextToContact(c, fill(s.text || '', c), 'bot');
      else if (s.type === 'template')
        await sendTemplateToContact(c, s.name || '', s.language || 'en', (s.params || []).map((p) => fill(p, c)), 'bot');
      else if (s.type === 'tag' && s.tag)
        await q('UPDATE contacts SET tags = (SELECT ARRAY(SELECT DISTINCT unnest(tags || $2::text))) WHERE id=$1', [c.id, s.tag.toLowerCase()]);
      else if (s.type === 'delay') await sleep(Math.min(Number(s.seconds) || 1, 10) * 1000);
      else if (s.type === 'handoff') {
        await q('UPDATE contacts SET bot_paused=true, flow_state=NULL WHERE id=$1', [c.id]);
        await addMessage({ contactId: c.id, direction: 'sys', type: 'note', body: 'Bot handed this chat to a human agent', sender: 'bot' });
        return 'done'; // nothing runs after a hand-over
      } else if (s.type === 'ask') {
        await sendAsk(s, c.id);
        await saveState(c.id, { flow_id: ctx.flow.id, path: [...prefix, { i }], tries: 0, at: new Date().toISOString() });
        return 'paused';
      }
    } catch (e: any) {
      console.error(`[flow ${ctx.flow.id}] step ${i + 1} failed:`, e.message);
    }
  }
  return 'done';
}

async function keywordEscape(ctx: Ctx, reply: string): Promise<boolean> {
  const flows = await q("SELECT * FROM flows WHERE channel_id=$1 AND active AND trigger_type='keyword' AND id<>$2 ORDER BY id", [ctx.flow.channel_id, ctx.flow.id]);
  const kw = flows.find((f) => keywordMatches(reply, f.trigger_value));
  if (!kw) return false;
  await runFlow(kw, await freshContact(ctx.contactId));
  return true;
}

function matchBranch(ask: Step, reply: string): number {
  const branches = ask.branches || [];
  const r = reply.trim().toLowerCase();
  // A tapped button sends back its exact title, so check that first.
  const exact = branches.findIndex((b) => b.button && b.button.trim().toLowerCase() === r);
  if (exact >= 0) return exact;
  return branches.findIndex((b) => keywordMatches(reply, [b.match, b.button].filter(Boolean).join(',')));
}

async function resumeFlow(flow: Row, contact: Row, st: FlowState, reply: string) {
  await clearState(contact.id); // a new pause (if any) will save fresh state
  await resumeIn(flow.steps || [], st.path, [], reply, { flow, contactId: contact.id }, st.tries);
}

async function resumeIn(steps: Step[], path: Seg[], prefix: Seg[], reply: string, ctx: Ctx, tries: number): Promise<'done' | 'paused'> {
  const seg = path[0];
  const ask = steps[seg.i];
  if (!ask || ask.type !== 'ask') return 'done'; // flow was edited while waiting: stop quietly

  let res: 'done' | 'paused';
  if (path.length === 1) {
    // This is the question that's waiting for the answer.
    const k = matchBranch(ask, reply);
    if (k >= 0) {
      res = await run(ask.branches![k].steps, 0, [...prefix, { i: seg.i, branch: k }], ctx);
    } else if (ask.else_steps?.length) {
      res = await run(ask.else_steps, 0, [...prefix, { i: seg.i, branch: 'else' }], ctx);
    } else if (await keywordEscape(ctx, reply)) {
      // The customer typed a global keyword (e.g. "human") instead of answering: let that flow take over.
      return 'done';
    } else if (tries < MAX_RETRIES) {
      // No branch matched and no fallback: ask again (max twice), then give up so we don't loop forever.
      try {
        await sendTextToContact(await freshContact(ctx.contactId), "Sorry, I didn't get that. Please choose one of the options.", 'bot');
        await sendAsk(ask, ctx.contactId);
        await saveState(ctx.contactId, { flow_id: ctx.flow.id, path: [...prefix, { i: seg.i }], tries: tries + 1, at: new Date().toISOString() });
      } catch (e: any) {
        console.error(`[flow ${ctx.flow.id}] re-ask failed:`, e.message);
      }
      return 'paused';
    } else {
      return 'done';
    }
  } else {
    // The waiting question is deeper inside one of this question's branches.
    const nested = seg.branch === 'else' ? ask.else_steps : ask.branches?.[seg.branch as number]?.steps;
    if (!nested) return 'done';
    res = await resumeIn(nested, path.slice(1), [...prefix, seg], reply, ctx, tries);
  }
  if (res === 'paused') return 'paused';
  // The branch finished: carry on with whatever follows this question.
  return run(steps, seg.i + 1, prefix, ctx);
}
