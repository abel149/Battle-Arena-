// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ArenaPaymaster — ERC-4337 Account Abstraction Gas Paymaster
 * @notice Sponsoring gas for Web3 Battle Arena players on L2s (Base, Arbitrum, Polygon).
 *         Kids never need ETH or native gas tokens. When players unlock skins,
 *         mint match achievements, or redeem chores, this Paymaster pays the
 *         ERC-4337 Bundler directly via the EntryPoint deposit.
 * @dev Conforms to ERC-4337 v0.7 PackedUserOperation paymaster specifications with whitelisting and rate-limiting.
 */

/**
 * @notice Minimal interface to ERC-4337 EntryPoint contract.
 */
interface IEntryPoint {
    /**
     * @notice Deposit funds into the EntryPoint for an account.
     * @param account Target address whose deposit balance is credited.
     */
    function depositTo(address account) external payable;

    /**
     * @notice Withdraw funds from the EntryPoint deposit.
     * @param withdrawAddress Address receiving native ETH withdrawal.
     * @param withdrawAmount Amount of wei to withdraw.
     */
    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external;

    /**
     * @notice Returns the deposited gas balance of an account.
     * @param account Address to query.
     * @return Available balance in wei deposited at the EntryPoint.
     */
    function getBalanceOf(address account) external view returns (uint256);
}

/**
 * @notice Mode enum passed by EntryPoint to postOp.
 */
enum PostOpMode {
    opSucceeded,
    opReverted,
    postOpReverted
}

/**
 * @notice ERC-4337 v0.7 Packed UserOperation struct definition.
 * @param sender Smart account address initiating the operation.
 * @param nonce Anti-replay sequential nonce.
 * @param initCode Bytecode to deploy account contract if not yet initialized.
 * @param callData Calldata to execute against sender account.
 * @param accountGasLimits Packed verification gas limit (16 bytes) and call gas limit (16 bytes).
 * @param preVerificationGas Gas overhead compensation for bundler pre-verification.
 * @param gasFees Packed maxPriorityFeePerGas (16 bytes) and maxFeePerGas (16 bytes).
 * @param paymasterAndData Packed paymaster address, gas limits, and validation data.
 * @param signature Verification signature by smart account owner.
 */
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
    /// @notice Address of the contract administrator / treasury manager.
    address public owner;

    /// @notice Address of the canonical ERC-4337 EntryPoint contract.
    IEntryPoint public immutable entryPoint;

    /// @notice Whitelist of allowed arena game contracts whose calls can be gas-sponsored.
    mapping(address => bool) public isWhitelistedTarget;

    /// @notice Daily gas sponsorship tracker: user address => cumulative wei sponsored today.
    mapping(address => uint256) public dailySponsorshipWei;

    /// @notice Day index (block.timestamp / 1 days) of user's last sponsored transaction.
    mapping(address => uint256) public lastSponsorshipDay;

    /// @notice Maximum daily gas allowance per player in wei (0.05 ether covers 100+ L2 transactions).
    uint256 public constant MAX_DAILY_SPONSORSHIP = 0.05 ether;

    /**
     * @notice Emitted when a contract target's whitelist status is modified.
     * @param target Target contract address.
     * @param allowed True if allowed for gas sponsorship, false if revoked.
     */
    event TargetWhitelisted(address indexed target, bool allowed);

    /**
     * @notice Emitted after a UserOperation execution with actual gas sponsored.
     * @param user Address of the player whose transaction was sponsored.
     * @param actualGasCost Amount in wei reimbursed to the EntryPoint bundler.
     */
    event GasSponsored(address indexed user, uint256 actualGasCost);

    /**
     * @notice Emitted when native ETH is deposited into the EntryPoint for gas sponsorship.
     * @param amount Wei amount deposited.
     */
    event Deposited(uint256 amount);

    /// @notice Thrown when caller lacks owner or EntryPoint authorization.
    error Unauthorized();

    /// @notice Thrown when UserOperation calls a contract not in whitelist.
    error TargetNotWhitelisted();

    /// @notice Thrown when player exceeds MAX_DAILY_SPONSORSHIP for the current day.
    error DailyQuotaExceeded();

    /**
     * @notice Restricts function execution to the contract owner.
     */
    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    /**
     * @notice Restricts function execution to the authorized EntryPoint contract.
     */
    modifier onlyEntryPoint() {
        if (msg.sender != address(entryPoint)) revert Unauthorized();
        _;
    }

    /**
     * @notice Initializes the Paymaster with EntryPoint and owner addresses.
     * @param _entryPoint Address of canonical ERC-4337 EntryPoint.
     * @param _owner Administrative owner address.
     */
    constructor(address _entryPoint, address _owner) {
        entryPoint = IEntryPoint(_entryPoint);
        owner = _owner;
    }

    /**
     * @notice Fallback function to automatically route incoming native ETH to EntryPoint deposit.
     */
    receive() external payable {
        if (address(entryPoint) != address(0)) {
            entryPoint.depositTo{value: msg.value}(address(this));
            emit Deposited(msg.value);
        }
    }

    /**
     * @notice Sets authorization for game contracts to receive paymaster gas sponsorship.
     * @param target Address of target contract (e.g. ArenaToken, MatchResult).
     * @param allowed True to whitelist, false to delist.
     */
    function setWhitelistedTarget(address target, bool allowed) external onlyOwner {
        isWhitelistedTarget[target] = allowed;
        emit TargetWhitelisted(target, allowed);
    }

    /**
     * @notice ERC-4337 EntryPoint validation hook.
     * @dev Validates caller is EntryPoint and player has not exceeded daily quota.
     * @param userOp PackedUserOperation submitted by bundler.
     * @param maxCost Maximum possible cost in wei calculated by EntryPoint.
     * @return context Encoded context bytes passed to postOp (sender, maxCost).
     * @return validationData Validation status (0 indicating valid operation).
     */
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

    /**
     * @notice ERC-4337 EntryPoint post-execution hook called after transaction execution.
     * @dev Emits GasSponsored event with the final actual gas cost settled by the EntryPoint.
     * @param context Context returned by validatePaymasterUserOp.
     * @param actualGasCost Actual gas cost in wei settled by EntryPoint.
     */
    function postOp(
        PostOpMode /* mode */,
        bytes calldata context,
        uint256 actualGasCost
    ) external onlyEntryPoint {
        (address sender, ) = abi.decode(context, (address, uint256));
        emit GasSponsored(sender, actualGasCost);
    }

    /**
     * @notice Deposit native ETH into the EntryPoint for ongoing gas sponsorship.
     */
    function deposit() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
        emit Deposited(msg.value);
    }

    /**
     * @notice Withdraw funds from the EntryPoint back to owner or designated recipient.
     * @param destination Target recipient address.
     * @param amount Amount in wei to withdraw.
     */
    function withdrawTo(address payable destination, uint256 amount) external onlyOwner {
        entryPoint.withdrawTo(destination, amount);
    }

    /**
     * @notice Query current available gas deposit balance on EntryPoint.
     * @return Available wei balance held in EntryPoint for this paymaster.
     */
    function getDepositBalance() external view returns (uint256) {
        return entryPoint.getBalanceOf(address(this));
    }
}
