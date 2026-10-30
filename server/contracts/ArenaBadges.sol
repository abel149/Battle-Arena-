// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ArenaBadges
 * @notice ERC-1155 collectible achievement badges for Web3 Battle Arena.
 * @dev Each badge type is identified by a deterministic numeric ID (matching the server's BADGE_DEFS array).
 *      The server wallet acts as minter, registering badge types lazily via `ensureBadge` and
 *      minting individual 1-of-1 collectible copies to players as achievements are unlocked.
 */
contract ArenaBadges {
    /// @notice Descriptive collection name.
    string public constant name = "Arena Badges";

    /// @notice Authorized minter address (the server relayer wallet).
    address public minter;

    /// @notice Next unassigned badge ID counter (IDs start at 1; 0 is reserved/invalid).
    uint256 public nextId = 1;

    /// @notice Mapping from token ID to holder address (each minted badge is a 1/1 collectible).
    mapping(uint256 => address) public balanceOf;

    /// @notice Mapping from player address to total count of badges held.
    mapping(address => uint256) public badgeCount;

    /// @notice Mapping from owner to operator approvals.
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    /// @notice Mapping from badge ID to human-readable label (e.g., "First Blood", "Triple Threat").
    mapping(uint256 => string) public badgeLabel;

    /**
     * @notice Standard ERC-1155 event emitted when a badge is minted or transferred.
     * @param operator Address that initiated the transfer.
     * @param from Previous owner address (address(0) for mints).
     * @param to New owner address.
     * @param id Badge token ID.
     * @param value Number of copies transferred (always 1 for 1-of-1 badges).
     */
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);

    /**
     * @notice Standard ERC-1155 event emitted when an operator approval is set.
     * @param owner Badge owner address.
     * @param operator Operator address.
     * @param approved Approval status.
     */
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    /**
     * @notice Emitted when a new badge type is registered in the contract.
     * @param id Registered numeric badge ID.
     * @param label Human-readable title of the achievement.
     */
    event BadgeCreated(uint256 indexed id, string label);

    /**
     * @notice Emitted when the minter authority is changed.
     * @param previous Previous minter address.
     * @param current New minter address.
     */
    event MinterChanged(address indexed previous, address indexed current);

    /// @dev Thrown when a non-minter caller invokes a privileged function.
    error Unauthorized();

    /// @dev Thrown when transferring a badge from an address that does not hold it.
    error BadgeMismatch();

    /// @dev Thrown when an unimplemented standard method is called.
    error NonImplemented();

    /**
     * @notice Restricts function invocation to the authorized minter.
     */
    modifier onlyMinter() {
        if (msg.sender != minter) revert Unauthorized();
        _;
    }

    /**
     * @notice Initializes the contract and sets the initial minter.
     * @param _minter Address of the authorized server relayer.
     */
    constructor(address _minter) {
        minter = _minter;
        emit MinterChanged(address(0), _minter);
    }

    /**
     * @notice Lazily registers a badge type if it has not yet been registered.
     * @dev No-op if the badge ID already has a label registered.
     * @param id Deterministic badge ID.
     * @param label Descriptive achievement title.
     */
    function ensureBadge(uint256 id, string calldata label) external onlyMinter {
        if (bytes(badgeLabel[id]).length == 0) {
            badgeLabel[id] = label;
            if (id >= nextId) nextId = id + 1;
            emit BadgeCreated(id, label);
        }
    }

    /**
     * @notice Mints a 1-of-1 copy of badge `id` to the specified player.
     * @dev Only callable by the minter. Reverts if the badge type has not been registered.
     * @param to Recipient address.
     * @param id Numeric badge ID to mint.
     */
    function mint(address to, uint256 id) external onlyMinter {
        require(bytes(badgeLabel[id]).length > 0, "ArenaBadges: unknown badge");
        balanceOf[id] = to;
        badgeCount[to] += 1;
        emit TransferSingle(msg.sender, address(0), to, id, 1);
    }

    /**
     * @notice Batch mints multiple collectible badges in a single transaction.
     * @dev Arrays must be of equal length.
     * @param recipients Array of recipient player addresses.
     * @param ids Array of badge token IDs matching recipients.
     */
    function mintBatch(address[] calldata recipients, uint256[] calldata ids) external onlyMinter {
        require(recipients.length == ids.length, "ArenaBadges: length mismatch");
        for (uint256 i = 0; i < recipients.length; i++) {
            address to = recipients[i];
            uint256 id = ids[i];
            require(bytes(badgeLabel[id]).length > 0, "ArenaBadges: unknown badge");
            balanceOf[id] = to;
            badgeCount[to] += 1;
            emit TransferSingle(msg.sender, address(0), to, id, 1);
        }
    }

    /**
     * @notice Queries the holder of a specific 1-of-1 badge ID.
     * @param id Badge token ID.
     * @return Address of the current holder, or address(0) if unminted.
     */
    function holderOf(uint256 id) external view returns (address) {
        return balanceOf[id];
    }

    /**
     * @notice Queries the next unassigned badge ID counter.
     * @return Current nextId value.
     */
    function currentNextId() external view returns (uint256) {
        return nextId;
    }

    /**
     * @notice Rotates the authorized minter address.
     * @param next New minter address.
     */
    function setMinter(address next) external onlyMinter {
        emit MinterChanged(minter, next);
        minter = next;
    }

    // ---- ERC-1155 Compatible Query & Transfer Surface ----

    /**
     * @notice Returns total number of badges held by an owner.
     * @param owner Address to query.
     * @return Total badge count.
     */
    function balanceOfAll(address owner) external view returns (uint256) {
        return badgeCount[owner];
    }

    /**
     * @notice Sets or revokes operator approval for all badges.
     * @param operator Address to authorize or revoke.
     * @param approved True to authorize, false to revoke.
     */
    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    /**
     * @notice Transfers a single 1-of-1 badge to a new owner.
     * @param from Current owner address.
     * @param to New owner address.
     * @param id Badge token ID.
     */
    function safeTransferFrom(address from, address to, uint256 id) external {
        if (!(msg.sender == from || isApprovedForAll[from][msg.sender])) revert Unauthorized();
        if (balanceOf[id] != from) revert BadgeMismatch();
        balanceOf[id] = to;
        badgeCount[from] -= 1;
        badgeCount[to] += 1;
        emit TransferSingle(msg.sender, from, to, id, 1);
    }
}
