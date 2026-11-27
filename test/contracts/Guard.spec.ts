import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { toFunctionSelector, zeroAddress, type Address, type Hex } from "viem";

import { startChain } from "../helpers/chain";
import { addr } from "../helpers/constants";

const chain = await startChain();
const { deployContract, loadFixture, assertions } = chain;
const [owner, alice] = chain.walletClients;

after(() => chain.stop());

/** ERC-165 interface id: the XOR of the interface's function selectors. */
function interfaceId(signatures: string[]): Hex {
  const id = signatures
    .map((signature) =>
      Number.parseInt(toFunctionSelector(signature).slice(2), 16)
    )
    .reduce((a, b) => (a ^ b) >>> 0, 0);
  return `0x${id.toString(16).padStart(8, "0")}`;
}

const IGuard = interfaceId([
  "checkTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes,address)",
  "checkAfterExecution(bytes32,bool)",
]);
const IModuleGuard = interfaceId([
  "checkModuleTransaction(address,uint256,bytes,uint8,address)",
  "checkAfterModuleExecution(bytes32,bool)",
]);
const IERC165 = interfaceId(["supportsInterface(bytes4)"]);

async function setup() {
  const module = await deployContract("TestGuardableModule", [
    owner.account.address,
    addr(1),
    addr(1),
  ]);
  const guard = await deployContract("MockModuleGuard");
  const otherGuard = await deployContract("MockModuleGuard");
  const transactionGuard = await deployContract("MockTransactionGuard");
  const unsupported = await deployContract("MockUnsupportedInterface");
  const receiver = await deployContract("Receiver");
  return { module, guard, otherGuard, transactionGuard, unsupported, receiver };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

describe("Guardable", () => {
  describe("setGuard", () => {
    it("reverts when caller is not the owner", async () => {
      const f = await loadFixture(setup);
      await assertions.revertWithCustomErrorWithArgs(
        f.module.write.setGuard([f.guard.address], { account: alice.account }),
        f.module,
        "OwnableUnauthorizedAccount",
        [alice.account.address]
      );
    });

    for (const [label, guardOf] of [
      ["guard has no code", () => addr(5)],
      ["guard lacks supportsInterface", (f: Fixture) => f.receiver.address],
    ] as [string, (f: Fixture) => Address][]) {
      it(`reverts when ${label}, without reason`, async () => {
        const f = await loadFixture(setup);
        await assertions.revertWithoutReason(
          f.module.write.setGuard([guardOf(f)])
        );
      });
    }

    for (const [label, guardOf] of [
      [
        "guard does not support IModuleGuard",
        (f: Fixture) => f.unsupported.address,
      ],
      [
        "guard supports only IGuard",
        (f: Fixture) => f.transactionGuard.address,
      ],
    ] as [string, (f: Fixture) => Address][]) {
      it(`reverts with NotIERC165Compliant when ${label}`, async () => {
        const f = await loadFixture(setup);
        await assertions.revertWithCustomErrorWithArgs(
          f.module.write.setGuard([guardOf(f)]),
          f.module,
          "NotIERC165Compliant",
          [guardOf(f)]
        );
      });
    }

    it("sets the guard and emits ChangedGuard", async () => {
      const f = await loadFixture(setup);
      await assertions.emitWithArgs(
        f.module.write.setGuard([f.guard.address]),
        f.module,
        "ChangedGuard",
        [f.guard.address]
      );
      assert.equal(await f.module.read.guard(), f.guard.address);
    });

    it("replaces an existing guard", async () => {
      const f = await loadFixture(setup);
      await f.module.write.setGuard([f.guard.address]);
      await assertions.emitWithArgs(
        f.module.write.setGuard([f.otherGuard.address]),
        f.module,
        "ChangedGuard",
        [f.otherGuard.address]
      );
      assert.equal(await f.module.read.guard(), f.otherGuard.address);
    });

    it("clears the guard with the zero address without an interface check", async () => {
      const f = await loadFixture(setup);
      await f.module.write.setGuard([f.guard.address]);
      await assertions.emitWithArgs(
        f.module.write.setGuard([zeroAddress]),
        f.module,
        "ChangedGuard",
        [zeroAddress]
      );
      assert.equal(await f.module.read.guard(), zeroAddress);
    });
  });

  describe("getGuard", () => {
    it("returns the zero address by default and matches guard() once set", async () => {
      const f = await loadFixture(setup);
      assert.equal(await f.module.read.getGuard(), zeroAddress);
      await f.module.write.setGuard([f.guard.address]);
      assert.equal(await f.module.read.getGuard(), f.guard.address);
      assert.equal(await f.module.read.getGuard(), await f.module.read.guard());
    });
  });
});

const ids: [string, Hex][] = [
  ["IGuard", IGuard],
  ["IModuleGuard", IModuleGuard],
  ["IERC165", IERC165],
  ["0xffffffff", "0xffffffff"],
];

describe("BaseGuard", () => {
  const supported = ["IGuard", "IERC165"];
  for (const [name, id] of ids) {
    it(`supportsInterface(${name}) returns ${supported.includes(name)}`, async () => {
      const f = await loadFixture(setup);
      assert.equal(
        await f.transactionGuard.read.supportsInterface([id]),
        supported.includes(name)
      );
    });
  }
});

describe("BaseModuleGuard", () => {
  const supported = ["IModuleGuard", "IERC165"];
  for (const [name, id] of ids) {
    it(`supportsInterface(${name}) returns ${supported.includes(name)}`, async () => {
      const f = await loadFixture(setup);
      assert.equal(
        await f.guard.read.supportsInterface([id]),
        supported.includes(name)
      );
    });
  }
});

describe("interface ids", () => {
  it("match the ones documented in BaseGuard.sol", () => {
    assert.deepEqual(
      [IGuard, IModuleGuard, IERC165],
      ["0xe6d7a83a", "0x58401ed8", "0x01ffc9a7"]
    );
  });
});
