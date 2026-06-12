// The coach's brain. Run by GitHub Actions (or locally) — never inside the
// Worker, so the only thing that ever calls Claude is Claude Code itself,
// authenticated with your subscription token.
//
//   node scripts/coach.mjs daily          # check for new workouts, coach them
//   node scripts/coach.mjs chat           # reply to one Telegram message
//                                         # (CHAT_TEXT / CHAT_ID from env)
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chunkMessage, compactWorkout, dailyPrompt, REST_DAY_PROMPT, selectNewWorkouts } from './lib.mjs';
import { getState, putState } from './state.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HEVY_API = 'https://api.hevyapp.com/v1';
const TELEGRAM = 'https://api.telegram.org';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const TZ = process.env.USER_TIMEZONE || 'UTC';
const MAX_TURNS = 30; // fold conversation into case notes past this many turns…
const KEEP_TURNS = 10; // …keeping the most recent verbatim.
const SEEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ---- Claude (headless Claude Code) ----

/** One Claude call via the `claude` CLI in print mode. Uses the ambient
 *  CLAUDE_CODE_OAUTH_TOKEN / logged-in session — no API key. */
function askClaude(systemPrompt, userPrompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      ['-p', '--model', MODEL, '--output-format', 'json', '--append-system-prompt', systemPrompt],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.slice(0, 500)}`));
      try {
        const parsed = JSON.parse(out);
        const text = parsed.result ?? parsed.text;
        if (!text) throw new Error('no result field');
        resolve(text.trim());
      } catch (e) {
        reject(new Error(`could not parse claude output: ${e.message}\n${out.slice(0, 500)}`));
      }
    });
    child.stdin.end(userPrompt);
  });
}

async function buildSystemPrompt() {
  const persona = await readFile(join(HERE, '..', 'persona', 'coach.md'), 'utf8');
  const profile = (await getState('profile')) ?? '(no profile yet — ask about goals, history and injuries)';
  const memory = (await getState('memory')) ?? { summary: '(no case notes yet)', conversation: [] };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const system =
    `${persona}\n\n` +
    `Do not use any tools — just reply as the coach in plain text (no markdown).\n\n` +
    `<athlete_profile>\n${profile}\n</athlete_profile>\n\n` +
    `<case_notes>\n${memory.summary}\n</case_notes>\n\n` +
    `Today's date for the athlete: ${today}`;
  return { system, memory };
}

/** Render recent conversation as a plain-text preamble for the user prompt,
 *  since print mode is single-shot. */
function historyPreamble(conversation) {
  if (!conversation.length) return '';
  const lines = conversation
    .map((t) => `${t.role === 'user' ? 'Athlete' : 'Coach'}: ${t.content}`)
    .join('\n\n');
  return `Recent conversation so far:\n${lines}\n\n---\n\n`;
}

/** Core turn: assemble context, call Claude, persist memory (folding old turns
 *  into the summary when it grows). Returns the reply text. */
async function coachTurn(userContent) {
  const { system, memory } = await buildSystemPrompt();
  const reply = await askClaude(system, historyPreamble(memory.conversation) + userContent);

  const ts = new Date().toISOString();
  memory.conversation.push({ role: 'user', content: userContent, ts });
  memory.conversation.push({ role: 'assistant', content: reply, ts });

  if (memory.conversation.length > MAX_TURNS) {
    const toFold = memory.conversation.slice(0, memory.conversation.length - KEEP_TURNS);
    try {
      memory.summary = await foldSummary(memory.summary, toFold);
      memory.conversation = memory.conversation.slice(memory.conversation.length - KEEP_TURNS);
    } catch (e) {
      console.error('summary fold failed, keeping full conversation:', e.message);
    }
  }
  await putState('memory', memory);
  return reply;
}

async function foldSummary(previous, turns) {
  const transcript = turns
    .map((t) => `${t.role === 'user' ? 'Athlete' : 'Coach'} (${t.ts.slice(0, 10)}): ${t.content}`)
    .join('\n\n');
  const system =
    "You maintain a strength coach's case notes about one athlete. Update the notes with new information from the conversation: training decisions, plan changes, recurring issues, diet agreements, injury status, PRs. Under 400 words, terse bullets. Drop stale details, keep what's actionable. Return ONLY the updated notes.";
  return askClaude(system, `Current case notes:\n${previous}\n\nConversation to fold in:\n${transcript}`);
}

// ---- Hevy ----

