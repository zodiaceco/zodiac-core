import { getAddress, pad, toHex, type Address } from "viem";

/** Chain id of the test chain. */
export const CHAIN_ID = 31337;

export const SENTINEL = "0x0000000000000000000000000000000000000001";

export enum Operation {
  Call = 0,
  DelegateCall = 1,
}

/** A distinct placeholder address with no code: `addr(1)` is 0x…1001. */
export function addr(n: number): Address {
  return getAddress(pad(toHex(0x1000 + n), { size: 20 }));
}
