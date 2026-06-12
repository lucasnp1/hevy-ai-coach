import Anthropic from '@anthropic-ai/sdk';
// Bundled as a text module via the `rules` entry in wrangler.toml.
import PERSONA from '../persona/coach.md';
import { getConversation, getProfile, getSummary, saveExchange } from './memory';
import type { CompactWorkout, Env } from './types';

const MAX_REPLY_TOKENS = 1200;

/** One coach turn: assemble persona + private profile + case notes + recent
 *  conversation, call Claude, persist the exchange. Returns the reply text. */
export async function coachReply(env: Env, userContent: string): Promise<string> {
  const [profile, summary, conversation] = await Promise.all([
    getProfile(env),
    getSummary(env),
    getConversation(env),
  ]);

  const today = new Date().toLocaleDateString('en-CA', { timeZone: env.USER_TIMEZONE });
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const response = await anthropic.messages.create({
    model: env.CLAUDE_MODEL,
    max_tokens: MAX_REPLY_TOKENS,
    system: [
      // Stable → volatile ordering so the prefix stays cacheable.
      { type: 'text', text: PERSONA },
      {
        type: 'text',
        text:
          `<athlete_profile>\n${profile}\n</athlete_profile>\n\n` +
          `<case_notes>\n${summary}\n</case_notes>\n\n` +
          `Today's date for the athlete: ${today}`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      ...conversation.map((t) => ({ role: t.role, content: t.content })),
      { role: 'user', content: userContent },
    ],
  });

  const reply = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  if (!reply) throw new Error('empty coach reply');

  await saveExchange(env, userContent, reply);
  return reply;
}

/** The daily check-in prompt wrapping freshly logged workouts. */
export function dailyPrompt(workouts: CompactWorkout[]): string {
  const payload = JSON.stringify(workouts.length === 1 ? workouts[0] : workouts, null, 1);
  return (
    `[Automated daily check-in] I just finished training. Here is what I logged on Hevy today:\n\n` +
    `${payload}\n\n` +
    `Give me your coach feedback on this session.`
  );
}

/** Rest-day variant, sent only when REST_DAY_MESSAGES is enabled. */
export const REST_DAY_PROMPT =
  '[Automated daily check-in] No workout logged today. Send a brief rest-day check-in — recovery, food, anything we agreed I should be doing on off days. Keep it short.';
