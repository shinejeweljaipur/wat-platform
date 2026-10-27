'use client';
import { useRef, useState } from 'react';
import { api, usePoll } from '@/lib/client';
import { useApp } from '@/components/Shell';
import type { TemplateButton } from '@/lib/templates';

const STATUS_STYLE: Record<string, string> = {
  APPROVED: 'bg-green-100 text-green-700',
  PENDING: 'bg-amber-100 text-amber-700',
  REJECTED: 'bg-red-100 text-red-700',
};
const FILE_RULE: Record<string, { accept: string; hint: string }> = {
  IMAGE: { accept: 'image/jpeg,image/png', hint: 'JPG or PNG, up to 5 MB' },
  VIDEO: { accept: 'video/mp4', hint: 'MP4, up to 16 MB' },
  DOCUMENT: { accept: 'application/pdf', hint: 'PDF, up to 16 MB' },
};

type T = {
  id: number; name: string; language: string; category: string; status: string; body: string;
  header_format: string; header_text: string; footer: string; buttons: TemplateButton[]; has_header_media: boolean; unsendable_reason: string | null;
};

/** WhatsApp-style preview used in the editor and the template cards. */
function Preview({ t, headerSrc }: { t: Pick<T, 'body' | 'header_format' | 'header_text' | 'footer' | 'buttons'>; headerSrc?: string | null }) {
  return (
    <div className="max-w-xs rounded-xl bg-[#efeae2] p-3">
      <div className="rounded-lg bg-white p-2 text-sm shadow-sm">
        {t.header_format === 'TEXT' && t.header_text && <div className="mb-1 font-semibold">{t.header_text}</div>}
        {['IMAGE', 'VIDEO', 'DOCUMENT'].includes(t.header_format) && (
          <div className="mb-1 flex h-28 items-center justify-center overflow-hidden rounded-md bg-slate-200 text-xs text-slate-500">
            {t.header_format === 'IMAGE' && headerSrc ? <img src={headerSrc} alt="" className="h-full w-full object-cover" />
              : t.header_format === 'VIDEO' ? '▶ Video' : t.header_format === 'DOCUMENT' ? '📄 Document' : 'Image'}
          </div>
        )}
        <div className="whitespace-pre-wrap break-words">{t.body || <span className="text-slate-400">Message body…</span>}</div>
        {t.footer && <div className="mt-1 text-xs text-slate-400">{t.footer}</div>}
      </div>
      {t.buttons.map((b, i) => (
        <div key={i} className="mt-1 rounded-lg bg-white py-1.5 text-center text-sm font-medium text-sky-600 shadow-sm">
          {b.type === 'URL' ? '🔗 ' : b.type === 'PHONE_NUMBER' ? '📞 ' : '↩ '}{b.text || 'Button'}
        </div>
      ))}
    </div>
  );
}

function TemplateCard({ t, onChanged }: { t: T; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');
  const media = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(t.header_format);

  async function upload(f: File) {
    setErr('');
    const fd = new FormData(); fd.append('file', f);
    const res = await fetch(`/api/templates/${t.id}/header`, { method: 'POST', body: fd });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) setErr(d.error || 'Upload failed'); else onChanged();
    if (input.current) input.current.value = '';
  }

  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="truncate font-medium">{t.name} <span className="text-xs text-slate-400">{t.language}</span></div>
        <span className={`badge ${STATUS_STYLE[t.status] || ''}`}>{t.status}</span>
      </div>
      <div className="text-xs text-slate-500">{t.category}{media ? ` · ${t.header_format.toLowerCase()} header` : ''}{t.buttons.length ? ` · ${t.buttons.length} button${t.buttons.length > 1 ? 's' : ''}` : ''}</div>
      <Preview t={t} headerSrc={t.has_header_media && t.header_format === 'IMAGE' ? `/api/templates/${t.id}/header` : null} />
      {media && (
        <div className="space-y-1">
          <input ref={input} type="file" className="hidden" accept={FILE_RULE[t.header_format].accept} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <button className="btn-ghost" onClick={() => input.current?.click()}>{t.has_header_media ? 'Replace header file' : `Upload header ${t.header_format.toLowerCase()}`}</button>
          <span className="ml-2 text-xs text-slate-400">{FILE_RULE[t.header_format].hint}</span>
        </div>
      )}
      {t.unsendable_reason && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Can’t be sent from the app yet: it {t.unsendable_reason}.</p>}
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}

