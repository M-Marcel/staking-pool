# StakingPool Smart Contract by Marcellus Nwankwo

This project contains a Solidity smart contract `StakingPool.sol` that allows users to stake an ERC20 token and earn rewards in another ERC20 token. Rewards accrue linearly over time.

## Features

-   Stake and Unstake ERC20 tokens.
-   Linear reward accrual based on staked amount and time.
-   Claim pending rewards at any time.
-   Admin functions to deposit reward tokens and set the reward rate.
-   Secured with OpenZeppelin's ReentrancyGuard and Ownable.
-   Events for all major actions.

## Project Setup

### Prerequisites

-   Node.js (v18 or higher recommended)
-   npm or yarn
-   Hardhat

### Installation

1.  Clone the repository (or create a new Hardhat project and add the files).
2.  Install dependencies:
    ```bash
    npm install
    # or
    # yarn install
    ```
    Required dependencies include:
    ```json
    // package.json (example devDependencies)
    {
      "devDependencies": {
        "@nomicfoundation/hardhat-toolbox": "^5.0.0", // Or specific versions
        "hardhat": "^2.22.0",
        "@openzeppelin/contracts": "^5.0.2",
        "dotenv": "^16.4.5",
        "chai": "^4.3.10", // Often comes with hardhat-toolbox
        "@types/chai": "^4.3.12",
        "@types/mocha": "^10.0.6",
        "ts-node": "^10.9.2",
        "typescript": "^5.4.2"
      }
    }
    ```

## Compilation

To compile the smart contracts:

```bash
npx hardhat compile