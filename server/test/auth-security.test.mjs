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

  io.close();
  await new Promise(r => server.close(r));
  process.exit(0);
});
