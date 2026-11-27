import type { Address, Hex } from "viem";

import encodeDeployProxy from "../encoding/encodeDeployProxy.js";
import predictProxyAddress from "../encoding/predictProxyAddress.js";
import waitForTransaction from "./waitForTransaction.js";

import type { AbiArgs, EIP1193Provider } from "../types.js";

/**
 * Deploys a Mod instance as a minimal proxy via the ModuleProxyFactory.
 * Returns `noop: true` if bytecode already exists at the predicted address.
 *
 * @param params.mastercopy - The address of the mastercopy contract.
 * @param params.setupArgs - The Mod setup args, ABI-encoded into the `setUp` call.
 * @param params.saltNonce - The salt nonce used in the proxy deployment.
 * @param params.provider - EIP-1193 provider to send the deployment transaction.
 */
export default async function deployModuleAsProxy({
  mastercopy,
  setupArgs,
  saltNonce,
  provider,
}: {
  mastercopy: Address;
  setupArgs: AbiArgs;
  saltNonce: bigint | number | string;
  provider: EIP1193Provider;
}): Promise<{ address: Address; noop: boolean }> {
  const address = predictProxyAddress({
    mastercopy,
    setupArgs,
    saltNonce,
  });

  const code = await provider.request({
    method: "eth_getCode",
    params: [address, "latest"],
  });
  if (code != "0x") {
    return { address, noop: true };
  }

  const transaction = encodeDeployProxy({
    mastercopy,
    setupArgs,
    saltNonce,
  });

  const hash = (await provider.request({
    method: "eth_sendTransaction",
    params: [transaction],
  })) as Hex;
  await waitForTransaction(hash, provider);

  return { address, noop: false };
}
