import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { artifacts, network } from "hardhat";

import withSender from "../test-helpers/eip1193";

import { deployFactories, deployMastercopy, deployProxy } from "../src/tooling";
import { predictProxyAddress } from "../src/index";

const connection = await network.create();
const { viem, networkHelpers, provider: hardhatProvider } = connection;
const { loadFixture } = networkHelpers;

const avatar = "0x0000000000000000000000000000000000000123";
const target = "0x0000000000000000000000000000000000000456";

async function setup() {
  const [wallet] = await viem.getWalletClients();
  const provider = withSender(hardhatProvider, wallet.account.address);

  const { bytecode } = await artifacts.readArtifact("TestModule");
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
    await connection.close();
  });

  it("Deploys a proxy at the predicted address", async () => {
    const { mastercopy, provider } = await loadFixture(setup);
    const publicClient = await viem.getPublicClient();

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

    const proxy = await viem.getContractAt("TestModule", address);
    assert.equal(await proxy.read.avatar(), proxyAvatar);
    assert.equal(await proxy.read.target(), proxyTarget);

    assert.deepEqual(
      await deployProxy({ mastercopy, setupArgs, saltNonce: 1, provider }),
      { address, noop: true }
    );
  });
});
