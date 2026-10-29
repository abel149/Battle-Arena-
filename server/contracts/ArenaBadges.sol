// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ArenaBadges — ERC-1155 collectible achievement badges for Battle Arena.
/// @notice Each badge type gets a deterministic numeric id (stable across
///         deployments of the server's BADGE_DEFS order). The server wallet,
///         acting as minter, lazily registers badge types (`ensureBadge`) and
///         mints one copy to a player when they earn it.
contract ArenaBadges {
    string public constant name = "Arena Badges";

    address public minter;
    uint256 public nextId = 1; // ids start at 1; 0 is invalid

    mapping(uint256 => address) public balanceOf;      // per-token owner (each badge is a 1/1)
    mapping(address => uint256) public badgeCount;     // badges held per address
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    mapping(uint256 => string) public badgeLabel;      // id -> e.g. "First Blood"

    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event BadgeCreated(uint256 indexed id, string label);
    event MinterChanged(address indexed previous, address indexed current);

    error Unauthorized();
    error BadgeMismatch();
    error NonImplemented();

    modifier onlyMinter() {
        if (msg.sender != minter) revert Unauthorized();
        _;
    }

    constructor(address _minter) {
        minter = _minter;
        emit MinterChanged(address(0), _minter);
    }

    /// @notice Register badge type `id` -> `label` if not yet created.
    ///         No-op when it already exists (server keeps deterministic ids).
    function ensureBadge(uint256 id, string calldata label) external onlyMinter {
        if (bytes(badgeLabel[id]).length == 0) {
            badgeLabel[id] = label;
            if (id >= nextId) nextId = id + 1;
            emit BadgeCreated(id, label);
        }
    }

    /// @notice Mint a 1-of-1 copy of badge `id` to `to`. The copy is
    ///         individually ownable (single token), matching collectible badges.
    function mint(address to, uint256 id) external onlyMinter {
        require(bytes(badgeLabel[id]).length > 0, "ArenaBadges: unknown badge");
        balanceOf[id] = to;
        badgeCount[to] += 1;
        emit TransferSingle(msg.sender, address(0), to, id, 1);
    }

    /// @notice Does `owner` hold badge `id`? Used for verification/lookup.
    function holderOf(uint256 id) external view returns (address) {
        return balanceOf[id];
    }

    /// @notice Next unassigned badge id (useful for server-side id allocation).
    function currentNextId() external view returns (uint256) {
        return nextId;
    }

    function setMinter(address next) external onlyMinter {
        emit MinterChanged(minter, next);
        minter = next;
    }

    // ---- ERC-1155 compat surface (transfers/balance queries) ----

    /// @notice MIME note: every badge is a unique 1/1, so balances are 0 or 1.
    function balanceOfAll(address owner) external view returns (uint256) {
        return badgeCount[owner];
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    /// @notice Escrow-style transfer of a single badge id.
    function safeTransferFrom(address from, address to, uint256 id) external {
        if (!(msg.sender == from || isApprovedForAll[from][msg.sender])) revert Unauthorized();
        if (balanceOf[id] != from) revert BadgeMismatch();
        balanceOf[id] = to;
        badgeCount[from] -= 1;
        badgeCount[to] += 1;
        emit TransferSingle(msg.sender, from, to, id, 1);
    }
}
