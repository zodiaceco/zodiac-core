import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import {
  concat,
  getAddress,
  hexToBigInt,
  isAddressEqual,
  keccak256,
  numberToHex,
  pad,
  recoverAddress,
  size,
  slice,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { startChain } from "../helpers/chain";
import { addr, CHAIN_ID, Operation } from "../helpers/constants";
import {
  moduleTxDigest,
  moduleTxStructHash,
  salt as makeSalt,
  signModuleTx,
  type ModuleTx,
} from "../helpers/signing";

const chain = await startChain();
const { deployContract, loadFixture, testClient } = chain;

after(() => chain.stop());

const signer = privateKeyToAccount(keccak256(toHex("signer")));
const SECP256K1_N =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const Mode = {
  Magic: 0,
  OtherValue: 1,
  Short: 2,
  Empty: 3,
  Revert: 4,
  WriteState: 5,
} as const;

const TX: ModuleTx = {
  to: addr(1),
  value: 5n,
  data: "0xbaddad",
  operation: Operation.Call,
};
const SALT = makeSalt("salt");

async function setup() {
  const checker = await deployContract("TestSignatureChecker");
  const erc1271 = await deployContract("MockERC1271");
  const receiver = await deployContract("Receiver");
  return { checker, erc1271, receiver };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

const digestOf = (f: Fixture, tx = TX, salt = SALT) =>
  moduleTxDigest({ verifyingContract: f.checker.address }, tx, salt);

const signLocal = (f: Fixture, tx = TX, salt = SALT) =>
  signModuleTx(
    {
      account: signer,
      signTypedData: ({ account: _account, ...args }) =>
        signer.signTypedData(args),
    },
    { verifyingContract: f.checker.address },
    tx,
    salt
  );

/** A signature by `signer` whose `v` is `v`, over a salt found for it. */
async function signWithV(f: Fixture, v: 27 | 28) {
  for (let i = 0; ; i++) {
    const salt = makeSalt(`salt ${i}`);
    const signature = await signLocal(f, TX, salt);
    if (Number(slice(signature, 64)) === v) {
      return { signature, digest: digestOf(f, TX, salt) };
    }
  }
}

const signedBy = (f: Fixture, hash: Hex, signature: Hex) =>
  f.checker.read.exposeSignedBy([hash, signature]);

/** `n` filler bytes. */
const filler = (n: number): Hex => (n === 0 ? "0x" : `0x${"ab".repeat(n)}`);

describe("SignatureChecker", () => {
  describe("hashTypedData", () => {
    it("matches viem's hashTypedData for the chainId + verifyingContract domain", async () => {
      const f = await loadFixture(setup);
      assert.equal(
        await f.checker.read.exposeHashTypedData([
          moduleTxStructHash(TX, SALT),
        ]),
        digestOf(f)
      );
    });

    it("changes with chain id", async () => {
      const f = await loadFixture(setup);
      const structHash = moduleTxStructHash(TX, SALT);
      const before = await f.checker.read.exposeHashTypedData([structHash]);
      await testClient.request({
        method: "anvil_setChainId",
        params: [1],
      } as any);
      try {
        const after = await f.checker.read.exposeHashTypedData([structHash]);
        assert.notEqual(after, before);
        assert.equal(
          after,
          moduleTxDigest(
            { chainId: 1, verifyingContract: f.checker.address },
            TX,
            SALT
          )
        );
      } finally {
        await testClient.request({
          method: "anvil_setChainId",
          params: [CHAIN_ID],
        } as any);
      }
    });

    it("changes with verifying contract", async () => {
      const f = await loadFixture(setup);
      const other = await deployContract("TestSignatureChecker");
      const structHash = moduleTxStructHash(TX, SALT);
      const hash = await other.read.exposeHashTypedData([structHash]);
      assert.notEqual(hash, digestOf(f));
      assert.equal(
        hash,
        moduleTxDigest({ verifyingContract: other.address }, TX, SALT)
      );
    });

    const changes: [string, ModuleTx, Hex][] = [
      ["to", { ...TX, to: addr(2) }, SALT],
      ["value", { ...TX, value: 6n }, SALT],
      ["data", { ...TX, data: "0xbaddae" }, SALT],
      ["operation", { ...TX, operation: Operation.DelegateCall }, SALT],
      ["salt", TX, makeSalt("other")],
    ];
    for (const [field, tx, salt] of changes) {
      it(`changes with ${field}`, async () => {
        const f = await loadFixture(setup);
        const hash = await f.checker.read.exposeHashTypedData([
          moduleTxStructHash(tx, salt),
        ]);
        assert.notEqual(hash, digestOf(f));
        assert.equal(hash, digestOf(f, tx, salt));
      });
    }
  });

  describe("signedBy", () => {
    describe("length", () => {
      for (const n of [0, 19]) {
        it(`returns zero for a ${n} byte signature`, async () => {
          const f = await loadFixture(setup);
          // Even a prefix of a contract that accepts every signature.
          const signature = slice(f.erc1271.address, 0, n);
          assert.equal(
            await signedBy(f, digestOf(f), n === 0 ? "0x" : signature),
            zeroAddress
          );
        });
      }

      for (const n of [20, 21, 64, 66]) {
        it(`treats a ${n} byte signature as a contract signature${n === 20 ? " (empty contract signature)" : ""}`, async () => {
          const f = await loadFixture(setup);
          const contractSignature = filler(n - 20);
          await f.erc1271.write.expect([digestOf(f), contractSignature]);
          const signature = concat([f.erc1271.address, contractSignature]);
          assert.equal(size(signature), n);
          assert.equal(
            await signedBy(f, digestOf(f), signature),
            f.erc1271.address
          );
        });
      }
    });

    describe("EOA signature", () => {
      for (const v of [27, 28] as const) {
        it(`recovers the signer with v = ${v}`, async () => {
          const f = await loadFixture(setup);
          const { signature, digest } = await signWithV(f, v);
          assert.equal(await signedBy(f, digest, signature), signer.address);
        });
      }

      it("recovers the same signer from the high-s twin signature", async () => {
        const f = await loadFixture(setup);
        const signature = await signLocal(f);
        const s = hexToBigInt(slice(signature, 32, 64));
        const v = Number(slice(signature, 64));
        const twin = concat([
          slice(signature, 0, 32),
          numberToHex(SECP256K1_N - s, { size: 32 }),
          numberToHex(v === 27 ? 28 : 27, { size: 1 }),
        ]);
        assert.notEqual(twin, signature);
        assert.equal(await signedBy(f, digestOf(f), twin), signer.address);
      });

      for (const [field, tx, salt] of [
        ["message", { ...TX, value: 6n }, SALT],
        ["salt", TX, makeSalt("other")],
      ] as const) {
        it(`recovers a different address when ${field} differs`, async () => {
          const f = await loadFixture(setup);
          const signature = await signLocal(f);
          const recovered = await signedBy(f, digestOf(f, tx, salt), signature);
          assert.notEqual(recovered, zeroAddress);
          assert.notEqual(recovered, signer.address);
        });
      }

      const broken: [string, (signature: Hex) => Hex][] = [
        ["v is 0", (sig) => concat([slice(sig, 0, 64), "0x00"])],
        ["v is 1", (sig) => concat([slice(sig, 0, 64), "0x01"])],
        [
          "r and s are zero",
          (sig) => concat([pad("0x", { size: 64 }), slice(sig, 64)]),
        ],
      ];
      for (const [label, breakIt] of broken) {
        it(`returns zero when ${label}`, async () => {
          const f = await loadFixture(setup);
          assert.equal(
            await signedBy(f, digestOf(f), breakIt(await signLocal(f))),
            zeroAddress
          );
        });
      }
    });

    describe("ERC-1271 fallback for 65 byte signatures", () => {
      // signer ‖ 44 filler bytes ‖ v = 0: ecrecover rejects the v.
      const fallbackSignature = (f: Fixture) =>
        concat([f.erc1271.address, filler(44), "0x00"]);

      it("uses the first 20 bytes as signer when ecrecover fails", async () => {
        const f = await loadFixture(setup);
        assert.equal(
          await signedBy(f, digestOf(f), fallbackSignature(f)),
          f.erc1271.address
        );
      });

      it("passes the remaining 45 bytes as the contract signature", async () => {
        const f = await loadFixture(setup);
        const signature = fallbackSignature(f);
        await f.erc1271.write.expect([digestOf(f), slice(signature, 20)]);
        assert.equal(
          await signedBy(f, digestOf(f), signature),
          f.erc1271.address
        );

        await f.erc1271.write.expect([digestOf(f), slice(signature, 21)]);
        assert.equal(await signedBy(f, digestOf(f), signature), zeroAddress);
      });

      it("does not consult the contract when ecrecover succeeds", async () => {
        const f = await loadFixture(setup);
        // r starts with the (accepting) contract's address; vary the rest of
        // r until it is a valid curve point, so ecrecover succeeds.
        for (let i = 0; i < 64; i++) {
          const signature = concat([
            f.erc1271.address,
            numberToHex(i, { size: 12 }),
            numberToHex(1n, { size: 32 }),
            "0x1b",
          ]);
          const recovered = await signedBy(f, digestOf(f), signature);
          if (isAddressEqual(recovered, f.erc1271.address)) continue;
          assert.equal(
            recovered,
            await recoverAddress({ hash: digestOf(f), signature })
          );
          return;
        }
        assert.fail("No r made ecrecover succeed");
      });
    });

    describe("contract signature", () => {
      it("returns the signer when it answers with the magic value", async () => {
        const f = await loadFixture(setup);
        assert.equal(
          await signedBy(f, digestOf(f), concat([f.erc1271.address, "0x01"])),
          f.erc1271.address
        );
      });

      it("passes the digest and the bytes after the signer to isValidSignature", async () => {
        const f = await loadFixture(setup);
        await f.erc1271.write.expect([digestOf(f), "0xc0ffee"]);
        const signature = concat([f.erc1271.address, "0xc0ffee"]);
        assert.equal(
          await signedBy(f, digestOf(f), signature),
          f.erc1271.address
        );
        assert.equal(
          await signedBy(f, makeSalt("other digest"), signature),
          zeroAddress
        );
        assert.equal(
          await signedBy(
            f,
            digestOf(f),
            concat([f.erc1271.address, "0xc0ffef"])
          ),
          zeroAddress
        );
      });

      const rejecting: [string, (f: Fixture) => Promise<Address>][] = [
        [
          "answers with another value",
          async (f) => (
            await f.erc1271.write.setMode([Mode.OtherValue]),
            f.erc1271.address
          ),
        ],
        [
          "returns fewer than 4 bytes",
          async (f) => (
            await f.erc1271.write.setMode([Mode.Short]),
            f.erc1271.address
          ),
        ],
        [
          "returns no data",
          async (f) => (
            await f.erc1271.write.setMode([Mode.Empty]),
            f.erc1271.address
          ),
        ],
        [
          "reverts",
          async (f) => (
            await f.erc1271.write.setMode([Mode.Revert]),
            f.erc1271.address
          ),
        ],
        ["has no isValidSignature", async (f) => f.receiver.address],
        // Answers with the magic value, after a write that STATICCALL forbids.
        [
          "tries to write state",
          async (f) => (
            await f.erc1271.write.setMode([Mode.WriteState]),
            f.erc1271.address
          ),
        ],
        ["has no code", async () => addr(5)],
        // The identity precompile echoes the calldata, whose first 4 bytes
        // are the isValidSignature selector: the magic value.
        [
          "is a precompile address",
          async () => getAddress(pad("0x04", { size: 20 })),
        ],
      ];
      for (const [label, prepare] of rejecting) {
        it(`returns zero when the signer ${label}`, async () => {
          const f = await loadFixture(setup);
          const contract = await prepare(f);
          assert.equal(
            await signedBy(f, digestOf(f), concat([contract, "0x01"])),
            zeroAddress
          );
        });
      }
    });
  });
});
