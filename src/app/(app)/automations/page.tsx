'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { useApp } from '@/components/Shell';

type Step = {
  type: 'text' | 'template' | 'tag' | 'delay' | 'handoff' | 'ask';
  text?: string; name?: string; language?: string; params?: string[]; tag?: string; seconds?: number;
  branches?: { match?: string; button?: string; steps: Step[] }[];
  else_steps?: Step[];
};
type Flow = { id: number; name: string; trigger_type: 'keyword' | 'welcome' | 'fallback'; trigger_value: string; steps: Step[]; active: boolean };

const STEP_LABEL: Record<string, string> = {
  text: 'Send text', template: 'Send template', tag: 'Add tag', delay: 'Wait', handoff: 'Hand over to human', ask: 'Ask & branch',
};
const TRIGGER_HELP: Record<string, string> = {
  keyword: 'Runs when a message contains one of the keywords',
  welcome: 'Runs on the customer’s very first message',
  fallback: 'Runs when nothing else matches (at most once per hour per customer)',
};

function StepsEditor({ steps, onChange, depth = 0 }: { steps: Step[]; onChange: (s: Step[]) => void; depth?: number }) {
  const set = (i: number, s: Partial<Step>) => onChange(steps.map((x, j) => (j === i ? { ...x, ...s } : x)));
  const move = (i: number, d: number) => {
    const next = [...steps]; const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const addStep = (type: Step['type']) =>
    onChange([...steps, type === 'ask' ? { type, text: '', branches: [{ match: '', button: '', steps: [] }], else_steps: [] } : { type }]);

  return (
    <div className="space-y-2">
      {steps.map((s, i) => (
        <div key={i} className="flex items-start gap-2 rounded-lg bg-slate-50 p-2">
          <div className="w-24 shrink-0 pt-2 text-xs font-medium text-slate-500 md:w-28">{i + 1}. {STEP_LABEL[s.type]}</div>
          <div className="min-w-0 flex-1 space-y-1">
            {s.type === 'text' && <textarea className="input" rows={2} placeholder="Message. Use {{name}} for the customer's name." value={s.text || ''} onChange={(e) => set(i, { text: e.target.value })} />}
            {s.type === 'template' && (
              <>
                <input className="input" placeholder="Template name" value={s.name || ''} onChange={(e) => set(i, { name: e.target.value })} />
                <input className="input" placeholder="Variables, comma separated ({{name}} allowed)" value={(s.params || []).join(', ')} onChange={(e) => set(i, { params: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
              </>
            )}
            {s.type === 'tag' && <input className="input" placeholder="Tag to add" value={s.tag || ''} onChange={(e) => set(i, { tag: e.target.value })} />}
            {s.type === 'delay' && <input className="input" type="number" min={1} max={10} placeholder="Seconds (max 10)" value={s.seconds ?? 2} onChange={(e) => set(i, { seconds: Number(e.target.value) })} />}
            {s.type === 'handoff' && <p className="pt-2 text-xs text-slate-500">Turns the bot off for this chat so your team can reply. Nothing after this step runs.</p>}
            {s.type === 'ask' && (
              <div className="space-y-2">
                <textarea className="input" rows={2} placeholder="Question to ask, e.g. Are you looking for gold or silver?" value={s.text || ''} onChange={(e) => set(i, { text: e.target.value })} />
                <p className="text-xs text-slate-500">The flow pauses here and waits for the customer’s reply, then follows the first branch that matches. Give up to 3 branches a button title to show tap-to-reply buttons.</p>
                {(s.branches || []).map((b, k) => (
                  <div key={k} className="space-y-2 rounded-lg border border-slate-200 bg-white p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-slate-500">If reply contains</span>
                      <input className="input w-44" placeholder="gold, sona" value={b.match || ''} onChange={(e) => set(i, { branches: s.branches!.map((x, j) => (j === k ? { ...x, match: e.target.value } : x)) })} />
                      <input className="input w-44" maxLength={20} placeholder="Button title (optional)" value={b.button || ''} onChange={(e) => set(i, { branches: s.branches!.map((x, j) => (j === k ? { ...x, button: e.target.value } : x)) })} />
                      <button className="btn-danger ml-auto px-2 py-1" aria-label="Remove branch" onClick={() => set(i, { branches: s.branches!.filter((_, j) => j !== k) })}>✕</button>
                    </div>
                    <div className="border-l-2 border-brand/30 pl-3">
                      <StepsEditor steps={b.steps} depth={depth + 1} onChange={(st) => set(i, { branches: s.branches!.map((x, j) => (j === k ? { ...x, steps: st } : x)) })} />
                    </div>
                  </div>
                ))}
                {(s.branches || []).length < 10 && (
                  <button className="btn-ghost" onClick={() => set(i, { branches: [...(s.branches || []), { match: '', button: '', steps: [] }] })}>+ Add branch</button>
                )}
                <div className="rounded-lg border border-dashed border-slate-300 p-2">
                  <div className="mb-1 text-xs font-medium text-slate-500">If nothing matches (optional; otherwise the question is repeated up to twice)</div>
                  <div className="border-l-2 border-slate-300 pl-3">
                    <StepsEditor steps={s.else_steps || []} depth={depth + 1} onChange={(st) => set(i, { else_steps: st })} />
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-col gap-1 text-xs">
            <button className="btn-ghost px-2 py-0.5" onClick={() => move(i, -1)} aria-label="Move up">↑</button>
            <button className="btn-ghost px-2 py-0.5" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
            <button className="btn-danger px-2 py-0.5" onClick={() => onChange(steps.filter((_, j) => j !== i))} aria-label="Remove step">✕</button>
          </div>
        </div>
      ))}
      <select className="input w-auto" value="" onChange={(e) => e.target.value && addStep(e.target.value as Step['type'])}>
        <option value="">+ Add step…</option>
        {Object.entries(STEP_LABEL).filter(([k]) => k !== 'ask' || depth < 4).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </div>
  );
}

function FlowCard({ flow, onChanged }: { flow: Flow; onChanged: () => void }) {
  const [f, setF] = useState<Flow>(flow);
  const [msg, setMsg] = useState('');
  const dirty = JSON.stringify(f) !== JSON.stringify(flow);

  async function save() {
    setMsg('');
    try {
      await api(`/api/flows/${f.id}`, { method: 'PATCH', body: { name: f.name, trigger_type: f.trigger_type, trigger_value: f.trigger_value, steps: f.steps, active: f.active } });
      setMsg('Saved'); onChanged();
    } catch (e: any) { setMsg(e.message); }
  }
  async function del() {
    if (!confirm(`Delete "${f.name}"?`)) return;
    await api(`/api/flows/${f.id}`, { method: 'DELETE' }); onChanged();
  }

  return (
    <div className={`card space-y-3 ${f.active ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs font-medium" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <select className="input w-auto" value={f.trigger_type} onChange={(e) => setF({ ...f, trigger_type: e.target.value as Flow['trigger_type'] })}>
          <option value="keyword">Keyword</option><option value="welcome">Welcome</option><option value="fallback">Fallback</option>
        </select>
        <label className="ml-auto flex items-center gap-1.5 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
      </div>
      <p className="text-xs text-slate-500">{TRIGGER_HELP[f.trigger_type]}</p>
      {f.trigger_type === 'keyword' && (
        <input className="input" placeholder="Keywords, comma separated (e.g. order, track, status)" value={f.trigger_value} onChange={(e) => setF({ ...f, trigger_value: e.target.value })} />
      )}
      <StepsEditor steps={f.steps} onChange={(steps) => setF({ ...f, steps })} />
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" disabled={!dirty} onClick={save}>Save</button>
        <button className="btn-danger" onClick={del}>Delete</button>
        {msg && <span className="text-sm text-slate-500">{msg}</span>}
      </div>
    </div>
  );
}

function Flows() {
  const { channel } = useApp();
  const cid = channel!.id;
  const [flows, setFlows] = useState<Flow[]>([]);
  const load = async () => setFlows((await api(`/api/flows?channel=${cid}`)).flows);
  useEffect(() => { load().catch(() => {}); }, [cid]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    await api(`/api/flows?channel=${cid}`, { body: { name: 'New flow', trigger_type: 'keyword', trigger_value: '', steps: [{ type: 'text', text: '' }] } });
    await load();
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Auto-replies run only while the bot is on for a chat. When an agent replies, the bot switches off for that customer.</p>
      {flows.map((f) => <FlowCard key={`${f.id}-${JSON.stringify(f)}`} flow={f} onChanged={load} />)}
      <button className="btn" onClick={add}>+ New flow</button>
    </div>
  );
}

function Shopify() {
  const { channel, user, reload } = useApp();
  const ch = channel!;
  const [templates, setTemplates] = useState<any[]>([]);
  const [f, setF] = useState({ tpl_order: ch.tpl_order, tpl_cod: ch.tpl_cod, tpl_cart: ch.tpl_cart, tpl_shipped: ch.tpl_shipped, cart_delay_min: ch.cart_delay_min });
  const [msg, setMsg] = useState('');
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
    api(`/api/templates?channel=${ch.id}`).then((d) => setTemplates(d.templates.filter((t: any) => !t.unsendable_reason && (t.status === 'APPROVED' || !d.live)))).catch(() => {});
  }, [ch.id]);
  useEffect(() => { setF({ tpl_order: ch.tpl_order, tpl_cod: ch.tpl_cod, tpl_cart: ch.tpl_cart, tpl_shipped: ch.tpl_shipped, cart_delay_min: ch.cart_delay_min }); }, [ch.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setMsg('');
    try { await api(`/api/channels/${ch.id}`, { method: 'PATCH', body: f }); await reload(); setMsg('Saved'); } catch (e: any) { setMsg(e.message); }
  }
  const sel = (key: 'tpl_order' | 'tpl_cod' | 'tpl_cart' | 'tpl_shipped', label: string, hint: string) => (
    <div>
      <label className="label">{label}</label>
      <select className="input" value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} disabled={user.role !== 'admin'}>
        <option value="">Off</option>
        {templates.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
      </select>
      <p className="mt-0.5 text-xs text-slate-400">{hint}</p>
    </div>
  );
  const url = `${origin}/api/webhook/shopify/${ch.id}`;

  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <h2 className="font-medium">1. Connect Shopify to {ch.name}</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>Shopify admin → <b>Settings → Notifications → Webhooks</b> → Create webhook (Format: JSON).</li>
          <li>Create one webhook for each event: <code>Order creation</code>, <code>Order fulfillment</code>, <code>Checkout creation</code>, <code>Checkout update</code>.</li>
          <li>URL for all of them:
            <div className="mt-1 break-all rounded-lg bg-slate-100 p-2 font-mono text-xs">{url}</div>
          </li>
          <li>Copy the <b>signing secret</b> shown at the bottom of that Webhooks page into <b>Settings → {ch.name} → Shopify signing secret</b>. {ch.has_shopify_secret ? <span className="text-green-700">✓ Secret is set.</span> : <span className="text-red-600">Not set yet. Webhooks will be rejected until you add it.</span>}</li>
        </ol>
      </div>
      <div className="card space-y-3">
        <h2 className="font-medium">2. Choose which template to send</h2>
        <p className="text-xs text-slate-500">
          Variables are filled in this order: Order confirmation / COD → {'{{1}}'} first name, {'{{2}}'} order number, {'{{3}}'} total. Shipped → {'{{1}}'} first name, {'{{2}}'} order number, {'{{3}}'} tracking link. Cart reminder → {'{{1}}'} first name, {'{{2}}'} checkout link.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {sel('tpl_order', 'Order confirmation', 'Utility template, sent when an order is placed')}
          {sel('tpl_cod', 'COD order confirmation (optional)', 'Used instead of the above for cash-on-delivery orders')}
          {sel('tpl_shipped', 'Order shipped', 'Sent when you mark the order as fulfilled')}
          {sel('tpl_cart', 'Abandoned cart reminder', 'Marketing template. Only sent to contacts who opted in')}
        </div>
        <div className="max-w-xs">
          <label className="label">Send cart reminder after (minutes)</label>
          <input className="input" type="number" min={1} value={f.cart_delay_min} onChange={(e) => setF({ ...f, cart_delay_min: Number(e.target.value) })} disabled={user.role !== 'admin'} />
        </div>
        {user.role === 'admin' ? <button className="btn" onClick={save}>Save</button> : <p className="text-xs text-slate-500">Only admins can change these settings.</p>}
        {msg && <span className="ml-2 text-sm text-slate-500">{msg}</span>}
      </div>
    </div>
  );
}

export default function Automations() {
  const [tab, setTab] = useState<'flows' | 'shopify'>('flows');
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <h1 className="text-xl font-semibold">Automations</h1>
      <div className="flex gap-1">
        {([['flows', 'Auto-reply flows'], ['shopify', 'Shopify']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-full px-4 py-1.5 text-sm font-medium ${tab === k ? 'bg-brand text-white' : 'bg-white text-slate-600 border border-slate-200'}`}>{l}</button>
        ))}
      </div>
      {tab === 'flows' ? <Flows /> : <Shopify />}
    </div>
  );
}
