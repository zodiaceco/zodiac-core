import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { artifacts, network } from "hardhat";

import predictSingletonAddress from "../src/encoding/predictSingletonAddress";

import { deployFactories, deployMastercopy } from "../src/tooling";
import withSender from "../test-helpers/eip1193";

const connection = await network.create();
const { viem, networkHelpers, provider: hardhatProvider } = connection;
const { loadFixture } = networkHelpers;

async function setup() {
  const [wallet] = await viem.getWalletClients();
  const provider = withSender(hardhatProvider, wallet.account.address);
  await deployFactories({ provider });
  return { provider };
}

const avatar = "0x0000000000000000000000000000000000000123";
const target = "0x0000000000000000000000000000000000000456";

describe("deployMastercopy", () => {
  after(async () => {
    await connection.close();
  });

  it("Deploys a mastercopy, at the predicted address", async () => {
    const { provider } = await loadFixture(setup);
    const publicClient = await viem.getPublicClient();

    const { bytecode } = await artifacts.readArtifact("TestModule");
    const salt =
      "0x0000000000000000000000000000000000000000000000000000000000000001";
    const constructorArgs = {
      types: ["address", "address"],
      values: [avatar, target],
    };

    const address = predictSingletonAddress({
      bytecode,
      salt,
      constructorArgs,
    });

    assert.equal(await publicClient.getCode({ address }), undefined);

    const result = await deployMastercopy({
      bytecode,
      constructorArgs,
      salt,
      provider,
    });
    assert.deepEqual(result, { address, noop: false });
    assert.notEqual(await publicClient.getCode({ address }), undefined);

    const module = await viem.getContractAt("TestModule", address);
    assert.equal(await module.read.avatar(), avatar);

    assert.deepEqual(
      await deployMastercopy({ bytecode, constructorArgs, salt, provider }),
      { address, noop: true }
    );
  });
});
