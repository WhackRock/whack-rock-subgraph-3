# Subgraph Fixes Applied

## Issue: Immutable Entity Overwrite Error

### Problem
The subgraph was failing with the error:
```
immutable entity type FundNAVSnapshot only allows inserts, not Overwrite
```

This occurred because the code was trying to update existing `FundNAVSnapshot` entities, but these entities are marked as `immutable: true` in the schema.

### Root Cause
1. In `fund.ts`, the `createOrUpdateNAVSnapshot` function was using `FundNAVSnapshot.load()` to check if an entity exists and then either create or update it.
2. In `registry.ts`, the `handleHourlyNAVUpdate` function was doing the same thing.
3. The snapshot IDs were based only on fund address and hour timestamp, causing collisions when multiple events occurred in the same hour.

### Solution
1. **Renamed function**: Changed `createOrUpdateNAVSnapshot` to `createNAVSnapshot` to reflect that it only creates new entities.

2. **Updated snapshot ID generation**: 
   - For event-triggered snapshots: `fundAddress + hourTimestamp + transactionHash + blockNumber`
   - For hourly block handler snapshots: `fundAddress + hourTimestamp + "hourly" + blockNumber`
   - This ensures unique IDs even when multiple events occur in the same hour

3. **Removed load/update pattern**: Since `FundNAVSnapshot` is immutable, we now only create new entities, never load existing ones.

4. **Added WETH price tracking**: The fund entity now updates `lastWethValueInUSDC` whenever a new price is available from events.

### Other Immutable Entities
The following entities are also immutable and were verified to be handled correctly:
- `Deposit` - Created with unique ID using transaction hash + log index
- `Withdrawal` - Created with unique ID using transaction hash + log index  
- `RebalanceCycle` - Created with unique ID using transaction hash + log index

These entities are never loaded for updates, only created with unique IDs.

### Files Modified
- `src/fund.ts` - Fixed snapshot creation logic
- `src/registry.ts` - Fixed hourly snapshot creation logic

### Testing
After these changes, the subgraph should be able to:
1. Create multiple NAV snapshots per hour without ID collisions
2. Properly track NAV changes from deposits, withdrawals, fees, and rebalances
3. Create hourly snapshots via the block handler 