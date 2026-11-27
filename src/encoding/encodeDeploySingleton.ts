import { isAddressEqual, type Address } from "viem";

import encodeDeployViaNickFactory from "./encodeDeployViaNickFactory.js";
import encodeDeployVia2470Factory from "./encodeDeployVia2470Factory.js";
import { address as nickFactoryAddress } from "../factory/nickFactory.js";
import { address as erc2470FactoryAddress } from "../factory/erc2470Factory.js";

import type { Create2Args, Transaction } from "../types.js";

/**
 * Encodes the transaction for deploying a singleton (for example a mastercopy)
 * through a singleton factory. Uses Nick's factory encoding when `factory` is
 * Nick's factory, and the ERC-2470 encoding otherwise.
 *
 * @param params.factory - The singleton factory. Defaults to ERC-2470.
 * @param params.bytecode - The creation bytecode of the contract to deploy.
 * @param params.constructorArgs - The constructor arguments, appended to the bytecode.
 * @param params.salt - The bytes32 CREATE2 salt.
 */
export default function encodeDeploySingleton({
  factory = erc2470FactoryAddress,
  bytecode,
  constructorArgs,
  salt,
}: Create2Args & { factory?: Address }): Transaction {
  const encode = isAddressEqual(factory, nickFactoryAddress)
    ? encodeDeployViaNickFactory
    : encodeDeployVia2470Factory;

  return encode({ factory, bytecode, constructorArgs, salt });
}
