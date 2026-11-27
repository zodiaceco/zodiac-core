import {
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  parseAbiParameter,
  type AbiParameter,
  type Hex,
} from "viem";

import type { AbiArgs } from "../types.js";

/**
 * ABI-encodes `values` according to `types`.
 */
export function encodeArgs({ types, values }: AbiArgs): Hex {
  const params: AbiParameter[] = types.map((type) =>
    typeof type === "string" ? parseAbiParameter(type) : type
  );
  return encodeAbiParameters(params, values as unknown[]);
}

const setUpAbi = parseAbi(["function setUp(bytes initializeParams)"]);

/**
 * Encodes the `setUp(bytes)` call that initializes a Mod proxy.
 */
export function encodeSetUp(setupArgs: AbiArgs): Hex {
  return encodeFunctionData({
    abi: setUpAbi,
    functionName: "setUp",
    args: [encodeArgs(setupArgs)],
  });
}
