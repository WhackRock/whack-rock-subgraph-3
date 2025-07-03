import { BigInt, Address, Bytes } from "@graphprotocol/graph-ts";
import {
  Staked,
  PointsClaimed,
  Withdrawn,
  PointsRedeemerSet,
  PointsRedeemed,
  TimelockQueued,
  TimelockExecuted,
  TimelockCancelled,
  PointsAccrued,
  WhackRockStaking as StakingContract
} from "../generated/WhackRockStaking/WhackRockStaking";
import { IERC20 } from "../generated/WhackRockStaking/IERC20";
import {
  StakingContract as StakingContractEntity,
  Stake,
  StakeEventStaked,
  PointsClaimEvent,
  WithdrawalEvent,
  PointsRedeemerEvent,
  PointsRedeemedEvent,
  TimelockEvent,
  PointsAccruedEvent,
  User
} from "../generated/schema";

/**
 * Helper function to get or create a user entity
 */
function getOrCreateUser(userAddress: Address): User {
  let user = User.load(userAddress.toHexString());
  if (user == null) {
    user = new User(userAddress.toHexString());
    user.address = userAddress;
    user.totalDepositedUSDC = BigInt.fromI32(0);
    user.totalWithdrawnUSDC = BigInt.fromI32(0);
    user.firstActivityAt = BigInt.fromI32(0);
    user.lastActivityAt = BigInt.fromI32(0);
    user.save();
  }
  return user;
}

/**
 * Helper function to get or create a staking contract entity
 */
function getOrCreateStakingContract(contractAddress: Address): StakingContractEntity {
  let stakingContract = StakingContractEntity.load(contractAddress.toHexString());
  if (stakingContract == null) {
    stakingContract = new StakingContractEntity(contractAddress.toHexString());
    stakingContract.address = contractAddress;
    
    // Get staking token from contract
    let contract = StakingContract.bind(contractAddress);
    let stakingTokenResult = contract.try_stakingToken();
    if (!stakingTokenResult.reverted) {
      stakingContract.stakingToken = stakingTokenResult.value;
    }
    
    stakingContract.totalStaked = BigInt.fromI32(0);
    stakingContract.createdAt = BigInt.fromI32(0);
    stakingContract.updatedAt = BigInt.fromI32(0);
    stakingContract.save();
  }
  return stakingContract;
}

/**
 * Helper function to get or create a stake entity
 */
function getOrCreateStake(contractAddress: Address, userAddress: Address): Stake {
  let stakeId = contractAddress.toHexString() + "-" + userAddress.toHexString();
  let stake = Stake.load(stakeId);
  if (stake == null) {
    stake = new Stake(stakeId);
    stake.contract = contractAddress.toHexString();
    stake.user = userAddress.toHexString();
    stake.amount = BigInt.fromI32(0);
    stake.startTime = BigInt.fromI32(0);
    stake.lockDuration = BigInt.fromI32(0);
    stake.unlockTime = BigInt.fromI32(0);
    stake.multiplier = BigInt.fromI32(0);
    stake.accumulatedPoints = BigInt.fromI32(0);
    stake.lastClaimTime = BigInt.fromI32(0);
    stake.claimedPoints = BigInt.fromI32(0);
    stake.isActive = false;
    stake.createdAt = BigInt.fromI32(0);
    stake.updatedAt = BigInt.fromI32(0);
    stake.save();
  }
  return stake;
}

/**
 * Handle Staked event
 */
