'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/client';

export type Channel = {
  id: number; name: string; phone_number_id: string | null; waba_id: string; default_country: string; template_language: string;
  tpl_order: string; tpl_cod: string; tpl_cart: string; tpl_shipped: string; cart_delay_min: number;
  live: boolean; has_token: boolean; has_shopify_secret: boolean;
};
export type User = { id: number; name: string; email: string; role: string };
type Ctx = { user: User; channels: Channel[]; channel: Channel | null; setChannelId: (id: number) => void; reload: () => Promise<void> };

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

const NAV = [
  { href: '/inbox', label: 'Inbox', icon: '💬' },
  { href: '/contacts', label: 'Contacts', icon: '👥' },
  { href: '/campaigns', label: 'Campaigns', icon: '📣' },
  { href: '/templates', label: 'Templates', icon: '📝' },
  { href: '/automations', label: 'Automations', icon: '⚡' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [state, setState] = useState<{ user: User; channels: Channel[] } | null>(null);
  const [channelId, setCid] = useState<number | null>(null);

  const reload = useCallback(async () => {
    const d = await api<{ user: User; channels: Channel[] }>('/api/me');
    setState(d);
    setCid((cur) => {
      if (cur && d.channels.some((c) => c.id === cur)) return cur;
      let saved: number | null = null;
      try { saved = Number(localStorage.getItem('channel')) || null; } catch { /* ignore */ }
      return d.channels.find((c) => c.id === saved)?.id ?? d.channels[0]?.id ?? null;
    });
  }, []);

  useEffect(() => { reload().catch(() => {}); }, [reload]);

  const setChannelId = (id: number) => {
    setCid(id);
    try { localStorage.setItem('channel', String(id)); } catch { /* ignore */ }
  };

  if (!state) return <div className="p-8 text-sm text-slate-500">Loading…</div>;
  const channel = state.channels.find((c) => c.id === channelId) ?? null;

  async function logout() {
    await api('/api/logout', { method: 'POST', body: {} });
    window.location.href = '/login';
  }

  return (
    <AppCtx.Provider value={{ user: state.user, channels: state.channels, channel, setChannelId, reload }}>
      <div className="flex h-screen flex-col md:flex-row">
        <aside className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-2 md:w-56 md:flex-col md:items-stretch md:gap-0 md:overflow-visible md:border-b-0 md:border-r md:px-3 md:py-4">
          <div className="hidden px-2 pb-3 text-lg font-semibold text-brand-dark md:block">WA Platform</div>
          {state.channels.length > 0 && (
            <select
              className="input mr-2 w-auto min-w-[8rem] shrink-0 md:mb-3 md:mr-0 md:w-full"
              value={channel?.id ?? ''}
              onChange={(e) => setChannelId(Number(e.target.value))}
              aria-label="Brand / WhatsApp number"
            >
              {state.channels.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.live ? '' : ' (test)'}</option>
              ))}
            </select>
          )}
          <nav className="flex gap-1 md:flex-col">
            {NAV.map((n) => {
              const active = path.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${active ? 'bg-brand/10 text-brand-dark' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  <span>{n.icon}</span>
                  <span>{n.label}</span>
                </Link>
              );
            })}
          </nav>
          <button onClick={logout} className="ml-auto shrink-0 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 md:hidden">Sign out</button>
          <div className="ml-auto hidden border-t border-slate-200 pt-3 md:mt-auto md:block">
            <div className="truncate px-2 text-xs text-slate-500">{state.user.name} · {state.user.role}</div>
            <button onClick={logout} className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-100">Sign out</button>
          </div>
        </aside>
        <main className="min-h-0 flex-1 overflow-auto">
          {channel ? (
            children
          ) : path.startsWith('/settings') ? (
            children
          ) : (
            <div className="p-8">
              <div className="card max-w-md">
                <p className="mb-3 text-sm">No WhatsApp number connected yet. Add your first brand/number in Settings.</p>
                <Link href="/settings" className="btn">Go to Settings</Link>
              </div>
            </div>
          )}
        </main>
      </div>
    </AppCtx.Provider>
  );
}
