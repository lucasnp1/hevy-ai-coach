import Anthropic from '@anthropic-ai/sdk';
import type { ConversationTurn, Env } from './types';

// Fold the conversation into long-term case notes past this many turns…
const MAX_TURNS = 30;
// …keeping the most recent ones verbatim.
const KEEP_TURNS = 10;

const KEYS = {
  profile: 'profile',
  summary: 'memory:summary',
  conversation: 'memory:conversation',
  bodyweight: 'bodyweight',
} as const;

export async function getProfile(env: Env): Promise<string> {
  return (await env.COACH_KV.get(KEYS.profile)) ?? '(no profile set yet — ask the athlete about goals, training history and injuries)';
}

/** Only explicit /remember writes touch the profile — it is never run through
 *  summarization, so medical facts can't get mangled. */
export async function appendToProfile(env: Env, fact: string): Promise<void> {
  const current = (await env.COACH_KV.get(KEYS.profile)) ?? '';
  const date = new Date().toISOString().slice(0, 10);
  await env.COACH_KV.put(KEYS.profile, `${current.trimEnd()}\n- (${date}) ${fact}\n`);
}

export async function getSummary(env: Env): Promise<string> {
  return (await env.COACH_KV.get(KEYS.summary)) ?? '(no case notes yet)';
}

export async function getConversation(env: Env): Promise<ConversationTurn[]> {
  return (await env.COACH_KV.get<ConversationTurn[]>(KEYS.conversation, 'json')) ?? [];
}

export async function clearConversation(env: Env): Promise<void> {
  await env.COACH_KV.delete(KEYS.conversation);
}

export async function appendBodyweight(env: Env, kg: number): Promise<number> {
  const log = (await env.COACH_KV.get<{ date: string; kg: number }[]>(KEYS.bodyweight, 'json')) ?? [];
  log.push({ date: new Date().toISOString().slice(0, 10), kg });
  await env.COACH_KV.put(KEYS.bodyweight, JSON.stringify(log));
  return log.length;
}

export async function getBodyweightLog(env: Env): Promise<{ date: string; kg: number }[]> {
  return (await env.COACH_KV.get<{ date: string; kg: number }[]>(KEYS.bodyweight, 'json')) ?? [];
}

/** Persist an exchange, folding old turns into the long-term summary when the
 *  conversation grows past MAX_TURNS. */
export async function saveExchange(
  env: Env,
  userContent: string,
  assistantContent: string,
): Promise<void> {
  const ts = new Date().toISOString();
  const turns = await getConversation(env);
  turns.push({ role: 'user', content: userContent, ts });
  turns.push({ role: 'assistant', content: assistantContent, ts });

  if (turns.length > MAX_TURNS) {
    const toFold = turns.slice(0, turns.length - KEEP_TURNS);
    const kept = turns.slice(turns.length - KEEP_TURNS);
    try {
      const summary = await summarize(env, await getSummary(env), toFold);
      await env.COACH_KV.put(KEYS.summary, summary);
      await env.COACH_KV.put(KEYS.conversation, JSON.stringify(kept));
      return;
    } catch (err) {
      // Folding is an optimization — never lose the actual exchange over it.
      console.error('summary fold failed, keeping full conversation', err);
    }
  }
  await env.COACH_KV.put(KEYS.conversation, JSON.stringify(turns));
}

async function summarize(env: Env, previousSummary: string, turns: ConversationTurn[]): Promise<string> {
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const transcript = turns.map((t) => `${t.role === 'user' ? 'Athlete' : 'Coach'} (${t.ts.slice(0, 10)}): ${t.content}`).join('\n\n');
  const response = await anthropic.messages.create({
    model: env.CLAUDE_MODEL,
    max_tokens: 1000,
    system:
      'You maintain a strength coach\'s case notes about one athlete. Update the notes with new information from the conversation below: training decisions made, plan changes, recurring issues, diet agreements, injury status, PRs. Keep them under 400 words, written as terse bullet points. Drop stale details, keep anything still actionable. Return ONLY the updated notes.',
    messages: [
      {
        role: 'user',
        content: `Current case notes:\n${previousSummary}\n\nConversation to fold in:\n${transcript}`,
      },
    ],
  });
  const block = response.content[0];
  if (block.type !== 'text') throw new Error('unexpected summary response type');
  return block.text;
}
