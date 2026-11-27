import {
  hashStruct,
  hashTypedData,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "viem";

import { CHAIN_ID } from "./constants";

/** The EIP-712 message the test modifiers authenticate (`TestTypedData.sol`). */
export type ModuleTx = {
  to: Address;
  value: bigint;
  data: Hex;
  operation: number;
};

export const moduleTxTypes = {
  ModuleTx: [
    { type: "address", name: "to" },
    { type: "uint256", name: "value" },
    { type: "bytes", name: "data" },
    { type: "uint8", name: "operation" },
    { type: "bytes32", name: "salt" },
  ],
} as const;

export type Signer = {
  account: { address: Address };
  signTypedData: (args: any) => Promise<Hex>;
};

export type Domain = { chainId?: number; verifyingContract: Address };

export function salt(text: string): Hex {
  return keccak256(toHex(text));
}

export function moduleTxStructHash(tx: ModuleTx, salt: Hex): Hex {
  return hashStruct({
    types: moduleTxTypes,
    primaryType: "ModuleTx",
    data: { ...tx, salt },
  });
}

/** The digest the modifier at `verifyingContract` checks signatures against. */
export function moduleTxDigest(
  { chainId = CHAIN_ID, verifyingContract }: Domain,
  tx: ModuleTx,
  salt: Hex
): Hex {
  return hashTypedData({
    domain: { chainId, verifyingContract },
    types: moduleTxTypes,
    primaryType: "ModuleTx",
    message: { ...tx, salt },
  });
}

/** Signs `tx` and `salt` as the EIP-712 `ModuleTx` message. */
export function signModuleTx(
  signer: Signer,
  { chainId = CHAIN_ID, verifyingContract }: Domain,
  tx: ModuleTx,
  salt: Hex
): Promise<Hex> {
  return signer.signTypedData({
    account: signer.account,
    domain: { chainId, verifyingContract },
    types: moduleTxTypes,
    primaryType: "ModuleTx",
    message: { ...tx, salt },
  });
}