export function handleStaked(event: Staked): void {
  let stakingContract = getOrCreateStakingContract(event.address);
  let user = getOrCreateUser(event.params.user);
  let stake = getOrCreateStake(event.address, event.params.user);
  
  // Update staking contract
  let contract = StakingContract.bind(event.address);
  let totalStakedResult = contract.try_totalStaked();
  if (!totalStakedResult.reverted) {
    stakingContract.totalStaked = totalStakedResult.value;
  }
  stakingContract.updatedAt = event.block.timestamp;
  stakingContract.save();
  
  // Update stake
  stake.amount = event.params.totalStakedAmount;
  stake.lockDuration = event.params.lockDuration;
  stake.unlockTime = event.params.unlockTime;
  stake.multiplier = event.params.multiplier;
  stake.isActive = true;
  
  if (stake.startTime.equals(BigInt.fromI32(0))) {
    stake.startTime = event.block.timestamp;
    stake.lastClaimTime = event.block.timestamp;
    stake.createdAt = event.block.timestamp;
  }
  stake.updatedAt = event.block.timestamp;
  stake.save();
  
  // Update user
  if (user.firstActivityAt.equals(BigInt.fromI32(0))) {
    user.firstActivityAt = event.block.timestamp;
  }
  user.lastActivityAt = event.block.timestamp;
  user.save();
  
  // Create stake event
  let stakeEvent = new StakeEventStaked(
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  );
  stakeEvent.contract = stakingContract.id;
  stakeEvent.user = user.id;
  stakeEvent.amount = event.params.amount;
  stakeEvent.totalStakedAmount = event.params.totalStakedAmount;
  stakeEvent.lockDuration = event.params.lockDuration;
  stakeEvent.unlockTime = event.params.unlockTime;
  stakeEvent.multiplier = event.params.multiplier;
  stakeEvent.timestamp = event.block.timestamp;
  stakeEvent.blockNumber = event.block.number;
  stakeEvent.transactionHash = event.transaction.hash;
  stakeEvent.save();
}

/**
 * Handle PointsClaimed event
 */
export function handlePointsClaimed(event: PointsClaimed): void {
  let stakingContract = getOrCreateStakingContract(event.address);
  let user = getOrCreateUser(event.params.user);
  let stake = getOrCreateStake(event.address, event.params.user);
  
  // Update stake
  stake.claimedPoints = event.params.totalClaimedPoints;
  stake.accumulatedPoints = BigInt.fromI32(0); // Reset accumulated points
  stake.updatedAt = event.block.timestamp;
  stake.save();
  
  // Update user
  user.lastActivityAt = event.block.timestamp;
  user.save();
  
  // Create points claim event
  let pointsClaimEvent = new PointsClaimEvent(
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  );
  pointsClaimEvent.contract = stakingContract.id;
  pointsClaimEvent.user = user.id;
  pointsClaimEvent.points = event.params.points;
  pointsClaimEvent.totalClaimedPoints = event.params.totalClaimedPoints;
  pointsClaimEvent.timestamp = event.block.timestamp;
  pointsClaimEvent.blockNumber = event.block.number;
  pointsClaimEvent.transactionHash = event.transaction.hash;
  pointsClaimEvent.save();
}

/**
 * Handle Withdrawn event
 */
export function handleWithdrawn(event: Withdrawn): void {
  let stakingContract = getOrCreateStakingContract(event.address);
  let user = getOrCreateUser(event.params.user);
  let stake = getOrCreateStake(event.address, event.params.user);
  
  // Update staking contract
  let contract = StakingContract.bind(event.address);
  let totalStakedResult = contract.try_totalStaked();
  if (!totalStakedResult.reverted) {
    stakingContract.totalStaked = totalStakedResult.value;
  }
  stakingContract.updatedAt = event.block.timestamp;
  stakingContract.save();
  
  // Update stake - mark as inactive
  stake.amount = BigInt.fromI32(0);
  stake.isActive = false;
  stake.claimedPoints = event.params.totalClaimedPoints;
  stake.accumulatedPoints = BigInt.fromI32(0);
  stake.updatedAt = event.block.timestamp;
  stake.save();
  
  // Update user
  user.lastActivityAt = event.block.timestamp;
  user.save();
  
  // Create withdrawal event
  let withdrawalEvent = new WithdrawalEvent(
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  );
  withdrawalEvent.contract = stakingContract.id;
  withdrawalEvent.user = user.id;
  withdrawalEvent.amount = event.params.amount;
  withdrawalEvent.points = event.params.points;
  withdrawalEvent.totalClaimedPoints = event.params.totalClaimedPoints;
  withdrawalEvent.stakeDuration = event.params.stakeDuration;
  withdrawalEvent.timestamp = event.block.timestamp;
  withdrawalEvent.blockNumber = event.block.number;
  withdrawalEvent.transactionHash = event.transaction.hash;
  withdrawalEvent.save();
}

/**
 * Handle PointsRedeemerSet event
 */
