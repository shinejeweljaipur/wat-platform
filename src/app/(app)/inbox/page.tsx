'use client';
import { useEffect, useRef, useState } from 'react';
import { api, timeAgo, usePoll } from '@/lib/client';
import { useApp } from '@/components/Shell';
import { countVars } from '@/lib/util';

type Conv = {
  id: number; phone: string; name: string; tags: string[]; status: string; assigned_to: number | null; assigned_name: string | null;
  unread: number; last_message_at: string; last_preview: string; bot_paused: boolean; window_open: boolean;
};
type Msg = { id: number; direction: 'in' | 'out' | 'note' | 'sys'; type: string; body: string; status: string; sender: string; error: string; created_at: string; has_media?: boolean; mime?: string; filename?: string };

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'mine', label: 'Mine' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'closed', label: 'Closed' },
];

function Ticks({ m }: { m: Msg }) {
  if (m.status === 'failed') return <span title={m.error} className="text-red-500">⚠ failed</span>;
  if (m.status === 'read') return <span className="text-sky-500">✓✓</span>;
  if (m.status === 'delivered') return <span className="text-slate-400">✓✓</span>;
  return <span className="text-slate-400">✓</span>;
}

function Media({ m }: { m: Msg }) {
  const src = `/api/media/${m.id}`;
  const mime = (m.mime || '').toLowerCase();
  if (m.type === 'image' || m.type === 'sticker' || mime.startsWith('image/'))
    return <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={m.filename || 'image'} loading="lazy" className="mb-1 max-h-72 max-w-full rounded-md object-contain" /></a>;
  if (m.type === 'video' || mime.startsWith('video/')) return <video src={src} controls preload="metadata" className="mb-1 max-h-72 max-w-full rounded-md" />;
  if (m.type === 'audio' || mime.startsWith('audio/')) return <audio src={src} controls preload="none" className="mb-1 w-64 max-w-full" />;
  return (
    <a href={src} download className="mb-1 flex items-center gap-2 rounded-md bg-black/5 px-3 py-2 text-sm hover:bg-black/10">
      <span>📄</span><span className="truncate">{m.filename || 'Document'}</span><span className="text-xs text-slate-500">Download</span>
    </a>
  );
}

