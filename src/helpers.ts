import { BigInt, BigDecimal, Bytes } from "@graphprotocol/graph-ts";

// Constants
export const REGISTRY_ADDRESS = "0x0B606A3B7ed0dFD34aE60263F0AE221d5C7de75B"; // This will be replaced with actual address
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_BYTES = Bytes.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000000");

/**
 * Helper function to round timestamp to the nearest hour
 */
export function roundToHour(timestamp: BigInt): BigInt {
  let hourInSeconds = BigInt.fromI32(3600);
  return timestamp.div(hourInSeconds).times(hourInSeconds);
}

/**
 * Helper function to calculate NAV per share
 */
export function calculateNavPerShare(navInUSDC: BigInt, totalSupply: BigInt): BigDecimal {
  if (totalSupply.gt(BigInt.fromI32(0))) {
    return navInUSDC.toBigDecimal().div(totalSupply.toBigDecimal());
  }
  return BigDecimal.fromString("0");
} 