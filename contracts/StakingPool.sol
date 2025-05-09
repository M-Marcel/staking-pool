// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title StakingPool
 * @dev A contract for staking ERC20 tokens and earning rewards in another ERC20 token.
 * Rewards accrue linearly over time based on the staked amount and a configurable reward rate.
 */
contract StakingPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Structs ---

    /**
     * @dev Stores information about a user's stake.
     * @param amount The amount of stakingToken currently staked by the user.
     * @param lastRewardUpdateTime Timestamp of the last moment rewards were calculated and updated for the user.
     * @param unclaimedRewards Rewards accrued up to `lastRewardUpdateTime` that have not yet been claimed.
     */
    struct StakeInfo {
        uint256 amount;
        uint256 lastRewardUpdateTime;
        uint256 unclaimedRewards;
    }

    // --- Constants ---

    /**
     * @dev Number of seconds in a year (365 days).
     */
    uint256 public constant SECONDS_IN_YEAR = 365 days;

    /**
     * @dev Precision factor for rewardRate calculations.
     * rewardRate is stored as (actual_rate * REWARD_RATE_PRECISION).
     * For example, an actual rate of 0.1 (10%) is stored as 0.1 * 10^18.
     */
    uint256 public constant REWARD_RATE_PRECISION = 1e18;

    // --- State Variables ---

    /**
     * @dev The ERC20 token that users stake.
     */
    IERC20 public immutable stakingToken;

    /**
     * @dev The ERC20 token used for distributing rewards.
     */
    IERC20 public immutable rewardToken;

    /**
     * @dev The annual reward rate.
     * This value represents how many `rewardToken` base units are earned per one `stakingToken`
     * base unit over a year, scaled by `REWARD_RATE_PRECISION`.
     * For example, if you want to give 0.1 reward tokens per staked token per year,
     * set rewardRate = 0.1 * 10^18 = 10^17.
     */
    uint256 public rewardRate;

    /**
     * @dev Total amount of stakingTokens currently staked in the contract.
     */
    uint256 public totalStaked;

    /**
     * @dev Mapping from user address to their stake information.
     */
    mapping(address => StakeInfo) public userStakeInfo;

    // --- Events ---

    /**
     * @dev Emitted when a user stakes tokens.
     * @param user The address of the staker.
     * @param amount The amount of tokens staked.
     */
    event Staked(address indexed user, uint256 amount);

    /**
     * @dev Emitted when a user unstakes tokens.
     * @param user The address of the unstaker.
     * @param amount The amount of tokens unstaked.
     */
    event Unstaked(address indexed user, uint256 amount);

    /**
     * @dev Emitted when a user claims their rewards.
     * @param user The address of the user claiming rewards.
     * @param rewardAmount The amount of reward tokens claimed.
     */
    event RewardClaimed(address indexed user, uint256 rewardAmount);

    /**
     * @dev Emitted when the reward rate is changed by the owner.
     * @param oldRate The previous reward rate.
     * @param newRate The new reward rate.
     */
    event RewardRateChanged(uint256 oldRate, uint256 newRate);

    /**
     * @dev Emitted when reward tokens are deposited into the contract by the owner.
     * @param depositor The address of the owner depositing rewards.
     * @param amount The amount of reward tokens deposited.
     */
    event RewardTokensDeposited(address indexed depositor, uint256 amount);

    // --- Constructor ---

    /**
     * @notice Initializes the StakingPool contract.
     * @param _stakingToken Address of the ERC20 token to be staked.
     * @param _rewardToken Address of the ERC20 token used for rewards.
     * @param _initialRewardRate The initial annual reward rate, scaled by `REWARD_RATE_PRECISION`.
     * E.g., for a 10% APR (actual rate of 0.1), pass `0.1 * 10^18 = 10^17`.
     */
    constructor(
        address _stakingToken,
        address _rewardToken,
        uint256 _initialRewardRate
    ) Ownable(msg.sender) {
        require(_stakingToken != address(0), "StakingPool: Staking token is zero address");
        require(_rewardToken != address(0), "StakingPool: Reward token is zero address");

        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
        rewardRate = _initialRewardRate;

        emit RewardRateChanged(0, _initialRewardRate);
    }

    // --- External Functions: User Actions ---

    /**
     * @notice Stakes a specified amount of staking tokens.
     * @dev User must approve the contract to spend their staking tokens beforehand.
     * Calls `_updateRewards` to calculate and store any pending rewards before staking.
     * @param _amount The amount of staking tokens to stake. Must be greater than 0.
     */
    function stake(uint256 _amount) external nonReentrant {
        require(_amount > 0, "StakingPool: Cannot stake 0 tokens");

        _updateRewardsInternal(msg.sender); // Calculate and store pending rewards for the user

        StakeInfo storage user = userStakeInfo[msg.sender];
        user.amount += _amount;
        // user.lastRewardUpdateTime is already set by _updateRewardsInternal

        totalStaked += _amount;

        stakingToken.safeTransferFrom(msg.sender, address(this), _amount);

        emit Staked(msg.sender, _amount);
    }

    /**
     * @notice Unstakes a specified amount of staking tokens.
     * @dev Calls `_updateRewards` to calculate and store any pending rewards before unstaking.
     * @param _amount The amount of staking tokens to unstake. Must be greater than 0 and
     * not exceed the user's staked balance.
     */
    function unstake(uint256 _amount) external nonReentrant {
        StakeInfo storage user = userStakeInfo[msg.sender];
        require(_amount > 0, "StakingPool: Cannot unstake 0 tokens");
        require(user.amount >= _amount, "StakingPool: Insufficient staked balance");

        _updateRewardsInternal(msg.sender); // Calculate and store pending rewards

        user.amount -= _amount;
        // user.lastRewardUpdateTime is already set by _updateRewardsInternal
        totalStaked -= _amount;

        stakingToken.safeTransfer(msg.sender, _amount);

        emit Unstaked(msg.sender, _amount);
    }

    /**
     * @notice Claims all pending rewards for the caller.
     * @dev Calls `_updateRewards` to ensure rewards are current before claiming.
     */
    function claimReward() external nonReentrant {
        _updateRewardsInternal(msg.sender); // Calculate and store latest rewards

        StakeInfo storage user = userStakeInfo[msg.sender];
        uint256 rewardToClaim = user.unclaimedRewards;
        require(rewardToClaim > 0, "StakingPool: No rewards to claim");

        user.unclaimedRewards = 0;
        // user.lastRewardUpdateTime is already set by _updateRewardsInternal

        rewardToken.safeTransfer(msg.sender, rewardToClaim);

        emit RewardClaimed(msg.sender, rewardToClaim);
    }

    // --- Public View Functions ---

    /**
     * @notice Calculates the total pending rewards for a user.
     * @dev This includes previously accumulated `unclaimedRewards` plus newly accrued rewards
     * since `lastRewardUpdateTime`.
     * @param _user The address of the user.
     * @return The total amount of reward tokens claimable by the user.
     */
    function getPendingRewards(address _user) public view returns (uint256) {
        StakeInfo memory user = userStakeInfo[_user];
        uint256 accumulatedRewards = user.unclaimedRewards;

        if (user.amount > 0 && block.timestamp > user.lastRewardUpdateTime) {
            uint256 timeElapsed = block.timestamp - user.lastRewardUpdateTime;
            uint256 newlyAccruedRewards = (user.amount * rewardRate * timeElapsed) / SECONDS_IN_YEAR / REWARD_RATE_PRECISION;
            accumulatedRewards += newlyAccruedRewards;
        }
        return accumulatedRewards;
    }

    /**
     * @notice Returns the current reward rate.
     * @return The annual reward rate, scaled by `REWARD_RATE_PRECISION`.
     */
    function getRewardRate() public view returns (uint256) {
        return rewardRate;
    }

    /**
     * @notice Returns staking information for a given user.
     * @param _user Address of the user.
     * @return amount Staked amount by the user.
     * @return lastRewardUpdateTime Timestamp of last reward calculation and update for the user.
     * @return unclaimedRewards Rewards accrued up to `lastRewardUpdateTime` and not yet claimed.
     */
    function getUserStakeInfo(address _user) public view returns (uint256 amount, uint256 lastRewardUpdateTime, uint256 unclaimedRewards) {
        StakeInfo memory user = userStakeInfo[_user];
        return (user.amount, user.lastRewardUpdateTime, user.unclaimedRewards);
    }

    // --- Internal Functions ---

    /**
     * @notice Updates the `unclaimedRewards` and `lastRewardUpdateTime` for a user.
     * @dev This function is called internally before any state change that affects reward calculation
     * (e.g., stake, unstake, claim).
     * It calculates rewards accrued since `lastRewardUpdateTime`, adds them to `unclaimedRewards`,
     * and then sets `lastRewardUpdateTime` to `block.timestamp`.
     * @param _user The address of the user.
     */
    function _updateRewardsInternal(address _user) internal {
        StakeInfo storage user = userStakeInfo[_user];

        if (user.amount > 0 && block.timestamp > user.lastRewardUpdateTime) {
            uint256 timeElapsed = block.timestamp - user.lastRewardUpdateTime;
            uint256 newlyAccruedRewards = (user.amount * rewardRate * timeElapsed) / SECONDS_IN_YEAR / REWARD_RATE_PRECISION;
            user.unclaimedRewards += newlyAccruedRewards;
        }
        // Always update lastRewardUpdateTime to current block timestamp.
        // This "resets" the clock for the next reward calculation period.
        // If user.amount is 0, no new rewards will effectively accrue from this point
        // as newlyAccruedRewards calculation will yield 0.
        user.lastRewardUpdateTime = block.timestamp;
    }


    // --- Admin Functions ---

    /**
     * @notice Deposits reward tokens into the contract.
     * @dev Only callable by the owner. The contract must have sufficient `rewardToken`
     * balance to pay out rewards.
     * @param _amount The amount of reward tokens to deposit. Must be greater than 0.
     */
    function depositRewardTokens(uint256 _amount) external onlyOwner nonReentrant {
        require(_amount > 0, "StakingPool: Cannot deposit 0 reward tokens");
        rewardToken.safeTransferFrom(msg.sender, address(this), _amount);
        emit RewardTokensDeposited(msg.sender, _amount);
    }

    /**
     * @notice Updates the annual reward rate.
     * @dev Only callable by the owner. The new rate applies to future reward calculations.
     * It's recommended to ensure users are aware of rate changes.
     * @param _newRate The new annual reward rate, scaled by `REWARD_RATE_PRECISION`.
     */
    function setRewardRate(uint256 _newRate) external onlyOwner {
        uint256 oldRate = rewardRate;
        rewardRate = _newRate;
        emit RewardRateChanged(oldRate, _newRate);
    }

    /**
     * @notice Allows the owner to withdraw accidentally sent ERC20 tokens from this contract.
     * @dev This function is intended for recovering tokens other than the `stakingToken` or `rewardToken`.
     * @param _tokenAddress The address of the ERC20 token to withdraw.
     * @param _amount The amount of tokens to withdraw. Must be greater than 0.
     */
    function withdrawStuckTokens(address _tokenAddress, uint256 _amount) external onlyOwner {
        require(_tokenAddress != address(0), "StakingPool: Token address cannot be zero");
        require(_tokenAddress != address(stakingToken), "StakingPool: Cannot withdraw staking token with this function");
        require(_tokenAddress != address(rewardToken), "StakingPool: Cannot withdraw reward token with this function");
        require(_amount > 0, "StakingPool: Amount must be greater than zero");

        IERC20(_tokenAddress).safeTransfer(owner(), _amount);
    }
}