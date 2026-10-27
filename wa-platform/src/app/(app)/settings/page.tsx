'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { useApp, Channel } from '@/components/Shell';

function ChannelCard({ ch, admin, onChanged }: { ch: Channel; admin: boolean; onChanged: () => void }) {
  const [f, setF] = useState({
    name: ch.name, phone_number_id: ch.phone_number_id || '', waba_id: ch.waba_id, default_country: ch.default_country,
    template_language: ch.template_language, access_token: '', shopify_secret: '',
  });
  const [msg, setMsg] = useState('');
  const [sim, setSim] = useState({ phone: '9999900000', text: 'Hi, I want to track my order' });

  async function save() {
    setMsg('');
    try { await api(`/api/channels/${ch.id}`, { method: 'PATCH', body: f }); setF({ ...f, access_token: '', shopify_secret: '' }); onChanged(); setMsg('Saved'); } catch (e: any) { setMsg(e.message); }
  }
  async function del() {
    if (!confirm(`Delete ${ch.name}? This permanently deletes its contacts, chats, campaigns and flows.`)) return;
    try { await api(`/api/channels/${ch.id}`, { method: 'DELETE' }); onChanged(); } catch (e: any) { setMsg(e.message); }
  }
  async function simulate() {
    setMsg('');
    try { await api('/api/simulate', { body: { channel: ch.id, ...sim } }); setMsg('Simulated message received. Open Inbox.'); } catch (e: any) { setMsg(e.message); }
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{ch.name}</h3>
        <span className={`badge ${ch.live ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{ch.live ? 'Live' : 'Test mode (nothing is sent to WhatsApp)'}</span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <div><label className="label">Brand name</label><input className="input" value={f.name} onChange={set('name')} disabled={!admin} /></div>
        <div><label className="label">Phone Number ID</label><input className="input" value={f.phone_number_id} onChange={set('phone_number_id')} disabled={!admin} /></div>
        <div><label className="label">WhatsApp Business Account ID</label><input className="input" value={f.waba_id} onChange={set('waba_id')} disabled={!admin} /></div>
        <div><label className="label">Access token {ch.has_token && <span className="text-green-700">✓ set</span>}</label><input className="input" type="password" autoComplete="off" placeholder={ch.has_token ? 'Leave blank to keep current' : 'Permanent system-user token'} value={f.access_token} onChange={set('access_token')} disabled={!admin} /></div>
        <div><label className="label">Shopify signing secret {ch.has_shopify_secret && <span className="text-green-700">✓ set</span>}</label><input className="input" type="password" autoComplete="off" placeholder={ch.has_shopify_secret ? 'Leave blank to keep current' : 'Optional'} value={f.shopify_secret} onChange={set('shopify_secret')} disabled={!admin} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">Default country code</label><input className="input" value={f.default_country} onChange={set('default_country')} disabled={!admin} /></div>
          <div><label className="label">Template language</label><input className="input" value={f.template_language} onChange={set('template_language')} disabled={!admin} /></div>
        </div>
      </div>
      {admin && (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" onClick={save}>Save</button>
          <button className="btn-danger" onClick={del}>Delete channel</button>
          {msg && <span className="text-sm text-slate-500">{msg}</span>}
        </div>
      )}
      {!ch.live && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <div className="text-xs font-medium text-slate-500">Test: pretend a customer sent a message</div>
          <div className="flex flex-wrap gap-2">
            <input className="input w-40" value={sim.phone} onChange={(e) => setSim({ ...sim, phone: e.target.value })} />
            <input className="input min-w-[12rem] flex-1" value={sim.text} onChange={(e) => setSim({ ...sim, text: e.target.value })} />
            <button className="btn-ghost" onClick={simulate}>Simulate</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const { user, channels, reload, setChannelId } = useApp();
  const admin = user.role === 'admin';
  const [origin, setOrigin] = useState('');
  const [team, setTeam] = useState<any[]>([]);
  const [nf, setNf] = useState({ name: '', phone_number_id: '', waba_id: '', access_token: '', default_country: '91' });
  const [tf, setTf] = useState({ name: '', email: '', password: '', role: 'agent' });
  const [err, setErr] = useState('');

  const loadTeam = () => api('/api/team').then((d) => setTeam(d.users)).catch(() => {});
  useEffect(() => { setOrigin(window.location.origin); loadTeam(); }, []);

  async function addChannel(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    try {
      const d = await api('/api/channels', { body: nf });
      setNf({ name: '', phone_number_id: '', waba_id: '', access_token: '', default_country: '91' });
      await reload(); setChannelId(d.id);
    } catch (e: any) { setErr(e.message); }
  }
  async function addUser(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    try { await api('/api/team', { body: tf }); setTf({ name: '', email: '', password: '', role: 'agent' }); loadTeam(); } catch (e: any) { setErr(e.message); }
  }
  async function removeUser(id: number) {
    if (!confirm('Remove this team member?')) return;
    try { await api(`/api/team?id=${id}`, { method: 'DELETE' }); loadTeam(); } catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      {err && <p className="text-sm text-red-600">{err}</p>}

      <section className="space-y-3">
        <h2 className="font-medium">WhatsApp numbers (one per brand)</h2>
        <div className="card space-y-1 text-sm text-slate-600">
          <div>In <b>Meta App Dashboard → WhatsApp → Configuration → Webhook</b> set:</div>
          <div>Callback URL: <code className="break-all rounded bg-slate-100 px-1.5 py-0.5 text-xs">{origin}/api/webhook/whatsapp</code></div>
          <div>Verify token: the value of <code>WA_VERIFY_TOKEN</code> in your server environment.</div>
          <div>Subscribe to the fields <code>messages</code> and <code>message_template_status_update</code>.</div>
        </div>
        {channels.map((c) => <ChannelCard key={`${c.id}-${c.has_token}-${c.has_shopify_secret}`} ch={c} admin={admin} onChanged={reload} />)}
        {admin && (
          <form onSubmit={addChannel} className="card space-y-3">
            <h3 className="font-medium">Add a brand / number</h3>
            <p className="text-xs text-slate-500">Leave Phone Number ID and token empty to start in test mode, then fill them in when you’re ready to go live.</p>
            <div className="grid gap-2 md:grid-cols-2">
              <input className="input" placeholder="Brand name (e.g. Shine Jewel)" value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} required />
              <input className="input" placeholder="Default country code (91 India, 1 US)" value={nf.default_country} onChange={(e) => setNf({ ...nf, default_country: e.target.value })} />
              <input className="input" placeholder="Phone Number ID" value={nf.phone_number_id} onChange={(e) => setNf({ ...nf, phone_number_id: e.target.value })} />
              <input className="input" placeholder="WhatsApp Business Account ID" value={nf.waba_id} onChange={(e) => setNf({ ...nf, waba_id: e.target.value })} />
              <input className="input md:col-span-2" type="password" autoComplete="off" placeholder="Access token" value={nf.access_token} onChange={(e) => setNf({ ...nf, access_token: e.target.value })} />
            </div>
            <button className="btn">Add</button>
          </form>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Team</h2>
        <div className="card p-0">
          {team.map((u) => (
            <div key={u.id} className="flex items-center justify-between border-b border-slate-100 px-4 py-2 last:border-0">
              <div><div className="text-sm font-medium">{u.name} <span className="badge ml-1">{u.role}</span></div><div className="text-xs text-slate-500">{u.email}</div></div>
              {admin && u.id !== user.id && <button className="btn-danger" onClick={() => removeUser(u.id)}>Remove</button>}
            </div>
          ))}
        </div>
        {admin && (
          <form onSubmit={addUser} className="card space-y-3">
            <h3 className="font-medium">Add team member</h3>
            <div className="grid gap-2 md:grid-cols-2">
              <input className="input" placeholder="Name" value={tf.name} onChange={(e) => setTf({ ...tf, name: e.target.value })} required />
              <input className="input" type="email" placeholder="Email" value={tf.email} onChange={(e) => setTf({ ...tf, email: e.target.value })} required />
              <input className="input" type="password" autoComplete="new-password" placeholder="Password (min 8 characters)" value={tf.password} onChange={(e) => setTf({ ...tf, password: e.target.value })} required />
              <select className="input" value={tf.role} onChange={(e) => setTf({ ...tf, role: e.target.value })}><option value="agent">Agent</option><option value="admin">Admin</option></select>
            </div>
            <button className="btn">Add member</button>
          </form>
        )}
      </section>
    </div>
  );
}
