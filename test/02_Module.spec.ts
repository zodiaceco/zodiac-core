import { after, describe, it } from "node:test";

import { network } from "hardhat";

import assertNotEmitted from "../test-helpers/assertNotEmitted";

const connection = await network.create();
const { viem, networkHelpers } = connection;
const { loadFixture } = networkHelpers;

describe("Module", () => {
  after(async () => {
    await connection.close();
  });

  /**
   * Deploys the TestAvatar, TestModule, and TestGuard contracts, enables the
   * module in the avatar and prepares a transaction for testing.
   */
  async function setupTests() {
    const [owner, wallet1] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const avatar = await viem.deployContract("TestAvatar");
    const iAvatar = await viem.getContractAt("IAvatar", avatar.address);
    const module = await viem.deployContract("TestModule", [
      iAvatar.address,
      iAvatar.address,
    ]);
    await avatar.write.enableModule([module.address]);
    const guard = await viem.deployContract("TestGuard", [module.address]);
    const tx = {
      to: avatar.address,
      value: 0n,
      data: "0x",
      operation: 0,
    } as const;
    return { owner, wallet1, publicClient, iAvatar, guard, module, tx };
  }

  describe("setAvatar", () => {
    it("reverts if caller is not the owner", async () => {
      const { owner, wallet1, iAvatar, module } = await loadFixture(setupTests);
      await module.write.transferOwnership([wallet1.account.address]);
      await viem.assertions.revertWithCustomErrorWithArgs(
        module.write.setAvatar([iAvatar.address]),
        module,
        "OwnableUnauthorizedAccount",
        [owner.account.address]
      );
    });

    it("allows owner to set avatar", async () => {
      const { iAvatar, module } = await loadFixture(setupTests);
      await module.write.setAvatar([iAvatar.address]);
    });

    it("emits previous owner and new owner", async () => {
      const { wallet1, iAvatar, module } = await loadFixture(setupTests);
      await viem.assertions.emitWithArgs(
        module.write.setAvatar([wallet1.account.address]),
        module,
        "AvatarSet",
        [iAvatar.address, wallet1.account.address]
      );
    });
  });

  describe("setTarget", () => {
    it("reverts if caller is not the owner", async () => {
      const { owner, wallet1, iAvatar, module } = await loadFixture(setupTests);
      await module.write.transferOwnership([wallet1.account.address]);
      await viem.assertions.revertWithCustomErrorWithArgs(
        module.write.setTarget([iAvatar.address]),
        module,
        "OwnableUnauthorizedAccount",
        [owner.account.address]
      );
    });

    it("allows owner to set avatar", async () => {
      const { iAvatar, module } = await loadFixture(setupTests);
      await module.write.setTarget([iAvatar.address]);
    });

    it("emits previous owner and new owner", async () => {
      const { wallet1, iAvatar, module } = await loadFixture(setupTests);
      await viem.assertions.emitWithArgs(
        module.write.setTarget([wallet1.account.address]),
        module,
        "TargetSet",
        [iAvatar.address, wallet1.account.address]
      );
    });
  });

  describe("exec", () => {
    it("skips guard pre-check if no guard is set", async () => {
      const { module, tx } = await loadFixture(setupTests);
      await module.write.executeTransaction([
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
      ]);
    });

    it("pre-checks transaction if guard is set", async () => {
      const { guard, module, tx } = await loadFixture(setupTests);
      await module.write.setGuard([guard.address]);
      await viem.assertions.emit(
        module.write.executeTransaction([
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
        ]),
        guard,
        "PreChecked"
      );
    });

    it("executes a transaction", async () => {
      const { module, tx } = await loadFixture(setupTests);
      await module.write.executeTransaction([
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
      ]);
    });

    it("skips post-check if no guard is enabled", async () => {
      const { publicClient, guard, module, tx } = await loadFixture(setupTests);
      await assertNotEmitted(
        publicClient,
        module.write.executeTransaction([
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
        ]),
        guard,
        "PostChecked"
      );
    });

    it("post-checks transaction if guard is set", async () => {
      const { guard, module, tx } = await loadFixture(setupTests);
      await module.write.setGuard([guard.address]);
      await viem.assertions.emitWithArgs(
        module.write.executeTransaction([
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
        ]),
        guard,
        "PostChecked",
        [true]
      );
    });
  });

  describe("execAndReturnData", () => {
    it("skips guard pre-check if no guard is set", async () => {
      const { module, tx } = await loadFixture(setupTests);
      await module.write.executeTransactionReturnData([
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
      ]);
    });

    it("pre-checks transaction if guard is set", async () => {
      const { guard, module, tx } = await loadFixture(setupTests);
      await module.write.setGuard([guard.address]);
      await viem.assertions.emit(
        module.write.executeTransactionReturnData([
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
        ]),
        guard,
        "PreChecked"
      );
    });

    it("executes a transaction", async () => {
      const { module, tx } = await loadFixture(setupTests);
      await module.write.executeTransactionReturnData([
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
      ]);
    });

    it("skips post-check if no guard is enabled", async () => {
      const { publicClient, guard, module, tx } = await loadFixture(setupTests);
      await assertNotEmitted(
        publicClient,
        module.write.executeTransactionReturnData([
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
        ]),
        guard,
        "PostChecked"
      );
    });

    it("post-checks transaction if guard is set", async () => {
      const { guard, module, tx } = await loadFixture(setupTests);
      await module.write.setGuard([guard.address]);
      await viem.assertions.emitWithArgs(
        module.write.executeTransactionReturnData([
          tx.to,
          tx.value,
          tx.data,
          tx.operation,
        ]),
        guard,
        "PostChecked",
        [true]
      );
    });
  });
});
