// Pure helpers shared by the coach script and the unit tests.
// No I/O here so everything in this file is trivially testable.

export const CHUNK_LIMIT = 3900; // Telegram hard-limits at 4096; leave headroom.

/** Split a long message into Telegram-sized chunks, preferring paragraph
 *  breaks, then line breaks, then spaces, then a hard cut. */
export function chunkMessage(text, limit = CHUNK_LIMIT) {
  const chunks = [];
  let rest = text.trim();
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n\n', limit);
    if (cut < limit / 2) cut = rest.lastIndexOf('\n', limit);
    if (cut < limit / 2) cut = rest.lastIndexOf(' ', limit);
    if (cut < limit / 2) cut = limit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** Strip a raw Hevy workout to what the coach needs — drop IDs, URLs and
 *  null metrics so the prompt stays lean. */
export function compactWorkout(w) {
  const durationMs = new Date(w.end_time).getTime() - new Date(w.start_time).getTime();
  return {
    title: w.title,
    start_time: w.start_time,
    duration_minutes: Math.round(durationMs / 60000),
    exercises: w.exercises.map((ex) => ({
      name: ex.title,
      ...(ex.notes ? { notes: ex.notes } : {}),
      sets: ex.sets.map((s) => {
        const set = {};
        if (s.type && s.type !== 'normal') set.type = s.type;
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

/** Pick unseen 'updated' workouts from a batch of Hevy events. Mutates
 *  `seenIds` so a workout repeated within one batch is only returned once. */
export function selectNewWorkouts(events, seenIds) {
  const result = [];
  for (const event of events) {
    const w = event.workout;
    if (event.type !== 'updated' || !w) continue;
    if (seenIds.has(w.id)) continue;
    seenIds.add(w.id);
    result.push(w);
  }
  return result;
}

/** The daily check-in prompt wrapping freshly logged workouts. */
export function dailyPrompt(workouts) {
  const payload = JSON.stringify(workouts.length === 1 ? workouts[0] : workouts, null, 1);
  return (
    `[Automated daily check-in] I just finished training. Here is what I logged on Hevy today:\n\n` +
    `${payload}\n\n` +
    `Give me your coach feedback on this session.`
  );
}

export const REST_DAY_PROMPT =
  '[Automated daily check-in] No workout logged today. Send a brief rest-day check-in — recovery, food, anything we agreed I should do on off days. Keep it short.';
