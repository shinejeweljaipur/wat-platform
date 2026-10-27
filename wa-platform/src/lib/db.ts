import { Pool } from 'pg';
import { SCHEMA } from './schema';
import { hashPassword } from './password';
import { encryptSecret, isEncrypted } from './crypto';

export type Row = Record<string, any>;

const g = globalThis as any;

export const pool: Pool = (g.__waPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 10 }));

async function init() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  await pool.query(SCHEMA);

  const { rows } = await pool.query('SELECT count(*)::int AS c FROM users');
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const pw = process.env.ADMIN_PASSWORD;
  if (rows[0].c === 0 && email && pw) {
    await pool.query('INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [
      'Admin',
      email,
      await hashPassword(pw),
      'admin',
    ]);
  }

  // Encrypt any secrets still stored as plain text (from older versions).
  const chans = await pool.query('SELECT id, access_token, shopify_secret FROM channels');
  for (const c of chans.rows) {
    if ((c.access_token && !isEncrypted(c.access_token)) || (c.shopify_secret && !isEncrypted(c.shopify_secret))) {
      await pool.query('UPDATE channels SET access_token=$2, shopify_secret=$3 WHERE id=$1', [c.id, encryptSecret(c.access_token), encryptSecret(c.shopify_secret)]);
    }
  }

  // Rows left in "sending" by a crash/restart may or may not have gone out. Don't risk a duplicate send.
  await pool.query("UPDATE campaign_recipients SET status='failed', error='Interrupted by restart' WHERE status='sending'");
  await pool.query("UPDATE scheduled_messages SET status='failed', error='Interrupted by restart' WHERE status='sending'");
}

export function ready(): Promise<void> {
  if (!g.__waReady) {
    g.__waReady = init().catch((e) => {
      g.__waReady = undefined; // allow retry on next call
      throw e;
    });
  }
  return g.__waReady;
}

export async function q<T = Row>(text: string, params: any[] = []): Promise<T[]> {
  await ready();
  const r = await pool.query(text, params);
  return r.rows as T[];
}

export async function q1<T = Row>(text: string, params: any[] = []): Promise<T | null> {
  return (await q<T>(text, params))[0] ?? null;
}
