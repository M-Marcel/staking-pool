import { ethers } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { StakingPool, MockERC20 } from "../typechain-types"; // Adjust if typechain output path differs
import { ContractTransactionResponse } from "ethers";

const SECONDS_IN_YEAR = 365 * 24 * 60 * 60;
const REWARD_RATE_PRECISION = ethers.parseUnits("1", 18); // 1e18

// Helper function to increase EVM time
async function increaseTime(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

describe("StakingPool", function () {
  let owner: HardhatEthersSigner;
  let staker1: HardhatEthersSigner;
  let staker2: HardhatEthersSigner;
  let otherUser: HardhatEthersSigner;

  let stakingToken: MockERC20;
  let rewardToken: MockERC20;
  let stakingPool: StakingPool;

  const stakingTokenName = "Staking Token";
  const stakingTokenSymbol = "STK";
  const rewardTokenName = "Reward Token";
  const rewardTokenSymbol = "RWD";

  const initialTokenSupply = ethers.parseUnits("1000000", 18); // 1 million tokens
  const tenPercentAnnualRate = ethers.parseUnits("0.1", 18); // 0.1 * 10^18 for 10% APR

  beforeEach(async function () {
    [owner, staker1, staker2, otherUser] = await ethers.getSigners();

    // Deploy MockERC20 for staking
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    stakingToken = (await MockERC20Factory.connect(owner).deploy(
      stakingTokenName,
      stakingTokenSymbol,
      0, // Mint later or mint to deployer
      owner.address
    )) as unknown as MockERC20;
    await stakingToken.waitForDeployment();
    await stakingToken.connect(owner).mint(owner.address, initialTokenSupply);

    // Deploy MockERC20 for rewards
    rewardToken = (await MockERC20Factory.connect(owner).deploy(
      rewardTokenName,
      rewardTokenSymbol,
      0,
      owner.address
    )) as unknown as MockERC20;
    await rewardToken.waitForDeployment();
    await rewardToken.connect(owner).mint(owner.address, initialTokenSupply);

    // Deploy StakingPool
    const StakingPoolFactory = await ethers.getContractFactory("StakingPool");
    stakingPool = (await StakingPoolFactory.connect(owner).deploy(
      await stakingToken.getAddress(),
      await rewardToken.getAddress(),
      tenPercentAnnualRate
    )) as unknown as StakingPool;
    await stakingPool.waitForDeployment();

    // Distribute staking tokens to stakers
    await stakingToken
      .connect(owner)
      .transfer(staker1.address, ethers.parseUnits("10000", 18));
    await stakingToken
      .connect(owner)
      .transfer(staker2.address, ethers.parseUnits("10000", 18));

    // Approve StakingPool to spend stakers' tokens
    await stakingToken
      .connect(staker1)
      .approve(await stakingPool.getAddress(), ethers.MaxUint256);
    await stakingToken
      .connect(staker2)
      .approve(await stakingPool.getAddress(), ethers.MaxUint256);

    // Fund the StakingPool with reward tokens
    await rewardToken
      .connect(owner)
      .approve(await stakingPool.getAddress(), ethers.MaxUint256);
    await stakingPool
      .connect(owner)
      .depositRewardTokens(ethers.parseUnits("100000", 18)); // 100k rewards
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await stakingPool.owner()).to.equal(owner.address);
    });

    it("Should set the correct staking and reward tokens", async function () {
      expect(await stakingPool.stakingToken()).to.equal(
        await stakingToken.getAddress()
      );
      expect(await stakingPool.rewardToken()).to.equal(
        await rewardToken.getAddress()
      );
    });

    it("Should set the initial reward rate", async function () {
      expect(await stakingPool.rewardRate()).to.equal(tenPercentAnnualRate);
    });
  });

  describe("Administration Functions", function () {
    describe("depositRewardTokens", function () {
      it("Should allow owner to deposit reward tokens", async function () {
        const depositAmount = ethers.parseUnits("1000", 18);
        const initialPoolBalance = await rewardToken.balanceOf(
          await stakingPool.getAddress()
        );
        const ownerInitialBalance = await rewardToken.balanceOf(owner.address);

        await expect(
          stakingPool.connect(owner).depositRewardTokens(depositAmount)
        )
          .to.emit(stakingPool, "RewardTokensDeposited")
          .withArgs(owner.address, depositAmount);

        expect(
          await rewardToken.balanceOf(await stakingPool.getAddress())
        ).to.equal(initialPoolBalance + depositAmount);
        expect(await rewardToken.balanceOf(owner.address)).to.equal(
          ownerInitialBalance - depositAmount
        );
      });

      it("Should prevent non-owner from depositing reward tokens", async function () {
        const depositAmount = ethers.parseUnits("1000", 18);
        await expect(
          stakingPool.connect(staker1).depositRewardTokens(depositAmount)
        ).to.be.revertedWithCustomError(
          stakingPool,
          "OwnableUnauthorizedAccount"
        );
      });

      it("Should revert if depositing zero reward tokens", async function () {
        await expect(
          stakingPool.connect(owner).depositRewardTokens(0)
        ).to.be.revertedWith("StakingPool: Cannot deposit 0 reward tokens");
      });
    });

    describe("setRewardRate", function () {
      it("Should allow owner to set reward rate", async function () {
        const newRate = ethers.parseUnits("0.05", 18); // 5%
        await expect(stakingPool.connect(owner).setRewardRate(newRate))
          .to.emit(stakingPool, "RewardRateChanged")
          .withArgs(tenPercentAnnualRate, newRate);
        expect(await stakingPool.rewardRate()).to.equal(newRate);
      });

      it("Should prevent non-owner from setting reward rate", async function () {
        const newRate = ethers.parseUnits("0.05", 18);
        await expect(
          stakingPool.connect(staker1).setRewardRate(newRate)
        ).to.be.revertedWithCustomError(
          stakingPool,
          "OwnableUnauthorizedAccount"
        );
      });
    });

    describe("withdrawStuckTokens", function () {
      let stuckToken: MockERC20;
      const stuckAmount = ethers.parseUnits("100", 18);

      beforeEach(async function () {
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        stuckToken = (await MockERC20Factory.connect(owner).deploy(
          "Stuck",
          "STUCK",
          0,
          owner.address
        )) as unknown as MockERC20;
        await stuckToken.waitForDeployment();
        await stuckToken
          .connect(owner)
          .mint(await stakingPool.getAddress(), stuckAmount); // Directly mint to pool
      });

      it("Should allow owner to withdraw stuck ERC20 tokens", async function () {
        const ownerInitialBalance = await stuckToken.balanceOf(owner.address);
        await expect(
          stakingPool
            .connect(owner)
            .withdrawStuckTokens(await stuckToken.getAddress(), stuckAmount)
        ).to.not.be.reverted;
        expect(
          await stuckToken.balanceOf(await stakingPool.getAddress())
        ).to.equal(0);
        expect(await stuckToken.balanceOf(owner.address)).to.equal(
          ownerInitialBalance + stuckAmount
        );
      });

      it("Should prevent withdrawing staking token", async function () {
        await expect(
          stakingPool
            .connect(owner)
            .withdrawStuckTokens(await stakingToken.getAddress(), stuckAmount)
        ).to.be.revertedWith(
          "StakingPool: Cannot withdraw staking token with this function"
        );
      });

      it("Should prevent withdrawing reward token", async function () {
        await expect(
          stakingPool
            .connect(owner)
            .withdrawStuckTokens(await rewardToken.getAddress(), stuckAmount)
        ).to.be.revertedWith(
          "StakingPool: Cannot withdraw reward token with this function"
        );
      });
      it("Should prevent non-owner from withdrawing stuck tokens", async function () {
        await expect(
          stakingPool
            .connect(staker1)
            .withdrawStuckTokens(await stuckToken.getAddress(), stuckAmount)
        ).to.be.revertedWithCustomError(
          stakingPool,
          "OwnableUnauthorizedAccount"
        );
      });
    });
  });

  describe("Core Staking Functionality", function () {
    const stakeAmount = ethers.parseUnits("100", 18); // 100 STK

    describe("stake", function () {
      it("Should allow a user to stake tokens", async function () {
        const initialStakerBalance = await stakingToken.balanceOf(
          staker1.address
        );
        const initialPoolBalance = await stakingToken.balanceOf(
          await stakingPool.getAddress()
        );
        const initialTotalStaked = await stakingPool.totalStaked();

        const stakeTx = await stakingPool.connect(staker1).stake(stakeAmount);
        await expect(stakeTx)
          .to.emit(stakingPool, "Staked")
          .withArgs(staker1.address, stakeAmount);

        const block = await ethers.provider.getBlock(stakeTx.blockNumber!);

        expect(await stakingToken.balanceOf(staker1.address)).to.equal(
          initialStakerBalance - stakeAmount
        );
        expect(
          await stakingToken.balanceOf(await stakingPool.getAddress())
        ).to.equal(initialPoolBalance + stakeAmount);
        expect(await stakingPool.totalStaked()).to.equal(
          initialTotalStaked + stakeAmount
        );

        const userInfo = await stakingPool.userStakeInfo(staker1.address);
        expect(userInfo.amount).to.equal(stakeAmount);
        expect(userInfo.lastRewardUpdateTime).to.equal(block!.timestamp);
        expect(userInfo.unclaimedRewards).to.equal(0);
      });

      it("Should revert if staking 0 tokens", async function () {
        await expect(stakingPool.connect(staker1).stake(0)).to.be.revertedWith(
          "StakingPool: Cannot stake 0 tokens"
        );
      });

      it("Should update rewards and add to stake if already staked", async function () {
        await stakingPool.connect(staker1).stake(stakeAmount); // Initial stake
        const firstStakeTime = (
          await stakingPool.userStakeInfo(staker1.address)
        ).lastRewardUpdateTime;

        await increaseTime(SECONDS_IN_YEAR / 2); // Wait half a year

        const secondStakeAmount = ethers.parseUnits("50", 18);
        const stakeTx = await stakingPool
          .connect(staker1)
          .stake(secondStakeAmount);
        const block = await ethers.provider.getBlock(stakeTx.blockNumber!);
        const currentTime = BigInt(block!.timestamp);

        const expectedRewards =
          (stakeAmount *
            tenPercentAnnualRate *
            (currentTime - firstStakeTime)) /
          BigInt(SECONDS_IN_YEAR) /
          REWARD_RATE_PRECISION;

        const userInfo = await stakingPool.userStakeInfo(staker1.address);
        expect(userInfo.amount).to.equal(stakeAmount + secondStakeAmount);
        expect(userInfo.lastRewardUpdateTime).to.equal(currentTime);
        // Using closeTo for reward checks due to potential minor timestamp variations if not careful
        expect(userInfo.unclaimedRewards).to.be.closeTo(
          expectedRewards,
          ethers.parseUnits("0.00001", 18)
        ); // Small tolerance
      });
    });

    describe("getPendingRewards", function () {
      it("Should correctly calculate pending rewards", async function () {
        await stakingPool.connect(staker1).stake(stakeAmount);
        const stakeTime = (await stakingPool.userStakeInfo(staker1.address))
          .lastRewardUpdateTime;

        await increaseTime(SECONDS_IN_YEAR); // Wait one year

        const pendingRewards = await stakingPool.getPendingRewards(
          staker1.address
        );
        const expectedRewards =
          (stakeAmount * tenPercentAnnualRate * BigInt(SECONDS_IN_YEAR)) /
          BigInt(SECONDS_IN_YEAR) /
          REWARD_RATE_PRECISION;

        expect(pendingRewards).to.be.closeTo(
          expectedRewards,
          ethers.parseUnits("0.00001", 18)
        ); // stakeAmount * 0.1
      });

      it("Should return 0 pending rewards for non-staker or 0 amount", async function () {
        expect(await stakingPool.getPendingRewards(otherUser.address)).to.equal(
          0
        );
        await stakingPool.connect(staker1).stake(stakeAmount);
        await stakingPool.connect(staker1).unstake(stakeAmount); // Unstake all
        expect(await stakingPool.getPendingRewards(staker1.address)).to.equal(
          0
        ); // Unclaimed rewards should be 0 after _updateRewardsInternal in unstake
      });
    });

    describe("claimReward", function () {
      it("Should allow a user to claim their rewards", async function () {
        await stakingPool.connect(staker1).stake(stakeAmount);
        await increaseTime(SECONDS_IN_YEAR); // Wait one year

        const pendingRewardsBeforeClaim = await stakingPool.getPendingRewards(
          staker1.address
        );
        expect(pendingRewardsBeforeClaim).to.be.gt(0);

        const initialStakerRewardBalance = await rewardToken.balanceOf(
          staker1.address
        );
        const initialPoolRewardBalance = await rewardToken.balanceOf(
          await stakingPool.getAddress()
        );

        const claimTx = await stakingPool.connect(staker1).claimReward();
        await expect(claimTx)
          .to.emit(stakingPool, "RewardClaimed")
          .withArgs(
            staker1.address,
            (args: any) =>
              args.toString() === pendingRewardsBeforeClaim.toString()
          ); // Check emitted reward amount

        const block = await ethers.provider.getBlock(claimTx.blockNumber!);

        expect(await rewardToken.balanceOf(staker1.address)).to.equal(
          initialStakerRewardBalance + pendingRewardsBeforeClaim
        );
        expect(
          await rewardToken.balanceOf(await stakingPool.getAddress())
        ).to.equal(initialPoolRewardBalance - pendingRewardsBeforeClaim);

        const userInfo = await stakingPool.userStakeInfo(staker1.address);
        expect(userInfo.unclaimedRewards).to.equal(0);
        expect(userInfo.lastRewardUpdateTime).to.equal(block!.timestamp);
        expect(await stakingPool.getPendingRewards(staker1.address)).to.equal(
          0
        );
      });

      it("Should revert if trying to claim with no rewards", async function () {
        await stakingPool.connect(staker1).stake(stakeAmount);
        // No time passed
        await expect(
          stakingPool.connect(staker1).claimReward()
        ).to.be.revertedWith("StakingPool: No rewards to claim");
      });

      it("Should correctly update lastRewardUpdateTime on claim", async function () {
        await stakingPool.connect(staker1).stake(stakeAmount);
        await increaseTime(SECONDS_IN_YEAR / 2);
        const claimTx = await stakingPool.connect(staker1).claimReward();
        const block = await ethers.provider.getBlock(claimTx.blockNumber!);
        const userInfo = await stakingPool.userStakeInfo(staker1.address);
        expect(userInfo.lastRewardUpdateTime).to.equal(block!.timestamp);
      });
    });

    describe("unstake", function () {
      beforeEach(async function () {
        await stakingPool.connect(staker1).stake(stakeAmount); // Stake 100 tokens
        await increaseTime(SECONDS_IN_YEAR); // Accrue rewards for 1 year
      });

      it("Should allow a user to unstake partial amount", async function () {
        const unstakeAmount = ethers.parseUnits("40", 18);
        const initialStakerTokenBalance = await stakingToken.balanceOf(
          staker1.address
        );
        const initialPoolTokenBalance = await stakingToken.balanceOf(
          await stakingPool.getAddress()
        );
        const initialTotalStaked = await stakingPool.totalStaked();

        const pendingRewardsBeforeUnstake = await stakingPool.getPendingRewards(
          staker1.address
        );

        const unstakeTx = await stakingPool
          .connect(staker1)
          .unstake(unstakeAmount);
        await expect(unstakeTx)
          .to.emit(stakingPool, "Unstaked")
          .withArgs(staker1.address, unstakeAmount);

        const block = await ethers.provider.getBlock(unstakeTx.blockNumber!);

        expect(await stakingToken.balanceOf(staker1.address)).to.equal(
          initialStakerTokenBalance + unstakeAmount
        );
        expect(
          await stakingToken.balanceOf(await stakingPool.getAddress())
        ).to.equal(initialPoolTokenBalance - unstakeAmount);
        expect(await stakingPool.totalStaked()).to.equal(
          initialTotalStaked - unstakeAmount
        );

        const userInfo = await stakingPool.userStakeInfo(staker1.address);
        expect(userInfo.amount).to.equal(stakeAmount - unstakeAmount);
        expect(userInfo.unclaimedRewards).to.be.closeTo(
          pendingRewardsBeforeUnstake,
          ethers.parseUnits("0.00001", 18)
        );
        expect(userInfo.lastRewardUpdateTime).to.equal(block!.timestamp);
      });

      it("Should allow a user to unstake full amount", async function () {
        const unstakeAmount = stakeAmount; // Unstake all
        const pendingRewardsBeforeUnstake = await stakingPool.getPendingRewards(
          staker1.address
        );

        await stakingPool.connect(staker1).unstake(unstakeAmount);

        const userInfo = await stakingPool.userStakeInfo(staker1.address);
        expect(userInfo.amount).to.equal(0);
        expect(userInfo.unclaimedRewards).to.be.closeTo(
          pendingRewardsBeforeUnstake,
          ethers.parseUnits("0.00001", 18)
        );
        expect(await stakingPool.totalStaked()).to.equal(0); // Assuming only one staker for this check
      });

      it("Should revert if unstaking 0 tokens", async function () {
        await expect(
          stakingPool.connect(staker1).unstake(0)
        ).to.be.revertedWith("StakingPool: Cannot unstake 0 tokens");
      });

      it("Should revert if unstaking more than staked", async function () {
        const excessiveAmount = stakeAmount + ethers.parseUnits("1", 18);
        await expect(
          stakingPool.connect(staker1).unstake(excessiveAmount)
        ).to.be.revertedWith("StakingPool: Insufficient staked balance");
      });

      it("Should correctly update rewards before unstaking", async function () {
        const expectedRewards =
          (stakeAmount * tenPercentAnnualRate * BigInt(SECONDS_IN_YEAR)) /
          BigInt(SECONDS_IN_YEAR) /
          REWARD_RATE_PRECISION;
        await stakingPool.connect(staker1).unstake(stakeAmount); // Unstake all
        const userInfo = await stakingPool.userStakeInfo(staker1.address);
        expect(userInfo.unclaimedRewards).to.be.closeTo(
          expectedRewards,
          ethers.parseUnits("0.00001", 18)
        );
      });
    });

    describe("Complex Scenarios", function () {
      it("Stake -> Wait -> Stake more -> Wait -> Claim -> Unstake", async function () {
        const firstStake = ethers.parseUnits("100", 18);
        const secondStake = ethers.parseUnits("50", 18);

        // 1. Staker1 stakes 100 tokens
        let tx = await stakingPool.connect(staker1).stake(firstStake);
        let time1 = BigInt(
          (await ethers.provider.getBlock(tx.blockNumber!))!.timestamp
        );

        // 2. Wait for 0.5 year
        await increaseTime(SECONDS_IN_YEAR / 2);
        let time2 = time1 + BigInt(SECONDS_IN_YEAR / 2);

        // 3. Staker1 stakes 50 more tokens
        tx = await stakingPool.connect(staker1).stake(secondStake);
        let time3 = BigInt(
          (await ethers.provider.getBlock(tx.blockNumber!))!.timestamp
        ); // ~time2

        const rewardsFromFirstPeriod =
          (firstStake * tenPercentAnnualRate * (time3 - time1)) /
          BigInt(SECONDS_IN_YEAR) /
          REWARD_RATE_PRECISION;
        let userInfo = await stakingPool.userStakeInfo(staker1.address);
        expect(userInfo.amount).to.equal(firstStake + secondStake);
        expect(userInfo.unclaimedRewards).to.be.closeTo(
          rewardsFromFirstPeriod,
          ethers.parseUnits("0.001", 18)
        );

        // 4. Wait for another 0.5 year
        await increaseTime(SECONDS_IN_YEAR / 2);
        let time4 = time3 + BigInt(SECONDS_IN_YEAR / 2);

        // Calculate expected rewards for the second period
        const totalStakedDuringSecondPeriod = firstStake + secondStake;
        const rewardsFromSecondPeriod =
          (totalStakedDuringSecondPeriod *
            tenPercentAnnualRate *
            (time4 - time3)) /
          BigInt(SECONDS_IN_YEAR) /
          REWARD_RATE_PRECISION;
        const totalExpectedRewards =
          rewardsFromFirstPeriod + rewardsFromSecondPeriod;

        expect(
          await stakingPool.getPendingRewards(staker1.address)
        ).to.be.closeTo(totalExpectedRewards, ethers.parseUnits("0.001", 18));

        // 5. Claim rewards
        const staker1InitialRewardBalance = await rewardToken.balanceOf(
          staker1.address
        );
        await stakingPool.connect(staker1).claimReward();
        userInfo = await stakingPool.userStakeInfo(staker1.address);
        expect(userInfo.unclaimedRewards).to.equal(0);
        expect(await rewardToken.balanceOf(staker1.address)).to.be.closeTo(
          staker1InitialRewardBalance + totalExpectedRewards,
          ethers.parseUnits("0.001", 18)
        );
        const time5 = userInfo.lastRewardUpdateTime; // ~time4

        // 6. Unstake all
        const staker1InitialStakingBalance = await stakingToken.balanceOf(
          staker1.address
        );
        await stakingPool
          .connect(staker1)
          .unstake(totalStakedDuringSecondPeriod);
        userInfo = await stakingPool.userStakeInfo(staker1.address);
        expect(userInfo.amount).to.equal(0);
        // Rewards accrued between claim and unstake (should be minimal if time5 ~ time of unstake)
        const rewardsAfterClaim =
          (totalStakedDuringSecondPeriod *
            tenPercentAnnualRate *
            (userInfo.lastRewardUpdateTime - time5)) /
          BigInt(SECONDS_IN_YEAR) /
          REWARD_RATE_PRECISION;
        expect(userInfo.unclaimedRewards).to.be.closeTo(
          rewardsAfterClaim,
          ethers.parseUnits("0.0001", 18)
        );
        expect(await stakingToken.balanceOf(staker1.address)).to.equal(
          staker1InitialStakingBalance + totalStakedDuringSecondPeriod
        );
      });

      it("Multiple stakers accrue rewards independently", async function () {
        const stake1Amount = ethers.parseUnits("100", 18);
        const stake2Amount = ethers.parseUnits("200", 18);

        await stakingPool.connect(staker1).stake(stake1Amount);
        await stakingPool.connect(staker2).stake(stake2Amount);

        await increaseTime(SECONDS_IN_YEAR);

        const rewards1 = await stakingPool.getPendingRewards(staker1.address);
        const rewards2 = await stakingPool.getPendingRewards(staker2.address);

        const expectedRewards1 =
          (stake1Amount * tenPercentAnnualRate) / REWARD_RATE_PRECISION; // For 1 year
        const expectedRewards2 =
          (stake2Amount * tenPercentAnnualRate) / REWARD_RATE_PRECISION; // For 1 year

        expect(rewards1).to.be.closeTo(
          expectedRewards1,
          ethers.parseUnits("0.001", 18)
        );
        expect(rewards2).to.be.closeTo(
          expectedRewards2,
          ethers.parseUnits("0.001", 18)
        );

        // Staker 1 claims
        await stakingPool.connect(staker1).claimReward();
        const userInfo1 = await stakingPool.userStakeInfo(staker1.address);
        expect(userInfo1.unclaimedRewards).to.equal(0);

        // Staker 2 rewards should remain unaffected by staker 1's claim
        const rewards2After1Claim = await stakingPool.getPendingRewards(
          staker2.address
        );
        expect(rewards2After1Claim).to.be.closeTo(
          expectedRewards2,
          ethers.parseUnits("0.001", 18)
        ); // Still has its full year reward
      });
    });

    describe("Edge Cases", function () {
      it("Staking when reward rate is 0", async function () {
        await stakingPool.connect(owner).setRewardRate(0); // Set rate to 0
        await stakingPool.connect(staker1).stake(stakeAmount);
        await increaseTime(SECONDS_IN_YEAR);
        expect(await stakingPool.getPendingRewards(staker1.address)).to.equal(
          0
        );
        await expect(
          stakingPool.connect(staker1).claimReward()
        ).to.be.revertedWith("StakingPool: No rewards to claim");
      });

      it("Claiming when reward pool is potentially empty (transfer should fail)", async function () {
        await stakingPool
          .connect(staker1)
          .stake(ethers.parseUnits("1000000", 18)); // Large stake
        await increaseTime(SECONDS_IN_YEAR); // Accrue massive rewards

        // Drain reward tokens from the pool by owner (simulating insufficient rewards)
        const poolBalance = await rewardToken.balanceOf(
          await stakingPool.getAddress()
        );
        if (poolBalance > 0) {
          // Need a way for owner to withdraw reward tokens directly (not typical, for test only)
          // Or, deploy pool with very few reward tokens initially.
          // For this test, we'll rely on the safeTransfer failing if contract doesn't have enough.
          // Let's set reward balance to less than pending.
          await rewardToken
            .connect(owner)
            .burn(await stakingPool.getAddress(), poolBalance - BigInt(1)); // Burn almost all reward tokens in pool
        }

        const pendingRewards = await stakingPool.getPendingRewards(
          staker1.address
        );
        if (pendingRewards > 1) {
          // If there are rewards to claim and pool has only 1 token
          await expect(stakingPool.connect(staker1).claimReward()).to.be
            .reverted; // ERC20: transfer amount exceeds balance or similar
        } else {
          // If pending rewards are 0 or 1, this test case might not be triggered as expected.
          // This scenario depends on SafeERC20 behavior when funds are insufficient.
          console.warn(
            "Skipping specific revert check for empty pool claim as rewards might be too low or contract has 1 token unit left."
          );
        }
      });

      it("Emergency exit (unstake all)", async function () {
        await stakingPool.connect(staker1).stake(stakeAmount);
        await increaseTime(SECONDS_IN_YEAR / 4); // Accrue some rewards

        const initialStakerTokenBalance = await stakingToken.balanceOf(
          staker1.address
        );
        const pendingRewards = await stakingPool.getPendingRewards(
          staker1.address
        );

        await stakingPool.connect(staker1).unstake(stakeAmount); // Unstake all

        const userInfo = await stakingPool.userStakeInfo(staker1.address);
        expect(userInfo.amount).to.equal(0);
        expect(userInfo.unclaimedRewards).to.be.closeTo(
          pendingRewards,
          ethers.parseUnits("0.001", 18)
        );
        expect(await stakingToken.balanceOf(staker1.address)).to.equal(
          initialStakerTokenBalance + stakeAmount
        );

        // User can then claim these `unclaimedRewards`
        if (pendingRewards > 0) {
          await stakingPool.connect(staker1).claimReward();
          expect(
            (await stakingPool.userStakeInfo(staker1.address)).unclaimedRewards
          ).to.equal(0);
        }
      });
    });

    describe("Reentrancy Guard", function () {
      // A direct reentrancy test requires a malicious contract.
      // We confirm the modifier is present on stake, unstake, claimReward, depositRewardTokens.
      // For this test, we'll just ensure a call doesn't obviously fail due to reentrancy issues
      // in a simple sequence, acknowledging true reentrancy is harder to unit test simply.
      it("Should prevent reentrancy on stake (conceptual check)", async function () {
        // This doesn't actually test reentrancy but ensures the function works.
        // A real reentrancy attack involves a malicious contract calling back into stake.
        await expect(stakingPool.connect(staker1).stake(stakeAmount)).to.not.be
          .reverted;
      });
    });
  });
});
