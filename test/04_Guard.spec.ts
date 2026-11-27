import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { network } from "hardhat";
import { zeroAddress } from "viem";

const connection = await network.create();
const { viem, networkHelpers } = connection;
const { loadFixture } = networkHelpers;

describe("Guard", () => {
  after(async () => {
    await connection.close();
  });

  /**
   * Deploys the TestAvatar, TestModule, TestGuard, and TestNonCompliantGuard
   * contracts and enables the module in the avatar.
   */
  async function setupTests() {
    const [owner, other, relayer] = await viem.getWalletClients();
    const avatar = await viem.deployContract("TestAvatar");
    const module = await viem.deployContract(
      "TestModule",
      [avatar.address, avatar.address],
      { client: { wallet: owner } }
    );
    await avatar.write.enableModule([module.address]);

    const deployedGuard = await viem.deployContract("TestGuard", [
      module.address,
    ]);
    const guard = await viem.getContractAt("TestGuard", deployedGuard.address, {
      client: { wallet: relayer },
    });

    const guardNonCompliant = await viem.deployContract(
      "TestNonCompliantGuard"
    );

    return { owner, other, module, guard, guardNonCompliant };
  }

  describe("Guardable", () => {
    describe("setGuard", () => {
      it("reverts if caller is not the owner", async () => {
        const { other, guard, module } = await loadFixture(setupTests);
        await viem.assertions.revertWithCustomErrorWithArgs(
          module.write.setGuard([guard.address], { account: other.account }),
          module,
          "OwnableUnauthorizedAccount",
          [other.account.address]
        );
      });

      it("reverts if guard does not implement ERC165", async () => {
        const { module } = await loadFixture(setupTests);
        await viem.assertions.revert(module.write.setGuard([module.address]));
      });

      it("reverts if guard implements ERC165 and returns false", async () => {
        const { module, guardNonCompliant } = await loadFixture(setupTests);
        await viem.assertions.revertWithCustomErrorWithArgs(
          module.write.setGuard([guardNonCompliant.address]),
          module,
          "NotIERC165Compliant",
          [guardNonCompliant.address]
        );
      });

      it("sets module and emits event", async () => {
        const { module, guard } = await loadFixture(setupTests);
        await viem.assertions.emitWithArgs(
          module.write.setGuard([guard.address]),
          module,
          "ChangedGuard",
          [guard.address]
        );
      });

      it("sets guard back to zero", async () => {
        const { module, guard } = await loadFixture(setupTests);
        await viem.assertions.emitWithArgs(
          module.write.setGuard([guard.address]),
          module,
          "ChangedGuard",
          [guard.address]
        );

        await viem.assertions.emitWithArgs(
          module.write.setGuard([zeroAddress]),
          module,
          "ChangedGuard",
          [zeroAddress]
        );
      });
    });

    describe("getGuard", () => {
      it("returns guard address", async () => {
        const { module } = await loadFixture(setupTests);
        assert.equal(await module.read.getGuard(), zeroAddress);
      });
    });
  });

  describe("BaseModuleGuard", () => {
    const moduleTxHash =
      "0x0000000000000000000000000000000000000000000000000000000000000001";

    it("supports IModuleGuard interface", async () => {
      const { guard } = await loadFixture(setupTests);
      // IModuleGuard interface ID
      const iModuleGuardId = "0x58401ed8";
      assert.equal(await guard.read.supportsInterface([iModuleGuardId]), true);
      assert.equal(await guard.read.supportsInterface(["0x01ffc9a7"]), true);
    });

    it("does not support IGuard interface", async () => {
      const { guard } = await loadFixture(setupTests);
      assert.equal(await guard.read.supportsInterface(["0xe6d7a83a"]), false);
    });

    describe("checkModuleTransaction", () => {
      it("reverts if test fails", async () => {
        const { guard, module } = await loadFixture(setupTests);
        await viem.assertions.revertWith(
          guard.write.checkModuleTransaction([
            module.address,
            1337n,
            "0x",
            0,
            module.address,
          ]),
          "Cannot send 1337"
        );
      });

      it("checks module transaction", async () => {
        const { guard, module } = await loadFixture(setupTests);
        await viem.assertions.emit(
          guard.write.checkModuleTransaction([
            module.address,
            0n,
            "0x",
            0,
            module.address,
          ]),
          guard,
          "PreChecked"
        );
      });
    });

    describe("checkAfterModuleExecution", () => {
      it("reverts if test fails", async () => {
        const { guard } = await loadFixture(setupTests);
        await viem.assertions.revertWith(
          guard.write.checkAfterModuleExecution([moduleTxHash, true]),
          "Module cannot remove its own guard."
        );
      });

      it("checks state after module execution", async () => {
        const { module, guard } = await loadFixture(setupTests);
        await viem.assertions.emitWithArgs(
          module.write.setGuard([guard.address]),
          module,
          "ChangedGuard",
          [guard.address]
        );
        await viem.assertions.emitWithArgs(
          guard.write.checkAfterModuleExecution([moduleTxHash, true]),
          guard,
          "PostChecked",
          [true]
        );
      });
    });
  });
});
