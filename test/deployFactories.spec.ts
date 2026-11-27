import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { network } from "hardhat";

import { address as erc2470FactoryAddress } from "../src/factory/erc2470Factory";
import { address as moduleFactoryAddress } from "../src/factory/proxyFactory";
import { address as nickFactoryAddress } from "../src/factory/nickFactory";

import { deployFactories } from "../src/tooling";

import withSender from "../test-helpers/eip1193";

const connection = await network.create();
const { viem, networkHelpers, provider: hardhatProvider } = connection;
const { loadFixture } = networkHelpers;

async function setup() {
  // loadFixture snapshots & restores; nothing else needed
}

const factories = [
  nickFactoryAddress,
  erc2470FactoryAddress,
  moduleFactoryAddress,
];

describe("deployFactories", () => {
  after(async () => {
    await connection.close();
  });

  async function codeOf(address: `0x${string}`) {
    const publicClient = await viem.getPublicClient();
    return publicClient.getCode({ address });
  }

  async function deploy() {
    const [wallet] = await viem.getWalletClients();
    await deployFactories({
      provider: withSender(hardhatProvider, wallet.account.address),
    });
  }

  it("Deploys all factories on an empty network", async () => {
    await loadFixture(setup);

    for (const address of factories) {
      assert.equal(await codeOf(address), undefined);
    }

    await deploy();

    for (const address of factories) {
      assert.notEqual(await codeOf(address), undefined);
    }
  });

  it("Does nothing if all factories exist", async () => {
    await loadFixture(setup);

    await deploy();
    const codes = await Promise.all(factories.map(codeOf));
    for (const code of codes) {
      assert.notEqual(code, undefined);
    }

    await deploy();
    assert.deepEqual(await Promise.all(factories.map(codeOf)), codes);
  });
});
