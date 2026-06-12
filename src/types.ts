export interface Env {
  COACH_KV: KVNamespace;
  // Secrets
  ANTHROPIC_API_KEY: string;
  HEVY_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  CRON_SECRET: string;
  // Vars
  ALLOWED_TELEGRAM_USER_ID: string;
  TELEGRAM_CHAT_ID: string;
  CLAUDE_MODEL: string;
  USER_TIMEZONE: string;
  REST_DAY_MESSAGES: string;
}

// ---- Hevy API ----

export interface HevySet {
  index: number;
  type: string;
  weight_kg: number | null;
  reps: number | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  rpe: number | null;
}

export interface HevyExercise {
  index: number;
  title: string;
  notes: string;
  sets: HevySet[];
}

export interface HevyWorkout {
  id: string;
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  exercises: HevyExercise[];
}

export interface HevyWorkoutEvent {
  type: 'updated' | 'deleted';
  workout?: HevyWorkout;
  id?: string; // present on deleted events
}

export interface HevyEventsResponse {
  page: number;
  page_count: number;
  events: HevyWorkoutEvent[];
}

/** Workout stripped down to what the coach needs (IDs and nulls removed). */
export interface CompactWorkout {
  title: string;
  start_time: string;
  duration_minutes: number;
  exercises: {
    name: string;
    notes?: string;
    sets: Record<string, number | string>[];
  }[];
}

// ---- Telegram ----

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string };
    chat: { id: number };
    text?: string;
  };
}

// ---- Memory ----

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  ts: string;
}
