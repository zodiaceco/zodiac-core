import type { Address } from "viem";

import { verifySourceCode } from "./etherscan.js";
import type { AbiArgs } from "../types.js";

/**
 * Verifies a mastercopy contract on an Etherscan-compatible block explorer.
 * Returns `noop: true` if the contract is already verified.
 *
 * On Etherscan V2, waits for verification confirmation. Legacy explorer
 * endpoints return once the submission is accepted.
 *
 * @param params.chainId - The chain ID.
 * @param params.apiKey - API key for the block explorer.
 * @param params.artifact - Contract metadata and Solidity standard JSON input (including dependencies and library settings).
 * @param params.apiUrl - Optional custom explorer API URL (defaults to Etherscan V2 for the chain).
 */
export default async function verifyMastercopy({
  chainId,
  apiKey,
  artifact,
  apiUrl,
}: {
  chainId: number;
  apiKey: string;
  artifact: {
    contractName: string;
    sourceName: string;
    compilerVersion: string;
    compilerInput: unknown;
    address: Address;
    constructorArgs: AbiArgs;
  };
  apiUrl?: string;
}): Promise<{
  address: Address;
  noop: boolean;
}> {
  const { noop } = await verifySourceCode({
    ...artifact,
    chainId,
    apiKey,
    apiUrl,
  });

  return { address: artifact.address, noop };
}
