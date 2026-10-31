// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ProofOfChore
 * @notice Parent-Backed Battle Pass Oracle contract for verifying real-world tasks and granting game energy.
 * @dev Parents act as real-world Oracles verifying off-chain tasks (chores, homework, reading).
 * Verification on-chain unlocks Arena Energy (entry tickets) and tokenized allowance rewards.
 * All chores are permanently attested on-chain with cryptographic digest hashing.
 */
contract ProofOfChore {
    /**
     * @notice Record of an individual completed and attested chore.
     * @param choreHash Unique cryptographic digest representing the verification event.
     * @param parentOracle Ethereum wallet address of the supervising parent oracle.
     * @param kid Ethereum wallet address of the child receiving energy/allowance.
     * @param choreId Unique string identifier of the chore task from off-chain database.
     * @param title Title or descriptive name of the chore task.
     * @param category Classification category (e.g., 'homework', 'reading', 'chores').
     * @param energyGranted Amount of Arena Energy credited to the player.
     * @param allowanceGranted Micro-token allowance or stipend amount granted.
     * @param timestamp Unix epoch timestamp (seconds) when verification was mined.
     */
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

    /// @notice Owner / deployer address with administrative permissions.
    address public owner;

    /// @notice Ordered collection of all verified chore records mined on-chain.
    ChoreRecord[] public choreRecords;

    /// @notice Tracks family link authorizations: parent wallet => child wallet => boolean link status.
    mapping(address => mapping(address => bool)) public linkedKids;

    /// @notice Reverse mapping from child wallet to primary supervising parent oracle wallet.
    mapping(address => address) public kidToParent;

    /// @notice Cumulative count of verified chores per child wallet address.
    mapping(address => uint256) public kidVerifiedCount;

    /// @notice Set of unique chore hashes to enforce idempotent execution and prevent replay.
    mapping(bytes32 => bool) public verifiedChores;

    /**
     * @notice Emitted when a parent oracle authorizes a child wallet link.
     * @param parent Address of the parent oracle wallet.
     * @param kid Address of the child account.
     * @param timestamp Block timestamp at execution time.
     */
    event ParentLinked(address indexed parent, address indexed kid, uint64 timestamp);

    /**
     * @notice Emitted when a parent oracle verifies and records a chore completion on-chain.
     * @param choreHash Unique keccak256 hash identifying the chore submission.
     * @param parent Address of the verifying parent oracle.
     * @param kid Address of the rewarded child player.
     * @param choreId Unique string ID of the chore task.
     * @param title Title of the completed task.
     * @param category Category tag of the task.
     * @param energyGranted Amount of energy awarded for gameplay sessions.
     * @param allowanceGranted Allowance token or unit amount granted.
     * @param timestamp Block timestamp when the verification was recorded.
     */
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

    /**
     * @notice Restricts invocation to the contract owner.
     */
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    /**
     * @notice Initializes the ProofOfChore contract setting msg.sender as the owner.
     */
    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Links a child player wallet to the caller (parent oracle).
     * @dev Establishes both directional mappings and emits ParentLinked. Rejects zero addresses or self-linking.
     * @param kid Ethereum address of the child player.
     */
    function linkKid(address kid) external {
        require(kid != address(0), "Invalid kid address");
        require(kid != msg.sender, "Parent cannot be kid");
        linkedKids[msg.sender][kid] = true;
        kidToParent[kid] = msg.sender;
        emit ParentLinked(msg.sender, kid, uint64(block.timestamp));
    }

    /**
     * @notice Verifies and records a chore completion on-chain, unlocking game energy.
     * @dev Only the linked parent oracle or contract owner may verify chores for a child.
     * Computes a unique keccak256 digest over caller, kid, choreId, block timestamp, and array length.
     * Reverts if the calculated choreHash was previously registered (replay protection).
     * @param kid Ethereum address of the child who completed the chore.
     * @param choreId Unique string identifier of the chore task.
     * @param title Title or description of the completed chore.
     * @param category Category of the chore (e.g., 'homework', 'cleaning').
     * @param energyGranted Game energy quantity granted.
     * @param allowanceGranted Tokenized allowance quantity awarded.
     * @return choreHash Unique cryptographic hash of the newly recorded chore.
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

    /**
     * @notice Returns total number of chore records minted across all accounts.
     * @return Total count of chore records stored in array.
     */
    function totalRecords() external view returns (uint256) {
        return choreRecords.length;
    }

    /**
     * @notice Retrieves the chore record at the given zero-based index.
     * @param index Array index to retrieve.
     * @return ChoreRecord struct containing complete verification details.
     */
    function getRecord(uint256 index) external view returns (ChoreRecord memory) {
        require(index < choreRecords.length, "Index out of range");
        return choreRecords[index];
    }
}
