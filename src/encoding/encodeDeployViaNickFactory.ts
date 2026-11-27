import { concat, type Address } from "viem";

import { creationBytecode } from "./predictSingletonAddress.js";
import { address as factoryAddress } from "../factory/nickFactory.js";

import type { Create2Args, Transaction } from "../types.js";

/**
 * Encodes the transaction for deploying a singleton via Nick's factory, which
 * takes `salt ‖ creationBytecode` as raw calldata.
 *
 * @param params.factory - Nick's factory. Defaults to the canonical one.
 * @param params.bytecode - The creation bytecode of the contract to deploy.
 * @param params.constructorArgs - The constructor arguments, appended to the bytecode.
 * @param params.salt - The bytes32 CREATE2 salt.
 */
export default function encodeDeployViaNickFactory({
  factory = factoryAddress,
  bytecode,
  constructorArgs,
  salt,
}: Create2Args & { factory?: Address }): Transaction {
  return {
    to: factory,
    data: concat([salt, creationBytecode({ bytecode, constructorArgs })]),
  };
}
