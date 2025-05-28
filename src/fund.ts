import { BigInt, Address, Bytes, BigDecimal } from "@graphprotocol/graph-ts";
import {
  AgentUpdated,
  TargetWeightsUpdated,
  WETHDepositedAndSharesMinted,
  BasketAssetsWithdrawn,
  AgentAumFeeCollected,
  RebalanceCycleExecuted,
  WhackRockFund as FundContract
} from "../generated/templates/WhackRockFund/WhackRockFund";
import {
  Fund,
  FundToken,
  FundNAVSnapshot,
  Agent,
  GlobalStats,
  User,
  UserFundPosition,
  Deposit,
  Withdrawal,
  RebalanceCycle
} from "../generated/schema";
import { roundToHour, calculateNavPerShare } from "./helpers";

/**
 * Helper function to create or update hourly NAV snapshot
 */
function createOrUpdateNAVSnapshot(
  fundAddress: Address,
  blockNumber: BigInt,
  timestamp: BigInt,
  triggeredBy: string,
  transactionHash: Bytes,
  wethValueInUSDC: BigInt
): void {
  let fund = Fund.load(fundAddress.toHexString());
  if (fund == null) return;

  // Get current NAV from contract
  let fundContract = FundContract.bind(fundAddress);
  let navInUSDCResult = fundContract.try_totalNAVInUSDC();
  let totalSupplyResult = fundContract.try_totalSupply();

  if (navInUSDCResult.reverted || totalSupplyResult.reverted) {
    return;
  }

  let navInUSDC = navInUSDCResult.value;
  let totalSupply = totalSupplyResult.value;
  
  // Update fund entity
  fund.currentNAVInUSDC = navInUSDC;
  fund.lastNAVUpdate = timestamp;
  fund.totalSupply = totalSupply;
  fund.updatedAt = timestamp;
  fund.save();

  // Round timestamp to hour
  let hourTimestamp = roundToHour(timestamp);
  let snapshotId = fundAddress.toHexString() + "-" + hourTimestamp.toString();

  // Create or update hourly snapshot
  let snapshot = FundNAVSnapshot.load(snapshotId);
  if (snapshot == null) {
    snapshot = new FundNAVSnapshot(snapshotId);
    snapshot.fund = fund.id;
    snapshot.timestamp = hourTimestamp;
  }

  snapshot.navInUSDC = navInUSDC;
  snapshot.totalSupply = totalSupply;
  snapshot.blockNumber = blockNumber;
  snapshot.triggeredBy = triggeredBy;
  snapshot.transactionHash = transactionHash;
  snapshot.wethValueInUSDC = wethValueInUSDC;

  // Calculate NAV per share
  snapshot.navPerShare = calculateNavPerShare(navInUSDC, totalSupply);

  snapshot.save();

  // Update global stats
  updateGlobalTVL();
}

/**
 * Helper function to update global TVL
 */
function updateGlobalTVL(): void {
  let globalStats = GlobalStats.load("1");
  if (globalStats == null) {
    globalStats = new GlobalStats("1");
    globalStats.totalFunds = BigInt.fromI32(0);
    globalStats.totalRegistryAllowedTokens = BigInt.fromI32(0);
    globalStats.totalValueLockedUSDC = BigInt.fromI32(0);
  }

  // Note: For a more accurate TVL, we would need to query all funds
  // For now, we'll update this when we have individual fund updates
  globalStats.lastUpdated = BigInt.fromI32(0); // Will be set by caller
  globalStats.save();
}

/**
 * Helper function to get or create a User entity
 */
function getOrCreateUser(userAddress: Address, timestamp: BigInt): User {
  let userId = userAddress.toHexString();
  let user = User.load(userId);
  
  if (user == null) {
    user = new User(userId);
    user.address = userAddress;
    user.totalDepositedUSDC = BigInt.fromI32(0);
    user.totalWithdrawnUSDC = BigInt.fromI32(0);
    user.firstActivityAt = timestamp;
    user.lastActivityAt = timestamp;
    user.save();
  }
  
  return user;
}

/**
 * Helper function to get or create a UserFundPosition entity
 */
function getOrCreateUserFundPosition(userAddress: Address, fundAddress: Address, timestamp: BigInt): UserFundPosition {
  let positionId = userAddress.toHexString() + "-" + fundAddress.toHexString();
  let position = UserFundPosition.load(positionId);
  
  if (position == null) {
    position = new UserFundPosition(positionId);
    position.user = userAddress.toHexString();
    position.fund = fundAddress.toHexString();
    position.shareBalance = BigInt.fromI32(0);
    position.totalDepositedWETH = BigInt.fromI32(0);
    position.totalDepositedUSDC = BigInt.fromI32(0);
    position.totalWETHValueOfSharesWithdrawn = BigInt.fromI32(0);
    position.totalUSDCValueOfSharesWithdrawn = BigInt.fromI32(0);
    position.depositCount = BigInt.fromI32(0);
    position.withdrawalCount = BigInt.fromI32(0);
    position.firstDepositAt = null;
    position.lastActivityAt = timestamp;
    position.isActive = false;
    position.save();
  }
  
  return position;
}

