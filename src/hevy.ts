import type { CompactWorkout, Env, HevyEventsResponse, HevyWorkout, HevyWorkoutEvent } from './types';

const HEVY_API = 'https://api.hevyapp.com/v1';
const PAGE_SIZE = 10; // API maximum for the events endpoint

/** Strip a raw Hevy workout down to what the coach needs — drops IDs, URLs
 *  and null metrics so we don't waste prompt tokens. */
export function compactWorkout(w: HevyWorkout): CompactWorkout {
  const durationMs = new Date(w.end_time).getTime() - new Date(w.start_time).getTime();
  return {
    title: w.title,
    start_time: w.start_time,
    duration_minutes: Math.round(durationMs / 60000),
    exercises: w.exercises.map((ex) => ({
      name: ex.title,
      ...(ex.notes ? { notes: ex.notes } : {}),
      sets: ex.sets.map((s) => {
        const set: Record<string, number | string> = {};
        if (s.type !== 'normal') set.type = s.type;
        if (s.weight_kg != null) set.weight_kg = s.weight_kg;
        if (s.reps != null) set.reps = s.reps;
        if (s.distance_meters != null) set.distance_meters = s.distance_meters;
        if (s.duration_seconds != null) set.duration_seconds = s.duration_seconds;
        if (s.rpe != null) set.rpe = s.rpe;
        return set;
      }),
    })),
  };
}

/** Pick the workouts worth coaching from a batch of events: 'updated' events
 *  carrying a workout we haven't already seen. */
export function selectNewWorkouts(events: HevyWorkoutEvent[], seenIds: Set<string>): HevyWorkout[] {
  const result: HevyWorkout[] = [];
  for (const event of events) {
    const w = event.workout;
    if (event.type !== 'updated' || !w) continue;
    if (seenIds.has(w.id)) continue;
    seenIds.add(w.id); // a workout can appear in multiple events of one batch
    result.push(w);
  }
  return result;
}

async function fetchEventsPage(env: Env, since: string, page: number): Promise<HevyEventsResponse> {
  const url = `${HEVY_API}/workouts/events?since=${encodeURIComponent(since)}&page=${page}&pageSize=${PAGE_SIZE}`;
  const res = await fetch(url, { headers: { 'api-key': env.HEVY_API_KEY } });
  if (!res.ok) throw new Error(`Hevy events request failed (${res.status}): ${await res.text()}`);
  return res.json();
}

/** All workout events since the given watermark, across pages. */
export async function fetchEventsSince(env: Env, since: string): Promise<HevyWorkoutEvent[]> {
  const first = await fetchEventsPage(env, since, 1);
  const events = [...first.events];
  for (let page = 2; page <= first.page_count; page++) {
    events.push(...(await fetchEventsPage(env, since, page)).events);
  }
  return events;
}

/** Latest workout regardless of watermark — powers the /last chat command. */
export async function fetchLatestWorkout(env: Env): Promise<HevyWorkout | null> {
  const res = await fetch(`${HEVY_API}/workouts?page=1&pageSize=1`, {
    headers: { 'api-key': env.HEVY_API_KEY },
  });
  if (!res.ok) throw new Error(`Hevy workouts request failed (${res.status}): ${await res.text()}`);
  const data: { workouts: HevyWorkout[] } = await res.json();
  return data.workouts[0] ?? null;
}
