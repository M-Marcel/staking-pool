// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol"; // For minting control if needed

contract MockERC20 is ERC20, Ownable {
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupplyOwner,
        address ownerAddress
    ) ERC20(name, symbol) Ownable(ownerAddress) {
        if (initialSupplyOwner > 0) {
            _mint(ownerAddress, initialSupplyOwner);
        }
    }

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) public { // Allow burning for testing
        _burn(from, amount);
    }
}