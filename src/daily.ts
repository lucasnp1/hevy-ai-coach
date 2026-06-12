import { coachReply, dailyPrompt, REST_DAY_PROMPT } from './coach';
import { compactWorkout, fetchEventsSince, selectNewWorkouts } from './hevy';
import { sendMessage } from './telegram';
import type { Env } from './types';

const WATERMARK_KEY = 'hevy:lastEventCheck';
const SEEN_TTL_SECONDS = 30 * 24 * 60 * 60; // workout edits re-emit events for a while

/** The daily check-in: find workouts logged since the last run, coach them,
 *  push the feedback to Telegram. Returns a small status object for the cron log. */
export async function runDailyCheckin(env: Env): Promise<{ workouts: number; sent: boolean }> {
  // Default watermark on first run: the past 24h.
  const since =
    (await env.COACH_KV.get(WATERMARK_KEY)) ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  // Capture BEFORE the request so events landing mid-run aren't skipped next time.
  const newWatermark = new Date().toISOString();

  const events = await fetchEventsSince(env, since);

  // Drop workouts we already coached (edits and re-syncs re-emit events).
  const seenIds = new Set<string>();
  for (const event of events) {
    const id = event.workout?.id;
    if (id && (await env.COACH_KV.get(`hevy:seen:${id}`))) seenIds.add(id);
  }
  const newWorkouts = selectNewWorkouts(events, seenIds);

  if (newWorkouts.length === 0) {
    if (env.REST_DAY_MESSAGES === 'true') {
      await sendMessage(env, env.TELEGRAM_CHAT_ID, await coachReply(env, REST_DAY_PROMPT));
      await env.COACH_KV.put(WATERMARK_KEY, newWatermark);
      return { workouts: 0, sent: true };
    }
    await env.COACH_KV.put(WATERMARK_KEY, newWatermark);
    return { workouts: 0, sent: false };
  }

  const reply = await coachReply(env, dailyPrompt(newWorkouts.map(compactWorkout)));
  await sendMessage(env, env.TELEGRAM_CHAT_ID, reply);

  // Only mark progress after the message actually went out, so a failed run
  // self-heals on the next cron tick.
  for (const w of newWorkouts) {
    await env.COACH_KV.put(`hevy:seen:${w.id}`, '1', { expirationTtl: SEEN_TTL_SECONDS });
  }
  await env.COACH_KV.put(WATERMARK_KEY, newWatermark);

  return { workouts: newWorkouts.length, sent: true };
}
