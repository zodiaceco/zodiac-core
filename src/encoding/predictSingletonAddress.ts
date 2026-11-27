import {
  concat,
  getContractAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import { encodeArgs } from "./encodeArgs.js";
import { address as erc2470FactoryAddress } from "../factory/erc2470Factory.js";

import type { AbiArgs, Create2Args } from "../types.js";

/**
 * Predicts the address of a singleton (for example a mastercopy) deployed via
 * a singleton factory. Uses the same CREATE2 derivation for both Nick's factory
 * and ERC-2470.
 *
 * @param params.factory - The singleton factory. Defaults to ERC-2470.
 * @param params.bytecode - The creation bytecode of the contract to deploy.
 * @param params.constructorArgs - The constructor arguments, appended to the bytecode.
 * @param params.salt - The bytes32 CREATE2 salt.
 */
export default function predictSingletonAddress({
  factory = erc2470FactoryAddress,
  bytecode,
  constructorArgs,
  salt,
}: Create2Args & { factory?: Address }): Address {
  return getContractAddress({
    opcode: "CREATE2",
    from: factory,
    salt,
    bytecodeHash: keccak256(creationBytecode({ bytecode, constructorArgs })),
  });
}

/**
 * Appends the ABI-encoded constructor arguments to the bytecode.
 */
export function creationBytecode({
  bytecode,
  constructorArgs,
}: {
  bytecode: Hex;
  constructorArgs: AbiArgs;
}): Hex {
  return concat([bytecode, encodeArgs(constructorArgs)]);
}
