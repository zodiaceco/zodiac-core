import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { startChain } from "./helpers/chain";
import * as contracts from "../build/contracts";

import withSender from "./helpers/eip1193";

import { deployFactories, deployMastercopy, deployProxy } from "../src/tooling";
import { predictProxyAddress } from "../src/index";

const chain = await startChain();
const { getContractAt, loadFixture } = chain;

const avatar = "0x0000000000000000000000000000000000000123";
const target = "0x0000000000000000000000000000000000000456";

async function setup() {
  const [wallet] = chain.walletClients;
  const provider = withSender(chain.provider, wallet.account.address);

  const { bytecode } = contracts.TestModule;
  await deployFactories({ provider });
  const { address } = await deployMastercopy({
    bytecode,
    constructorArgs: {
      types: ["address", "address"],
      values: [avatar, target],
    },
    salt: "0x0000000000000000000000000000000000000000000000000000000000000001",
    provider,
  });

  return { mastercopy: address, provider };
}

describe("deployProxy", () => {
  after(async () => {
    await chain.stop();
  });

  it("Deploys a proxy at the predicted address", async () => {
    const { mastercopy, provider } = await loadFixture(setup);
    const publicClient = chain.publicClient;

    const proxyAvatar = "0x0000000000000000000000000000000000000789";
    const proxyTarget = "0x0000000000000000000000000000000000000345";

    const setupArgs = {
      types: ["address", "address"],
      values: [proxyAvatar, proxyTarget],
    };

    const address = predictProxyAddress({
      mastercopy,
      setupArgs,
      saltNonce: 1,
    });

    assert.notEqual(
      await publicClient.getCode({ address: mastercopy }),
      undefined
    );
    assert.equal(await publicClient.getCode({ address }), undefined);

    assert.deepEqual(
      await deployProxy({ mastercopy, setupArgs, saltNonce: 1, provider }),
      { address, noop: false }
    );

    assert.notEqual(await publicClient.getCode({ address }), undefined);

    const proxy = await getContractAt("TestModule", address);
    assert.equal(await proxy.read.avatar(), proxyAvatar);
    assert.equal(await proxy.read.target(), proxyTarget);

    assert.deepEqual(
      await deployProxy({ mastercopy, setupArgs, saltNonce: 1, provider }),
      { address, noop: true }
    );
  });
});
