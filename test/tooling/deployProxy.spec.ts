import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type { Address } from "viem";

import { ModuleProxyFactory } from "../../build/contracts";
import predictProxyAddress from "../../src/encoding/predictProxyAddress";
import { address as proxyFactoryAddress } from "../../src/factory/proxyFactory";
import deployFactories from "../../src/tooling/deployFactories";
import deployProxy from "../../src/tooling/deployProxy";
import { startChain } from "../helpers/chain";
import { addr } from "../helpers/constants";
import { recording, withSender } from "../helpers/provider";

const chain = await startChain();
const { deployContract, getContractAt, loadFixture, publicClient, assertions } =
  chain;
const [owner] = chain.walletClients;

after(() => chain.stop());

async function setup() {
  const provider = withSender(chain.provider, owner.account.address);
  await deployFactories({ provider });
  const mastercopy = await deployContract("TestModule", [
    addr(1),
    addr(1),
    addr(1),
  ]);
  return { provider, mastercopy };
}

const setupArgs = {
  types: ["address", "address", "address"],
  values: [addr(10), addr(11), addr(12)],
};
const factory = { abi: ModuleProxyFactory.abi, address: proxyFactoryAddress };

const hasCode = async (address: Address) =>
  (await publicClient.getCode({ address })) !== undefined;

describe("deployProxy", () => {
  it("deploys and initializes a proxy at the predicted address", async () => {
    const { provider, mastercopy } = await loadFixture(setup);
    const params = { mastercopy: mastercopy.address, setupArgs, saltNonce: 1n };
    const address = predictProxyAddress(params);
    assert.deepEqual(await deployProxy({ ...params, provider }), {
      address,
      noop: false,
    });

    const proxy = getContractAt("TestModule", address);
    assert.equal(await proxy.read.owner(), addr(10));
    assert.equal(await proxy.read.avatar(), addr(11));
    assert.equal(await proxy.read.target(), addr(12));
  });

  it("returns noop: false on first deployment, then noop: true without sending anything", async () => {
    const { provider, mastercopy } = await loadFixture(setup);
    const params = { mastercopy: mastercopy.address, setupArgs, saltNonce: 1n };
    const first = await deployProxy({ ...params, provider });
    assert.equal(first.noop, false);

    const recorder = recording(provider);
    assert.deepEqual(
      await deployProxy({ ...params, provider: recorder.provider }),
      {
        address: first.address,
        noop: true,
      }
    );
    assert.deepEqual(
      recorder.requests.map((r) => r.method),
      ["eth_getCode"]
    );
  });

  it("deploys a second proxy for a different saltNonce", async () => {
    const { provider, mastercopy } = await loadFixture(setup);
    const first = await deployProxy({
      mastercopy: mastercopy.address,
      setupArgs,
      saltNonce: 1n,
      provider,
    });
    const second = await deployProxy({
      mastercopy: mastercopy.address,
      setupArgs,
      saltNonce: 2n,
      provider,
    });
    assert.equal(second.noop, false);
    assert.notEqual(second.address, first.address);
    assert.equal(await hasCode(second.address), true);
  });

  it("rejects when mastercopy has no code", async () => {
    const { provider } = await loadFixture(setup);
    await assertions.revertWithCustomErrorWithArgs(
      deployProxy({ mastercopy: addr(5), setupArgs, saltNonce: 1n, provider }),
      factory,
      "TargetHasNoCode",
      [addr(5)]
    );
  });

  it("rejects when setUp reverts", async () => {
    const { provider, mastercopy } = await loadFixture(setup);
    // setUp decodes three addresses from a single word.
    const params = {
      mastercopy: mastercopy.address,
      setupArgs: { types: ["uint256"], values: [1n] },
      saltNonce: 1n,
    };
    await assertions.revertWithCustomError(
      deployProxy({ ...params, provider }),
      factory,
      "FailedInitialization"
    );
    assert.equal(await hasCode(predictProxyAddress(params)), false);
  });
});
