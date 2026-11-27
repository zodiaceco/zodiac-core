import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import {
  concat,
  encodeErrorResult,
  encodeFunctionData,
  hashStruct,
  parseEther,
  zeroAddress,
  type Hex,
} from "viem";

import { startChain } from "../helpers/chain";
import { addr, Operation, SENTINEL } from "../helpers/constants";
import { fail, failedError, poke, succeed, succeeded } from "../helpers/calls";
import {
  moduleTxDigest,
  moduleTxStructHash,
  salt as makeSalt,
  signModuleTx,
  type ModuleTx,
} from "../helpers/signing";

const chain = await startChain();
const { deployContract, loadFixture, assertions, testClient } = chain;
const [owner, alice, bob, charlie] = chain.walletClients;

after(() => chain.stop());

const SALT = makeSalt("salt");

async function setup() {
  const avatar = await deployContract("MockAvatar");
  const receiver = await deployContract("Receiver");
  const erc1271 = await deployContract("MockERC1271");
  const multicall = await deployContract("Multicall");
  const modifier = await deployContract("TestModifier", [
    owner.account.address,
    avatar.address,
    avatar.address,
  ]);
  for (const module of [
    alice.account.address,
    bob.account.address,
    erc1271.address,
    multicall.address,
  ]) {
    await modifier.write.enableModule([module]);
  }
  await testClient.setBalance({
    address: avatar.address,
    value: parseEther("1"),
  });
  const tx: ModuleTx = {
    to: receiver.address,
    value: 0n,
    data: poke(),
    operation: Operation.Call,
  };
  return { avatar, receiver, erc1271, multicall, modifier, tx };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

const domainOf = ({ modifier }: Fixture) => ({
  verifyingContract: modifier.address,
});

const sign = (f: Fixture, signer = alice, tx = f.tx, salt = SALT) =>
  signModuleTx(signer, domainOf(f), tx, salt);

const digestOf = (f: Fixture, tx = f.tx, salt = SALT) =>
  moduleTxDigest(domainOf(f), tx, salt);

/** Calldata for `modifier.<functionName>(...args)`. */
const calldata = (
  f: Fixture,
  functionName: string,
  args: readonly unknown[] = []
) => encodeFunctionData({ abi: f.modifier.abi, functionName, args } as any);

const alreadyAuthenticated = (f: Fixture) =>
  encodeErrorResult({ abi: f.modifier.abi, errorName: "AlreadyAuthenticated" });

describe("Modifier — authentication", () => {
  describe("moduleOnly", () => {
    for (const label of ["non-module", "disabled module"] as const) {
      it(`reverts with NotAuthorized(sender) for ${label}`, async () => {
        const f = await loadFixture(setup);
        const caller = label === "non-module" ? charlie : alice;
        if (label === "disabled module") {
          // alice sits right after bob in the list.
          await f.modifier.write.disableModule([
            bob.account.address,
            alice.account.address,
          ]);
        }
        await assertions.revertWithCustomErrorWithArgs(
          f.modifier.write.execTransactionFromModule(
            [f.tx.to, f.tx.value, f.tx.data, f.tx.operation],
            { account: caller.account }
          ),
          f.modifier,
          "NotAuthorized",
          [caller.account.address]
        );
      });
    }

    it("executes for an enabled module", async () => {
      const f = await loadFixture(setup);
      await f.modifier.write.execTransactionFromModule(
        [f.tx.to, f.tx.value, f.tx.data, f.tx.operation],
        { account: alice.account }
      );
      assert.equal(await f.receiver.read.pokes(), 1n);
    });

    it("exposes msg.sender through sentOrSignedByModule and clears it on return", async () => {
      const f = await loadFixture(setup);
      const { result } =
        await f.modifier.simulate.moduleOnlySentOrSignedByModule({
          account: alice.account,
        });
      assert.equal(result, alice.account.address);

      // In one transaction: authenticated call, unauthenticated read, and
      // another authenticated call, which would revert if the first had not
      // cleared the context.
      const { result: results } = await f.multicall.simulate.multicall([
        [
          {
            target: f.modifier.address,
            data: calldata(f, "moduleOnlySentOrSignedByModule"),
          },
          {
            target: f.modifier.address,
            data: calldata(f, "exposeSentOrSignedByModule"),
          },
          {
            target: f.modifier.address,
            data: calldata(f, "moduleOnlySentOrSignedByModule"),
          },
        ],
      ]);
      assert.deepEqual(
        results.map((r: Hex) => `0x${r.slice(-40)}`.toLowerCase()),
        [f.multicall.address, zeroAddress, f.multicall.address].map((a) =>
          a.toLowerCase()
        )
      );
    });

    it("reverts with AlreadyAuthenticated when nested inside moduleOnly", async () => {
      const f = await loadFixture(setup);
      await assertions.revertWithCustomError(
        f.modifier.write.moduleOnlyNestedInModuleOnly({
          account: alice.account,
        }),
        f.modifier,
        "AlreadyAuthenticated"
      );
    });

    it("reverts with AlreadyAuthenticated when a module re-enters during execution", async () => {
      const f = await loadFixture(setup);
      // The avatar is an enabled module too, so only re-entrance stops it.
      await f.modifier.write.enableModule([f.avatar.address]);
      const reenter = calldata(f, "execTransactionFromModule", [
        f.tx.to,
        f.tx.value,
        f.tx.data,
        f.tx.operation,
      ]);
      const { result } =
        await f.modifier.simulate.execTransactionFromModuleReturnData(
          [f.modifier.address, 0n, reenter, Operation.Call],
          { account: alice.account }
        );
      assert.deepEqual(result, [false, alreadyAuthenticated(f)]);
    });
  });

  describe("moduleOnlySigned", () => {
    const kinds = [
      {
        label: "EOA signature",
        async prepare(f: Fixture) {
          const structHash = moduleTxStructHash(f.tx, SALT);
          return {
            structHash,
            signature: await sign(f),
            signer: alice.account.address,
          };
        },
      },
      {
        label: "ERC-1271 contract module",
        async prepare(f: Fixture) {
          const structHash = moduleTxStructHash(f.tx, SALT);
          return {
            structHash,
            signature: concat([f.erc1271.address, "0xc0ffee"]),
            signer: f.erc1271.address,
          };
        },
      },
      {
        label: "custom EIP-712 struct hash",
        async prepare(f: Fixture) {
          const types = {
            Permit: [
              { name: "spender", type: "address" },
              { name: "nonce", type: "uint256" },
            ],
          } as const;
          const message = { spender: addr(7), nonce: 42n };
          const structHash = hashStruct({
            types,
            primaryType: "Permit",
            data: message,
          });
          const signature = await alice.signTypedData({
            account: alice.account,
            domain: {
              chainId: chain.publicClient.chain.id,
              verifyingContract: f.modifier.address,
            },
            types,
            primaryType: "Permit",
            message,
          });
          return { structHash, signature, signer: alice.account.address };
        },
      },
    ];

    for (const kind of kinds) {
      it(`authenticates ${kind.label} sent by a relayer`, async () => {
        const f = await loadFixture(setup);
        const { structHash, signature, signer } = await kind.prepare(f);
        const { result } =
          await f.modifier.simulate.moduleOnlySignedSentOrSignedByModule(
            [structHash, signature],
            { account: charlie.account }
          );
        assert.equal(result, signer);
        await f.modifier.write.moduleOnlySignedSentOrSignedByModule(
          [structHash, signature],
          { account: charlie.account }
        );
      });
    }

    it("emits HashExecuted and marks the digest consumed for the signer", async () => {
      const f = await loadFixture(setup);
      const digest = digestOf(f);
      await assertions.emitWithArgs(
        f.modifier.write.execTransactionFromModuleSigned(
          [f.tx, SALT, await sign(f)],
          {
            account: charlie.account,
          }
        ),
        f.modifier,
        "HashExecuted",
        [digest]
      );
      assert.equal(
        await f.modifier.read.consumed([alice.account.address, digest]),
        true
      );
      assert.equal(
        await f.modifier.read.consumed([charlie.account.address, digest]),
        false
      );
      assert.equal(await f.receiver.read.pokes(), 1n);
    });

    it("exposes the signer, not the relayer, through sentOrSignedByModule", async () => {
      const f = await loadFixture(setup);
      const { result } =
        await f.modifier.simulate.moduleOnlySignedSentOrSignedByModule(
          [moduleTxStructHash(f.tx, SALT), await sign(f)],
          { account: charlie.account }
        );
      assert.equal(result, alice.account.address);
    });

    it("exposes the signer even when the relayer is itself a module", async () => {
      const f = await loadFixture(setup);
      const { result } =
        await f.modifier.simulate.moduleOnlySignedSentOrSignedByModule(
          [moduleTxStructHash(f.tx, SALT), await sign(f)],
          { account: bob.account }
        );
      assert.equal(result, alice.account.address);
    });

    it("clears sentOrSignedByModule on return", async () => {
      const f = await loadFixture(setup);
      const signed = calldata(f, "moduleOnlySignedSentOrSignedByModule", [
        moduleTxStructHash(f.tx, SALT),
        await sign(f),
      ]);
      const { result: results } = await f.multicall.simulate.multicall([
        [
          { target: f.modifier.address, data: signed },
          {
            target: f.modifier.address,
            data: calldata(f, "exposeSentOrSignedByModule"),
          },
          {
            target: f.modifier.address,
            data: calldata(f, "moduleOnlySentOrSignedByModule"),
          },
        ],
      ]);
      assert.deepEqual(
        results.map((r: Hex) => `0x${r.slice(-40)}`.toLowerCase()),
        [alice.account.address, zeroAddress, f.multicall.address].map((a) =>
          a.toLowerCase()
        )
      );
    });

    const unauthorized: [
      string,
      (f: Fixture) => Promise<{ tx?: ModuleTx; signature: Hex }>,
    ][] = [
      [
        "malformed signature",
        async (f) => ({ signature: (await sign(f)).slice(0, 130) as Hex }),
      ],
      [
        "signer is not a module",
        async (f) => ({ signature: await sign(f, charlie) }),
      ],
      [
        "signer disabled after signing",
        async (f) => {
          const signature = await sign(f);
          await f.modifier.write.disableModule([
            bob.account.address,
            alice.account.address,
          ]);
          return { signature };
        },
      ],
      [
        "tampered message",
        async (f) => ({ tx: { ...f.tx, value: 1n }, signature: await sign(f) }),
      ],
      [
        "signature over another chain id",
        async (f) => ({
          signature: await signModuleTx(
            alice,
            { chainId: 1, verifyingContract: f.modifier.address },
            f.tx,
            SALT
          ),
        }),
      ],
      [
        "signature over another verifying contract",
        async (f) => ({
          signature: await signModuleTx(
            alice,
            { verifyingContract: addr(9) },
            f.tx,
            SALT
          ),
        }),
      ],
      [
        "contract signature naming SENTINEL_MODULES",
        async () => ({ signature: SENTINEL }),
      ],
    ];
    for (const [label, prepare] of unauthorized) {
      it(`reverts with NotAuthorized(relayer) for ${label}`, async () => {
        const f = await loadFixture(setup);
        const { tx = f.tx, signature } = await prepare(f);
        await assertions.revertWithCustomErrorWithArgs(
          f.modifier.write.execTransactionFromModuleSigned(
            [tx, SALT, signature],
            {
              account: charlie.account,
            }
          ),
          f.modifier,
          "NotAuthorized",
          [charlie.account.address]
        );
      });
    }

    for (const label of [
      "signature replayed",
      "signer invalidated the digest",
    ] as const) {
      it(`reverts with HashAlreadyConsumed when ${label}`, async () => {
        const f = await loadFixture(setup);
        const signature = await sign(f);
        if (label === "signature replayed") {
          await f.modifier.write.execTransactionFromModuleSigned(
            [f.tx, SALT, signature],
            {
              account: charlie.account,
            }
          );
        } else {
          await f.modifier.write.invalidate([digestOf(f)], {
            account: alice.account,
          });
        }
        await assertions.revertWithCustomErrorWithArgs(
          f.modifier.write.execTransactionFromModuleSigned(
            [f.tx, SALT, signature],
            {
              account: charlie.account,
            }
          ),
          f.modifier,
          "HashAlreadyConsumed",
          [digestOf(f)]
        );
      });
    }

    it("accepts the same message again under a different salt", async () => {
      const f = await loadFixture(setup);
      const other = makeSalt("other");
      for (const s of [SALT, other]) {
        await f.modifier.write.execTransactionFromModuleSigned(
          [f.tx, s, await sign(f, alice, f.tx, s)],
          {
            account: charlie.account,
          }
        );
      }
      assert.equal(await f.receiver.read.pokes(), 2n);
    });

    it("ignores an invalidation made by a different account", async () => {
      const f = await loadFixture(setup);
      await f.modifier.write.invalidate([digestOf(f)], {
        account: bob.account,
      });
      await f.modifier.write.execTransactionFromModuleSigned(
        [f.tx, SALT, await sign(f)],
        {
          account: charlie.account,
        }
      );
      assert.equal(await f.receiver.read.pokes(), 1n);
    });

    it("lets two modules each execute the same message once", async () => {
      const f = await loadFixture(setup);
      const signatures = [await sign(f, alice), await sign(f, bob)];
      for (const signature of signatures) {
        await f.modifier.write.execTransactionFromModuleSigned(
          [f.tx, SALT, signature],
          {
            account: charlie.account,
          }
        );
      }
      assert.equal(await f.receiver.read.pokes(), 2n);
      for (const signature of signatures) {
        await assertions.revertWithCustomError(
          f.modifier.write.execTransactionFromModuleSigned(
            [f.tx, SALT, signature],
            {
              account: charlie.account,
            }
          ),
          f.modifier,
          "HashAlreadyConsumed"
        );
      }
    });

    it("does not consume the digest when the execution reverts", async () => {
      const f = await loadFixture(setup);
      const signature = await sign(f);
      await f.avatar.write.setReverts([true]);
      await assertions.revertWithCustomError(
        f.modifier.write.execTransactionFromModuleSigned(
          [f.tx, SALT, signature],
          {
            account: charlie.account,
          }
        ),
        f.avatar,
        "AvatarReverted"
      );
      assert.equal(
        await f.modifier.read.consumed([alice.account.address, digestOf(f)]),
        false
      );

      await f.avatar.write.setReverts([false]);
      await f.modifier.write.execTransactionFromModuleSigned(
        [f.tx, SALT, signature],
        {
          account: charlie.account,
        }
      );
      assert.equal(await f.receiver.read.pokes(), 1n);
    });

    it("reverts with AlreadyAuthenticated when nested inside moduleOnly", async () => {
      const f = await loadFixture(setup);
      await assertions.revertWithCustomError(
        f.modifier.write.moduleOnlySignedNestedInModuleOnly(
          [moduleTxStructHash(f.tx, SALT), await sign(f, bob)],
          { account: alice.account }
        ),
        f.modifier,
        "AlreadyAuthenticated"
      );
    });

    it("reverts with AlreadyAuthenticated when signed call relayed during execution", async () => {
      const f = await loadFixture(setup);
      const relayed = calldata(f, "execTransactionFromModuleSigned", [
        f.tx,
        SALT,
        await sign(f, bob),
      ]);
      const args = [f.modifier.address, 0n, relayed, Operation.Call] as const;
      const { result } =
        await f.modifier.simulate.execTransactionFromModuleReturnData(args, {
          account: alice.account,
        });
      assert.deepEqual(result, [false, alreadyAuthenticated(f)]);

      await f.modifier.write.execTransactionFromModuleReturnData(args, {
        account: alice.account,
      });
      assert.equal(
        await f.modifier.read.consumed([bob.account.address, digestOf(f)]),
        false
      );
      assert.equal(await f.receiver.read.pokes(), 0n);
    });
  });

  describe("ExecutionTracker", () => {
    const hash = makeSalt("some hash");

    it("returns false from consumed for an unknown hash", async () => {
      const f = await loadFixture(setup);
      assert.equal(
        await f.modifier.read.consumed([alice.account.address, hash]),
        false
      );
    });

    it("invalidate marks the hash for the caller only and emits HashInvalidated", async () => {
      const f = await loadFixture(setup);
      await assertions.emitWithArgs(
        f.modifier.write.invalidate([hash], { account: alice.account }),
        f.modifier,
        "HashInvalidated",
        [hash]
      );
      assert.equal(
        await f.modifier.read.consumed([alice.account.address, hash]),
        true
      );
      assert.equal(
        await f.modifier.read.consumed([bob.account.address, hash]),
        false
      );
    });

    it("invalidate is idempotent", async () => {
      const f = await loadFixture(setup);
      for (let i = 0; i < 2; i++) {
        await assertions.emitWithArgs(
          f.modifier.write.invalidate([hash], { account: alice.account }),
          f.modifier,
          "HashInvalidated",
          [hash]
        );
      }
      assert.equal(
        await f.modifier.read.consumed([alice.account.address, hash]),
        true
      );
    });
  });

  describe("execution", () => {
    const variants = [
      { name: "execTransactionFromModule", signed: false, returnsData: false },
      {
        name: "execTransactionFromModuleReturnData",
        signed: false,
        returnsData: true,
      },
      {
        name: "execTransactionFromModuleSigned",
        signed: true,
        returnsData: false,
      },
      {
        name: "execTransactionFromModuleReturnDataSigned",
        signed: true,
        returnsData: true,
      },
    ] as const;

    for (const variant of variants) {
      const event = variant.returnsData
        ? "ExecTransactionFromModuleReturnData"
        : "ExecTransactionFromModule";

      /** Arguments and sender for calling the variant with `tx`. */
      async function call(f: Fixture, tx: ModuleTx) {
        if (!variant.signed) {
          return {
            args: [tx.to, tx.value, tx.data, tx.operation],
            account: alice.account,
          };
        }
        return {
          args: [tx, SALT, await sign(f, alice, tx)],
          account: charlie.account,
        };
      }
      async function write(f: Fixture, tx: ModuleTx) {
        const { args, account } = await call(f, tx);
        return (f.modifier.write as any)[variant.name](args, {
          account,
        }) as Promise<Hex>;
      }
      async function simulate(f: Fixture, tx: ModuleTx) {
        const { args, account } = await call(f, tx);
        return (
          await (f.modifier.simulate as any)[variant.name](args, { account })
        ).result;
      }

      describe(variant.name, () => {
        for (const operation of [Operation.Call, Operation.DelegateCall]) {
          it(`forwards to, value, data and operation to the target (${Operation[operation]})`, async () => {
            const f = await loadFixture(setup);
            const tx = {
              to: f.receiver.address,
              value: 7n,
              data: succeed("0x1234"),
              operation,
            };
            await assertions.emitWithArgs(write(f, tx), f.avatar, event, [
              f.modifier.address,
              tx.to,
              tx.value,
              tx.data,
              tx.operation,
            ]);
          });
        }

        for (const success of [true, false]) {
          it(`returns the success flag (${success})`, async () => {
            const f = await loadFixture(setup);
            const tx = { ...f.tx, data: success ? succeed() : fail() };
            const result = await simulate(f, tx);
            assert.equal(variant.returnsData ? result[0] : result, success);
          });
        }

        if (variant.returnsData) {
          it("returns the inner call's return data", async () => {
            const f = await loadFixture(setup);
            assert.deepEqual(await simulate(f, { ...f.tx, data: succeed() }), [
              true,
              succeeded(),
            ]);
            assert.deepEqual(await simulate(f, { ...f.tx, data: fail() }), [
              false,
              failedError(),
            ]);
          });
        }
      });
    }
  });
});
