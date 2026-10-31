/**
 * @file chain.js
 * @description Front-end React hooks and utilities for blockchain state and token balances.
 * Connects with server endpoints `/api/chain/status` and `/api/wallet/:addr/tokens`,
 * synchronizing live block height, network diagnostics, and ARENA token balances
 * triggered by WebSocket `match:end` events and polling timers.
 */

import { useEffect, useState } from 'react';
import { API, socket } from '../socket.js';

/**
 * @typedef {Object} ChainStatus
 * @property {boolean} onchain - True if server has an active on-chain contract connection.
 * @property {string} network - Human-readable network title (e.g. 'Base Sepolia', 'Local Hardhat').
 * @property {number | null} chainId - Connected EVM chain ID integer.
 * @property {number | null} blockNumber - Current highest indexed block number.
 * @property {string | null} explorerTx - Base URL for blockchain explorer transaction lookups.
 * @property {string} [error] - Error message if network connection is unreachable.
 * @property {boolean} [offline] - True if server HTTP status endpoint failed to respond.
 * @property {Object} [tokens] - Deployed token and badge contract addresses.
 */

/**
 * React hook querying server blockchain connection status and network diagnostics.
 * Periodically polls every 15 seconds and refreshes on WebSocket `match:end` events.
 *
 * @function useChainStatus
 * @returns {ChainStatus | null} Live blockchain status object or null while loading.
 */
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
 * @typedef {Object} ChainBalanceInfo
 * @property {boolean} onchain - True if balance was queried directly from ERC-20 contract.
 * @property {number} balance - Current ARENA token balance.
 * @property {string} [tokenAddress] - Deployed ERC-20 token address.
 */

/**
 * React hook querying live ARENA token balance for an Ethereum wallet address.
 * Automatically refetches on `match:end` events or when `refreshKey` increments.
 *
 * @function useChainBalance
 * @param {string | null | undefined} address - Target player wallet address.
 * @param {number} [refreshKey=0] - Optional dependency key to force balance reload.
 * @returns {ChainBalanceInfo | null} Balance details or null if uninitialized.
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

/**
 * Formats a raw numeric ARENA token amount with locale-aware thousand separators
 * and up to 2 decimal places.
 *
 * @function formatArena
 * @param {number | string | null | undefined} n - Raw token amount.
 * @returns {string} Formatted token string.
 */
export const formatArena = n =>
  Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
