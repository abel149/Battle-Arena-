import test from 'node:test';
import assert from 'node:assert/strict';

// No env config here → chain-tokens.js must fall back to simulated receipts.
const tokens = await import('../chain-tokens.js');

test('isTokensOnchain is false without env config', () => {
  assert.equal(tokens.isTokensOnchain(), false);
  assert.equal(tokens.tokenAddresses(), null);
});

test('distributeRewards falls back to simulated receipts (no tx hash)', async () => {
  const out = await tokens.distributeRewards([
    { address: '0x' + 'a'.repeat(40), tokens: 10, badges: [{ id: 1, label: 'First Blood' }] },
    { address: '0x' + 'b'.repeat(40), tokens: 1, badges: [] },
  ]);
  const a = out['0x' + 'a'.repeat(40)];
  assert.equal(a.tokens, 10);
  assert.equal(a.tokenTx, null);
  assert.deepEqual(a.badges, [{ id: 1, label: 'First Blood', tx: null }]);
  const b = out['0x' + 'b'.repeat(40)];
  assert.equal(b.tokens, 1);
  assert.deepEqual(b.badges, []);
});
