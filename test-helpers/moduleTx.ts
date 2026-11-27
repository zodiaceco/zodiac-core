import { keccak256, toHex, type Address, type Hex } from "viem";

export type ModuleTx = {
  to: Address;
  value: bigint;
  data: Hex;
  operation: number;
};

export type Signer = {
  account: { address: Address };
  signTypedData: (args: any) => Promise<Hex>;
};

export const HARDHAT_CHAIN_ID = 31337;

export function salt(text: string): Hex {
  return keccak256(toHex(text));
}

/**
 * Signs `tx` and `salt` as the EIP-712 `ModuleTx` message that the test
 * modifiers and `TestSignature` authenticate.
 */
export function signModuleTx(
  signer: Signer,
  contract: Address,
  tx: ModuleTx,
  salt: Hex
): Promise<Hex> {
  return signer.signTypedData({
    account: signer.account,
    domain: { chainId: HARDHAT_CHAIN_ID, verifyingContract: contract },
    types: {
      ModuleTx: [
        { type: "address", name: "to" },
        { type: "uint256", name: "value" },
        { type: "bytes", name: "data" },
        { type: "uint8", name: "operation" },
        { type: "bytes32", name: "salt" },
      ],
    },
    primaryType: "ModuleTx",
    message: { ...tx, salt },
  });
}
