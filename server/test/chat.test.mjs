import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeChatMessage } from '../sockets/chat.js';

test('sanitizeChatMessage strips HTML tags and trims whitespace', () => {
  const dirty = '  Hello <b>World</b>!  ';
  const clean = sanitizeChatMessage(dirty);
  assert.equal(clean, 'Hello bWorld/b!');
});

test('sanitizeChatMessage filters profanity with family-friendly placeholder', () => {
  const profanity = 'what the hell this is stupid and idiot';
  const clean = sanitizeChatMessage(profanity);
  assert.equal(clean, '🎮 [Family Friendly Message]');
});

test('sanitizeChatMessage truncates messages longer than 100 characters', () => {
  const longMsg = 'A'.repeat(150);
  const clean = sanitizeChatMessage(longMsg);
  assert.equal(clean.length, 100);
});

test('sanitizeChatMessage safely handles null and non-string inputs', () => {
  assert.equal(sanitizeChatMessage(null), null);
  assert.equal(sanitizeChatMessage(undefined), null);
  assert.equal(sanitizeChatMessage(123), null);
  assert.equal(sanitizeChatMessage({}), null);
});
