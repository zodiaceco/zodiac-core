import assert from "node:assert/strict";
import { describe, it } from "node:test";

import waitForTransaction from "../../src/tooling/waitForTransaction";
import { stubProvider } from "../helpers/provider";
import { withFakeTimers } from "../helpers/timers";

const hash =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const receipt = { transactionHash: hash, status: "0x1" };

describe("waitForTransaction", () => {
  it("resolves immediately when the receipt is available", async () => {
    const { provider, requests } = stubProvider({
      eth_getTransactionReceipt: () => receipt,
    });
    await withFakeTimers(async (delays) => {
      await waitForTransaction(hash, provider);
      assert.deepEqual(delays, []);
    });
    assert.deepEqual(requests, [
      { method: "eth_getTransactionReceipt", params: [hash] },
    ]);
  });

  it("polls eth_getTransactionReceipt until the receipt appears", async () => {
    const answers = [null, null, receipt];
    const { provider, requests } = stubProvider({
      eth_getTransactionReceipt: () => answers.shift(),
    });
    await withFakeTimers(async (delays) => {
      await waitForTransaction(hash, provider);
      assert.equal(delays.length, 2);
    });
    assert.equal(requests.length, 3);
    for (const request of requests) assert.deepEqual(request.params, [hash]);
  });

  it("rejects when the provider rejects", async () => {
    const { provider } = stubProvider({
      eth_getTransactionReceipt: () => {
        throw new Error("connection lost");
      },
    });
    await assert.rejects(waitForTransaction(hash, provider), /connection lost/);
  });
});
