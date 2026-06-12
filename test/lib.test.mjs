import { describe, expect, it } from 'vitest';
import { chunkMessage, compactWorkout, dailyPrompt, selectNewWorkouts } from '../scripts/lib.mjs';

const workout = (id) => ({
  id,
  title: 'Limbs B',
  start_time: '2026-06-12T05:45:49+00:00',
  end_time: '2026-06-12T07:58:30+00:00',
  exercises: [
    {
      index: 0,
      title: 'Straight Leg Deadlift',
      notes: 'Back today is very bad',
      sets: [
        { type: 'normal', weight_kg: 145, reps: 3, distance_meters: null, duration_seconds: null, rpe: null },
        { type: 'failure', weight_kg: 130, reps: 1, distance_meters: null, duration_seconds: null, rpe: 8 },
      ],
    },
    {
      index: 1,
      title: 'Walking',
      notes: '',
      sets: [{ type: 'normal', weight_kg: null, reps: null, distance_meters: 4860, duration_seconds: 3600, rpe: null }],
    },
  ],
});

describe('chunkMessage', () => {
  it('returns short messages unchanged', () => {
    expect(chunkMessage('hello coach')).toEqual(['hello coach']);
  });
  it('splits long messages at paragraph boundaries, under the limit', () => {
    const para = 'A'.repeat(2000);
    const chunks = chunkMessage(`${para}\n\n${para}\n\n${para}`);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(3900);
      expect(c.startsWith('A')).toBe(true);
    }
    expect(chunks.join('')).toHaveLength(6000);
  });
  it('hard-cuts text with no break points', () => {
    expect(chunkMessage('B'.repeat(9000)).map((c) => c.length)).toEqual([3900, 3900, 1200]);
  });
  it('never exceeds the Telegram hard limit', () => {
    const messy = `${'word '.repeat(1500)}\n${'word '.repeat(1500)}`;
    for (const c of chunkMessage(messy)) expect(c.length).toBeLessThanOrEqual(4096);
  });
});

describe('compactWorkout', () => {
  const compact = compactWorkout(workout('w1'));
  it('computes duration and keeps essentials', () => {
    expect(compact.title).toBe('Limbs B');
    expect(compact.duration_minutes).toBe(133);
    expect(compact.exercises[0].notes).toBe('Back today is very bad');
  });
  it('drops null metrics, ids and empty notes', () => {
    expect(compact.exercises[0].sets[0]).toEqual({ weight_kg: 145, reps: 3 });
    expect(compact.exercises[0].sets[1]).toEqual({ type: 'failure', weight_kg: 130, reps: 1, rpe: 8 });
    expect(compact.exercises[1].notes).toBeUndefined();
    expect(JSON.stringify(compact)).not.toContain('"id"');
  });
  it('keeps cardio metrics', () => {
    expect(compact.exercises[1].sets[0]).toEqual({ distance_meters: 4860, duration_seconds: 3600 });
  });
});

describe('selectNewWorkouts', () => {
  const events = [
    { type: 'updated', workout: workout('a') },
    { type: 'updated', workout: workout('a') },
    { type: 'updated', workout: workout('b') },
    { type: 'deleted', id: 'c' },
  ];
  it('returns unseen updated workouts once each', () => {
    expect(selectNewWorkouts(events, new Set()).map((w) => w.id)).toEqual(['a', 'b']);
  });
  it('skips already-coached workouts', () => {
    expect(selectNewWorkouts(events, new Set(['a'])).map((w) => w.id)).toEqual(['b']);
  });
  it('ignores deleted events', () => {
    expect(selectNewWorkouts([{ type: 'deleted', id: 'x' }], new Set())).toEqual([]);
  });
});

describe('dailyPrompt', () => {
  it('wraps a single workout without an array', () => {
    const p = dailyPrompt([compactWorkout(workout('a'))]);
    expect(p).toContain('"title": "Limbs B"');
    expect(p.trimStart().startsWith('[Automated daily check-in]')).toBe(true);
  });
});
