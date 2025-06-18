import { BigInt, Address, Bytes, ethereum, BigDecimal, store } from "@graphprotocol/graph-ts";
import {
  WhackRockFundCreated,
  RegistryAllowedTokenAdded,
  RegistryAllowedTokenRemoved,
  WhackRockFundRegistry
} from "../generated/WhackRockFundRegistry/WhackRockFundRegistry";
import { WhackRockFund as FundTemplate } from "../generated/templates";
import { WhackRockFund as FundContract } from "../generated/templates/WhackRockFund/WhackRockFund";
import { IERC20 } from "../generated/WhackRockFundRegistry/IERC20";
import {
  Registry,
  Fund,
  AllowedToken,
  FundToken,
  Agent,
  GlobalStats,
  FundNAVSnapshot
} from "../generated/schema";
import { roundToHour, calculateNavPerShare, REGISTRY_ADDRESS, ZERO_BYTES } from "./helpers";

export function handleWhackRockFundCreated(event: WhackRockFundCreated): void {
  // Get or create registry entity
  let registry = Registry.load(event.address.toHexString());
  if (registry == null) {
    registry = new Registry(event.address.toHexString());
    registry.fundCount = BigInt.fromI32(0);
    registry.createdAt = event.block.timestamp;
  }
  
  // Increment fund count
  registry.fundCount = registry.fundCount.plus(BigInt.fromI32(1));
  registry.updatedAt = event.block.timestamp;
  registry.save();

  // Create Fund entity
  let fund = new Fund(event.params.fundAddress.toHexString());
  fund.registry = registry.id;
  fund.fundId = event.params.fundId;
  fund.address = event.params.fundAddress;
  fund.creator = event.params.creator; // Original creator (never changes)
  fund.owner = event.params.creator; // Current owner (initially the creator)
  fund.agent = event.params.initialAgent;
  fund.name = event.params.vaultName;
  fund.symbol = event.params.vaultSymbol;
  fund.vaultURI = event.params.vaultURI;
  fund.description = event.params.description;
  fund.agentAumFeeWallet = event.params.agentAumFeeWallet;
  fund.agentAumFeeBps = event.params.agentTotalAumFeeBps;
  fund.currentNAVInUSDC = BigInt.fromI32(0);
  fund.lastNAVUpdate = event.block.timestamp;
  fund.lastWethValueInUSDC = BigInt.fromI32(0);
  fund.totalSupply = BigInt.fromI32(0);
  fund.createdAt = event.params.timestamp;
  fund.createdAtBlock = event.block.number;
  fund.updatedAt = event.block.timestamp;
  fund.save();

  // Create FundToken entities for each allowed token
  let allowedTokens = event.params.allowedTokens;
  let targetWeights = event.params.targetWeights;
  
  for (let i = 0; i < allowedTokens.length; i++) {
    let fundTokenId = event.params.fundAddress.toHexString() + "-" + allowedTokens[i].toHexString();
    let fundToken = new FundToken(fundTokenId);
    fundToken.fund = fund.id;
    fundToken.token = allowedTokens[i];
    
    // Fetch token name and symbol from ERC20 contract
    let tokenContract = IERC20.bind(allowedTokens[i]);
    let nameResult = tokenContract.try_name();
    let symbolResult = tokenContract.try_symbol();
    
    // Set name and symbol with fallback values if calls fail
    fundToken.name = nameResult.reverted ? "Unknown" : nameResult.value;
    fundToken.symbol = symbolResult.reverted ? "UNKNOWN" : symbolResult.value;
    
    fundToken.targetWeight = targetWeights[i];
    fundToken.isActive = true;
    fundToken.addedAt = event.block.timestamp;
    fundToken.addedAtBlock = event.block.number;
    fundToken.updatedAt = event.block.timestamp;
    fundToken.save();
  }

  // Create or update Agent entity
  let agent = Agent.load(event.params.initialAgent.toHexString());
  if (agent == null) {
    agent = new Agent(event.params.initialAgent.toHexString());
    agent.address = event.params.initialAgent;
    agent.activeFundCount = BigInt.fromI32(0);
    agent.totalFundCount = BigInt.fromI32(0);
    agent.firstActiveAt = event.block.timestamp;
  }
  agent.activeFundCount = agent.activeFundCount.plus(BigInt.fromI32(1));
  agent.totalFundCount = agent.totalFundCount.plus(BigInt.fromI32(1));
  agent.lastActiveAt = event.block.timestamp;
  agent.save();

  // Update global stats
  let globalStats = GlobalStats.load("1");
  if (globalStats == null) {
    globalStats = new GlobalStats("1");
    globalStats.totalFunds = BigInt.fromI32(0);
    globalStats.totalRegistryAllowedTokens = BigInt.fromI32(0);
    globalStats.totalValueLockedUSDC = BigInt.fromI32(0);
  }
  globalStats.totalFunds = globalStats.totalFunds.plus(BigInt.fromI32(1));
  globalStats.lastUpdated = event.block.timestamp;
  globalStats.save();

  // Start tracking this fund contract
  FundTemplate.create(event.params.fundAddress);
}

