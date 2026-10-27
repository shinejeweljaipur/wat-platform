/** Digits only, with country code. 10-digit numbers get the channel's default country code. */
export function normalizePhone(p: string, defaultCountry = '91'): string {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = defaultCountry + d;
  return d;
}

export function isValidPhone(d: string) {
  return /^\d{9,15}$/.test(d);
}

export function cleanTags(input: unknown): string[] {
  const arr = Array.isArray(input) ? input : String(input ?? '').split(',');
  return [...new Set(arr.map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function fill(s: string, c: { name?: string; phone?: string }) {
  return String(s || '')
    .replace(/\{\{\s*name\s*\}\}/gi, c.name || 'there')
    .replace(/\{\{\s*phone\s*\}\}/gi, c.phone || '');
}

export function countVars(body: string): number {
  const nums = [...String(body).matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}
