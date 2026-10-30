// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ArenaToken
 * @notice ERC-20 reward token for Web3 Battle Arena.
 * @dev Self-contained, lightweight implementation without third-party dependencies.
 *      Enforces a single trusted minter role (the server wallet) to award tokens upon match completion
 *      and chore allowance distribution. Includes batch minting to minimize gas.
 */
contract ArenaToken {
    /// @notice Descriptive name of the token.
    string public constant name = "Arena Token";

    /// @notice Symbol of the token.
    string public constant symbol = "ARENA";

    /// @notice Decimal precision for the token (standard 18 decimals).
    uint8 public constant decimals = 18;

    /// @notice Authorized minter address (the game server relayer).
    address public minter;

    /// @notice Total circulating supply of ARENA tokens in wei units.
    uint256 public totalSupply;

    /// @notice Mapping from account address to current token balance.
    mapping(address => uint256) public balanceOf;

    /// @notice Mapping from account owner to spender allowances.
    mapping(address => mapping(address => uint256)) public allowance;

    /**
     * @notice Emitted when tokens are transferred, including mints and burns.
     * @param from Origin address (address(0) for mints).
     * @param to Destination address (address(0) for burns).
     * @param value Amount of tokens transferred in wei.
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @notice Emitted when a spender allowance is approved.
     * @param owner Address authorizing the spending.
     * @param spender Address allowed to spend tokens.
     * @param value Approved token spending limit in wei.
     */
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /**
     * @notice Emitted when the minter authority is rotated.
     * @param previous Previous minter address.
     * @param current New authorized minter address.
     */
    event MinterChanged(address indexed previous, address indexed current);

    /// @dev Thrown when a non-minter caller invokes a minter-only function.
    error Unauthorized();

    /// @dev Thrown when attempting to transfer or burn more tokens than available.
    error InsufficientBalance();

    /// @dev Thrown when attempting to spend more than approved allowance.
    error InsufficientAllowance();

    /**
     * @notice Restricts function invocation to the authorized minter address.
     */
    modifier onlyMinter() {
        if (msg.sender != minter) revert Unauthorized();
        _;
    }

    /**
     * @notice Initializes the ArenaToken contract with an initial minter.
     * @param _minter Address of the authorized server distributor wallet.
     */
    constructor(address _minter) {
        minter = _minter;
        emit MinterChanged(address(0), _minter);
    }

    /**
     * @notice Standard ERC-20 transfer.
     * @param to Recipient address.
     * @param value Amount of tokens to transfer in wei.
     * @return True upon successful transfer.
     */
    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    /**
     * @notice Standard ERC-20 transferFrom honoring approved allowance.
     * @param from Token owner address.
     * @param to Recipient address.
     * @param value Amount of tokens to transfer in wei.
     * @return True upon successful transfer.
     */
    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a < value) revert InsufficientAllowance();
        if (a != type(uint256).max) allowance[from][msg.sender] = a - value;
        _transfer(from, to, value);
        return true;
    }

    /**
     * @notice Standard ERC-20 approve.
     * @param spender Spender address.
     * @param value Approved amount in wei.
     * @return True upon successful approval.
     */
    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    /**
     * @notice Mints new ARENA tokens to a recipient.
     * @dev Only callable by the minter.
     * @param to Recipient address.
     * @param value Token amount in wei.
     */
    function mint(address to, uint256 value) external onlyMinter {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    /**
     * @notice Batch mints ARENA tokens to multiple recipients in a single atomic transaction.
     * @dev Significantly reduces gas costs and avoids nonce congestion during match settlements.
     * @param recipients Array of recipient addresses.
     * @param values Array of token amounts in wei matching recipients.
     */
    function mintBatch(address[] calldata recipients, uint256[] calldata values) external onlyMinter {
        require(recipients.length == values.length, "ArenaToken: length mismatch");
        uint256 total = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            address to = recipients[i];
            uint256 val = values[i];
            balanceOf[to] += val;
            total += val;
            emit Transfer(address(0), to, val);
        }
        totalSupply += total;
    }

    /**
     * @notice Burns tokens from caller's balance and reduces total supply.
     * @param value Token amount in wei to burn.
     */
    function burn(uint256 value) external {
        if (balanceOf[msg.sender] < value) revert InsufficientBalance();
        balanceOf[msg.sender] -= value;
        totalSupply -= value;
        emit Transfer(msg.sender, address(0), value);
    }

    /**
     * @notice Rotates the minter address to a new distributor.
     * @dev Only callable by the current minter.
     * @param next Address of the new minter.
     */
    function setMinter(address next) external onlyMinter {
        emit MinterChanged(minter, next);
        minter = next;
    }

    /**
     * @dev Internal token transfer logic verifying balances.
     * @param from Sender address.
     * @param to Recipient address.
     * @param value Amount in wei.
     */
    function _transfer(address from, address to, uint256 value) internal {
        if (balanceOf[from] < value) revert InsufficientBalance();
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
