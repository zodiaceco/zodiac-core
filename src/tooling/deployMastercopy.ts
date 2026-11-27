import { numberToHex, type Address, type Hex } from "viem";

import { address as erc2470FactoryAddress } from "../factory/erc2470Factory.js";

import encodeDeploySingleton from "../encoding/encodeDeploySingleton.js";
import predictSingletonAddress, {
  creationBytecode,
} from "../encoding/predictSingletonAddress.js";

import waitForTransaction from "./waitForTransaction.js";

import { Create2Args, EIP1193Provider } from "../types.js";

/**
 * Deploys a mastercopy via a singleton factory. Returns `noop: true` if
 * bytecode already exists at the predicted address.
 *
 * @param params.factory - The singleton factory. Defaults to ERC-2470.
 * @param params.bytecode - The creation bytecode of the contract to deploy.
 * @param params.constructorArgs - The constructor arguments, appended to the bytecode.
 * @param params.salt - The bytes32 CREATE2 salt.
 * @param params.provider - EIP-1193 provider to send the deployment transaction.
 * @param params.onStart - Optional callback invoked right before submitting the deployment.
 */
export default async function deployMastercopy({
  factory = erc2470FactoryAddress,
  bytecode,
  constructorArgs,
  salt,
  provider,
  onStart,
}: Create2Args & {
  factory?: Address;
  provider: EIP1193Provider;
  onStart?: () => void;
}): Promise<{
  address: Address;
  noop: boolean;
}> {
  const address = predictSingletonAddress({
    factory,
    bytecode,
    constructorArgs,
    salt,
  });
  const code = await provider.request({
    method: "eth_getCode",
    params: [address, "latest"],
  });
  if (code != "0x") {
    return { address, noop: true };
  }

  onStart && onStart();

  /*
   * To address an RPC gas estimation issue with the CREATE2 opcode,
   * we combine the gas estimation for deploying from the factory contract
   * with the gas estimation for a simple inner contract deployment.
   */
  const [gasEstimation, innerGasEstimation] = await Promise.all([
    provider.request({
      method: "eth_estimateGas",
      params: [
        encodeDeploySingleton({ factory, bytecode, constructorArgs, salt }),
      ],
    }),
    provider.request({
      method: "eth_estimateGas",
      params: [{ data: creationBytecode({ bytecode, constructorArgs }) }],
    }),
  ]);

  const transaction = {
    ...encodeDeploySingleton({
      factory,
      bytecode,
      constructorArgs,
      salt,
    }),
    gas: numberToHex(
      BigInt(gasEstimation as string) + BigInt(innerGasEstimation as string)
    ),
  };

  const hash = (await provider.request({
    method: "eth_sendTransaction",
    params: [transaction],
  })) as Hex;

  await waitForTransaction(hash, provider);

  return { address, noop: false };
}
