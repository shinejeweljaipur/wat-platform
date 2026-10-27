'use client';
import { useRef, useState } from 'react';
import { api, usePoll } from '@/lib/client';
import { useApp } from '@/components/Shell';

type C = { id: number; phone: string; name: string; email: string; tags: string[]; opted_in: boolean };

/** Minimal CSV parser (handles quoted fields and commas inside quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

export default function Contacts() {
  const { channel } = useApp();
  const cid = channel!.id;
  const [list, setList] = useState<C[]>([]);
  const [stats, setStats] = useState({ total: 0, opted_in: 0 });
  const [tags, setTags] = useState<{ tag: string; n: number }[]>([]);
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', tags: '', opted_in: false });
  const [consent, setConsent] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const load = async () => {
    const d = await api(`/api/contacts?channel=${cid}&q=${encodeURIComponent(search)}&tag=${encodeURIComponent(tag)}`);
    setList(d.contacts); setStats(d.stats); setTags(d.tags);
  };
  usePoll(load, 15000, [cid, search, tag]);

  async function add(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('');
    try {
      await api(`/api/contacts?channel=${cid}`, { body: form });
      setForm({ name: '', phone: '', tags: '', opted_in: false });
      setMsg('Contact saved'); await load();
    } catch (e: any) { setErr(e.message); }
  }

  async function importCsv(f: File) {
    setErr(''); setMsg('');
    try {
      const rows = parseCsv(await f.text());
      if (rows.length < 2) throw new Error('CSV needs a header row and at least one contact');
      const head = rows[0].map((h) => h.trim().toLowerCase());
      const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.includes(n)));
      const iPhone = col('phone', 'mobile', 'whatsapp', 'number');
      if (iPhone < 0) throw new Error('No phone column found. Name the column "phone".');
      const iName = col('name'), iEmail = col('email'), iTags = col('tag');
      const contacts = rows.slice(1).map((r) => ({
        phone: r[iPhone], name: iName >= 0 ? r[iName] : '', email: iEmail >= 0 ? r[iEmail] : '', tags: iTags >= 0 ? r[iTags] : '',
        opted_in: consent,
      }));
      const d = await api(`/api/contacts?channel=${cid}`, { body: { contacts } });
      setMsg(`Imported ${d.added} contacts${d.skipped ? `, skipped ${d.skipped} invalid` : ''}.${d.errors?.length ? ' ' + d.errors.slice(0, 3).join('; ') : ''}`);
      await load();
    } catch (e: any) { setErr(e.message); }
    if (file.current) file.current.value = '';
  }

  async function update(id: number, body: any) {
    try { await api(`/api/contacts/${id}`, { method: 'PATCH', body }); await load(); } catch (e: any) { setErr(e.message); }
  }
  async function remove(id: number) {
    if (!confirm('Delete this contact and their chat history?')) return;
    try { await api(`/api/contacts/${id}`, { method: 'DELETE' }); await load(); } catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Contacts</h1>
          <p className="text-sm text-slate-500">{stats.total} total · {stats.opted_in} opted in for marketing</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <form onSubmit={add} className="card space-y-3">
          <h2 className="font-medium">Add contact</h2>
          <div className="grid grid-cols-2 gap-2">
            <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" placeholder={`Phone (+${channel!.default_country} default)`} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
          </div>
          <input className="input" placeholder="Tags, comma separated (e.g. vip, jaipur)" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={form.opted_in} onChange={(e) => setForm({ ...form, opted_in: e.target.checked })} />
            <span>This person agreed to receive WhatsApp marketing messages</span>
          </label>
          <button className="btn">Save contact</button>
        </form>

        <div className="card space-y-3">
          <h2 className="font-medium">Import CSV</h2>
          <p className="text-xs text-slate-500">Columns: <code>phone</code> (required), <code>name</code>, <code>email</code>, <code>tags</code>.</p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>Everyone in this file agreed to receive WhatsApp marketing messages. (If unchecked, they’re imported but can’t be added to broadcasts.)</span>
          </label>
          <input ref={file} type="file" accept=".csv,text/csv" className="text-sm" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
        </div>
      </div>

      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="card space-y-3 p-0">
        <div className="flex flex-wrap gap-2 border-b border-slate-200 p-3">
          <input className="input max-w-xs" placeholder="Search name, phone, email" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="input w-auto" value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">All tags</option>
            {tags.map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({t.n})</option>)}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Phone</th><th className="px-3 py-2">Tags</th><th className="px-3 py-2">Opted in</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{c.name || <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2">+{c.phone}</td>
                  <td className="px-3 py-2">
                    <input
                      className="w-40 rounded border border-transparent px-1 py-0.5 text-xs hover:border-slate-300 focus:border-brand focus:outline-none"
                      defaultValue={c.tags.join(', ')}
                      placeholder="add tags"
                      onBlur={(e) => { if (e.target.value !== c.tags.join(', ')) update(c.id, { tags: e.target.value }); }}
                    />
                  </td>
                  <td className="px-3 py-2"><input type="checkbox" checked={c.opted_in} onChange={(e) => update(c.id, { opted_in: e.target.checked })} aria-label="Opted in" /></td>
                  <td className="px-3 py-2 text-right"><button className="text-xs text-red-600 hover:underline" onClick={() => remove(c.id)}>Delete</button></td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">No contacts yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
