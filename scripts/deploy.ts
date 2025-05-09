import { ethers } from "hardhat";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    const stakingTokenAddress = "0xYourStakingTokenAddress"; // Replace with actual ERC20 address
    const rewardTokenAddress = "0xYourRewardTokenAddress";   // Replace with actual ERC20 address

    // Example: 10% APR. 0.1 * 10^18 = 10^17
    const initialRewardRate = ethers.parseUnits("0.1", 18); // Or "100000000000000000"

    const StakingPoolFactory = await ethers.getContractFactory("StakingPool");
    const stakingPool = await StakingPoolFactory.deploy(
        stakingTokenAddress,
        rewardTokenAddress,
        initialRewardRate
    );

    await stakingPool.waitForDeployment();
    const stakingPoolAddress = await stakingPool.getAddress();

    console.log("StakingPool deployed to:", stakingPoolAddress);

    // You might want to deposit some reward tokens after deployment
    // const rewardTokenContract = await ethers.getContractAt("MockERC20", rewardTokenAddress); // Assuming MockERC20 interface or actual IERC20
    // const depositAmount = ethers.parseUnits("100000", 18); // 100,000 reward tokens
    // await rewardTokenContract.connect(deployer).approve(stakingPoolAddress, depositAmount);
    // await stakingPool.connect(deployer).depositRewardTokens(depositAmount);
    // console.log(`Deposited ${ethers.formatUnits(depositAmount, 18)} reward tokens into the pool.`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });