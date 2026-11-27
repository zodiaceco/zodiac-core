import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { encodeFunctionData, parseEther, zeroAddress, type Hex } from "viem";

import { startChain } from "../helpers/chain";
import { Operation } from "../helpers/constants";
import { fail, failedError, poke, succeed, succeeded } from "../helpers/calls";
import * as invoke from "../helpers/invoke";
import { salt } from "../helpers/signing";

const chain = await startChain();
const { deployContract, loadFixture, assertions, testClient } = chain;
const [owner] = chain.walletClients;

after(() => chain.stop());

async function setup() {
  const avatar = await deployContract("MockAvatar");
  const receiver = await deployContract("Receiver");
  const guard = await deployContract("MockModuleGuard");
  const otherGuard = await deployContract("MockModuleGuard");
  const module = await deployContract("TestGuardableModule", [
    owner.account.address,
    avatar.address,
    avatar.address,
  ]);
  await testClient.setBalance({
    address: avatar.address,
    value: parseEther("1"),
  });
  return { avatar, receiver, guard, otherGuard, module };
}

async function setupWithGuard() {
  const f = await setup();
  await f.module.write.setGuard([f.guard.address]);
  return f;
}

type Fixture = Awaited<ReturnType<typeof setup>>;
type Tx = { to: `0x${string}`; value: bigint; data: Hex; operation: Operation };

const MODULE_TX_HASH = salt("module tx hash");

for (const variant of [
  {
    name: "exec",
    method: "executeTransaction",
    event: "ExecTransactionFromModule",
  },
  {
    name: "execAndReturnData",
    method: "executeTransactionReturnData",
    event: "ExecTransactionFromModuleReturnData",
  },
] as const) {
  const returnsData = variant.name === "execAndReturnData";
  const args = ({ to, value, data, operation }: Tx) => [
    to,
    value,
    data,
    operation,
  ];
  const write = (f: Fixture, tx: Tx) =>
    invoke.write(f.module, variant.method, args(tx));
  const simulate = (f: Fixture, tx: Tx) =>
    invoke.simulate(f.module, variant.method, args(tx));
  const pokeTx = (f: Fixture): Tx => ({
    to: f.receiver.address,
    value: 0n,
    data: poke(),
    operation: Operation.Call,
  });

  describe(`GuardableModule — ${variant.name}`, () => {
    it("executes without calling any guard when none is set", async () => {
      const f = await loadFixture(setup);
      const events = await assertions.events(write(f, pokeTx(f)), [
        f.avatar,
        f.guard,
      ]);
      assert.deepEqual(
        events.map((e) => e.eventName),
        [variant.event]
      );
      assert.equal(await f.receiver.read.pokes(), 1n);
    });

    it("pre-checks with to, value, data, operation and the module's own address", async () => {
      const f = await loadFixture(setupWithGuard);
      const tx = {
        to: f.receiver.address,
        value: 7n,
        data: succeed("0x1234"),
        operation: Operation.Call,
      };
      await assertions.emitWithArgs(write(f, tx), f.guard, "PreChecked", [
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        f.module.address,
      ]);
    });

    it("pre-checks before the transaction is executed", async () => {
      const f = await loadFixture(setupWithGuard);
      const events = await assertions.events(write(f, pokeTx(f)), [
        f.avatar,
        f.guard,
      ]);
      assert.deepEqual(
        events.map((e) => e.eventName),
        ["PreChecked", variant.event, "PostChecked"]
      );
    });

    it("reverts the whole call when the pre-check reverts", async () => {
      const f = await loadFixture(setupWithGuard);
      await f.guard.write.setFailPreCheck([true]);
      await assertions.revertWithCustomError(
        write(f, pokeTx(f)),
        f.guard,
        "PreCheckFailed"
      );
      assert.equal(await f.receiver.read.pokes(), 0n);
    });

    it("post-checks with the hash returned by the pre-check", async () => {
      const f = await loadFixture(setupWithGuard);
      await f.guard.write.setModuleTxHash([MODULE_TX_HASH]);
      await assertions.emitWithArgs(
        write(f, pokeTx(f)),
        f.guard,
        "PostChecked",
        [MODULE_TX_HASH, true]
      );
    });

    for (const success of [true, false]) {
      it(`post-checks with success = ${success}`, async () => {
        const f = await loadFixture(setupWithGuard);
        const tx = { ...pokeTx(f), data: success ? poke() : fail() };
        await assertions.emitWithArgs(write(f, tx), f.guard, "PostChecked", [
          await f.guard.read.moduleTxHash(),
          success,
        ]);
      });
    }

    it("rolls back the execution when the post-check reverts", async () => {
      const f = await loadFixture(setupWithGuard);
      await f.guard.write.setFailPostCheck([true]);
      await assertions.revertWithCustomError(
        write(f, pokeTx(f)),
        f.guard,
        "PostCheckFailed"
      );
      assert.equal(await f.receiver.read.pokes(), 0n);
    });

    for (const change of ["replaced", "removed"] as const) {
      it(`still post-checks with the original guard when the execution ${change} it`, async () => {
        const f = await loadFixture(setupWithGuard);
        // The avatar owns the module, so the executed call may change its guard.
        await f.module.write.transferOwnership([f.avatar.address]);
        const newGuard =
          change === "replaced" ? f.otherGuard.address : zeroAddress;
        const tx: Tx = {
          to: f.module.address,
          value: 0n,
          data: encodeFunctionData({
            abi: f.module.abi,
            functionName: "setGuard",
            args: [newGuard],
          }),
          operation: Operation.Call,
        };
        const events = await assertions.events(write(f, tx), [
          f.guard,
          f.otherGuard,
        ]);
        assert.deepEqual(
          events.map((e) => [e.address, e.eventName]),
          [
            [f.guard.address, "PreChecked"],
            [f.guard.address, "PostChecked"],
          ]
        );
        assert.equal(await f.module.read.guard(), newGuard);
      });
    }

    it("returns the avatar's success flag", async () => {
      const f = await loadFixture(setupWithGuard);
      for (const success of [true, false]) {
        const result = await simulate(f, {
          ...pokeTx(f),
          data: success ? poke() : fail(),
        });
        assert.equal(returnsData ? result[0] : result, success);
      }
    });

    if (returnsData) {
      it("returns the avatar's return data", async () => {
        const f = await loadFixture(setupWithGuard);
        assert.deepEqual(await simulate(f, { ...pokeTx(f), data: succeed() }), [
          true,
          succeeded(),
        ]);
        assert.deepEqual(await simulate(f, { ...pokeTx(f), data: fail() }), [
          false,
          failedError(),
        ]);
      });
    }
  });
}
