import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { startChain } from "./helpers/chain";

import { address as erc2470FactoryAddress } from "../src/factory/erc2470Factory";
import { address as moduleFactoryAddress } from "../src/factory/proxyFactory";
import { address as nickFactoryAddress } from "../src/factory/nickFactory";

import { deployFactories } from "../src/tooling";

import withSender from "./helpers/eip1193";

const chain = await startChain();
const { loadFixture } = chain;

async function setup() {
  // loadFixture snapshots & restores; nothing else needed
}

const factories = [
  nickFactoryAddress,
  erc2470FactoryAddress,
  moduleFactoryAddress,
];

describe("deployFactories", () => {
  after(() => chain.stop());

  async function codeOf(address: `0x${string}`) {
    const publicClient = chain.publicClient;
    return publicClient.getCode({ address });
  }

  async function deploy() {
    const [wallet] = chain.walletClients;
    await deployFactories({
      provider: withSender(chain.provider, wallet.account.address),
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