/**
 * Helper function to calculate USDC value from WETH amount and price
 */
function calculateUSDCValue(wethAmount: BigInt, wethPriceInUSDC: BigInt): BigInt {
  // wethPriceInUSDC is the price of 1 WETH (1e18) in USDC (6 decimals)
  // wethAmount is in wei (18 decimals)
  // Result should be in USDC units (6 decimals)
  
  // (wethAmount * wethPriceInUSDC) / 1e18
  return wethAmount.times(wethPriceInUSDC).div(BigInt.fromString("1000000000000000000"));
}

export function handleAgentUpdated(event: AgentUpdated): void {
  let fund = Fund.load(event.address.toHexString());
  if (fund == null) return;

  // Update old agent stats
  let oldAgent = Agent.load(event.params.oldAgent.toHexString());
  if (oldAgent != null) {
    oldAgent.activeFundCount = oldAgent.activeFundCount.minus(BigInt.fromI32(1));
    oldAgent.save();
  }

  // Update new agent stats
  let newAgent = Agent.load(event.params.newAgent.toHexString());
  if (newAgent == null) {
    newAgent = new Agent(event.params.newAgent.toHexString());
    newAgent.address = event.params.newAgent;
    newAgent.activeFundCount = BigInt.fromI32(0);
    newAgent.totalFundCount = BigInt.fromI32(0);
    newAgent.firstActiveAt = event.block.timestamp;
  }
  newAgent.activeFundCount = newAgent.activeFundCount.plus(BigInt.fromI32(1));
  newAgent.lastActiveAt = event.block.timestamp;
  newAgent.save();

  // Update fund
  fund.agent = event.params.newAgent;
  fund.updatedAt = event.block.timestamp;
  fund.save();
}

export function handleTargetWeightsUpdated(event: TargetWeightsUpdated): void {
  let fund = Fund.load(event.address.toHexString());
  if (fund == null) return;

  let tokens = event.params.tokens;
  let weights = event.params.weights;

  // Update target weights for each token
  for (let i = 0; i < tokens.length; i++) {
    let fundTokenId = event.address.toHexString() + "-" + tokens[i].toHexString();
    let fundToken = FundToken.load(fundTokenId);
    
    if (fundToken != null) {
      fundToken.targetWeight = weights[i];
      fundToken.updatedAt = event.block.timestamp;
      fundToken.save();
    }
  }

  fund.updatedAt = event.block.timestamp;
  fund.save();
}

export function handleWETHDepositedAndSharesMinted(event: WETHDepositedAndSharesMinted): void {
  // Get or create user
  let user = getOrCreateUser(event.params.depositor, event.block.timestamp);
  
  // Calculate USDC value of the deposit
  let depositValueInUSDC = calculateUSDCValue(event.params.wethDeposited, event.params.wethValueInUSDC);
  
  // Update user totals
  user.totalDepositedUSDC = user.totalDepositedUSDC.plus(depositValueInUSDC);
  user.lastActivityAt = event.block.timestamp;
  user.save();
  
  // Get or create user position in this fund
  let position = getOrCreateUserFundPosition(event.params.depositor, event.address, event.block.timestamp);
  
  // Update position
  position.shareBalance = position.shareBalance.plus(event.params.sharesMinted);
  position.totalDepositedWETH = position.totalDepositedWETH.plus(event.params.wethDeposited);
  position.totalDepositedUSDC = position.totalDepositedUSDC.plus(depositValueInUSDC);
  position.depositCount = position.depositCount.plus(BigInt.fromI32(1));
  if (!position.firstDepositAt) {
    position.firstDepositAt = event.block.timestamp;
  }
  position.lastActivityAt = event.block.timestamp;
  position.isActive = true;
  position.save();

  // Create deposit entity
  let depositId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let deposit = new Deposit(depositId);
  deposit.fund = event.address.toHexString();
  deposit.depositor = user.id; // Reference to User entity
  deposit.receiver = event.params.receiver;
  deposit.wethDeposited = event.params.wethDeposited;
  deposit.sharesMinted = event.params.sharesMinted;
  deposit.navBeforeDepositWETH = event.params.navBeforeDepositWETH;
  deposit.totalSupplyBeforeDeposit = event.params.totalSupplyBeforeDeposit;
  deposit.wethValueInUSDC = event.params.wethValueInUSDC;
  deposit.depositValueInUSDC = depositValueInUSDC;
  deposit.timestamp = event.block.timestamp;
  deposit.blockNumber = event.block.number;
  deposit.transactionHash = event.transaction.hash;
  deposit.save();

  // Create NAV snapshot
  createOrUpdateNAVSnapshot(
    event.address,
    event.block.number,
    event.block.timestamp,
    "deposit",
    event.transaction.hash,
    event.params.wethValueInUSDC
  );
}

