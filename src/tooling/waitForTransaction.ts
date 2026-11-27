import type { Hex } from "viem";

import type { EIP1193Provider } from "../types.js";

/**
 * Waits for a transaction to be mined and returns the transaction receipt.
 *
 * @param {string} hash - The transaction hash.
 * @param {EIP1193Provider} provider - The EIP1193 compliant provider to interact with the blockchain.
 * @returns {Promise<void>} A promise that resolves once the transaction receipt is obtained.
 */
export default async function waitForTransaction(
  hash: Hex,
  provider: EIP1193Provider
): Promise<void> {
  let receipt;
  while (!receipt) {
    receipt = await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    });
    if (!receipt) {
      await wait(200);
    }
  }
}

/**
 * Delays execution for a specified number of milliseconds.
 *
 * @param {number} milliseconds - The number of milliseconds to wait.
 * @returns {Promise<void>} A promise that resolves after the specified delay.
 */
function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
