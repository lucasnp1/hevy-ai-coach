// State access layer. Talks to the Cloudflare Worker's /state API when
// WORKER_URL is set; otherwise falls back to local JSON files under
// ./.local-state so the coach can be run and tested without any deployment.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const LOCAL_DIR = join(process.cwd(), '.local-state');

function workerUrl() {
  const url = process.env.WORKER_URL;
  return url ? url.replace(/\/$/, '') : null;
}

/** Read a state key. Returns the parsed value, or `fallback` if unset. */
export async function getState(key, fallback = null) {
  const base = workerUrl();
  if (base) {
    const res = await fetch(`${base}/state/${key}`, {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    if (res.status === 404) return fallback;
    if (!res.ok) throw new Error(`state GET ${key} failed (${res.status})`);
    const text = await res.text();
    return text ? parseLoose(text) : fallback;
  }
  try {
    return parseLoose(await readFile(join(LOCAL_DIR, `${key}.json`), 'utf8'));
  } catch {
    return fallback;
  }
}

// JSON for structured state (memory, bodyweight, hevy); raw text for values
// seeded as plain text (the profile, e.g. via `wrangler kv key put`).
function parseLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Write a state key. */
export async function putState(key, value) {
  const base = workerUrl();
  const body = JSON.stringify(value);
  if (base) {
    const res = await fetch(`${base}/state/${key}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${process.env.CRON_SECRET}`,
        'content-type': 'application/json',
      },
      body,
    });
    if (!res.ok) throw new Error(`state PUT ${key} failed (${res.status})`);
    return;
  }
  const path = join(LOCAL_DIR, `${key}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
}
