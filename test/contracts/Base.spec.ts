import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { encodeAbiParameters, encodeFunctionData, zeroAddress } from "viem";

import { startChain } from "../helpers/chain";
import { addr } from "../helpers/constants";

const chain = await startChain();
const { deployContract, getContractAt, loadFixture, assertions } = chain;
const [, alice, bob] = chain.walletClients;

const avatar = addr(1);
const target = addr(2);

const setUpParams = (
  owner: `0x${string}`,
  a: `0x${string}`,
  t: `0x${string}`
) =>
  encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }],
    [owner, a, t]
  );

async function setup() {
  const module = await deployContract("TestModule", [
    alice.account.address,
    avatar,
    target,
  ]);
  return { module };
}

after(() => chain.stop());

describe("Ownable", () => {
  it("reverts with OwnableUnauthorizedAccount when caller is not the owner", async () => {
    const { module } = await loadFixture(setup);
    await assertions.revertWithCustomErrorWithArgs(
      module.write.transferOwnership([bob.account.address], {
        account: bob.account,
      }),
      module,
      "OwnableUnauthorizedAccount",
      [bob.account.address]
    );
  });

  it("transfers ownership, emits OwnershipTransferred, and revokes the previous owner", async () => {
    const { module } = await loadFixture(setup);
    await assertions.emitWithArgs(
      module.write.transferOwnership([bob.account.address], {
        account: alice.account,
      }),
      module,
      "OwnershipTransferred",
      [alice.account.address, bob.account.address]
    );
    assert.equal(await module.read.owner(), bob.account.address);

    await assertions.revertWithCustomErrorWithArgs(
      module.write.setAvatar([addr(3)], { account: alice.account }),
      module,
      "OwnableUnauthorizedAccount",
      [alice.account.address]
    );
    await module.write.setAvatar([addr(3)], { account: bob.account });
    assert.equal(await module.read.avatar(), addr(3));
  });

  it("allows transferring ownership to the zero address, locking out all callers", async () => {
    const { module } = await loadFixture(setup);
    await assertions.emitWithArgs(
      module.write.transferOwnership([zeroAddress], { account: alice.account }),
      module,
      "OwnershipTransferred",
      [alice.account.address, zeroAddress]
    );
    assert.equal(await module.read.owner(), zeroAddress);

    for (const caller of [alice, bob]) {
      await assertions.revertWithCustomErrorWithArgs(
        module.write.transferOwnership([caller.account.address], {
          account: caller.account,
        }),
        module,
        "OwnableUnauthorizedAccount",
        [caller.account.address]
      );
    }
  });
});

describe("Initializable", () => {
  it("runs setUp once through the constructor", async () => {
    const { module } = await loadFixture(setup);
    assert.equal(await module.read.owner(), alice.account.address);
    assert.equal(await module.read.avatar(), avatar);
    assert.equal(await module.read.target(), target);
  });

  it("reverts with AlreadyInitialized when setUp is called again", async () => {
    const { module } = await loadFixture(setup);
    await assertions.revertWithCustomError(
      module.write.setUp([setUpParams(bob.account.address, addr(3), addr(4))], {
        account: alice.account,
      }),
      module,
      "AlreadyInitialized"
    );
  });

  it("lets a fresh proxy initialize once, independently of its mastercopy", async () => {
    const { module } = await loadFixture(setup);
    const factory = await deployContract("ModuleProxyFactory");
    const initializer = encodeFunctionData({
      abi: module.abi,
      functionName: "setUp",
      args: [setUpParams(bob.account.address, addr(3), addr(4))],
    });
    const { result: proxyAddress } = await factory.simulate.deployModule([
      module.address,
      initializer,
      0n,
    ]);
    await factory.write.deployModule([module.address, initializer, 0n]);
    const proxy = getContractAt("TestModule", proxyAddress);

    assert.equal(await proxy.read.owner(), bob.account.address);
    assert.equal(await proxy.read.avatar(), addr(3));
    assert.equal(await proxy.read.target(), addr(4));
    // The mastercopy keeps its own state.
    assert.equal(await module.read.owner(), alice.account.address);
    assert.equal(await module.read.avatar(), avatar);

    await assertions.revertWithCustomError(
      proxy.write.setUp(
        [setUpParams(alice.account.address, addr(5), addr(6))],
        {
          account: bob.account,
        }
      ),
      proxy,
      "AlreadyInitialized"
    );
  });
});
