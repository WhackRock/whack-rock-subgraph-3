# WhackRock Fund Subgraph

This subgraph indexes the WhackRock Fund protocol, tracking fund management, user deposits, withdrawals, and NAV calculations.

## Key Features

### User Deposit Tracking

The subgraph properly accounts for user deposits through the `WETHDepositedAndSharesMinted` event handler:

1. **User Entity Creation**: When a user makes their first deposit, a `User` entity is created tracking:
   - Total USDC value deposited across all funds
   - Total USDC value withdrawn across all funds
   - First and last activity timestamps

2. **User Fund Position**: Each user's position in a specific fund is tracked via `UserFundPosition` entities:
   - Current share balance
   - Total WETH deposited
   - Total USDC value of deposits (calculated at time of deposit)
   - Total WETH value of shares withdrawn
   - Total USDC value of withdrawals
   - Deposit and withdrawal counts
   - Active status (true if shareBalance > 0)

3. **Individual Deposits**: Each deposit creates a `Deposit` entity storing:
   - WETH amount deposited
   - Shares minted
   - NAV before deposit
   - WETH price in USDC at time of deposit
   - Calculated USDC value of the deposit

### NAV Tracking

The subgraph creates hourly NAV snapshots triggered by:
- Deposits
- Withdrawals
- Fee collections
- Rebalancing

Each snapshot stores:
- NAV in USDC
- Total supply of shares
- NAV per share
- WETH price in USDC

### Price Calculations

USDC values are calculated using the WETH price provided in events:
```typescript
// wethPriceInUSDC is the price of 1 WETH (1e18) in USDC (6 decimals)
// wethAmount is in wei (18 decimals)
// Result is in USDC units (6 decimals)
usdcValue = (wethAmount * wethPriceInUSDC) / 1e18
```

## Build & Deploy

```bash
# Install dependencies
npm install

# Generate code from schema
npm run codegen

# Build the subgraph
npm run build

# Deploy to The Graph
npm run deploy
```

## Entities

- **Fund**: Represents a WhackRock fund with its configuration, allowed tokens, and current NAV
- **User**: Tracks individual users across all funds
- **UserFundPosition**: Tracks a user's position in a specific fund
- **Deposit**: Records individual deposit transactions
- **Withdrawal**: Records individual withdrawal transactions
- **FundNAVSnapshot**: Hourly snapshots of fund NAV
- **Agent**: Tracks fund managers
- **FundToken**: Tokens allowed in a fund with target weights

## Recent Fixes

1. Fixed field name mismatches: `totalWithdrawnWETH` → `totalWETHValueOfSharesWithdrawn`
2. Fixed BigInt power calculation using `BigInt.fromString("1000000000000000000")` instead of `BigInt.fromI32(10).pow(18)`
3. Fixed null check for `firstDepositAt` using `!position.firstDepositAt` instead of `== null`

## Features

### Core Functionality
- ✅ **Tracks all funds created from the registry**
- ✅ **Tracks the registry's allowedTokenList** (add/remove events)
- ✅ **Tracks each individual fund's allowed tokens** with target weights
- ✅ **Hourly NAV snapshots in USDC** for each fund on Base

### Additional Features
- Agent management tracking
- Fund deposit/withdrawal events
- AUM fee collection tracking
- Global TVL calculation
- NAV per share calculations

## Hourly NAV Tracking

The subgraph includes an **efficient hourly block handler** that:
1. Runs every ~300 blocks (approximately 1 hour on Base with 2-second blocks)
2. Iterates through all funds created by the registry
3. Calls `totalNAVInUSDC()` on each fund contract
4. Creates hourly snapshots with NAV data
5. Updates global TVL across all funds

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Registry Address
Update the registry address in two places:

**`subgraph.yaml`:**
```yaml
source:
  address: "0x_YOUR_REGISTRY_ADDRESS" # Replace with actual registry address
  startBlock: YOUR_START_BLOCK # Replace with deployment block
```

**`src/helpers.ts`:**
```typescript
export const REGISTRY_ADDRESS = "0x_YOUR_REGISTRY_ADDRESS"; // Replace with actual address
```

### 3. Build and Deploy
```bash
# Generate types
npm run codegen

# Build the subgraph
npm run build

# Deploy to The Graph Studio
npm run deploy
```

## Queries

### Get All Funds with Current NAV
```graphql
{
  funds {
    id
    name
    symbol
    agent
    currentNAVInUSDC
    totalSupply
    allowedTokens {
      token
      targetWeight
      isActive
    }
  }
}
```

### Get Hourly NAV History for a Fund
```graphql
{
  fundNAVSnapshots(
    where: { fund: "0xFUND_ADDRESS" }
    orderBy: timestamp
    orderDirection: desc
    first: 168  # Last 7 days of hourly data
  ) {
    id
    navInUSDC
    navPerShare
    totalSupply
    timestamp
    triggeredBy
  }
}
```

### Get Registry Allowed Tokens
```graphql
{
  allowedTokens(where: { isActive: true }) {
    id
    token
    addedAt
    registry {
      id
    }
  }
}
```

### Get Global Stats
```graphql
{
  globalStats(id: "1") {
    totalFunds
    totalRegistryAllowedTokens
    totalValueLockedUSDC
    lastUpdated
  }
}
```

### Get Fund Token Weights
```graphql
{
  fund(id: "0xFUND_ADDRESS") {
    allowedTokens {
      token
      targetWeight
      isActive
    }
  }
}
```

## Entities

### Registry
- Tracks the main registry contract
- Contains global allowed tokens list
- Links to all created funds

### Fund
- Individual fund contracts
- Current NAV in USDC
- Total supply of shares
- Agent and fee configuration

### FundNAVSnapshot
- **Hourly snapshots of fund NAV**
- NAV in USDC
- NAV per share
- Triggered by: "hourly", "deposit", "withdrawal", or "fee"

### AllowedToken
- Registry-level allowed tokens
- Active/inactive status
- Add/remove timestamps

### FundToken
- Fund-specific allowed tokens
- Target weights in basis points (0-10000)
- Active status

### Agent
- Tracks fund managers
- Active and total fund counts
- First/last active timestamps

### GlobalStats
- Total funds count
- Total registry allowed tokens
- **Total Value Locked (TVL) in USDC**
- Last update timestamp

## Performance Optimizations

The hourly block handler is optimized for efficiency:
- Only creates snapshots once per hour per fund
- Uses `try_` functions to handle reverts gracefully
- Calculates global TVL in a single pass
- Minimal storage operations

## Notes

- The subgraph tracks NAV in USDC using the fund contract's `totalNAVInUSDC()` function
- Hourly snapshots are created both by the block handler and by fund events
- The block handler ensures we capture NAV even for inactive funds
- All timestamps are rounded to the nearest hour for consistency

## Base Network Configuration

The subgraph is configured for Base network:
- Network: `base`
- Block time: ~2 seconds
- Hourly blocks: ~300 blocks

## Troubleshooting

1. **Missing NAV data**: Ensure the fund contracts have proper liquidity for WETH/USDC conversion
2. **No hourly snapshots**: Verify the registry address is correctly set in both locations
3. **Build errors**: Run `npm run codegen` before `npm run build` 