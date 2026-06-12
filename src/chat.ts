import { coachReply, dailyPrompt } from './coach';
import { compactWorkout, fetchLatestWorkout } from './hevy';
import { appendBodyweight, appendToProfile, clearConversation, getBodyweightLog } from './memory';
import { sendMessage, sendTyping } from './telegram';
import type { Env, TelegramUpdate } from './types';

const HELP = `Commands:
/last - coach my latest Hevy workout now
/weight 82.5 - log today's bodyweight
/remember <fact> - save a fact to my profile permanently
/weights - show recent bodyweight log
/reset - clear conversation history (profile is kept)

Anything else you send goes straight to your coach.`;

/** Handle one (already authenticated and deduped) Telegram update. */
export async function handleChatMessage(env: Env, update: TelegramUpdate): Promise<void> {
  const message = update.message;
  const text = message?.text?.trim();
  if (!message || !text) return;
  const chatId = message.chat.id;

  try {
    if (text === '/start' || text === '/help') {
      await sendMessage(env, chatId, HELP);
      return;
    }

    if (text === '/reset') {
      await clearConversation(env);
      await sendMessage(env, chatId, 'Conversation history cleared. Profile and case notes kept.');
      return;
    }

    if (text.startsWith('/weight ')) {
      const kg = Number.parseFloat(text.slice('/weight '.length).replace(',', '.'));
      if (!Number.isFinite(kg) || kg <= 0) {
        await sendMessage(env, chatId, 'Usage: /weight 82.5');
        return;
      }
      const count = await appendBodyweight(env, kg);
      await sendMessage(env, chatId, `Logged ${kg} kg (entry #${count}).`);
      return;
    }

    if (text === '/weights') {
      const log = await getBodyweightLog(env);
      const recent = log.slice(-14).map((e) => `${e.date}: ${e.kg} kg`).join('\n');
      await sendMessage(env, chatId, recent || 'No bodyweight entries yet. Log one with /weight 82.5');
      return;
    }

    if (text.startsWith('/remember ')) {
      const fact = text.slice('/remember '.length).trim();
      if (!fact) {
        await sendMessage(env, chatId, 'Usage: /remember squats feel better with a 2s pause');
        return;
      }
      await appendToProfile(env, fact);
      await sendMessage(env, chatId, 'Saved to your profile.');
      return;
    }

    if (text === '/last') {
      await sendTyping(env, chatId);
      const workout = await fetchLatestWorkout(env);
      if (!workout) {
        await sendMessage(env, chatId, 'No workouts found in your Hevy account.');
        return;
      }
      const reply = await coachReply(env, dailyPrompt([compactWorkout(workout)]));
      await sendMessage(env, chatId, reply);
      return;
    }

    // Freeform chat with the coach.
    await sendTyping(env, chatId);
    const reply = await coachReply(env, text);
    await sendMessage(env, chatId, reply);
  } catch (err) {
    console.error('chat handler failed', err);
    // Best effort: tell the user instead of silently dropping the message.
    await sendMessage(env, chatId, 'Something went wrong on my end — try that again in a minute.').catch(() => {});
  }
}
