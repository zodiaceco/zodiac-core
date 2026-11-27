import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { startChain } from "./helpers/chain";
import * as contracts from "../build/contracts";

import predictSingletonAddress from "../src/encoding/predictSingletonAddress";

import { deployFactories, deployMastercopy } from "../src/tooling";
import withSender from "./helpers/eip1193";

const chain = await startChain();
const { getContractAt, loadFixture } = chain;

async function setup() {
  const [wallet] = chain.walletClients;
  const provider = withSender(chain.provider, wallet.account.address);
  await deployFactories({ provider });
  return { provider };
}

const avatar = "0x0000000000000000000000000000000000000123";
const target = "0x0000000000000000000000000000000000000456";

describe("deployMastercopy", () => {
  after(() => chain.stop());

  it("Deploys a mastercopy, at the predicted address", async () => {
    const { provider } = await loadFixture(setup);
    const publicClient = chain.publicClient;

    const { bytecode } = contracts.TestModule;
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

    const module = getContractAt("TestModule", address);
    assert.equal(await module.read.avatar(), avatar);

    assert.deepEqual(
      await deployMastercopy({ bytecode, constructorArgs, salt, provider }),
      { address, noop: true }
    );
  });
});
