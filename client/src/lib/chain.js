// Front-end helpers for the blockchain layer (server: /api/chain/status, /api/wallet/:addr/tokens).
import { useEffect, useState } from 'react';
import { API, socket } from '../socket.js';

/** Which chain the server is writing to: { onchain, network, chainId, blockNumber, explorerTx, error?, tokens }. */
export function useChainStatus() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${API}/api/chain/status`)
        .then(r => r.json())
        .then(s => { if (alive) setStatus(s); })
        .catch(() => { if (alive) setStatus({ offline: true }); });
    load();
    const id = setInterval(load, 15000);
    socket.on('match:end', load); // a finished match adds a block
    return () => {
      alive = false;
      clearInterval(id);
      socket.off('match:end', load);
    };
  }, []);

  return status;
}

/**
 * Live ARENA balance for an address.
 * { onchain: true, balance } when read from the ARENA token contract,
 * { onchain: false, balance } when the server falls back to its database.
 * `refreshKey` lets a caller force a re-read (e.g. when a receipt arrives).
 */
export function useChainBalance(address, refreshKey = 0) {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    if (!address) return undefined;
    let alive = true;
    const load = () =>
      fetch(`${API}/api/wallet/${address}/tokens`)
        .then(r => r.json())
        .then(d => { if (alive && typeof d?.balance === 'number') setInfo(d); })
        .catch(() => {});
    load();
    // match:end is emitted AFTER the server mints rewards, so it is the right moment to re-read.
    socket.on('match:end', load);
    return () => {
      alive = false;
      socket.off('match:end', load);
    };
  }, [address, refreshKey]);

  return info;
}

export const formatArena = n =>
  Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