export function handlePointsRedeemerSet(event: PointsRedeemerSet): void {
  let stakingContract = getOrCreateStakingContract(event.address);
  
  // Update staking contract
  stakingContract.pointsRedeemer = event.params.redeemer;
  stakingContract.updatedAt = event.block.timestamp;
  stakingContract.save();
  
  // Create points redeemer event
  let pointsRedeemerEvent = new PointsRedeemerEvent(
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  );
  pointsRedeemerEvent.contract = stakingContract.id;
  pointsRedeemerEvent.redeemer = event.params.redeemer;
  pointsRedeemerEvent.timestamp = event.block.timestamp;
  pointsRedeemerEvent.blockNumber = event.block.number;
  pointsRedeemerEvent.transactionHash = event.transaction.hash;
  pointsRedeemerEvent.save();
}

/**
 * Handle PointsRedeemed event
 */
export function handlePointsRedeemed(event: PointsRedeemed): void {
  let stakingContract = getOrCreateStakingContract(event.address);
  let user = getOrCreateUser(event.params.user);
  
  // Update user
  user.lastActivityAt = event.block.timestamp;
  user.save();
  
  // Create points redeemed event
  let pointsRedeemedEvent = new PointsRedeemedEvent(
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  );
  pointsRedeemedEvent.contract = stakingContract.id;
  pointsRedeemedEvent.user = user.id;
  pointsRedeemedEvent.redeemer = event.params.redeemer;
  pointsRedeemedEvent.amount = event.params.amount;
  pointsRedeemedEvent.timestamp = event.block.timestamp;
  pointsRedeemedEvent.blockNumber = event.block.number;
  pointsRedeemedEvent.transactionHash = event.transaction.hash;
  pointsRedeemedEvent.save();
}

/**
 * Handle TimelockQueued event
 */
export function handleTimelockQueued(event: TimelockQueued): void {
  let stakingContract = getOrCreateStakingContract(event.address);
  
  // Create timelock event
  let timelockEvent = new TimelockEvent(
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  );
  timelockEvent.contract = stakingContract.id;
  timelockEvent.functionId = event.params.functionId;
  timelockEvent.executeTime = event.params.executeTime;
  timelockEvent.eventType = "queued";
  timelockEvent.timestamp = event.block.timestamp;
  timelockEvent.blockNumber = event.block.number;
  timelockEvent.transactionHash = event.transaction.hash;
  timelockEvent.save();
}

/**
 * Handle TimelockExecuted event
 */
export function handleTimelockExecuted(event: TimelockExecuted): void {
  let stakingContract = getOrCreateStakingContract(event.address);
  
  // Create timelock event
  let timelockEvent = new TimelockEvent(
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  );
  timelockEvent.contract = stakingContract.id;
  timelockEvent.functionId = event.params.functionId;
  timelockEvent.eventType = "executed";
  timelockEvent.timestamp = event.block.timestamp;
  timelockEvent.blockNumber = event.block.number;
  timelockEvent.transactionHash = event.transaction.hash;
  timelockEvent.save();
}

/**
 * Handle TimelockCancelled event
 */
export function handleTimelockCancelled(event: TimelockCancelled): void {
  let stakingContract = getOrCreateStakingContract(event.address);
  
  // Create timelock event
  let timelockEvent = new TimelockEvent(
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  );
  timelockEvent.contract = stakingContract.id;
  timelockEvent.functionId = event.params.functionId;
  timelockEvent.eventType = "cancelled";
  timelockEvent.timestamp = event.block.timestamp;
  timelockEvent.blockNumber = event.block.number;
  timelockEvent.transactionHash = event.transaction.hash;
  timelockEvent.save();
}

/**
 * Handle PointsAccrued event
 */
export function handlePointsAccrued(event: PointsAccrued): void {
  let stakingContract = getOrCreateStakingContract(event.address);
  let user = getOrCreateUser(event.params.user);
  let stake = getOrCreateStake(event.address, event.params.user);
  
  // Update stake accumulated points
  stake.accumulatedPoints = stake.accumulatedPoints.plus(event.params.points);
  stake.updatedAt = event.block.timestamp;
  stake.save();
  
  // Update user
  user.lastActivityAt = event.block.timestamp;
  user.save();
  
  // Create points accrued event
  let pointsAccruedEvent = new PointsAccruedEvent(
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  );
  pointsAccruedEvent.contract = stakingContract.id;
  pointsAccruedEvent.user = user.id;
  pointsAccruedEvent.points = event.params.points;
  pointsAccruedEvent.timestamp = event.block.timestamp;
  pointsAccruedEvent.blockNumber = event.block.number;
  pointsAccruedEvent.transactionHash = event.transaction.hash;
  pointsAccruedEvent.save();
}