import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { startChain } from "./helpers/chain";
import { getAddress, zeroAddress } from "viem";

const chain = await startChain();
const { deployContract, loadFixture, assertions } = chain;

describe("IAvatar", () => {
  after(() => chain.stop());

  async function setupTests() {
    const [user1] = chain.walletClients;
    const iAvatar = await deployContract("TestAvatar");
    const tx = {
      to: iAvatar.address,
      value: 0n,
      data: "0x",
      operation: 0,
    } as const;
    return { iAvatar, tx, user1: getAddress(user1.account.address) };
  }

  describe("enableModule", () => {
    it("allow to enable a module", async () => {
      const { iAvatar, user1 } = await loadFixture(setupTests);
      assert.equal(await iAvatar.read.isModuleEnabled([user1]), false);
      await iAvatar.write.enableModule([user1]);
      assert.equal(await iAvatar.read.isModuleEnabled([user1]), true);
    });
  });

  describe("disableModule", () => {
    it("allow to disable a module", async () => {
      const { iAvatar, user1 } = await loadFixture(setupTests);

      assert.equal(await iAvatar.read.isModuleEnabled([user1]), false);
      await iAvatar.write.enableModule([user1]);
      assert.equal(await iAvatar.read.isModuleEnabled([user1]), true);
      await iAvatar.write.disableModule([zeroAddress, user1]);
      assert.equal(await iAvatar.read.isModuleEnabled([user1]), false);
    });
  });

  describe("execTransactionFromModule", () => {
    it("revert if module is not enabled", async () => {
      const { iAvatar, tx } = await loadFixture(setupTests);
      await assertions.revertWith(
        iAvatar.write.execTransactionFromModule([
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
        ]),
        "Not authorized"
      );
    });

    it("allow to execute module transaction", async () => {
      const { iAvatar, tx, user1 } = await loadFixture(setupTests);
      await iAvatar.write.enableModule([user1]);
      await iAvatar.write.execTransactionFromModule([
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
      ]);
    });
  });

  describe("execTransactionFromModuleReturnData", () => {
    it("revert if module is not enabled", async () => {
      const { iAvatar, tx } = await loadFixture(setupTests);
      await assertions.revertWith(
        iAvatar.write.execTransactionFromModuleReturnData([
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
        ]),
        "Not authorized"
      );
    });

    it("allow to execute module transaction and return data", async () => {
      const { iAvatar, tx, user1 } = await loadFixture(setupTests);
      await iAvatar.write.enableModule([user1]);
      await iAvatar.write.execTransactionFromModuleReturnData([
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
      ]);
    });
  });

  describe("isModuleEnabled", () => {
    it("returns false if module has not been enabled", async () => {
      const { iAvatar, user1 } = await loadFixture(setupTests);
      assert.equal(await iAvatar.read.isModuleEnabled([user1]), false);
    });

    it("returns true if module has been enabled", async () => {
      const { iAvatar, user1 } = await loadFixture(setupTests);
      assert.equal(await iAvatar.read.isModuleEnabled([user1]), false);
      await iAvatar.write.enableModule([user1]);
      assert.equal(await iAvatar.read.isModuleEnabled([user1]), true);
    });
  });

  describe("getModulesPaginated", () => {
    it("returns array of enabled modules", async () => {
      const { iAvatar, user1 } = await loadFixture(setupTests);
      await iAvatar.write.enableModule([user1]);
      const [array, next] = await iAvatar.read.getModulesPaginated([user1, 1n]);
      assert.deepEqual(array, [user1]);
      assert.equal(next, user1);
    });
  });
});
