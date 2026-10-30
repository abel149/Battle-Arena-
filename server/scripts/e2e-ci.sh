#!/usr/bin/env bash
# CI-friendly end-to-end check.
# Delegates to the verified e2e-onchain.sh script:
# Starts a local Hardhat node, deploys MatchResult + ArenaToken + ArenaBadges,
# registers a wallet, runs a bot match, and verifies: on-chain record, ARENA
# tokens minted, badges minted, replay served, weekly leaderboard populated.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "${DIR}/e2e-onchain.sh" "$@"
