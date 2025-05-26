import { BigInt, BigDecimal, Bytes } from "@graphprotocol/graph-ts";

// Constants
export const REGISTRY_ADDRESS = "0x2b9e3ddfa63e3e93b931fcad8fa98307225dfb0f"; // This will be replaced with actual address
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