import type { Env } from './types';

const TELEGRAM_API = 'https://api.telegram.org';
// Hard API limit is 4096; leave headroom so we never trip it mid-paragraph.
export const CHUNK_LIMIT = 3900;

/**
 * Split a long message into chunks under Telegram's 4096-char limit,
 * preferring paragraph breaks, then line breaks, then a hard cut.
 */
export function chunkMessage(text: string, limit = CHUNK_LIMIT): string[] {
  const chunks: string[] = [];
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

async function callTelegram(env: Env, method: string, body: unknown): Promise<Response> {
  const res = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Telegram ${method} failed (${res.status}): ${detail}`);
  }
  return res;
}

/** Send a message, chunking if needed. Plain text — no parse_mode on purpose:
 *  MarkdownV2 escaping is the #1 source of silent 400s. */
export async function sendMessage(env: Env, chatId: number | string, text: string): Promise<void> {
  for (const chunk of chunkMessage(text)) {
    await callTelegram(env, 'sendMessage', { chat_id: chatId, text: chunk });
  }
}

/** Show the "typing…" indicator while the coach thinks. */
export async function sendTyping(env: Env, chatId: number | string): Promise<void> {
  try {
    await callTelegram(env, 'sendChatAction', { chat_id: chatId, action: 'typing' });
  } catch {
    // Cosmetic only — never fail the request over it.
  }
}