export function handleBasketAssetsWithdrawn(event: BasketAssetsWithdrawn): void {
  // Get or create user
  let user = getOrCreateUser(event.params.owner, event.block.timestamp);
  
  // Calculate USDC value of the withdrawal
  let withdrawalValueInUSDC = calculateUSDCValue(event.params.totalWETHValueOfWithdrawal, event.params.wethValueInUSDC);
  
  // Update user totals
  user.totalWithdrawnUSDC = user.totalWithdrawnUSDC.plus(withdrawalValueInUSDC);
  user.lastActivityAt = event.block.timestamp;
  user.save();
  
  // Get or create user position in this fund
  let position = getOrCreateUserFundPosition(event.params.owner, event.address, event.block.timestamp);
  
  // Update position
  position.shareBalance = position.shareBalance.minus(event.params.sharesBurned);
  position.totalWETHValueOfSharesWithdrawn = position.totalWETHValueOfSharesWithdrawn.plus(event.params.totalWETHValueOfWithdrawal);
  position.totalUSDCValueOfSharesWithdrawn = position.totalUSDCValueOfSharesWithdrawn.plus(withdrawalValueInUSDC);
  position.withdrawalCount = position.withdrawalCount.plus(BigInt.fromI32(1));
  position.lastActivityAt = event.block.timestamp;
  position.isActive = position.shareBalance.gt(BigInt.fromI32(0));
  position.save();

  // Create withdrawal entity
  let withdrawalId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let withdrawal = new Withdrawal(withdrawalId);
  withdrawal.fund = event.address.toHexString();
  withdrawal.owner = user.id; // Reference to User entity
  withdrawal.receiver = event.params.receiver;
  withdrawal.sharesBurned = event.params.sharesBurned;
  
  // Convert Address array to Bytes array
  let tokensWithdrawn: Bytes[] = [];
  for (let i = 0; i < event.params.tokensWithdrawn.length; i++) {
    tokensWithdrawn.push(event.params.tokensWithdrawn[i]);
  }
  withdrawal.tokensWithdrawn = tokensWithdrawn;
  
  withdrawal.amountsWithdrawn = event.params.amountsWithdrawn;
  withdrawal.navBeforeWithdrawalWETH = event.params.navBeforeWithdrawalWETH;
  withdrawal.totalSupplyBeforeWithdrawal = event.params.totalSupplyBeforeWithdrawal;
  withdrawal.totalWETHValueOfWithdrawal = event.params.totalWETHValueOfWithdrawal;
  withdrawal.wethValueInUSDC = event.params.wethValueInUSDC;
  withdrawal.withdrawalValueInUSDC = withdrawalValueInUSDC;
  withdrawal.timestamp = event.block.timestamp;
  withdrawal.blockNumber = event.block.number;
  withdrawal.transactionHash = event.transaction.hash;
  withdrawal.save();

  // Create NAV snapshot
  createOrUpdateNAVSnapshot(
    event.address,
    event.block.number,
    event.block.timestamp,
    "withdrawal",
    event.transaction.hash,
    event.params.wethValueInUSDC
  );
}

export function handleAgentAumFeeCollected(event: AgentAumFeeCollected): void {
  // Create NAV snapshot
  createOrUpdateNAVSnapshot(
    event.address,
    event.block.number,
    event.block.timestamp,
    "fee",
    event.transaction.hash,
    event.params.wethValueInUSDC
  );
}

export function handleRebalanceCycleExecuted(event: RebalanceCycleExecuted): void {
  // Create rebalance cycle entity
  let rebalanceCycleId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let rebalanceCycle = new RebalanceCycle(rebalanceCycleId);
  rebalanceCycle.fund = event.address.toHexString();
  rebalanceCycle.navBeforeRebalanceAA = event.params.navBeforeRebalanceAA;
  rebalanceCycle.navAfterRebalanceAA = event.params.navAfterRebalanceAA;
  rebalanceCycle.wethValueInUSDC = event.params.wethValueInUSDC;
  rebalanceCycle.timestamp = event.block.timestamp;
  rebalanceCycle.blockNumber = event.block.number;
  rebalanceCycle.transactionHash = event.transaction.hash;
  rebalanceCycle.save();

  // Create NAV snapshot
  createOrUpdateNAVSnapshot(
    event.address,
    event.block.number,
    event.block.timestamp,
    "rebalance",
    event.transaction.hash,
    event.params.wethValueInUSDC
  );
} 