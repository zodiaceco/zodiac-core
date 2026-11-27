import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, hashStruct, keccak256, toHex, zeroAddress } from "viem";

import {
  HARDHAT_CHAIN_ID,
  salt as makeSalt,
  signModuleTx,
} from "../test-helpers/moduleTx";

const AddressZero = zeroAddress;
const AddressOne = "0x0000000000000000000000000000000000000001";
const SENTINEL_MODULES = AddressOne;

const connection = await network.create();
const { viem, networkHelpers } = connection;
const { loadFixture } = networkHelpers;

describe("Modifier", () => {
  after(async () => {
    await connection.close();
  });

  /**
   * Deploys the TestAvatar and TestModifier contracts, enables the modifier
   * on the avatar, and prepares a transaction for testing.
   */
  async function setupTests() {
    const [signer, alice, bob, charlie] = await viem.getWalletClients();
    const iAvatar = await viem.deployContract("TestAvatar");
    const modifier = await viem.deployContract("TestModifier", [
      iAvatar.address,
      iAvatar.address,
    ]);
    await iAvatar.write.enableModule([modifier.address]);

    const tx = {
      to: iAvatar.address,
      value: 0n,
      data: "0x",
      operation: 0,
    } as const;
    return {
      iAvatar,
      modifier,
      tx,
      signer,
      alice,
      bob,
      charlie,
    };
  }

  /** Checksummed address of a wallet client. */
  function addressOf(wallet: { account: { address: `0x${string}` } }) {
    return getAddress(wallet.account.address);
  }

  const salt = makeSalt("salt");

  describe("setupModules", () => {
    it("reverts if called more than once", async () => {
      const { modifier } = await loadFixture(setupTests);
      await viem.assertions.revertWithCustomError(
        modifier.write.attemptToSetupModules(),
        modifier,
        "SetupModulesAlreadyCalled"
      );
    });
  });

  describe("enableModule", () => {
    it("reverts if caller is not the owner", async () => {
      const { modifier, alice: user2 } = await loadFixture(setupTests);
      await viem.assertions.revertWithCustomErrorWithArgs(
        modifier.write.enableModule([user2.account.address], {
          account: user2.account,
        }),
        modifier,
        "OwnableUnauthorizedAccount",
        [user2.account.address]
      );
    });

    it("reverts if module is zero address", async () => {
      const { modifier } = await loadFixture(setupTests);
      await viem.assertions.revertWithCustomErrorWithArgs(
        modifier.write.enableModule([AddressZero]),
        modifier,
        "InvalidModule",
        [AddressZero]
      );
    });

    it("reverts if module is SENTINEL_MODULES", async () => {
      const { modifier } = await loadFixture(setupTests);
      await viem.assertions.revertWithCustomErrorWithArgs(
        modifier.write.enableModule([SENTINEL_MODULES]),
        modifier,
        "InvalidModule",
        [AddressOne]
      );
    });

    it("reverts if module is already enabled", async () => {
      const { modifier, signer: user1 } = await loadFixture(setupTests);
      await viem.assertions.emitWithArgs(
        modifier.write.enableModule([user1.account.address]),
        modifier,
        "EnabledModule",
        [user1.account.address]
      );
      await viem.assertions.revertWithCustomError(
        modifier.write.enableModule([user1.account.address]),
        modifier,
        "AlreadyEnabledModule"
      );
    });

    it("enables a module", async () => {
      const { modifier, signer: user1 } = await loadFixture(setupTests);
      await viem.assertions.emitWithArgs(
        modifier.write.enableModule([user1.account.address]),
        modifier,
        "EnabledModule",
        [user1.account.address]
      );
    });
  });

  describe("disableModule", () => {
    it("reverts if caller is not the owner", async () => {
      const { modifier, alice: user2 } = await loadFixture(setupTests);
      await viem.assertions.revertWithCustomErrorWithArgs(
        modifier.write.disableModule(
          [SENTINEL_MODULES, user2.account.address],
          { account: user2.account }
        ),
        modifier,
        "OwnableUnauthorizedAccount",
        [user2.account.address]
      );
    });

    it("reverts if module is zero address", async () => {
      const { modifier } = await loadFixture(setupTests);
      await viem.assertions.revertWithCustomErrorWithArgs(
        modifier.write.disableModule([SENTINEL_MODULES, AddressZero]),
        modifier,
        "InvalidModule",
        [AddressZero]
      );
    });

    it("reverts if module is SENTINEL_MODULES", async () => {
      const { modifier } = await loadFixture(setupTests);
      await viem.assertions.revertWithCustomErrorWithArgs(
        modifier.write.disableModule([SENTINEL_MODULES, SENTINEL_MODULES]),
        modifier,
        "InvalidModule",
        [AddressOne]
      );
    });

    it("reverts if module is already disabled", async () => {
      const { modifier, signer: user1 } = await loadFixture(setupTests);
      await viem.assertions.emitWithArgs(
        modifier.write.enableModule([user1.account.address]),
        modifier,
        "EnabledModule",
        [user1.account.address]
      );
      await viem.assertions.emitWithArgs(
        modifier.write.disableModule([SENTINEL_MODULES, user1.account.address]),
        modifier,
        "DisabledModule",
        [user1.account.address]
      );
      await viem.assertions.revertWithCustomError(
        modifier.write.disableModule([SENTINEL_MODULES, user1.account.address]),
        modifier,
        "AlreadyDisabledModule"
      );
    });

    it("disables a module", async () => {
      const { modifier, signer: user1 } = await loadFixture(setupTests);
      await viem.assertions.emitWithArgs(
        modifier.write.enableModule([user1.account.address]),
        modifier,
        "EnabledModule",
        [user1.account.address]
      );
      await viem.assertions.emitWithArgs(
        modifier.write.disableModule([SENTINEL_MODULES, user1.account.address]),
        modifier,
        "DisabledModule",
        [user1.account.address]
      );
    });
  });

  describe("isModuleEnabled", () => {
    it("returns false if SENTINEL_MODULES is provided", async () => {
      const { modifier } = await loadFixture(setupTests);
      assert.equal(
        await modifier.read.isModuleEnabled([SENTINEL_MODULES]),
        false
      );
    });

    it("returns false if AddressZero is provided", async () => {
      const { modifier } = await loadFixture(setupTests);
      assert.equal(await modifier.read.isModuleEnabled([AddressZero]), false);
    });

    it("returns false if module is not enabled", async () => {
      const { modifier, signer: user1 } = await loadFixture(setupTests);
      assert.equal(
        await modifier.read.isModuleEnabled([user1.account.address]),
        false
      );
    });

    it("returns true if module is enabled", async () => {
      const { modifier, alice: user2 } = await loadFixture(setupTests);
      await viem.assertions.emitWithArgs(
        modifier.write.enableModule([user2.account.address]),
        modifier,
        "EnabledModule",
        [user2.account.address]
      );
      assert.equal(
        await modifier.read.isModuleEnabled([user2.account.address]),
        true
      );
    });
  });

  describe("getModulesPaginated", () => {
    it("requires page size to be greater than 0", async () => {
      const { modifier } = await loadFixture(setupTests);
      await viem.assertions.revertWithCustomError(
        modifier.read.getModulesPaginated([AddressOne, 0n]),
        modifier,
        "InvalidPageSize"
      );
    });

    it("requires start to be a module or start pointer", async () => {
      const {
        modifier,
        signer: user1,
        alice: user2,
      } = await loadFixture(setupTests);

      await viem.assertions.revertWithCustomErrorWithArgs(
        modifier.read.getModulesPaginated([AddressZero, 1n]),
        modifier,
        "InvalidModule",
        [AddressZero]
      );
      await modifier.write.enableModule([user1.account.address]);

      assert.deepEqual(
        await modifier.read.getModulesPaginated([user1.account.address, 1n]),
        [[], AddressOne]
      );

      await viem.assertions.revertWithCustomError(
        modifier.read.getModulesPaginated([user2.account.address, 1n]),
        modifier,
        "InvalidModule"
      );
    });

    it("returns empty array if no modules are enabled.", async () => {
      const { modifier } = await loadFixture(setupTests);
      assert.deepEqual(
        await modifier.read.getModulesPaginated([SENTINEL_MODULES, 3n]),
        [[], SENTINEL_MODULES]
      );
    });

    it("returns one module if one module is enabled", async () => {
      const { modifier, signer: user1 } = await loadFixture(setupTests);
      await modifier.write.enableModule([user1.account.address]);
      assert.deepEqual(
        await modifier.read.getModulesPaginated([SENTINEL_MODULES, 3n]),
        [[addressOf(user1)], SENTINEL_MODULES]
      );
    });

    it("returns two modules if two modules are enabled", async () => {
      const {
        modifier,
        signer: user1,
        alice: user2,
      } = await loadFixture(setupTests);

      await viem.assertions.emitWithArgs(
        modifier.write.enableModule([user1.account.address]),
        modifier,
        "EnabledModule",
        [user1.account.address]
      );
      await viem.assertions.emitWithArgs(
        modifier.write.enableModule([user2.account.address]),
        modifier,
        "EnabledModule",
        [user2.account.address]
      );
      assert.deepEqual(
        await modifier.read.getModulesPaginated([SENTINEL_MODULES, 3n]),
        [[addressOf(user2), addressOf(user1)], SENTINEL_MODULES]
      );
    });

    it("returns all modules over multiple pages", async () => {
      const {
        modifier,
        signer: user1,
        alice: user2,
        bob: user3,
      } = await loadFixture(setupTests);

      await modifier.write.enableModule([user1.account.address]);
      await modifier.write.enableModule([user2.account.address]);
      await modifier.write.enableModule([user3.account.address]);

      assert.equal(
        await modifier.read.isModuleEnabled([user1.account.address]),
        true
      );
      assert.equal(
        await modifier.read.isModuleEnabled([user2.account.address]),
        true
      );
      assert.equal(
        await modifier.read.isModuleEnabled([user3.account.address]),
        true
      );

      // page size 2
      assert.deepEqual(
        await modifier.read.getModulesPaginated([AddressOne, 2n]),
        [[addressOf(user3), addressOf(user2)], addressOf(user2)]
      );
      assert.deepEqual(
        await modifier.read.getModulesPaginated([user2.account.address, 2n]),
        [[addressOf(user1)], AddressOne]
      );

      // page size 1
      assert.deepEqual(
        await modifier.read.getModulesPaginated([AddressOne, 1n]),
        [[addressOf(user3)], addressOf(user3)]
      );
      assert.deepEqual(
        await modifier.read.getModulesPaginated([user3.account.address, 1n]),
        [[addressOf(user2)], addressOf(user2)]
      );
      assert.deepEqual(
        await modifier.read.getModulesPaginated([user2.account.address, 1n]),
        [[addressOf(user1)], AddressOne]
      );
    });

    it("returns an empty array and end pointer for a safe with no modules", async () => {
      const { modifier } = await loadFixture(setupTests);
      assert.deepEqual(
        await modifier.read.getModulesPaginated([AddressOne, 10n]),
        [[], AddressOne]
      );
    });
  });

  for (const [name, signedName, event] of [
    [
      "execTransactionFromModule",
      "execTransactionFromModuleSigned",
      "Executed",
    ],
    [
      "execTransactionFromModuleReturnData",
      "execTransactionFromModuleReturnDataSigned",
      "ExecutedAndReturnedData",
    ],
  ] as const) {
    describe(name, () => {
      it("reverts if module is not enabled", async () => {
        const { modifier, tx, signer } = await loadFixture(setupTests);
        await viem.assertions.revertWithCustomErrorWithArgs(
          modifier.write[name]([tx.to, tx.value, tx.data, tx.operation]),
          modifier,
          "NotAuthorized",
          [signer.account.address]
        );
      });

      it("execute a transaction.", async () => {
        const { modifier, tx, signer: user1 } = await loadFixture(setupTests);
        await viem.assertions.emitWithArgs(
          modifier.write.enableModule([user1.account.address]),
          modifier,
          "EnabledModule",
          [user1.account.address]
        );

        await viem.assertions.emit(
          modifier.write[name]([tx.to, tx.value, tx.data, tx.operation], {
            account: user1.account,
          }),
          modifier,
          event
        );
      });

      it("execute a transaction with signature.", async () => {
        const {
          modifier,
          tx,
          signer: user1,
          alice: relayer,
        } = await loadFixture(setupTests);
        await viem.assertions.emitWithArgs(
          modifier.write.enableModule([user1.account.address]),
          modifier,
          "EnabledModule",
          [user1.account.address]
        );

        const signature = await signModuleTx(user1, modifier.address, tx, salt);

        await viem.assertions.revertWithCustomError(
          modifier.write[signedName]([tx, salt, "0x"], {
            account: relayer.account,
          }),
          modifier,
          "NotAuthorized"
        );

        await viem.assertions.emit(
          modifier.write[signedName]([tx, salt, signature], {
            account: relayer.account,
          }),
          modifier,
          event
        );
      });

      it("reverts if signature not valid.", async () => {
        const {
          modifier,
          tx,
          signer: user1,
          alice: user2,
          bob: relayer,
        } = await loadFixture(setupTests);
        await viem.assertions.emitWithArgs(
          modifier.write.enableModule([user1.account.address]),
          modifier,
          "EnabledModule",
          [user1.account.address]
        );

        const signatureOk = await signModuleTx(
          user1,
          modifier.address,
          tx,
          salt
        );
        const signatureBad = await signModuleTx(
          user2,
          modifier.address,
          tx,
          salt
        );

        await viem.assertions.revertWithCustomError(
          modifier.write[signedName]([tx, salt, signatureBad], {
            account: relayer.account,
          }),
          modifier,
          "NotAuthorized"
        );

        await viem.assertions.emit(
          modifier.write[signedName]([tx, salt, signatureOk], {
            account: relayer.account,
          }),
          modifier,
          event
        );
      });

      it("reverts if signature previously used for execution.", async () => {
        const {
          modifier,
          tx,
          signer: user1,
          alice: user2,
          bob: relayer,
        } = await loadFixture(setupTests);
        await viem.assertions.emitWithArgs(
          modifier.write.enableModule([user1.account.address]),
          modifier,
          "EnabledModule",
          [user1.account.address]
        );

        const signatureOk = await signModuleTx(
          user1,
          modifier.address,
          tx,
          salt
        );
        const signatureBad = await signModuleTx(
          user2,
          modifier.address,
          tx,
          salt
        );

        await viem.assertions.revertWithCustomError(
          modifier.write[signedName]([tx, salt, signatureBad], {
            account: relayer.account,
          }),
          modifier,
          "NotAuthorized"
        );

        await viem.assertions.emit(
          modifier.write[signedName]([tx, salt, signatureOk], {
            account: relayer.account,
          }),
          modifier,
          event
        );

        await viem.assertions.revertWithCustomError(
          modifier.write[signedName]([tx, salt, signatureOk], {
            account: relayer.account,
          }),
          modifier,
          "HashAlreadyConsumed"
        );
      });

      it("reverts if signature invalidated.", async () => {
        const {
          modifier,
          tx,
          signer: user1,
          alice: relayer,
        } = await loadFixture(setupTests);

        await modifier.write.enableModule([user1.account.address]);

        const signatureOk = await signModuleTx(
          user1,
          modifier.address,
          tx,
          salt
        );

        const hash = await modifier.read.moduleTxHash([tx, salt]);
        await modifier.write.invalidate([hash]);

        await viem.assertions.revertWithCustomError(
          modifier.write[signedName]([tx, salt, signatureOk], {
            account: relayer.account,
          }),
          modifier,
          "HashAlreadyConsumed"
        );
      });
    });
  }

  describe("sentOrSignedByModule", () => {
    const salty = makeSalt("something salty");

    it("returns msg.sender if msg.sender is module", async () => {
      const { modifier, alice, bob } = await loadFixture(setupTests);

      await modifier.write.enableModule([alice.account.address]);
      const { result } =
        await modifier.simulate.exposeSentOrSignedByModuleDirect({
          account: alice.account.address,
        });
      assert.equal(result, addressOf(alice));

      assert.equal(
        await modifier.read.exposeSentOrSignedByModule({
          account: bob.account,
        }),
        AddressZero
      );
    });

    it("returns authenticated module for direct and signed calls", async () => {
      const { modifier, tx, alice, bob, charlie } =
        await loadFixture(setupTests);

      await modifier.write.enableModule([alice.account.address]);
      await modifier.write.enableModule([bob.account.address]);

      const signature = await signModuleTx(bob, modifier.address, tx, salty);

      const direct = await modifier.simulate.exposeSentOrSignedByModuleDirect({
        account: alice.account.address,
      });
      assert.equal(direct.result, addressOf(alice));

      const signed = await modifier.simulate.exposeSentOrSignedByModuleSigned(
        [tx, salty, signature],
        { account: charlie.account.address }
      );
      assert.equal(signed.result, addressOf(bob));
    });

    it("returns signer if signer is module", async () => {
      const {
        modifier,
        tx,
        alice,
        charlie: relayer,
      } = await loadFixture(setupTests);

      await modifier.write.enableModule([alice.account.address]);

      const signature = await signModuleTx(alice, modifier.address, tx, salty);

      const { result } =
        await modifier.simulate.exposeSentOrSignedByModuleSigned(
          [tx, salty, signature],
          { account: relayer.account.address }
        );
      assert.equal(result, addressOf(alice));
    });

    it("authenticates a modifier-defined EIP-712 digest", async () => {
      const {
        modifier,
        alice,
        charlie: relayer,
      } = await loadFixture(setupTests);

      await modifier.write.enableModule([alice.account.address]);

      const domain = {
        chainId: HARDHAT_CHAIN_ID,
        verifyingContract: modifier.address,
      };
      const types = {
        ScopedTx: [{ name: "scope", type: "bytes32" }],
      } as const;
      const message = { scope: keccak256(toHex("scope")) };
      const structHash = hashStruct({
        data: message,
        primaryType: "ScopedTx",
        types,
      });
      const signature = await alice.signTypedData({
        account: alice.account,
        domain,
        types,
        primaryType: "ScopedTx",
        message,
      });

      const { result } =
        await modifier.simulate.exposeSentOrSignedByModuleSignedStructHash(
          [structHash, signature],
          { account: relayer.account.address }
        );
      assert.equal(result, addressOf(alice));

      await modifier.write.exposeSentOrSignedByModuleSignedStructHash(
        [structHash, signature],
        { account: relayer.account }
      );

      await viem.assertions.revertWithCustomError(
        modifier.write.exposeSentOrSignedByModuleSignedStructHash(
          [structHash, signature],
          { account: relayer.account }
        ),
        modifier,
        "HashAlreadyConsumed"
      );
    });

    it("returns zero if signer is not module and message sender not a module", async () => {
      const {
        modifier,
        tx,
        alice,
        charlie: relayer,
      } = await loadFixture(setupTests);

      // no modules enabled

      const signature = await signModuleTx(alice, modifier.address, tx, salty);

      await viem.assertions.revertWithCustomError(
        modifier.write.exposeSentOrSignedByModuleSigned(
          [tx, salty, signature],
          { account: relayer.account }
        ),
        modifier,
        "NotAuthorized"
      );

      assert.equal(
        await modifier.read.exposeSentOrSignedByModule(),
        AddressZero
      );
    });
  });
});
