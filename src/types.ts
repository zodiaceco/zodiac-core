import type { AbiParameter, Address, Hex } from "viem";

export type RequestArguments = {
  readonly method: string;
  readonly params?: readonly unknown[] | object;
};

export type EIP1193Provider = {
  request: (args: RequestArguments) => Promise<unknown>;
};

/**
 * ABI-encodable arguments. Each type is either a human-readable ABI parameter
 * (`"address"`, `"uint256[]"`, `"(address to, uint256 value)"`) or a viem
 * `AbiParameter` object.
 */
export type AbiArgs = {
  types: readonly (string | AbiParameter)[];
  values: readonly unknown[];
};

export type Create2Args = {
  bytecode: Hex;
  constructorArgs: AbiArgs;
  salt: Hex;
};

export type Transaction = {
  to: Address;
  data: Hex;
};
