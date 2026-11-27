import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { numberToHex } from "viem";

import * as erc2470 from "../../src/factory/erc2470Factory";
import * as nick from "../../src/factory/nickFactory";
import * as proxyFactory from "../../src/factory/proxyFactory";
import deployFactories from "../../src/tooling/deployFactories";
import { startChain } from "../helpers/chain";
import { recording, stubProvider, withSender } from "../helpers/provider";

const chain = await startChain();
const { hasCode, loadFixture, publicClient, testClient } = chain;
const [owner] = chain.walletClients;

after(() => chain.stop());

/** anvil starts without any of the factories. */
async function emptyNetwork() {
  return { provider: withSender(chain.provider, owner.account.address) };
}

const fundings = (requests: ReturnType<typeof recording>["requests"]) =>
  requests
    .filter((r) => r.method === "eth_sendTransaction")
    .map((r) => r.params[0])
    .filter((tx) =>
      [nick.deployer, erc2470.deployer].some(
        (d) => d.toLowerCase() === tx.to?.toLowerCase()
      )
    )
    .map((tx) => ({ to: tx.to.toLowerCase(), value: tx.value }));

describe("deployFactories", () => {
  it("deploys Nick's, ERC-2470 and ModuleProxyFactory at canonical addresses on an empty network", async () => {
    const { provider } = await loadFixture(emptyNetwork);
    for (const address of [
      nick.address,
      erc2470.address,
      proxyFactory.address,
    ]) {
      assert.equal(await hasCode(address), false);
    }
    await deployFactories({ provider });
    for (const address of [
      nick.address,
      erc2470.address,
      proxyFactory.address,
    ]) {
      assert.equal(await hasCode(address), true, address);
    }
  });

  it("does nothing when all factories exist", async () => {
    const { provider } = await loadFixture(emptyNetwork);
    await deployFactories({ provider });
    const recorder = recording(provider);
    await deployFactories({ provider: recorder.provider });
    assert.deepEqual(
      [...new Set(recorder.requests.map((r) => r.method))],
      ["eth_getCode"]
    );
  });

  it("deploys only the missing factories", async () => {
    const { provider } = await loadFixture(emptyNetwork);
    await testClient.setCode({ address: nick.address, bytecode: "0x00" });
    const recorder = recording(provider);
    await deployFactories({ provider: recorder.provider });

    assert.deepEqual(
      recorder.of("eth_sendRawTransaction").map((r) => r.params),
      [[erc2470.signedDeployTransaction]]
    );
    assert.deepEqual(
      fundings(recorder.requests).map((f) => f.to),
      [erc2470.deployer.toLowerCase()]
    );
    assert.equal(await publicClient.getCode({ address: nick.address }), "0x00");
    assert.equal(await hasCode(erc2470.address), true);
    assert.equal(await hasCode(proxyFactory.address), true);
  });

  it("funds each deployer with exactly the missing amount", async () => {
    const { provider } = await loadFixture(emptyNetwork);
    await testClient.setBalance({
      address: nick.deployer,
      value: nick.funding - 123n,
    });
    const recorder = recording(provider);
    await deployFactories({ provider: recorder.provider });
    assert.deepEqual(fundings(recorder.requests), [
      { to: nick.deployer.toLowerCase(), value: numberToHex(123n) },
      {
        to: erc2470.deployer.toLowerCase(),
        value: numberToHex(erc2470.funding),
      },
    ]);
  });

  it("skips funding when the deployer already holds enough", async () => {
    const { provider } = await loadFixture(emptyNetwork);
    await testClient.setBalance({
      address: nick.deployer,
      value: nick.funding,
    });
    await testClient.setBalance({
      address: erc2470.deployer,
      value: erc2470.funding * 2n,
    });
    const recorder = recording(provider);
    await deployFactories({ provider: recorder.provider });
    assert.deepEqual(fundings(recorder.requests), []);
    assert.equal(await hasCode(proxyFactory.address), true);
  });

  it("throws when a factory has no code after its deploy transaction", async () => {
    const { provider, requests } = stubProvider({
      eth_getCode: () => "0x",
      eth_getBalance: () => numberToHex(nick.funding),
      eth_sendRawTransaction: () => `0x${"11".repeat(32)}`,
      eth_getTransactionReceipt: () => ({ status: "0x1" }),
    });
    await assert.rejects(
      deployFactories({ provider }),
      /Bytecode for Factory not found after deployment/
    );
    assert.deepEqual(
      requests
        .filter((r) => r.method === "eth_sendRawTransaction")
        .map((r) => r.params),
      [[nick.signedDeployTransaction]]
    );
  });
});
