import { encodeFunctionData, type Address } from "viem";

import { creationBytecode } from "./predictSingletonAddress.js";
import {
  abi as factoryAbi,
  address as factoryAddress,
} from "../factory/erc2470Factory.js";

import type { Create2Args, Transaction } from "../types.js";

/**
 * Encodes the transaction for deploying a singleton via the ERC-2470 factory.
 *
 * @param params.factory - The ERC-2470 factory. Defaults to the canonical one.
 * @param params.bytecode - The creation bytecode of the contract to deploy.
 * @param params.constructorArgs - The constructor arguments, appended to the bytecode.
 * @param params.salt - The bytes32 CREATE2 salt.
 */
export default function encodeDeployVia2470Factory({
  factory = factoryAddress,
  bytecode,
  constructorArgs,
  salt,
}: Create2Args & { factory?: Address }): Transaction {
  return {
    to: factory,
    data: encodeFunctionData({
      abi: factoryAbi,
      functionName: "deploy",
      args: [creationBytecode({ bytecode, constructorArgs }), salt],
    }),
  };
}
