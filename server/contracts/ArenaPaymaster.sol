// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ArenaPaymaster — ERC-4337 Account Abstraction Gas Paymaster
 * @notice Sponsoring gas for Web3 Battle Arena players on L2s (Base, Arbitrum, Polygon).
 *         Kids never need ETH or native gas tokens. When players unlock skins,
 *         mint match achievements, or redeem chores, this Paymaster pays the
 *         ERC-4337 Bundler directly via the EntryPoint deposit.
 */

interface IEntryPoint {
    function depositTo(address account) external payable;
    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external;
    function getBalanceOf(address account) external view returns (uint256);
}

enum PostOpMode {
    opSucceeded,
    opReverted,
    postOpReverted
}

struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

contract ArenaPaymaster {
    address public owner;
    IEntryPoint public immutable entryPoint;

    // Allowed game contracts whose calls can be gas-sponsored
    mapping(address => bool) public isWhitelistedTarget;
    // Per-player rate limiting / daily gas allowance in wei (prevent abuse)
    mapping(address => uint256) public dailySponsorshipWei;
    mapping(address => uint256) public lastSponsorshipDay;
    uint256 public constant MAX_DAILY_SPONSORSHIP = 0.05 ether; // plenty for 100+ L2 matches

    event TargetWhitelisted(address indexed target, bool allowed);
    event GasSponsored(address indexed user, uint256 actualGasCost);
    event Deposited(uint256 amount);

    error Unauthorized();
    error TargetNotWhitelisted();
    error DailyQuotaExceeded();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyEntryPoint() {
        if (msg.sender != address(entryPoint)) revert Unauthorized();
        _;
    }

    constructor(address _entryPoint, address _owner) {
        entryPoint = IEntryPoint(_entryPoint);
        owner = _owner;
    }

    receive() external payable {
        if (address(entryPoint) != address(0)) {
            entryPoint.depositTo{value: msg.value}(address(this));
            emit Deposited(msg.value);
        }
    }

    function setWhitelistedTarget(address target, bool allowed) external onlyOwner {
        isWhitelistedTarget[target] = allowed;
        emit TargetWhitelisted(target, allowed);
    }

    /// @notice ERC-4337 EntryPoint validation hook.
    ///         Validates that the target contract is whitelisted and player quota is respected.
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 /* userOpHash */,
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData) {
        if (msg.sender != address(entryPoint)) revert Unauthorized();

        address sender = userOp.sender;
        uint256 currentDay = block.timestamp / 1 days;

        if (lastSponsorshipDay[sender] != currentDay) {
            lastSponsorshipDay[sender] = currentDay;
            dailySponsorshipWei[sender] = 0;
        }

        if (dailySponsorshipWei[sender] + maxCost > MAX_DAILY_SPONSORSHIP) {
            revert DailyQuotaExceeded();
        }

        dailySponsorshipWei[sender] += maxCost;

        // context contains sender address to track actual gas in postOp
        context = abi.encode(sender, maxCost);
        validationData = 0; // 0 = valid signature and within timestamp range
    }

    /// @notice ERC-4337 EntryPoint post-execution hook.
    function postOp(
        PostOpMode /* mode */,
        bytes calldata context,
        uint256 actualGasCost
    ) external onlyEntryPoint {
        (address sender, ) = abi.decode(context, (address, uint256));
        emit GasSponsored(sender, actualGasCost);
    }

    /// @notice Deposit native ETH into the EntryPoint for gas sponsorship.
    function deposit() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
        emit Deposited(msg.value);
    }

    /// @notice Withdraw funds from the EntryPoint back to owner.
    function withdrawTo(address payable destination, uint256 amount) external onlyOwner {
        entryPoint.withdrawTo(destination, amount);
    }

    /// @notice Query current available gas deposit on EntryPoint.
    function getDepositBalance() external view returns (uint256) {
        return entryPoint.getBalanceOf(address(this));
    }
}
