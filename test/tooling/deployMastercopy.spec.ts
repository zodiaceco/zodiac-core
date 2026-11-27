import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { keccak256, numberToHex, toHex } from "viem";

import { TestModule } from "../../build/contracts";
import predictSingletonAddress from "../../src/encoding/predictSingletonAddress";
import { address as nickFactory } from "../../src/factory/nickFactory";
import deployFactories from "../../src/tooling/deployFactories";
import deployMastercopy from "../../src/tooling/deployMastercopy";
import { startChain } from "../helpers/chain";
import { addr } from "../helpers/constants";
import { recording, withSender } from "../helpers/provider";

const chain = await startChain();
const { getContractAt, hasCode, loadFixture } = chain;
const [owner] = chain.walletClients;

after(() => chain.stop());

async function setup() {
  const provider = withSender(chain.provider, owner.account.address);
  await deployFactories({ provider });
  return { provider };
}

const salt = keccak256(toHex("mastercopy"));
const constructorArgs = {
  types: ["address", "address", "address"],
  values: [addr(1), addr(2), addr(3)],
};
const params = { bytecode: TestModule.bytecode, constructorArgs, salt };

describe("deployMastercopy", () => {
  for (const [label, factory] of [
    ["ERC-2470 (default)", undefined],
    ["Nick's factory", nickFactory],
  ] as const) {
    it(`deploys at the predicted address through ${label}`, async () => {
      const { provider } = await loadFixture(setup);
      const address = predictSingletonAddress({ ...params, factory });
      assert.equal(await hasCode(address), false);
      assert.deepEqual(
        await deployMastercopy({ ...params, factory, provider }),
        { address, noop: false }
      );
      assert.equal(await hasCode(address), true);
    });
  }

  it("deploys with constructor args", async () => {
    const { provider } = await loadFixture(setup);
    const { address } = await deployMastercopy({ ...params, provider });
    const module = getContractAt("TestModule", address);
    assert.equal(await module.read.owner(), addr(1));
    assert.equal(await module.read.avatar(), addr(2));
    assert.equal(await module.read.target(), addr(3));
  });

  it("returns noop: false on first deployment, then noop: true without sending anything", async () => {
    const { provider } = await loadFixture(setup);
    const first = await deployMastercopy({ ...params, provider });
    assert.equal(first.noop, false);

    const recorder = recording(provider);
    const second = await deployMastercopy({
      ...params,
      provider: recorder.provider,
    });
    assert.deepEqual(second, { address: first.address, noop: true });
    assert.deepEqual(
      recorder.requests.map((r) => r.method),
      ["eth_getCode"]
    );
  });

  it("calls onStart once before sending, and not on a noop", async () => {
    const { provider } = await loadFixture(setup);
    const recorder = recording(provider);
    const sentAtStart: number[] = [];
    const onStart = () =>
      sentAtStart.push(recorder.of("eth_sendTransaction").length);
    await deployMastercopy({ ...params, provider: recorder.provider, onStart });
    assert.deepEqual(sentAtStart, [0]);
    assert.equal(recorder.of("eth_sendTransaction").length, 1);

    await deployMastercopy({ ...params, provider, onStart });
    assert.deepEqual(sentAtStart, [0]);
  });

  it("sets gas to the sum of the factory and inner deployment estimates", async () => {
    const { provider } = await loadFixture(setup);
    const recorder = recording(provider);
    await deployMastercopy({ ...params, provider: recorder.provider });
    const estimates = recorder.of("eth_estimateGas");
    assert.equal(estimates.length, 2);
    const total = estimates.reduce(
      (sum, r) => sum + BigInt(r.result as string),
      0n
    );
    const [sent] = recorder.of("eth_sendTransaction");
    assert.equal(sent.params[0].gas, numberToHex(total));
  });

  for (const [step, method] of [
    ["gas estimation", "eth_estimateGas"],
    ["eth_sendTransaction", "eth_sendTransaction"],
  ] as const) {
    it(`rejects when ${step} fails`, async () => {
      const { provider } = await loadFixture(setup);
      const recorder = recording(provider, (args) =>
        args.method === method
          ? Promise.reject(new Error(`${method} failed`))
          : undefined
      );
      await assert.rejects(
        deployMastercopy({ ...params, provider: recorder.provider }),
        new RegExp(`${method} failed`)
      );
      assert.equal(await hasCode(predictSingletonAddress(params)), false);
    });
  }
});
