// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ProofOfChore
 * @dev Parent-Backed Battle Pass Oracle contract.
 * Parents act as real-world Oracles verifying off-chain tasks (chores, homework, reading).
 * Verification on-chain unlocks Arena Energy (entry tickets) and tokenized allowance rewards.
 */
contract ProofOfChore {
    struct ChoreRecord {
        bytes32 choreHash;
        address parentOracle;
        address kid;
        string  choreId;
        string  title;
        string  category;
        uint256 energyGranted;
        uint256 allowanceGranted;
        uint64  timestamp;
    }

    address public owner;
    ChoreRecord[] public choreRecords;

    // parent -> kid -> isLinked
    mapping(address => mapping(address => bool)) public linkedKids;
    // kid -> parent
    mapping(address => address) public kidToParent;
    // kid -> total verified chores
    mapping(address => uint256) public kidVerifiedCount;
    // choreHash -> exists
    mapping(bytes32 => bool) public verifiedChores;

    event ParentLinked(address indexed parent, address indexed kid, uint64 timestamp);
    event ChoreVerified(
        bytes32 indexed choreHash,
        address indexed parent,
        address indexed kid,
        string choreId,
        string title,
        string category,
        uint256 energyGranted,
        uint256 allowanceGranted,
        uint64 timestamp
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @dev Link a kid wallet to a parent oracle wallet.
     */
    function linkKid(address kid) external {
        require(kid != address(0), "Invalid kid address");
        require(kid != msg.sender, "Parent cannot be kid");
        linkedKids[msg.sender][kid] = true;
        kidToParent[kid] = msg.sender;
        emit ParentLinked(msg.sender, kid, uint64(block.timestamp));
    }

    /**
     * @dev Parent or contract owner verifies a completed chore.
     */
    function verifyChore(
        address kid,
        string calldata choreId,
        string calldata title,
        string calldata category,
        uint256 energyGranted,
        uint256 allowanceGranted
    ) external returns (bytes32) {
        require(kid != address(0), "Invalid kid address");
        require(
            msg.sender == owner || linkedKids[msg.sender][kid] || kidToParent[kid] == msg.sender,
            "Not authorized parent oracle"
        );

        bytes32 choreHash = keccak256(
            abi.encodePacked(msg.sender, kid, choreId, block.timestamp, choreRecords.length)
        );
        require(!verifiedChores[choreHash], "Chore already verified");

        ChoreRecord memory record = ChoreRecord({
            choreHash: choreHash,
            parentOracle: msg.sender,
            kid: kid,
            choreId: choreId,
            title: title,
            category: category,
            energyGranted: energyGranted,
            allowanceGranted: allowanceGranted,
            timestamp: uint64(block.timestamp)
        });

        choreRecords.push(record);
        verifiedChores[choreHash] = true;
        kidVerifiedCount[kid] += 1;

        emit ChoreVerified(
            choreHash,
            msg.sender,
            kid,
            choreId,
            title,
            category,
            energyGranted,
            allowanceGranted,
            uint64(block.timestamp)
        );

        return choreHash;
    }

    function totalRecords() external view returns (uint256) {
        return choreRecords.length;
    }

    function getRecord(uint256 index) external view returns (ChoreRecord memory) {
        require(index < choreRecords.length, "Index out of range");
        return choreRecords[index];
    }
}
