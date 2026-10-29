// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ArenaToken — ERC-20 reward token for Battle Arena.
/// @notice Minimal, self-contained ERC-20 (no OpenZeppelin dependency) with a
///         single trusted minter: the reward distributor (the server wallet).
///         Winners draw losers each receive ARENA tokens minted at match end.
contract ArenaToken {
    string public constant name = "Arena Token";
    string public constant symbol = "ARENA";
    uint8 public constant decimals = 18;

    address public minter;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event MinterChanged(address indexed previous, address indexed current);

    error Unauthorized();
    error InsufficientBalance();
    error InsufficientAllowance();

    modifier onlyMinter() {
        if (msg.sender != minter) revert Unauthorized();
        _;
    }

    constructor(address _minter) {
        minter = _minter;
        emit MinterChanged(address(0), _minter);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a < value) revert InsufficientAllowance();
        if (a != type(uint256).max) allowance[from][msg.sender] = a - value;
        _transfer(from, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    /// @notice Mint new ARENA to `to`. Only the minter (server wallet) may call it.
    function mint(address to, uint256 value) external onlyMinter {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function burn(uint256 value) external {
        if (balanceOf[msg.sender] < value) revert InsufficientBalance();
        balanceOf[msg.sender] -= value;
        totalSupply -= value;
        emit Transfer(msg.sender, address(0), value);
    }

    /// @notice Rotate the minter (e.g. hand rewards to a new distributor).
    function setMinter(address next) external onlyMinter {
        emit MinterChanged(minter, next);
        minter = next;
    }

    function _transfer(address from, address to, uint256 value) internal {
        if (balanceOf[from] < value) revert InsufficientBalance();
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
