import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { parseEther } from "viem";

import { startChain } from "../helpers/chain";
import { addr, Operation } from "../helpers/constants";
import { fail, failedError, succeed, succeeded } from "../helpers/calls";
import * as invoke from "../helpers/invoke";

const chain = await startChain();
const { deployContract, loadFixture, assertions, testClient } = chain;
const [owner, alice] = chain.walletClients;

after(() => chain.stop());

async function setup() {
  const avatar = await deployContract("MockAvatar");
  const target = await deployContract("MockAvatar");
  const receiver = await deployContract("Receiver");
  const module = await deployContract("TestModule", [
    owner.account.address,
    avatar.address,
    target.address,
  ]);
  await testClient.setBalance({
    address: target.address,
    value: parseEther("1"),
  });
  return { avatar, target, receiver, module };
}

describe("Module", () => {
  describe("setAvatar", () => {
    it("reverts when caller is not the owner", async () => {
      const { module } = await loadFixture(setup);
      await assertions.revertWithCustomErrorWithArgs(
        module.write.setAvatar([addr(1)], { account: alice.account }),
        module,
        "OwnableUnauthorizedAccount",
        [alice.account.address]
      );
    });

    it("sets avatar and emits AvatarSet without changing target", async () => {
      const { module, avatar, target } = await loadFixture(setup);
      await assertions.emitWithArgs(
        module.write.setAvatar([addr(1)]),
        module,
        "AvatarSet",
        [avatar.address, addr(1)]
      );
      assert.equal(await module.read.avatar(), addr(1));
      assert.equal(await module.read.target(), target.address);
    });
  });

  describe("setTarget", () => {
    it("reverts when caller is not the owner", async () => {
      const { module } = await loadFixture(setup);
      await assertions.revertWithCustomErrorWithArgs(
        module.write.setTarget([addr(1)], { account: alice.account }),
        module,
        "OwnableUnauthorizedAccount",
        [alice.account.address]
      );
    });

    it("sets target and emits TargetSet without changing avatar", async () => {
      const { module, avatar, target } = await loadFixture(setup);
      await assertions.emitWithArgs(
        module.write.setTarget([addr(1)]),
        module,
        "TargetSet",
        [target.address, addr(1)]
      );
      assert.equal(await module.read.target(), addr(1));
      assert.equal(await module.read.avatar(), avatar.address);
    });
  });

  for (const variant of [
    {
      name: "exec",
      method: "executeTransaction",
      call: "execTransactionFromModule",
      event: "ExecTransactionFromModule",
    },
    {
      name: "execAndReturnData",
      method: "executeTransactionReturnData",
      call: "execTransactionFromModuleReturnData",
      event: "ExecTransactionFromModuleReturnData",
    },
  ] as const) {
    const returnsData = variant.name === "execAndReturnData";

    describe(variant.name, () => {
      type Fixture = Awaited<ReturnType<typeof setup>>;
      const write = (m: Fixture["module"], args: readonly unknown[]) =>
        invoke.write(m, variant.method, args);
      const simulate = (m: Fixture["module"], args: readonly unknown[]) =>
        invoke.simulate(m, variant.method, args);

      it(`calls ${variant.call} on target, not avatar`, async () => {
        const { module, avatar, target, receiver } = await loadFixture(setup);
        const tx = write(module, [
          receiver.address,
          0n,
          succeed(),
          Operation.Call,
        ]);
        const events = await assertions.events(tx, [avatar, target]);
        assert.deepEqual(
          events.map(({ address, eventName }) => [address, eventName]),
          [[target.address, variant.event]]
        );
        assert.equal(events[0].args.sender, module.address);
      });

      for (const operation of [Operation.Call, Operation.DelegateCall]) {
        it(`forwards to, value, data and operation (${Operation[operation]})`, async () => {
          const { module, target, receiver } = await loadFixture(setup);
          const data = succeed("0x1234");
          await assertions.emitWithArgs(
            write(module, [receiver.address, 7n, data, operation]),
            target,
            variant.event,
            [module.address, receiver.address, 7n, data, operation]
          );
        });
      }

      if (!returnsData) {
        for (const success of [true, false]) {
          it(`returns the target's success flag (${success})`, async () => {
            const { module, receiver } = await loadFixture(setup);
            const data = success ? succeed() : fail();
            assert.equal(
              await simulate(module, [
                receiver.address,
                0n,
                data,
                Operation.Call,
              ]),
              success
            );
          });
        }
      } else {
        for (const success of [true, false]) {
          it(`returns the target's success flag and return data (${success ? "success" : "failure"})`, async () => {
            const { module, receiver } = await loadFixture(setup);
            const data = success ? succeed() : fail();
            assert.deepEqual(
              await simulate(module, [
                receiver.address,
                0n,
                data,
                Operation.Call,
              ]),
              [success, success ? succeeded() : failedError()]
            );
          });
        }
      }

      it("bubbles the revert when the target reverts", async () => {
        const { module, target, receiver } = await loadFixture(setup);
        await target.write.setReverts([true]);
        await assertions.revertWithCustomError(
          write(module, [receiver.address, 0n, succeed(), Operation.Call]),
          target,
          "AvatarReverted"
        );
      });
    });
  }
});
