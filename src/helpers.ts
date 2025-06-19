import { BigInt, BigDecimal, Bytes } from "@graphprotocol/graph-ts";

// Constants
export const REGISTRY_ADDRESS = "0xAf2c1b44A8DF5e0B187e84988fF84F699D4B83a9"; // This will be replaced with actual address
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
 * navInUSDC has 6 decimals, totalSupply has 18 decimals
 * To get the correct USD price per share, we need to scale by 1e12
 */
export function calculateNavPerShare(navInUSDC: BigInt, totalSupply: BigInt): BigDecimal {
  if (totalSupply.gt(BigInt.fromI32(0))) {
    // Scale navInUSDC by 1e12 to account for decimal difference (18 - 6 = 12)
    let scaledNavInUSDC = navInUSDC.times(BigInt.fromString("1000000000000")); // 1e12
    return scaledNavInUSDC.toBigDecimal().div(totalSupply.toBigDecimal());
  }
  return BigDecimal.fromString("0");
} 