async function hevyGet(path) {
  const res = await fetch(`${HEVY_API}${path}`, { headers: { 'api-key': process.env.HEVY_API_KEY } });
  if (!res.ok) throw new Error(`Hevy ${path} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

async function fetchEventsSince(since) {
  const first = await hevyGet(`/workouts/events?since=${encodeURIComponent(since)}&page=1&pageSize=10`);
  const events = [...first.events];
  for (let page = 2; page <= first.page_count; page++) {
    events.push(...(await hevyGet(`/workouts/events?since=${encodeURIComponent(since)}&page=${page}&pageSize=10`)).events);
  }
  return events;
}

async function fetchLatestWorkout() {
  const data = await hevyGet('/workouts?page=1&pageSize=1');
  return data.workouts?.[0] ?? null;
}

// ---- Telegram ----

async function sendTelegram(text) {
  const chatId = process.env.CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  for (const chunk of chunkMessage(text)) {
    const res = await fetch(`${TELEGRAM}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: chunk }),
    });
    if (!res.ok) throw new Error(`Telegram sendMessage failed (${res.status}): ${await res.text()}`);
  }
}

// ---- Modes ----

async function runDaily() {
  const hevy = (await getState('hevy')) ?? { watermark: null, seen: {} };
  const since = hevy.watermark ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const newWatermark = new Date().toISOString(); // capture before the request

  const events = await fetchEventsSince(since);
  const now = Date.now();
  for (const id of Object.keys(hevy.seen)) if (hevy.seen[id] < now) delete hevy.seen[id]; // prune expired
  const seenIds = new Set(Object.keys(hevy.seen));
  const newWorkouts = selectNewWorkouts(events, seenIds);

  if (newWorkouts.length === 0) {
    if (process.env.REST_DAY_MESSAGES === 'true') await sendTelegram(await coachTurn(REST_DAY_PROMPT));
    hevy.watermark = newWatermark;
    await putState('hevy', hevy);
    console.log('no new workouts');
    return;
  }

  const reply = await coachTurn(dailyPrompt(newWorkouts.map(compactWorkout)));
  await sendTelegram(reply);
  for (const w of newWorkouts) hevy.seen[w.id] = now + SEEN_TTL_MS;
  hevy.watermark = newWatermark;
  await putState('hevy', hevy);
  console.log(`coached ${newWorkouts.length} workout(s)`);
}

async function runChat() {
  const text = (process.env.CHAT_TEXT || '').trim();
  if (!text) return console.log('no chat text');

  // Slash commands handled without an LLM call.
  if (text === '/start' || text === '/help') {
    return sendTelegram(
      'Commands:\n/last - coach my latest Hevy workout now\n/weight 82.5 - log bodyweight\n/remember <fact> - save a fact to my profile\n/weights - recent bodyweight log\n/reset - clear conversation history\n\nAnything else goes straight to your coach.',
    );
  }
  if (text === '/reset') {
    await putState('memory', { summary: (await getState('memory'))?.summary ?? '(no case notes yet)', conversation: [] });
    return sendTelegram('Conversation history cleared. Profile and case notes kept.');
  }
  if (text.startsWith('/weight ')) {
    const kg = Number.parseFloat(text.slice(8).replace(',', '.'));
    if (!Number.isFinite(kg) || kg <= 0) return sendTelegram('Usage: /weight 82.5');
    const log = (await getState('bodyweight')) ?? [];
    log.push({ date: new Date().toISOString().slice(0, 10), kg });
    await putState('bodyweight', log);
    return sendTelegram(`Logged ${kg} kg (entry #${log.length}).`);
  }
  if (text === '/weights') {
    const log = (await getState('bodyweight')) ?? [];
    const recent = log.slice(-14).map((e) => `${e.date}: ${e.kg} kg`).join('\n');
    return sendTelegram(recent || 'No bodyweight entries yet. Log one with /weight 82.5');
  }
  if (text.startsWith('/remember ')) {
    const fact = text.slice(10).trim();
    if (!fact) return sendTelegram('Usage: /remember squats feel better with a 2s pause');
    const profile = (await getState('profile')) ?? '';
    await putState('profile', `${profile.trimEnd()}\n- (${new Date().toISOString().slice(0, 10)}) ${fact}\n`);
    return sendTelegram('Saved to your profile.');
  }
  if (text === '/last') {
    const workout = await fetchLatestWorkout();
    if (!workout) return sendTelegram('No workouts found in your Hevy account.');
    return sendTelegram(await coachTurn(dailyPrompt([compactWorkout(workout)])));
  }

  await sendTelegram(await coachTurn(text));
}

const mode = process.argv[2];
const run = mode === 'daily' ? runDaily : mode === 'chat' ? runChat : null;
if (!run) {
  console.error('usage: node scripts/coach.mjs <daily|chat>');
  process.exit(1);
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
