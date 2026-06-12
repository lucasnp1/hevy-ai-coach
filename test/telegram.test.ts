import { describe, expect, it } from 'vitest';
import { chunkMessage } from '../src/telegram';

describe('chunkMessage', () => {
  it('returns short messages unchanged', () => {
    expect(chunkMessage('hello coach')).toEqual(['hello coach']);
  });

  it('splits long messages at paragraph boundaries', () => {
    const para = 'A'.repeat(2000);
    const text = `${para}\n\n${para}\n\n${para}`;
    const chunks = chunkMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(3900);
      expect(chunk.startsWith('A')).toBe(true);
    }
    expect(chunks.join('')).toHaveLength(6000);
  });

  it('hard-cuts text with no break points', () => {
    const chunks = chunkMessage('B'.repeat(9000));
    expect(chunks.map((c) => c.length)).toEqual([3900, 3900, 1200]);
  });

  it('never produces a chunk over the Telegram limit', () => {
    const messy = `${'word '.repeat(1500)}\n${'word '.repeat(1500)}`;
    for (const chunk of chunkMessage(messy)) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });
});
