import { Hono } from 'hono';
import { handleChatMessage } from './chat';
import { runDailyCheckin } from './daily';
import type { Env, TelegramUpdate } from './types';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.text('ok'));

// Daily check-in, triggered by the GitHub Actions cron (or a manual curl).
app.post('/daily', async (c) => {
  const auth = c.req.header('authorization');
  if (auth !== `Bearer ${c.env.CRON_SECRET}`) {
    return c.text('unauthorized', 401);
  }
  const result = await runDailyCheckin(c.env);
  return c.json(result);
});

// Telegram webhook. The bot is publicly discoverable, so two gates:
// the webhook secret proves the request is from Telegram, and the user-id
// check ensures only the owner can talk to the coach.
app.post('/telegram', async (c) => {
  if (c.req.header('x-telegram-bot-api-secret-token') !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.text('unauthorized', 401);
  }

  const update = await c.req.json<TelegramUpdate>();

  const fromId = update.message?.from?.id;
  if (String(fromId) !== c.env.ALLOWED_TELEGRAM_USER_ID) {
    // Acknowledge so Telegram doesn't retry, but don't engage.
    return c.json({ ok: true });
  }

  // Telegram retries any update we don't 200 quickly — dedupe by update_id.
  const dedupeKey = `tg:update:${update.update_id}`;
  if (await c.env.COACH_KV.get(dedupeKey)) {
    return c.json({ ok: true });
  }
  await c.env.COACH_KV.put(dedupeKey, '1', { expirationTtl: 24 * 60 * 60 });

  // Respond 200 immediately; the Claude call happens after the response.
  c.executionCtx.waitUntil(handleChatMessage(c.env, update));
  return c.json({ ok: true });
});

export default app;
