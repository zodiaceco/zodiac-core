import { encodeFunctionData, type Address } from "viem";

import { encodeSetUp } from "./encodeArgs.js";
import {
  abi as factoryAbi,
  address as factoryAddress,
} from "../factory/proxyFactory.js";

import type { AbiArgs, Transaction } from "../types.js";

/**
 * Encodes the transaction for deploying a Mod instance as a minimal proxy
 * through the ModuleProxyFactory.
 *
 * @param params.factory - The ModuleProxyFactory to deploy through. Defaults to the canonical one.
 * @param params.mastercopy - The address of the mastercopy contract.
 * @param params.setupArgs - The Mod setup args, ABI-encoded into the `setUp` call.
 * @param params.saltNonce - The salt nonce used in the proxy deployment.
 */
export default function encodeDeployProxy({
  factory = factoryAddress,
  mastercopy,
  setupArgs,
  saltNonce,
}: {
  factory?: Address;
  mastercopy: Address;
  setupArgs: AbiArgs;
  saltNonce: bigint | number | string;
}): Transaction {
  return {
    to: factory,
    data: encodeFunctionData({
      abi: factoryAbi,
      functionName: "deployModule",
      args: [mastercopy, encodeSetUp(setupArgs), BigInt(saltNonce)],
    }),
  };
}
