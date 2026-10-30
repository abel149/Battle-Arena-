/**
 * @file ChainBadge.jsx
 * @description React UI component rendering a visual badge indicating live blockchain status,
 * block height, simulated ledger mode, or RPC reachability alerts.
 */

import './chain.css';

/**
 * Visual badge displaying the active blockchain or simulated ledger status.
 *
 * @component
 * @param {Object} props - Component props.
 * @param {import('../lib/chain.js').ChainStatus | null} props.status - Status object from useChainStatus().
 * @returns {JSX.Element | null} Badge element or null if status is loading.
 */
export default function ChainBadge({ status }) {
  if (!status) return null;

  if (status.offline) {
    return (
      <span className="chain-badge off" title="Cannot reach the arena server">
        ⛓ Server offline
      </span>
    );
  }
  if (!status.onchain) {
    return (
      <span
        className="chain-badge sim"
        title="Results are saved to a local file only — no blockchain. Start the server with npm start for a real chain."
      >
        🧪 Simulated ledger
      </span>
    );
  }
  if (status.error) {
    return (
      <span className="chain-badge err" title={status.error}>
        ⚠ Chain unreachable
      </span>
    );
  }
  return (
    <span
      className="chain-badge live"
      title={`Connected to ${status.network} (chain ${status.chainId}) · block ${status.blockNumber}`}
    >
      <span className="live-dot" /> {status.network} · #{status.blockNumber}
    </span>
  );
}
