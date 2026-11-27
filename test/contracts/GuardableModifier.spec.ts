import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { encodeFunctionData, zeroAddress, type Hex } from "viem";

import { startChain } from "../helpers/chain";
import { Operation } from "../helpers/constants";
import { fail, failedError, poke, succeed, succeeded } from "../helpers/calls";
import * as invoke from "../helpers/invoke";
import {
  moduleTxDigest,
  salt as makeSalt,
  signModuleTx,
  type ModuleTx,
} from "../helpers/signing";

const chain = await startChain();
const { deployContract, loadFixture, assertions } = chain;
const [owner, alice, bob, charlie] = chain.walletClients;

after(() => chain.stop());

const SALT = makeSalt("salt");
const MODULE_TX_HASH = makeSalt("module tx hash");

async function setup() {
  const avatar = await deployContract("MockAvatar");
  const receiver = await deployContract("Receiver");
  const guard = await deployContract("MockModuleGuard");
  const modifier = await deployContract("TestGuardableModifier", [
    owner.account.address,
    avatar.address,
    avatar.address,
  ]);
  await modifier.write.enableModule([alice.account.address]);
  await modifier.write.enableModule([bob.account.address]);
  return { avatar, receiver, guard, modifier };
}

async function setupWithGuard() {
  const f = await setup();
  await f.modifier.write.setGuard([f.guard.address]);
  return f;
}

type Fixture = Awaited<ReturnType<typeof setup>>;

for (const variant of [
  {
    name: "exec",
    direct: "execTransactionFromModule",
    signed: "execTransactionFromModuleSigned",
    event: "ExecTransactionFromModule",
  },
  {
    name: "execAndReturnData",
    direct: "execTransactionFromModuleReturnData",
    signed: "execTransactionFromModuleReturnDataSigned",
    event: "ExecTransactionFromModuleReturnData",
  },
] as const) {
  const returnsData = variant.name === "execAndReturnData";
  const pokeTx = (f: Fixture): ModuleTx => ({
    to: f.receiver.address,
    value: 0n,
    data: poke(),
    operation: Operation.Call,
  });

  /** Sends `tx` directly from `from`, an enabled module by default. */
  const write = (f: Fixture, tx: ModuleTx, from = alice) =>
    invoke.write(
      f.modifier,
      variant.direct,
      [tx.to, tx.value, tx.data, tx.operation],
      { account: from.account }
    );
  const simulate = (f: Fixture, tx: ModuleTx) =>
    invoke.simulate(
      f.modifier,
      variant.direct,
      [tx.to, tx.value, tx.data, tx.operation],
      { account: alice.account }
    );
  const sign = (f: Fixture, tx: ModuleTx) =>
    signModuleTx(alice, { verifyingContract: f.modifier.address }, tx, SALT);
  /** Relays `tx`, signed by alice, from charlie (not a module). */
  const writeSigned = (f: Fixture, tx: ModuleTx, signature: Hex) =>
    invoke.write(f.modifier, variant.signed, [tx, SALT, signature], {
      account: charlie.account,
    });

  describe(`GuardableModifier — ${variant.name}`, () => {
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

    it("reverts with NotAuthorized before the guard is consulted", async () => {
      const f = await loadFixture(setupWithGuard);
      await f.guard.write.setFailPreCheck([true]);
      await assertions.revertWithCustomErrorWithArgs(
        write(f, pokeTx(f), charlie),
        f.modifier,
        "NotAuthorized",
        [charlie.account.address]
      );
    });

    it("pre-checks with the calling module for a direct call", async () => {
      const f = await loadFixture(setupWithGuard);
      const tx = {
        to: f.receiver.address,
        value: 0n,
        data: succeed("0x1234"),
        operation: Operation.Call,
      };
      await assertions.emitWithArgs(write(f, tx, bob), f.guard, "PreChecked", [
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        bob.account.address,
      ]);
    });

    it("pre-checks with the signer, not the relayer, for a signed call", async () => {
      const f = await loadFixture(setupWithGuard);
      const tx = pokeTx(f);
      await assertions.emitWithArgs(
        writeSigned(f, tx, await sign(f, tx)),
        f.guard,
        "PreChecked",
        [tx.to, tx.value, tx.data, tx.operation, alice.account.address]
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

    it("does not consume the signature when the pre-check reverts", async () => {
      const f = await loadFixture(setupWithGuard);
      const tx = pokeTx(f);
      const signature = await sign(f, tx);
      await f.guard.write.setFailPreCheck([true]);
      await assertions.revertWithCustomError(
        writeSigned(f, tx, signature),
        f.guard,
        "PreCheckFailed"
      );
      const digest = moduleTxDigest(
        { verifyingContract: f.modifier.address },
        tx,
        SALT
      );
      assert.equal(
        await f.modifier.read.consumed([alice.account.address, digest]),
        false
      );

      await f.guard.write.setFailPreCheck([false]);
      await writeSigned(f, tx, signature);
      assert.equal(await f.receiver.read.pokes(), 1n);
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

    it("still post-checks with the original guard when the execution removed it", async () => {
      const f = await loadFixture(setupWithGuard);
      await f.modifier.write.transferOwnership([f.avatar.address]);
      const tx: ModuleTx = {
        to: f.modifier.address,
        value: 0n,
        data: encodeFunctionData({
          abi: f.modifier.abi,
          functionName: "setGuard",
          args: [zeroAddress],
        }),
        operation: Operation.Call,
      };
      const events = await assertions.events(write(f, tx), [f.guard]);
      assert.deepEqual(
        events.map((e) => e.eventName),
        ["PreChecked", "PostChecked"]
      );
      assert.equal(await f.modifier.read.guard(), zeroAddress);
    });

    it("reverts with AlreadyAuthenticated when the guard re-enters the modifier", async () => {
      const f = await loadFixture(setupWithGuard);
      // The guard is an enabled module too, so only re-entrance stops it.
      await f.modifier.write.enableModule([f.guard.address]);
      const tx = pokeTx(f);
      await f.guard.write.setHook([
        f.modifier.address,
        encodeFunctionData({
          abi: f.modifier.abi,
          functionName: "execTransactionFromModule",
          args: [tx.to, tx.value, tx.data, tx.operation],
        }),
      ]);
      await assertions.revertWithCustomError(
        write(f, tx),
        f.modifier,
        "AlreadyAuthenticated"
      );
    });

    if (returnsData) {
      it("returns the avatar's success flag and return data", async () => {
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
