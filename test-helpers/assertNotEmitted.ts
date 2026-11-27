import assert from "node:assert/strict";

import {
  isAddressEqual,
  parseEventLogs,
  type Abi,
  type Address,
  type Hash,
} from "viem";

type ReceiptClient = {
  waitForTransactionReceipt: (args: { hash: Hash }) => Promise<{
    logs: { address: Address; data: Hash; topics: readonly Hash[] }[];
  }>;
};

/**
 * Asserts that the transaction succeeds without `contract` emitting
 * `eventName`. hardhat-viem-assertions has no negated `emit`.
 */
export default async function assertNotEmitted(
  client: ReceiptClient,
  hash: Hash | Promise<Hash>,
  contract: { abi: Abi; address: Address },
  eventName: string
): Promise<void> {
  const receipt = await client.waitForTransactionReceipt({ hash: await hash });
  const logs = parseEventLogs({
    abi: contract.abi,
    logs: receipt.logs.filter((log) =>
      isAddressEqual(log.address, contract.address)
    ) as any,
    eventName: eventName as never,
  });
  assert.equal(logs.length, 0, `Expected "${eventName}" not to be emitted`);
}
