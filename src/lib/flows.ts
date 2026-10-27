import { HttpError } from './auth';

export type Step = {
  type: 'text' | 'template' | 'tag' | 'delay' | 'handoff' | 'ask';
  text?: string; name?: string; language?: string; params?: string[]; tag?: string; seconds?: number;
  branches?: { match?: string; button?: string; steps: Step[] }[];
  else_steps?: Step[];
};

const MAX_DEPTH = 4;
const MAX_STEPS = 60;

/** Validates + whitelists fields of a (possibly nested) step list. Throws HttpError(400) on bad input. */
export function cleanSteps(input: unknown, depth = 0, counter = { n: 0 }): Step[] {
  if (!Array.isArray(input)) throw new HttpError(400, 'steps must be a list');
  if (depth > MAX_DEPTH) throw new HttpError(400, `Branches can be nested at most ${MAX_DEPTH} levels deep`);
  return input.map((s: any): Step => {
    if (++counter.n > MAX_STEPS) throw new HttpError(400, `A flow can have at most ${MAX_STEPS} steps in total`);
    const str = (v: unknown, max: number) => String(v ?? '').slice(0, max);
    switch (s?.type) {
      case 'text': return { type: 'text', text: str(s.text, 1000) };
      case 'template': return {
        type: 'template', name: str(s.name, 200), language: str(s.language || 'en', 20),
        params: Array.isArray(s.params) ? s.params.slice(0, 20).map((p: unknown) => str(p, 200)) : [],
      };
      case 'tag': return { type: 'tag', tag: str(s.tag, 50) };
      case 'delay': return { type: 'delay', seconds: Math.max(1, Math.min(10, Number(s.seconds) || 2)) };
      case 'handoff': return { type: 'handoff' };
      case 'ask': {
        const branches = Array.isArray(s.branches) ? s.branches : [];
        if (branches.length > 10) throw new HttpError(400, 'A question can have at most 10 branches');
        // WhatsApp allows at most 3 reply buttons per message, so the limit is per question (not per flow).
        if (branches.filter((b: any) => String(b?.button ?? '').trim()).length > 3) throw new HttpError(400, 'A question can show at most 3 reply buttons');
        return {
          type: 'ask',
          text: str(s.text, 1000),
          branches: branches.map((b: any) => {
            return { match: str(b?.match, 300), button: str(b?.button, 20).trim(), steps: cleanSteps(b?.steps ?? [], depth + 1, counter) };
          }),
          else_steps: cleanSteps(s.else_steps ?? [], depth + 1, counter),
        };
      }
      default: throw new HttpError(400, `Unknown step type: ${s?.type}`);
    }
  });
}
