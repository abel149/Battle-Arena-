import { io } from 'socket.io-client';
import { ethers } from 'ethers';

const socket = io('http://localhost:3001');
const signer = ethers.Wallet.createRandom();
const me = signer.address;

socket.onAny((event, ...args) => {
  console.log('EVENT', event, JSON.stringify(args).slice(0, 200));
});
socket.on('connect_error', e => console.log('connect_error', e.message));
socket.on('connect', async () => {
  console.log('connected, sending identify');
  const signature = await signer.signMessage(`Battle Arena login for ${me}`);
  socket.emit('identify', { address: me, name: 'SmokeTest', signature }, (ack) => console.log('identify ack', ack));
  setTimeout(() => {
    console.log('sending match:bot');
    socket.emit('match:bot', { gameType: 'memory', deck: 'flags' });
  }, 500);
});
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 10000);
