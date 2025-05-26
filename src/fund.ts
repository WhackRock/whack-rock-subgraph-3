import { BigInt, Address, Bytes, BigDecimal } from "@graphprotocol/graph-ts";
import {
  AgentUpdated,
  TargetWeightsUpdated,
  WETHDepositedAndSharesMinted,
  BasketAssetsWithdrawn,
  AgentAumFeeCollected,
  WhackRockFund as FundContract
} from "../generated/templates/WhackRockFund/WhackRockFund";
import {
  Fund,
  FundToken,
  FundNAVSnapshot,
  Agent,
  GlobalStats
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
  transactionHash: Bytes
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
  // Create NAV snapshot
  createOrUpdateNAVSnapshot(
    event.address,
    event.block.number,
    event.block.timestamp,
    "deposit",
    event.transaction.hash
  );
}

export function handleBasketAssetsWithdrawn(event: BasketAssetsWithdrawn): void {
  // Create NAV snapshot
  createOrUpdateNAVSnapshot(
    event.address,
    event.block.number,
    event.block.timestamp,
    "withdrawal",
    event.transaction.hash
  );
}

export function handleAgentAumFeeCollected(event: AgentAumFeeCollected): void {
  // Create NAV snapshot
  createOrUpdateNAVSnapshot(
    event.address,
    event.block.number,
    event.block.timestamp,
    "fee",
    event.transaction.hash
  );
} 