'use client';
import { useState } from 'react';
import { api, usePoll } from '@/lib/client';
import { useApp } from '@/components/Shell';
import { countVars } from '@/lib/util';

type Camp = {
  id: number; name: string; template_name: string; tag: string; status: string; total: number; created_at: string;
  sent: number; delivered: number; read: number; failed: number; pending: number;
};

export default function Campaigns() {
  const { channel } = useApp();
  const cid = channel!.id;
  const [camps, setCamps] = useState<Camp[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [tags, setTags] = useState<{ tag: string; n: number }[]>([]);
  const [stats, setStats] = useState({ total: 0, opted_in: 0 });
  const [form, setForm] = useState({ name: '', tpl: '', tag: '' });
  const [params, setParams] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<{ id: number; rows: any[] } | null>(null);

  const load = async () => {
    const d = await api(`/api/campaigns?channel=${cid}`);
    setCamps(d.campaigns);
  };
  usePoll(load, 4000, [cid]);
  usePoll(async () => {
    const [t, c] = await Promise.all([api(`/api/templates?channel=${cid}`), api(`/api/contacts?channel=${cid}`)]);
    setTemplates(t.templates.filter((x: any) => !x.unsendable_reason && (x.status === 'APPROVED' || !t.live)));
    setTags(c.tags); setStats(c.stats);
  }, 30000, [cid]);

  const tpl = templates.find((t) => `${t.name}|${t.language}` === form.tpl);
  const nVars = tpl ? countVars(tpl.body) : 0;
  const preview = tpl ? String(tpl.body).replace(/\{\{(\d+)\}\}/g, (_: string, i: string) => params[Number(i) - 1] || `{{${i}}}`) : '';

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!tpl) return;
    if (!confirm(`Send "${form.name}" to ${form.tag ? `contacts tagged "${form.tag}"` : 'all opted-in contacts'}? This starts sending immediately.`)) return;
    setBusy(true); setErr('');
    try {
      await api(`/api/campaigns?channel=${cid}`, { body: { name: form.name, template_name: tpl.name, language: tpl.language, params, tag: form.tag } });
      setForm({ name: '', tpl: '', tag: '' }); setParams([]); await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function act(id: number, action: 'pause' | 'resume') {
    try { await api(`/api/campaigns/${id}`, { method: 'PATCH', body: { action } }); await load(); } catch (e: any) { setErr(e.message); }
  }
  async function showFailures(id: number) {
    const d = await api(`/api/campaigns/${id}`);
    setFailures({ id, rows: d.failures });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold">Broadcast campaigns</h1>
        <p className="text-sm text-slate-500">Sent only to contacts who opted in ({stats.opted_in} of {stats.total}). Use {'{{name}}'} in a variable to insert the customer’s name.</p>
      </div>

      <form onSubmit={create} className="card space-y-3">
        <h2 className="font-medium">New campaign</h2>
        <div className="grid gap-2 md:grid-cols-3">
          <div><label className="label">Campaign name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div><label className="label">Template</label>
            <select className="input" value={form.tpl} onChange={(e) => { setForm({ ...form, tpl: e.target.value }); setParams([]); }} required>
              <option value="">Choose approved template…</option>
              {templates.map((t) => <option key={t.id} value={`${t.name}|${t.language}`}>{t.name} ({t.language})</option>)}
            </select>
          </div>
          <div><label className="label">Audience</label>
            <select className="input" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })}>
              <option value="">All opted-in contacts</option>
              {tags.map((t) => <option key={t.tag} value={t.tag}>Tag: {t.tag}</option>)}
            </select>
          </div>
        </div>
        {Array.from({ length: nVars }).map((_, i) => (
          <div key={i}><label className="label">Value for {`{{${i + 1}}}`}</label>
            <input className="input" value={params[i] || ''} onChange={(e) => { const p = [...params]; p[i] = e.target.value; setParams(p); }} required />
          </div>
        ))}
        {tpl && <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><div className="mb-1 text-xs text-slate-400">Preview</div>{preview}</div>}
        <button className="btn" disabled={busy || !tpl}>Start campaign</button>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </form>

      <div className="space-y-3">
        {camps.map((c) => {
          const pct = (n: number) => (c.total ? Math.round((n / c.total) * 100) : 0);
          return (
            <div key={c.id} className="card space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-slate-500">{c.template_name}{c.tag ? ` · tag: ${c.tag}` : ''} · {new Date(c.created_at).toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge ${c.status === 'done' ? 'bg-green-100 text-green-700' : c.status === 'paused' ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'}`}>{c.status}</span>
                  {c.status === 'sending' && <button className="btn-ghost" onClick={() => act(c.id, 'pause')}>Pause</button>}
                  {c.status === 'paused' && <button className="btn-ghost" onClick={() => act(c.id, 'resume')}>Resume</button>}
                </div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-brand" style={{ width: `${pct(c.total - c.pending)}%` }} />
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                <span>Total <b>{c.total}</b></span>
                <span>Sent <b>{c.sent}</b></span>
                <span>Delivered <b>{c.delivered}</b> <span className="text-slate-400">({pct(c.delivered)}%)</span></span>
                <span>Read <b>{c.read}</b> <span className="text-slate-400">({pct(c.read)}%)</span></span>
                <span className={c.failed ? 'text-red-600' : ''}>Failed <b>{c.failed}</b></span>
                <span>Queued <b>{c.pending}</b></span>
                {c.failed > 0 && <button className="text-xs text-red-600 underline" onClick={() => showFailures(c.id)}>why?</button>}
              </div>
              {failures?.id === c.id && (
                <div className="max-h-40 overflow-auto rounded-lg bg-red-50 p-2 text-xs text-red-800">
                  {failures.rows.map((r, i) => <div key={i}>+{r.phone} {r.name && `(${r.name})`}: {r.error}</div>)}
                </div>
              )}
            </div>
          );
        })}
        {camps.length === 0 && <p className="text-sm text-slate-400">No campaigns yet.</p>}
      </div>
    </div>
  );
}
