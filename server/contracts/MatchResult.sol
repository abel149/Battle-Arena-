// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MatchResult
 * @notice Immutable on-chain ledger and receipt registry for Web3 Battle Arena.
 * @dev Stores authoritative match receipts submitted by the game server relayer.
 *      Game logic, real-time moves, and physics remain off-chain; this contract acts as
 *      a tamper-proof settlement layer and verifiable audit trail.
 */
contract MatchResult {
    /**
     * @notice Data structure holding the immutable record of a completed match.
     * @param matchId Unique bytes32 identifier of the match (encoded room ID or hash).
     * @param gameType Short identifier of the game mode ("memory", "math-arena", "connectfour", "cyber-blaster").
     * @param winner Address of the winning player, or address(0) for a draw.
     * @param playerA Address of Player 1 (Seat X).
     * @param playerB Address of Player 2 (Seat O / Bot).
     * @param moves Total number of moves or dynamic input ticks executed during the match.
     * @param timestamp Unix epoch timestamp (seconds) when the match was committed on-chain.
     */
    struct Match {
        bytes32 matchId;
        string  gameType;
        address winner;
        address playerA;
        address playerB;
        uint256 moves;
        uint64  timestamp;
    }

    /// @notice Ordered list of all completed match records.
    Match[] public matches;

    /// @dev Internal mapping from matchId to 1-based index in `matches` for O(1) duplicate checks and lookups.
    mapping(bytes32 => uint256) private matchIndex;

    /// @notice Address of the contract owner (the trusted game server relayer wallet).
    address public owner;

    /**
     * @notice Restricts function invocation to the contract owner.
     */
    modifier onlyOwner() {
        require(msg.sender == owner, "MatchResult: caller is not the owner");
        _;
    }

    /**
     * @notice Initializes the contract and assigns deployer as the initial owner.
     */
    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Transfers ownership of the contract to a new address.
     * @dev Only callable by the current owner.
     * @param newOwner Address of the new owner account.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "MatchResult: new owner is zero address");
        owner = newOwner;
    }

    /**
     * @notice Emitted whenever a match is recorded to the blockchain.
     * @param matchId Unique bytes32 identifier of the match.
     * @param gameType Game mode name.
     * @param winner Address of the winning player, or address(0) for draws.
     * @param playerA Address of Player 1.
     * @param playerB Address of Player 2.
     * @param moves Number of moves in the match.
     * @param timestamp Block timestamp when the match was recorded.
     */
    event MatchRecorded(
        bytes32 matchId,
        string  gameType,
        address winner,
        address playerA,
        address playerB,
        uint256 moves,
        uint64  timestamp
    );

    /**
     * @notice Records a single completed match to the permanent receipt ledger.
     * @dev Reverts if the matchId has already been recorded or if player addresses are zero.
     * @param matchId Unique bytes32 match identifier.
     * @param gameType Short string describing the game mode.
     * @param winner Winning player's address (or address(0) for a draw).
     * @param playerA Address of Player 1.
     * @param playerB Address of Player 2.
     * @param moves Move count of the completed game.
     */
    function recordMatch(
        bytes32 matchId,
        string  calldata gameType,
        address winner,
        address playerA,
        address playerB,
        uint256 moves
    ) external onlyOwner {
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

    /**
     * @notice Input struct for batch recording multiple match results in one transaction.
     * @param matchId Unique bytes32 identifier.
     * @param gameType Game mode name.
     * @param winner Winner address or address(0).
     * @param playerA Player 1 address.
     * @param playerB Player 2 address.
     * @param moves Number of moves.
     */
    struct BatchMatchInput {
        bytes32 matchId;
        string  gameType;
        address winner;
        address playerA;
        address playerB;
        uint256 moves;
    }

    /**
     * @notice Batch records multiple completed matches in a single atomic transaction.
     * @dev Amortizes base transaction gas (21,000 gas) across all included match logs.
     * @param inputs Array of BatchMatchInput structs to record.
     */
    function recordMatchBatch(BatchMatchInput[] calldata inputs) external onlyOwner {
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

    /**
     * @notice Returns the total count of matches recorded on-chain.
     * @return Total count of Match structs in the matches array.
     */
    function matchCount() external view returns (uint256) {
        return matches.length;
    }

    /**
     * @notice Retrieves a recorded match by its unique bytes32 matchId.
     * @param matchId The unique bytes32 identifier of the match.
     * @return The Match struct if found, or an empty Match struct with matchId == bytes32(0) if not found.
     */
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

    /**
     * @notice Retrieves a recorded match by its chronological index.
     * @param index Zero-based index in the `matches` array.
     * @return The Match struct at the specified index.
     */
    function getMatchByIndex(uint256 index) external view returns (Match memory) {
        require(index < matches.length, "MatchResult: index out of bounds");
        return matches[index];
    }
}
