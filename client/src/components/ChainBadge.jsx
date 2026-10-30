import './chain.css';

/** Badge that displays the active blockchain or simulated ledger connection. */
export default function ChainBadge({ status }) {
  if (!status) return null;

  if (status.offline) {
    return <span className="chain-badge off" title="Cannot reach the arena server">⛓ Server offline</span>;
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
    return <span className="chain-badge err" title={status.error}>⚠ Chain unreachable</span>;
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