export default function Templates() {
  const { channel } = useApp();
  const cid = channel!.id;
  const [list, setList] = useState<T[]>([]);
  const [live, setLive] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const blank = { name: '', category: 'UTILITY', language: channel!.template_language || 'en', body: '', footer: '', header_format: 'NONE', header_text: '' };
  const [form, setForm] = useState(blank);
  const [buttons, setButtons] = useState<TemplateButton[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async () => {
    const d = await api(`/api/templates?channel=${cid}`);
    setList(d.templates); setLive(d.live); setMediaReady(d.media_headers_ready);
  };
  usePoll(load, 30000, [cid]);

  async function sync() {
    setBusy(true); setErr(''); setMsg('');
    try { const d = await api(`/api/templates?channel=${cid}`, { body: { action: 'sync' } }); setMsg(`Synced ${d.synced} templates from Meta`); await load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(''); setMsg('');
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      fd.append('buttons', JSON.stringify(buttons));
      if (file && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(form.header_format)) fd.append('file', file);
      const res = await fetch(`/api/templates?channel=${cid}`, { method: 'POST', body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Failed');
      setMsg(live ? `Submitted to Meta. Status: ${d.status}. Approval usually takes a few minutes to a day.` : 'Saved (test mode: auto-approved).');
      setForm({ ...blank, category: form.category, language: form.language }); setButtons([]); setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  const setBtn = (i: number, b: Partial<TemplateButton>) => setButtons(buttons.map((x, j) => (j === i ? { ...x, ...b } : x)));
  const mediaHeader = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(form.header_format);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Message templates</h1>
          <p className="text-sm text-slate-500">Templates must be approved by Meta before you can use them for broadcasts or to message customers after 24 hours.</p>
        </div>
        <button className="btn-ghost" onClick={sync} disabled={busy || !live}>↻ Sync from Meta</button>
      </div>

      <form onSubmit={create} className="card grid gap-4 md:grid-cols-[1fr_20rem]">
        <div className="space-y-3">
          <h2 className="font-medium">Create template</h2>
          <div className="grid gap-2 md:grid-cols-3">
            <div><label className="label">Name</label><input className="input" placeholder="order_confirmation" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div><label className="label">Category</label>
              <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="UTILITY">Utility (order updates)</option>
                <option value="MARKETING">Marketing (offers, promos)</option>
              </select>
            </div>
            <div><label className="label">Language code</label><input className="input" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} /></div>
          </div>

          <div>
            <label className="label">Header (optional)</label>
            <select className="input" value={form.header_format} onChange={(e) => { setForm({ ...form, header_format: e.target.value }); setFile(null); setPreviewUrl(null); }}>
              <option value="NONE">No header</option><option value="TEXT">Text</option><option value="IMAGE">Image</option><option value="VIDEO">Video</option><option value="DOCUMENT">Document (PDF)</option>
            </select>
            {form.header_format === 'TEXT' && <input className="input mt-2" maxLength={60} placeholder="Header text (max 60 characters)" value={form.header_text} onChange={(e) => setForm({ ...form, header_text: e.target.value })} required />}
            {mediaHeader && (
              <div className="mt-2 space-y-1">
                <input ref={fileInput} type="file" className="text-sm" accept={FILE_RULE[form.header_format].accept} required
                  onChange={(e) => { const f = e.target.files?.[0] || null; setFile(f); setPreviewUrl(f && form.header_format === 'IMAGE' ? URL.createObjectURL(f) : null); }} />
                <p className="text-xs text-slate-500">{FILE_RULE[form.header_format].hint}. This file is the sample sent to Meta for approval and is also what customers receive.</p>
                {live && !mediaReady && <p className="text-xs text-amber-700">Set the <code>META_APP_ID</code> environment variable on your server to submit templates with a media header.</p>}
              </div>
            )}
          </div>

          <div>
            <label className="label">Body: use {'{{1}}'}, {'{{2}}'} for variables</label>
            <textarea className="input" rows={3} placeholder={'Hi {{1}}, your order {{2}} is confirmed. Total: {{3}}'} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required />
          </div>
          <div><label className="label">Footer (optional)</label><input className="input" maxLength={60} placeholder="e.g. Reply STOP to opt out" value={form.footer} onChange={(e) => setForm({ ...form, footer: e.target.value })} /></div>

          <div className="space-y-2">
            <label className="label">Buttons (optional, max 3)</label>
            {buttons.map((b, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select className="input w-auto" value={b.type} onChange={(e) => setBtn(i, { type: e.target.value, url: '', phone_number: '' })}>
                  <option value="QUICK_REPLY">Quick reply</option><option value="URL">Open website</option><option value="PHONE_NUMBER">Call phone</option>
                </select>
                <input className="input w-40" maxLength={25} placeholder="Button text" value={b.text} onChange={(e) => setBtn(i, { text: e.target.value })} required />
                {b.type === 'URL' && <input className="input min-w-[12rem] flex-1" placeholder="https://shop.example/offer" value={b.url || ''} onChange={(e) => setBtn(i, { url: e.target.value })} required />}
                {b.type === 'PHONE_NUMBER' && <input className="input w-48" placeholder="+919876543210" value={b.phone_number || ''} onChange={(e) => setBtn(i, { phone_number: e.target.value })} required />}
                <button type="button" className="btn-danger px-2 py-1" aria-label="Remove button" onClick={() => setButtons(buttons.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            {buttons.length < 3 && <button type="button" className="btn-ghost" onClick={() => setButtons([...buttons, { type: 'QUICK_REPLY', text: '' }])}>+ Add button</button>}
          </div>
          <button className="btn" disabled={busy}>Submit for approval</button>
        </div>
        <div>
          <div className="label">Preview</div>
          <Preview t={{ ...form, buttons }} headerSrc={previewUrl} />
        </div>
      </form>

      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="grid gap-3 md:grid-cols-2">
        {list.map((t) => <TemplateCard key={t.id} t={t} onChanged={load} />)}
        {list.length === 0 && <p className="text-sm text-slate-400">No templates yet. Create one above{live ? ' or sync existing ones from Meta' : ''}.</p>}
      </div>
    </div>
  );
}
