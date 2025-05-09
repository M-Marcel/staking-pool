require("@nomicfoundation/hardhat-toolbox"); // Includes ethers, chai, hardhat-ethers
require("dotenv").config(); // If you use .env for private keys or API keys

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      // Configuration for the Hardhat Network (local in-memory blockchain)
    },
    // Example for a testnet like Sepolia:
    // sepolia: {
    //   url: process.env.SEPOLIA_RPC_URL || `https://sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`,
    //   accounts: process.env.PRIVATE_KEY ? [`0x${process.env.PRIVATE_KEY}`] : [],
    //   chainId: 11155111,
    // },
  },
  etherscan: {
    // apiKey: process.env.ETHERSCAN_API_KEY, // For contract verification
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  mocha: {
    timeout: 60000 // Increased timeout for potentially long-running tests
  }
};