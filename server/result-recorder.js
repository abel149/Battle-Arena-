/**
 * @file result-recorder.js
 * @description Unified ResultRecorder adapter interface.
 * Isolates Web3 smart-contract and cryptographic simulation recording behind
 * a single uniform facade.
 *
 * Provides honest, transparent distinction between:
 * - On-chain mode (EVM smart contracts via MatchResult.sol)
 * - Simulated mode (deterministic SHA-256 result hashing to local JSON ledger)
 */

import * as onchainAdapter from './chain-onchain.js';
import * as simulatedAdapter from './chain.js';

export class ResultRecorder {
  /**
   * @param {'onchain' | 'simulated'} [preferredMode] - Desired recorder backend mode.
   */
  constructor(preferredMode) {
    this.preferredMode = preferredMode;
  }

  /**
   * Whether the recorder is currently writing to a real EVM blockchain.
   *
   * @returns {boolean}
   */
  isOnchain() {
    if (this.preferredMode === 'simulated') return false;
    return onchainAdapter.isOnchain();
  }

  /**
   * Returns current chain deployment information or simulation status.
   *
   * @returns {Promise<Object>}
   */
  async chainInfo() {
    if (!this.isOnchain()) {
      return {
        configured: false,
        network: 'simulated-local',
        ledgerType: 'sha256-json',
      };
    }
    return onchainAdapter.chainInfo();
  }

  /**
   * Records a match outcome to the active ledger (EVM or local hash ledger).
   *
   * @param {Object} params
   * @param {string} params.matchId - Unique match identifier.
   * @param {string} params.gameType - Game identifier.
   * @param {{X: string, O: string}} params.players - Players mapping.
   * @param {string} params.winner - Winner address or 'draw'.
   * @param {Array|number} params.moves - Replay moves or count.
   * @returns {Promise<Object>} Normalized ledger receipt.
   */
  async recordMatch(params) {
    if (this.isOnchain()) {
      return onchainAdapter.recordMatch(params);
    }
    return simulatedAdapter.recordMatch(params);
  }

  /**
   * Retrieves all verified match ledger entries.
   *
   * @returns {Promise<Array<Object>>}
   */
  async getLedger() {
    if (this.isOnchain()) {
      return onchainAdapter.getLedger();
    }
    return simulatedAdapter.getLedger();
  }
}

/**
 * Default singleton ResultRecorder instance respecting environment configuration.
 */
export const defaultRecorder = new ResultRecorder();