export function handleRegistryAllowedTokenAdded(event: RegistryAllowedTokenAdded): void {
  // Get or create registry entity
  let registry = Registry.load(event.address.toHexString());
  if (registry == null) {
    registry = new Registry(event.address.toHexString());
    registry.fundCount = BigInt.fromI32(0);
    registry.createdAt = event.block.timestamp;
  }

  // Create AllowedToken entity
  let allowedTokenId = event.address.toHexString() + "-" + event.params.token.toHexString();
  let allowedToken = AllowedToken.load(allowedTokenId);
  
  if (allowedToken == null) {
    allowedToken = new AllowedToken(allowedTokenId);
    allowedToken.registry = registry.id;
    allowedToken.token = event.params.token;
    allowedToken.addedAtBlock = event.block.number;
  }
  
  allowedToken.isActive = true;
  allowedToken.addedAt = event.block.timestamp;
  allowedToken.removedAt = null;
  allowedToken.removedAtBlock = null;
  allowedToken.save();

  registry.updatedAt = event.block.timestamp;
  registry.save();

  // Update global stats
  let globalStats = GlobalStats.load("1");
  if (globalStats == null) {
    globalStats = new GlobalStats("1");
    globalStats.totalFunds = BigInt.fromI32(0);
    globalStats.totalRegistryAllowedTokens = BigInt.fromI32(0);
    globalStats.totalValueLockedUSDC = BigInt.fromI32(0);
  }
  globalStats.totalRegistryAllowedTokens = globalStats.totalRegistryAllowedTokens.plus(BigInt.fromI32(1));
  globalStats.lastUpdated = event.block.timestamp;
  globalStats.save();
}

export function handleRegistryAllowedTokenRemoved(event: RegistryAllowedTokenRemoved): void {
  // Get or create registry entity
  let registry = Registry.load(event.address.toHexString());
  if (registry == null) {
    registry = new Registry(event.address.toHexString());
    registry.fundCount = BigInt.fromI32(0);
    registry.createdAt = event.block.timestamp;
  }

  // Update AllowedToken entity
  let allowedTokenId = event.address.toHexString() + "-" + event.params.token.toHexString();
  let allowedToken = AllowedToken.load(allowedTokenId);
  
  if (allowedToken != null) {
    allowedToken.isActive = false;
    allowedToken.removedAt = event.block.timestamp;
    allowedToken.removedAtBlock = event.block.number;
    allowedToken.save();
  }

  registry.updatedAt = event.block.timestamp;
  registry.save();

  // Update global stats
  let globalStats = GlobalStats.load("1");
  if (globalStats != null) {
    globalStats.totalRegistryAllowedTokens = globalStats.totalRegistryAllowedTokens.minus(BigInt.fromI32(1));
    globalStats.lastUpdated = event.block.timestamp;
    globalStats.save();
  }
}



/**
 * Hourly block handler to update NAV for all funds
 * This runs every ~300 blocks (1 hour on Base with 2 second blocks)
 */
export function handleHourlyNAVUpdate(block: ethereum.Block): void {
  // Round timestamp to hour
  let hourTimestamp = roundToHour(block.timestamp);
  let totalTVL = BigInt.fromI32(0);
  
  // Get the registry contract to fetch all deployed funds
  // Note: You need to update REGISTRY_ADDRESS in helpers.ts with the actual deployed address
  let registryContract = WhackRockFundRegistry.bind(Address.fromString(REGISTRY_ADDRESS));
  
  // Get the number of deployed funds
  let fundCountResult = registryContract.try_getDeployedFundsCount();
  if (fundCountResult.reverted) return;
  
  let fundCount = fundCountResult.value;
  
  // Iterate through all funds
  for (let i = 0; i < fundCount.toI32(); i++) {
    let fundAddressResult = registryContract.try_getFundAddressByIndex(BigInt.fromI32(i));
    if (fundAddressResult.reverted) continue;
    
    let fundAddress = fundAddressResult.value;
    let fund = Fund.load(fundAddress.toHexString());
    if (fund == null) continue;
    
    // Get fund contract instance
    let fundContract = FundContract.bind(fundAddress);
    
    // Get NAV in USDC
    let navResult = fundContract.try_totalNAVInUSDC();
    
    // Get total supply using IERC20 interface since WhackRockFund inherits from ERC20
    let erc20Contract = IERC20.bind(fundAddress);
    let totalSupplyResult = erc20Contract.try_totalSupply();
    
    if (navResult.reverted || totalSupplyResult.reverted) continue;
    
    let navInUSDC = navResult.value;
    let totalSupply = totalSupplyResult.value;
    
    // Update fund entity
    fund.currentNAVInUSDC = navInUSDC;
    fund.lastNAVUpdate = block.timestamp;
    fund.totalSupply = totalSupply;
    fund.updatedAt = block.timestamp;
    fund.save();
    
    // Create hourly snapshot
    let snapshotId = fundAddress.toHexString() + "-" + hourTimestamp.toString() + "-hourly-" + block.number.toString();
    
    // Since FundNAVSnapshot is immutable, we only create new ones
    let snapshot = new FundNAVSnapshot(snapshotId);
    snapshot.fund = fund.id;
    snapshot.timestamp = hourTimestamp;
    snapshot.navInUSDC = navInUSDC;
    snapshot.totalSupply = totalSupply;
    snapshot.blockNumber = block.number;
    snapshot.triggeredBy = "hourly";
    snapshot.transactionHash = ZERO_BYTES;
    snapshot.wethValueInUSDC = BigInt.fromI32(0); // Default value for hourly updates since we can't get WETH price from block handler
    
    // Calculate NAV per share
    snapshot.navPerShare = calculateNavPerShare(navInUSDC, totalSupply);
    
    snapshot.save();
    
    // Add to total TVL
    totalTVL = totalTVL.plus(navInUSDC);
  }
  
  // Update global stats
  let globalStats = GlobalStats.load("1");
  if (globalStats == null) {
    globalStats = new GlobalStats("1");
    globalStats.totalFunds = BigInt.fromI32(0);
    globalStats.totalRegistryAllowedTokens = BigInt.fromI32(0);
    globalStats.totalValueLockedUSDC = BigInt.fromI32(0);
  }
  
  globalStats.totalValueLockedUSDC = totalTVL;
  globalStats.lastUpdated = block.timestamp;
  globalStats.save();
} 