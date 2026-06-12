import { describe, expect, it } from 'vitest';
import { compactWorkout, selectNewWorkouts } from '../src/hevy';
import type { HevyWorkout, HevyWorkoutEvent } from '../src/types';

const workout = (id: string): HevyWorkout => ({
  id,
  title: 'Limbs B',
  description: '',
  start_time: '2026-06-12T05:45:49+00:00',
  end_time: '2026-06-12T07:58:30+00:00',
  exercises: [
    {
      index: 0,
      title: 'Straight Leg Deadlift',
      notes: 'Back today is very bad',
      sets: [
        { index: 0, type: 'normal', weight_kg: 145, reps: 3, distance_meters: null, duration_seconds: null, rpe: null },
        { index: 1, type: 'failure', weight_kg: 130, reps: 1, distance_meters: null, duration_seconds: null, rpe: 8 },
      ],
    },
    {
      index: 1,
      title: 'Walking',
      notes: '',
      sets: [
        { index: 0, type: 'normal', weight_kg: null, reps: null, distance_meters: 4860, duration_seconds: 3600, rpe: null },
      ],
    },
  ],
});

describe('compactWorkout', () => {
  const compact = compactWorkout(workout('w1'));

  it('computes duration and keeps the essentials', () => {
    expect(compact.title).toBe('Limbs B');
    expect(compact.duration_minutes).toBe(133);
    expect(compact.exercises[0].name).toBe('Straight Leg Deadlift');
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
  const events: HevyWorkoutEvent[] = [
    { type: 'updated', workout: workout('a') },
    { type: 'updated', workout: workout('a') }, // same workout edited twice in one batch
    { type: 'updated', workout: workout('b') },
    { type: 'deleted', id: 'c' },
  ];

  it('returns unseen updated workouts once each', () => {
    expect(selectNewWorkouts(events, new Set()).map((w) => w.id)).toEqual(['a', 'b']);
  });

  it('skips workouts already coached', () => {
    expect(selectNewWorkouts(events, new Set(['a'])).map((w) => w.id)).toEqual(['b']);
  });

  it('ignores deleted events', () => {
    expect(selectNewWorkouts([{ type: 'deleted', id: 'x' }], new Set())).toEqual([]);
  });
});
