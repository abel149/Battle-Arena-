import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDb = path.join(os.tmpdir(), `arena-auth-sec-${process.pid}-${Date.now()}.sqlite`);
process.env.ARENA_DB_PATH = tmpDb;
process.env.PORT = '3988';

after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(tmpDb + suffix, { force: true }); } catch { /* ignore */ }
  }
});

test('Security SEC-01 & SEC-02: rejecting unauthenticated login and registration', async () => {
  const { server, io } = await import('../index.js');
  const serverUrl = 'http://localhost:3988';

  const victimWallet = ethers.Wallet.createRandom().address;

  // 1. Unauthenticated register without signature MUST FAIL with 401
  const regRes = await fetch(`${serverUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: victimWallet, username: 'hackeduser', password: 'password123' }),
  });
  assert.equal(regRes.status, 401, 'Register without signature must be 401 Unauthorized');
  const regJson = await regRes.json();
  assert.ok(regJson.error.includes('Signature required'));

  // 2. Unauthenticated login with only address (no signature, no password) MUST FAIL with 401
  const loginRes = await fetch(`${serverUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: victimWallet }),
  });
  assert.equal(loginRes.status, 401, 'Login without signature or password must be 401 Unauthorized');

  // 3. Legitimate registration with signed message succeeds
  const legitWallet = ethers.Wallet.createRandom();
  const legitSig = await legitWallet.signMessage(`Battle Arena login for ${legitWallet.address}`);
  const legitReg = await fetch(`${serverUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: legitWallet.address,
      username: 'legit_' + Math.random().toString(36).slice(2, 8),
      password: 'password123',
      signature: legitSig,
    }),
  });
  assert.equal(legitReg.status, 200, 'Register with valid signature succeeds');
  const legitJson = await legitReg.json();
  assert.ok(legitJson.token, 'Session token returned on registration');

  // 4. Nonce endpoint works and nonced signature succeeds
  const nonceRes = await fetch(`${serverUrl}/api/auth/nonce?address=${legitWallet.address}`);
  assert.ok(nonceRes.ok);
  const { nonce, message } = await nonceRes.json();
  assert.ok(nonce);
  const noncedSig = await legitWallet.signMessage(message);

  const loginNonced = await fetch(`${serverUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: legitWallet.address,
      signature: noncedSig,
    }),
  });
  assert.equal(loginNonced.status, 200, 'Login with nonced signature succeeds');
  const noncedData = await loginNonced.json();
  assert.ok(noncedData.token, 'Session token returned on nonced login');

  // 5. Security headers check (SEC-07)
  const headRes = await fetch(`${serverUrl}/api/leaderboard`);
  assert.equal(headRes.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headRes.headers.get('x-frame-options'), 'DENY');
  assert.equal(headRes.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');

  // 6. Guest queue bypass check (SEC-06)
  const { io: ClientIO } = await import('socket.io-client');
  const guestWallet = ethers.Wallet.createRandom();
  const guestSock = ClientIO(serverUrl, { reconnection: false });
  await new Promise(r => guestSock.on('connect', r));
  const guestSig = await guestWallet.signMessage(`Battle Arena login for ${guestWallet.address}`);
  guestSock.emit('identify', { address: guestWallet.address, name: 'GuestUser', signature: guestSig });
  await new Promise(r => setTimeout(r, 80));

  const guestErrPromise = new Promise(resolve => guestSock.on('player:error', resolve));
  guestSock.emit('queue:join', { gameType: 'memory' });
  const guestErr = await guestErrPromise;
  assert.equal(guestErr.code, 'AUTH_REQUIRED', 'Unregistered guest must be blocked from matchmaking queue');

  // 7. Brain Quiz cooldown check (SEC-11)
  const quiz1 = await fetch(`${serverUrl}/api/chores/quiz-complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kidAddress: legitWallet.address, score: 5 }),
  });
  assert.equal(quiz1.status, 200);
  const quiz2 = await fetch(`${serverUrl}/api/chores/quiz-complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kidAddress: legitWallet.address, score: 5 }),
  });
  assert.equal(quiz2.status, 400, 'Immediate duplicate quiz must trigger cooldown');
  const quiz2Json = await quiz2.json();
  assert.ok(quiz2Json.error.includes('cooldown') || quiz2Json.error.includes('recently'));

  // 8. Parent PIN setup protection check (SEC-13)
  const pinUnauth = await fetch(`${serverUrl}/api/parent/set-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: legitWallet.address, pin: '9999' }),
  });
  assert.equal(pinUnauth.status, 401, 'Setting PIN without current PIN or signature must be 401');

  const pinAuth = await fetch(`${serverUrl}/api/parent/set-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: legitWallet.address, pin: '9999', currentPin: '1234' }),
  });
  assert.equal(pinAuth.status, 200, 'Setting PIN with verified current PIN succeeds');

  // 9. Chore reward capping check (SEC-16)
  const choreRes = await fetch(`${serverUrl}/api/chores/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kidAddress: legitWallet.address,
      title: 'Exploit test',
      energyReward: 9999,
      xpReward: 99999,
      allowanceReward: 5000,
    }),
  });
  assert.equal(choreRes.status, 200);
  const choreJson = await choreRes.json();
  assert.ok(choreJson.energyReward <= 5, 'Energy reward must be capped');
  assert.ok(choreJson.xpReward <= 100, 'XP reward must be capped');
  assert.ok(choreJson.allowanceReward <= 20, 'Allowance reward must be capped');

  guestSock.disconnect();
  io.close();
  await new Promise(r => server.close(r));
  process.exit(0);
});