export default function Inbox() {
  const { channel, user } = useApp();
  const cid = channel!.id;

  const [filter, setFilter] = useState('open');
  const [search, setSearch] = useState('');
  const [convs, setConvs] = useState<Conv[]>([]);
  const [counts, setCounts] = useState<{ open: number; mine: number; unassigned: number; unread: number }>({ open: 0, mine: 0, unassigned: 0, unread: 0 });
  const [selId, setSelId] = useState<number | null>(null);
  const [contact, setContact] = useState<any>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [team, setTeam] = useState<{ id: number; name: string }[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [tab, setTab] = useState<'reply' | 'note'>('reply');
  const [text, setText] = useState('');
  const [tplKey, setTplKey] = useState('');
  const [tplParams, setTplParams] = useState<string[]>([]);
  const [tagsText, setTagsText] = useState('');
  const [err, setErr] = useState('');
  const [sending, setSending] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  // reset selection when switching brand
  useEffect(() => { setSelId(null); setContact(null); setMsgs([]); }, [cid]);

  useEffect(() => {
    api('/api/team').then((d) => setTeam(d.users)).catch(() => {});
    api(`/api/templates?channel=${cid}`).then((d) => setTemplates(d.templates.filter((t: any) => !t.unsendable_reason && (t.status === 'APPROVED' || !d.live)))).catch(() => {});
  }, [cid]);

  usePoll(async () => {
    const d = await api(`/api/conversations?channel=${cid}&filter=${filter}&q=${encodeURIComponent(search)}`);
    setConvs(d.conversations);
    setCounts(d.counts);
  }, 4000, [cid, filter, search]);

  usePoll(async () => {
    if (!selId) return;
    const d = await api(`/api/conversations/${selId}`);
    setContact(d.contact);
    setMsgs(d.messages);
  }, 3000, [selId]);

  useEffect(() => { if (contact) setTagsText((contact.tags || []).join(', ')); }, [contact?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (msgs.length !== lastCount.current) {
      lastCount.current = msgs.length;
      bottom.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [msgs]);

  const refreshChat = async () => {
    if (!selId) return;
    const d = await api(`/api/conversations/${selId}`);
    setContact(d.contact);
    setMsgs(d.messages);
  };

  async function patch(body: any) {
    try { await api(`/api/conversations/${selId}`, { method: 'PATCH', body }); await refreshChat(); } catch (e: any) { setErr(e.message); }
  }

  async function send() {
    setErr('');
    setSending(true);
    try {
      if (tab === 'note') {
        await api(`/api/conversations/${selId}`, { body: { kind: 'note', text } });
      } else if (contact.window_open && file) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('caption', text);
        const res = await fetch(`/api/conversations/${selId}/media`, { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        setFile(null);
        if (fileInput.current) fileInput.current.value = '';
      } else if (contact.window_open) {
        await api(`/api/conversations/${selId}`, { body: { kind: 'text', text } });
      } else {
        const t = templates.find((x) => `${x.name}|${x.language}` === tplKey);
        if (!t) throw new Error('Choose a template');
        await api(`/api/conversations/${selId}`, { body: { kind: 'template', name: t.name, language: t.language, params: tplParams } });
      }
      setText('');
      await refreshChat();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSending(false);
    }
  }

  const selTpl = templates.find((x) => `${x.name}|${x.language}` === tplKey);
  const nVars = selTpl ? countVars(selTpl.body) : 0;
  const preview = selTpl ? String(selTpl.body).replace(/\{\{(\d+)\}\}/g, (_: string, i: string) => tplParams[Number(i) - 1] || `{{${i}}}`) : '';
  const needsTemplate = tab === 'reply' && contact && !contact.window_open;

  return (
    <div className="flex h-full">
      {/* conversation list */}
      <section className={`${selId ? 'hidden md:flex' : 'flex'} w-full flex-col border-r border-slate-200 bg-white md:w-80 md:shrink-0`}>
        <div className="space-y-2 border-b border-slate-200 p-3">
          <input className="input" placeholder="Search name or number" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)} className={`rounded-full px-3 py-1 text-xs font-medium ${filter === f.key ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {f.label}
                {f.key !== 'closed' && <span className="ml-1 opacity-70">{counts[f.key as 'open']}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {convs.length === 0 && <p className="p-4 text-sm text-slate-400">No conversations here yet.</p>}
          {convs.map((c) => (
            <button key={c.id} onClick={() => { setSelId(c.id); setErr(''); }} className={`block w-full border-b border-slate-100 px-3 py-3 text-left hover:bg-slate-50 ${selId === c.id ? 'bg-brand/5' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{c.name || `+${c.phone}`}</span>
                <span className="shrink-0 text-xs text-slate-400">{timeAgo(c.last_message_at)}</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-slate-500">{c.last_preview}</span>
                {c.unread > 0 && <span className="shrink-0 rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">{c.unread}</span>}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {c.assigned_name && <span className="badge">👤 {c.assigned_name}</span>}
                {!c.window_open && <span className="badge">window closed</span>}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* chat */}
      <section className={`${selId ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
        {!contact || contact.id !== selId ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Select a conversation</div>
        ) : (
          <>
            <header className="space-y-2 border-b border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn-ghost md:hidden" onClick={() => setSelId(null)}>← Back</button>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{contact.name || `+${contact.phone}`}</div>
                  <div className="text-xs text-slate-500">+{contact.phone} {contact.opted_in ? '· opted in' : ''}</div>
                </div>
                <select className="input w-auto" value={contact.assigned_to ?? ''} onChange={(e) => patch({ assigned_to: e.target.value ? Number(e.target.value) : null })} aria-label="Assign to">
                  <option value="">Unassigned</option>
                  {team.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === user.id ? ' (me)' : ''}</option>)}
                </select>
                <button className="btn-ghost" onClick={() => patch({ bot_paused: !contact.bot_paused })} title="When the bot is on, auto-reply flows answer this customer">
                  Bot: {contact.bot_paused ? 'off' : 'on'}
                </button>
                <button className="btn-ghost" onClick={() => patch({ status: contact.status === 'open' ? 'closed' : 'open' })}>
                  {contact.status === 'open' ? 'Close chat' : 'Reopen'}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Tags</span>
                <input className="input py-1" value={tagsText} placeholder="comma, separated" onChange={(e) => setTagsText(e.target.value)} onBlur={() => patch({ tags: tagsText })} />
              </div>
            </header>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#efeae2] p-4">
              {msgs.map((m) => {
                if (m.direction === 'sys') return <div key={m.id} className="text-center text-xs text-slate-500">{m.body}</div>;
                if (m.direction === 'note')
                  return (
                    <div key={m.id} className="mx-auto max-w-[80%] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                      <div className="mb-0.5 text-[11px] font-medium text-amber-700">Internal note · {m.sender}</div>
                      <div className="whitespace-pre-wrap">{m.body}</div>
                    </div>
                  );
                const out = m.direction === 'out';
                return (
                  <div key={m.id} className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm ${out ? 'bg-brand-light' : 'bg-white'}`}>
                      {out && m.sender && m.sender !== user.name && <div className="mb-0.5 text-[11px] font-medium text-slate-500">{m.sender}</div>}
                      {m.type === 'template' && <div className="mb-0.5 text-[11px] text-slate-500">Template</div>}
                      {m.has_media && <Media m={m} />}
                      {m.body && !(m.type === 'document' && m.body === m.filename) && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                      <div className="mt-1 flex items-center justify-end gap-1.5 text-[11px] text-slate-400">
                        {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {out && <Ticks m={m} />}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottom} />
            </div>

            <footer className="border-t border-slate-200 bg-white p-3">
              <div className="mb-2 flex gap-1">
                {(['reply', 'note'] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)} className={`rounded-full px-3 py-1 text-xs font-medium ${tab === t ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    {t === 'reply' ? 'Reply' : 'Internal note'}
                  </button>
                ))}
              </div>
              {needsTemplate ? (
                <div className="space-y-2">
                  <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                    The customer hasn’t messaged in the last 24 hours, so WhatsApp only allows an approved template message.
                  </p>
                  <select className="input" value={tplKey} onChange={(e) => { setTplKey(e.target.value); setTplParams([]); }}>
                    <option value="">Choose a template…</option>
                    {templates.map((t) => <option key={t.id} value={`${t.name}|${t.language}`}>{t.name} ({t.language})</option>)}
                  </select>
                  {Array.from({ length: nVars }).map((_, i) => (
                    <input key={i} className="input" placeholder={`Value for {{${i + 1}}}`} value={tplParams[i] || ''} onChange={(e) => { const p = [...tplParams]; p[i] = e.target.value; setTplParams(p); }} />
                  ))}
                  {selTpl && <div className="rounded-lg bg-slate-50 p-2 text-sm text-slate-600">{preview}</div>}
                  <button className="btn" disabled={sending || !selTpl || tplParams.filter(Boolean).length < nVars} onClick={send}>Send template</button>
                </div>
              ) : (
                <div className="space-y-2">
                  {file && tab === 'reply' && (
                    <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-sm">
                      <span>📎</span><span className="truncate">{file.name}</span>
                      <span className="text-xs text-slate-500">{(file.size / 1024).toFixed(0)} KB</span>
                      <button className="ml-auto text-slate-500 hover:text-red-600" aria-label="Remove attachment" onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ''; }}>✕</button>
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    {tab === 'reply' && (
                      <>
                        <input ref={fileInput} type="file" className="hidden" accept="image/jpeg,image/png,video/mp4,video/3gpp,audio/aac,audio/mp4,audio/mpeg,audio/amr,audio/ogg,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                        <button className="btn-ghost h-[42px] px-3" title="Attach image, video, audio or document" aria-label="Attach file" onClick={() => fileInput.current?.click()}>📎</button>
                      </>
                    )}
                    <textarea
                      className={`input resize-none ${tab === 'note' ? 'bg-amber-50' : ''}`}
                      rows={2}
                      placeholder={tab === 'note' ? 'Write an internal note (customer cannot see this)…' : file ? 'Add a caption (optional)…' : 'Type a reply…'}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if ((text.trim() || (file && tab === 'reply')) && !sending) send(); } }}
                    />
                    <button className="btn" disabled={sending || (!text.trim() && !(file && tab === 'reply'))} onClick={send}>{tab === 'note' ? 'Add note' : 'Send'}</button>
                  </div>
                </div>
              )}
              {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
