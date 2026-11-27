import { after, describe, it } from "node:test";

import { startChain } from "./helpers/chain";
import { encodeFunctionData } from "viem";

import {
  salt as makeSalt,
  signModuleTx,
  type ModuleTx,
} from "./helpers/moduleTx";

const chain = await startChain();
const { deployContract, loadFixture, assertions } = chain;

describe("GuardableModifier", () => {
  after(async () => {
    await chain.stop();
  });

  /**
   * Deploys the avatar, the guardable modifier and a guard, enables the
   * modifier on the avatar and the executor on the modifier.
   */
  async function setupTests() {
    const [, executor, signer, someone, relayer] = chain.walletClients;

    const avatar = await deployContract("TestAvatar");
    const modifier = await deployContract("TestGuardableModifier", [
      avatar.address,
      avatar.address,
    ]);
    const guard = await deployContract("TestGuard", [modifier.address]);

    await avatar.write.enableModule([modifier.address]);
    await modifier.write.enableModule([executor.account.address]);

    return {
      executor,
      signer,
      someone,
      relayer,
      avatar,
      guard,
      modifier,
    };
  }

  type Setup = Awaited<ReturnType<typeof setupTests>>;

  /**
   * A relayed module transaction that makes the avatar enable an arbitrary
   * module, signed by `signer`.
   */
  async function signedEnableModule({ avatar, modifier, signer }: Setup) {
    const tx: ModuleTx = {
      to: avatar.address,
      value: 0n,
      data: encodeFunctionData({
        abi: avatar.abi,
        functionName: "enableModule",
        args: ["0xff00000000000000000000000000000000ff3456"],
      }),
      operation: 0,
    };
    const salt = makeSalt("salt");
    const signature = await signModuleTx(signer, modifier.address, tx, salt);
    return [tx, salt, signature] as const;
  }

  for (const [describeName, name, signedName] of [
    ["exec", "execTransactionFromModule", "execTransactionFromModuleSigned"],
    [
      "execAndReturnData",
      "execTransactionFromModuleReturnData",
      "execTransactionFromModuleReturnDataSigned",
    ],
  ] as const) {
    describe(describeName, () => {
      it("skips guard pre-check if no guard is set", async () => {
        const { avatar, modifier, executor } = await loadFixture(setupTests);

        await modifier.write[name]([avatar.address, 0n, "0x", 0], {
          account: executor.account,
        });
      });

      it("pre-checks transaction if guard is set", async () => {
        const { avatar, executor, modifier, guard } =
          await loadFixture(setupTests);
        await modifier.write.setGuard([guard.address]);

        await assertions.emitWithArgs(
          modifier.write[name]([avatar.address, 0n, "0x", 0], {
            account: executor.account,
          }),
          guard,
          "PreChecked",
          [executor.account.address]
        );
      });

      it("pre-check gets called with signer address when transaction is relayed", async () => {
        const setup = await loadFixture(setupTests);
        const { signer, modifier, relayer, guard } = setup;

        await modifier.write.enableModule([signer.account.address]);
        await modifier.write.setGuard([guard.address]);

        await assertions.emitWithArgs(
          modifier.write[signedName](await signedEnableModule(setup), {
            account: relayer.account,
          }),
          guard,
          "PreChecked",
          [signer.account.address]
        );
      });

      it("pre-checks and reverts transaction if guard is set", async () => {
        const { avatar, executor, modifier, guard } =
          await loadFixture(setupTests);
        await modifier.write.setGuard([guard.address]);

        await assertions.revertWith(
          modifier.write[name]([avatar.address, 1337n, "0x", 0], {
            account: executor.account,
          }),
          "Cannot send 1337"
        );
      });

      it("skips post-check if no guard is enabled", async () => {
        const { avatar, executor, modifier, guard } =
          await loadFixture(setupTests);

        await assertions.notEmit(
          modifier.write[name]([avatar.address, 0n, "0x", 0], {
            account: executor.account,
          }),
          guard,
          "PostChecked"
        );
      });

      it("post-checks transaction if guard is set", async () => {
        const { avatar, executor, modifier, guard } =
          await loadFixture(setupTests);
        await modifier.write.setGuard([guard.address]);

        await assertions.emitWithArgs(
          modifier.write[name]([avatar.address, 0n, "0x", 0], {
            account: executor.account,
          }),
          guard,
          "PostChecked",
          [true]
        );
      });
    });
  }
});
