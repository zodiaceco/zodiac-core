import {
  concat,
  encodeAbiParameters,
  getContractAddress,
  isAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import { encodeSetUp } from "./encodeArgs.js";
import { address as factoryAddress } from "../factory/proxyFactory.js";

import type { AbiArgs } from "../types.js";

/**
 * Predicts the address of a Mod instance deployed via ModuleProxyFactory.
 *
 * @param params.factory - The ModuleProxyFactory to deploy through. Defaults to the canonical one.
 * @param params.mastercopy - The address of the mastercopy contract.
 * @param params.setupArgs - The Mod setup args, ABI-encoded into the `setUp` call.
 * @param params.saltNonce - The salt nonce used to derive the final CREATE2 salt.
 */
export default function predictProxyAddress({
  factory = factoryAddress,
  mastercopy,
  setupArgs,
  saltNonce,
}: {
  factory?: Address;
  mastercopy: Address;
  setupArgs: AbiArgs;
  saltNonce: bigint | number | string;
}): Address {
  const salt = keccak256(
    concat([
      keccak256(encodeSetUp(setupArgs)),
      encodeAbiParameters([{ type: "uint256" }], [BigInt(saltNonce)]),
    ])
  );
  return getContractAddress({
    opcode: "CREATE2",
    from: factory,
    salt,
    bytecodeHash: keccak256(creationBytecode(mastercopy)),
  });
}

/**
 * Generates the EIP-1167 minimal proxy creation bytecode for `mastercopy`.
 */
function creationBytecode(mastercopy: Address): Hex {
  if (!isAddress(mastercopy)) {
    throw new Error(`Mastercopy address "${mastercopy}" is invalid`);
  }
  return concat([
    "0x602d8060093d393df3363d3d373d3d3d363d73",
    mastercopy,
    "0x5af43d82803e903d91602b57fd5bf3",
  ]);
}
