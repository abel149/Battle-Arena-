// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Simulated match-result registry.
// Each completed match produces one record:
//   matchId  - unique match identifier (the room id, or a server-generated id)
//   gameType - e.g. "memory" or "tic-tac-toe" (stored as a short string)
//   winner   - the winner's address, or address(0) for a draw
//   players  - packed player addresses (playerA, playerB)
//   moves    - number of moves in the match
//   timestamp
//
// This is intentionally thin so it is easy to swap in a real reward/ERC-20
// integration later. The server keeps the authoritative match logic; this
// contract is an immutable receipt log.

contract MatchResult {
    struct Match {
        bytes32 matchId;     // server-side match id, kept as bytes32 for on-chain neutrality
        string  gameType;    // "memory" | "tic-tac-toe" | ...
        address winner;      // address(0) for a draw
        address playerA;
        address playerB;
        uint256 moves;
        uint64  timestamp;
    }

    Match[] public matches;

    // Map matchId -> index in `matches` for O(1) lookups.
    mapping(bytes32 => uint256) private matchIndex;

    event MatchRecorded(
        bytes32 matchId,
        string  gameType,
        address winner,
        address playerA,
        address playerB,
        uint256 moves,
        uint64  timestamp
    );

    /// @notice Record a completed match. Reverts if the matchId was already recorded.
    function recordMatch(
        bytes32 matchId,
        string  calldata gameType,
        address winner,
        address playerA,
        address playerB,
        uint256 moves
    ) external {
        require(matchIndex[matchId] == 0, "MatchResult: match already recorded");
        require(playerA != address(0) && playerB != address(0), "MatchResult: invalid players");

        uint256 idx = matches.length;
        matches.push(Match({
            matchId:    matchId,
            gameType:   gameType,
            winner:     winner,
            playerA:    playerA,
            playerB:    playerB,
            moves:      moves,
            timestamp:  uint64(block.timestamp)
        }));
        matchIndex[matchId] = idx + 1;

        emit MatchRecorded(matchId, gameType, winner, playerA, playerB, moves, uint64(block.timestamp));
    }

    struct BatchMatchInput {
        bytes32 matchId;
        string  gameType;
        address winner;
        address playerA;
        address playerB;
        uint256 moves;
    }

    /// @notice Batch record multiple matches in a single atomic transaction.
    ///         Amortizes transaction base gas overhead across all matches.
    function recordMatchBatch(BatchMatchInput[] calldata inputs) external {
        uint64 ts = uint64(block.timestamp);
        for (uint256 i = 0; i < inputs.length; i++) {
            BatchMatchInput calldata m = inputs[i];
            require(matchIndex[m.matchId] == 0, "MatchResult: match already recorded");
            require(m.playerA != address(0) && m.playerB != address(0), "MatchResult: invalid players");

            uint256 idx = matches.length;
            matches.push(Match({
                matchId:    m.matchId,
                gameType:   m.gameType,
                winner:     m.winner,
                playerA:    m.playerA,
                playerB:    m.playerB,
                moves:      m.moves,
                timestamp:  ts
            }));
            matchIndex[m.matchId] = idx + 1;

            emit MatchRecorded(m.matchId, m.gameType, m.winner, m.playerA, m.playerB, m.moves, ts);
        }
    }

    /// @notice Number of recorded matches.
    function matchCount() external view returns (uint256) {
        return matches.length;
    }

    /// @notice Retrieve a recorded match by its matchId. Returns empty Match if not found.
    function getMatch(bytes32 matchId) external view returns (Match memory) {
        uint256 idx = matchIndex[matchId];
        if (idx == 0) {
            return Match(
                bytes32(0),
                "",
                address(0),
                address(0),
                address(0),
                0,
                0
            );
        }
        return matches[idx - 1];
    }

    /// @notice Retrieve a recorded match by its list index.
    function getMatchByIndex(uint256 index) external view returns (Match memory) {
        require(index < matches.length, "MatchResult: index out of bounds");
        return matches[index];
    }
}
