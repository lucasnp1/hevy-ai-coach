// Thin front door for the coach. Does NOT call Claude — that happens in
// GitHub Actions (Claude Code + your subscription token). This Worker only:
//   1. receives Telegram messages and triggers the chat workflow, and
//   2. stores your private state (profile, memory, bodyweight) in KV, which
//      the Actions jobs read and write over an authenticated /state API.
import { Hono } from 'hono';

interface Env {
  COACH_KV: KVNamespace;
  // secrets
  TELEGRAM_WEBHOOK_SECRET: string;
  CRON_SECRET: string;
  GITHUB_TOKEN: string;
  // vars
  ALLOWED_TELEGRAM_USER_ID: string;
  GITHUB_REPO: string; // "owner/name"
}

interface TelegramUpdate {
  update_id: number;
  message?: { from?: { id: number }; chat: { id: number }; text?: string };
}

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.text('ok'));

// --- State API: used by the GitHub Actions coach script ---

function authed(c: { req: { header: (k: string) => string | undefined }; env: Env }): boolean {
  return c.req.header('authorization') === `Bearer ${c.env.CRON_SECRET}`;
}

app.get('/state/:key', async (c) => {
  if (!authed(c)) return c.text('unauthorized', 401);
  const value = await c.env.COACH_KV.get(c.req.param('key'));
  if (value === null) return c.text('', 404);
  return c.body(value);
});

app.put('/state/:key', async (c) => {
  if (!authed(c)) return c.text('unauthorized', 401);
  await c.env.COACH_KV.put(c.req.param('key'), await c.req.text());
  return c.json({ ok: true });
});

// --- Telegram webhook: validate, then hand off to the chat workflow ---

app.post('/telegram', async (c) => {
  if (c.req.header('x-telegram-bot-api-secret-token') !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.text('unauthorized', 401);
  }
  const update = await c.req.json<TelegramUpdate>();

  // The bot is publicly discoverable — only the owner may talk to it.
  if (String(update.message?.from?.id) !== c.env.ALLOWED_TELEGRAM_USER_ID) {
    return c.json({ ok: true });
  }
  const text = update.message?.text?.trim();
  if (!text) return c.json({ ok: true });

  // Telegram retries un-acked updates — dedupe by update_id.
  const dedupeKey = `tg:update:${update.update_id}`;
  if (await c.env.COACH_KV.get(dedupeKey)) return c.json({ ok: true });
  await c.env.COACH_KV.put(dedupeKey, '1', { expirationTtl: 24 * 60 * 60 });

  // Trigger the chat workflow with the message; reply happens there.
  c.executionCtx.waitUntil(dispatchChat(c.env, text, update.message!.chat.id));
  return c.json({ ok: true });
});

async function dispatchChat(env: Env, text: string, chatId: number): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'hevy-ai-coach',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      event_type: 'telegram-message',
      client_payload: { text, chat_id: chatId },
    }),
  });
  if (!res.ok) console.error(`repository_dispatch failed (${res.status}): ${await res.text()}`);
}

export default app;
