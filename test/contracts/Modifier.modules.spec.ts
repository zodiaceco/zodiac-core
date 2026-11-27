import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { zeroAddress, type Address } from "viem";

import { startChain } from "../helpers/chain";
import { addr, SENTINEL } from "../helpers/constants";

const chain = await startChain();
const { deployContract, loadFixture, assertions } = chain;
const [owner, alice] = chain.walletClients;

after(() => chain.stop());

const [A, B, C, D] = [addr(1), addr(2), addr(3), addr(4)];

async function setup() {
  const modifier = await deployContract("TestModifier", [
    owner.account.address,
    addr(100),
    addr(100),
  ]);
  return { modifier };
}

/** Enables A, B and C, in that order: the list reads C, B, A. */
async function setupWithModules() {
  const { modifier } = await setup();
  for (const module of [A, B, C]) await modifier.write.enableModule([module]);
  return { modifier };
}

type Modifier = Awaited<ReturnType<typeof setup>>["modifier"];

async function listModules(modifier: Modifier) {
  const [modules] = await modifier.read.getModulesPaginated([SENTINEL, 100n]);
  return modules;
}

describe("Modifier — module list", () => {
  describe("setupModules", () => {
    it("initializes the list with SENTINEL pointing to itself", async () => {
      const { modifier } = await loadFixture(setup);
      // Without the SENTINEL self-link, the empty page would underflow.
      assert.deepEqual(
        await modifier.read.getModulesPaginated([SENTINEL, 10n]),
        [[], SENTINEL]
      );
      assert.equal(await modifier.read.isModuleEnabled([SENTINEL]), false);
    });

    it("reverts with SetupModulesAlreadyCalled on a second call", async () => {
      const { modifier } = await loadFixture(setup);
      await assertions.revertWithCustomError(
        modifier.write.attemptToSetupModules(),
        modifier,
        "SetupModulesAlreadyCalled"
      );
    });
  });

  describe("enableModule", () => {
    const cases: [string, Address, string, () => Address[]][] = [
      [
        "non-owner",
        A,
        "OwnableUnauthorizedAccount",
        () => [alice.account.address],
      ],
      ["zero address", zeroAddress, "InvalidModule", () => [zeroAddress]],
      ["SENTINEL_MODULES", SENTINEL, "InvalidModule", () => [SENTINEL]],
      ["already enabled", A, "AlreadyEnabledModule", () => [A]],
    ];
    for (const [label, module, error, args] of cases) {
      it(`reverts with ${error} for ${label}`, async () => {
        const { modifier } = await loadFixture(setupWithModules);
        await assertions.revertWithCustomErrorWithArgs(
          modifier.write.enableModule([module], {
            account: label === "non-owner" ? alice.account : owner.account,
          }),
          modifier,
          error,
          args()
        );
      });
    }

    it("enables a module at the head of the list and emits EnabledModule", async () => {
      const { modifier } = await loadFixture(setupWithModules);
      await assertions.emitWithArgs(
        modifier.write.enableModule([D]),
        modifier,
        "EnabledModule",
        [D]
      );
      assert.equal(await modifier.read.isModuleEnabled([D]), true);
      assert.deepEqual(await listModules(modifier), [D, C, B, A]);
    });

    it("re-enables a previously disabled module", async () => {
      const { modifier } = await loadFixture(setupWithModules);
      await modifier.write.disableModule([C, B]);
      await assertions.emitWithArgs(
        modifier.write.enableModule([B]),
        modifier,
        "EnabledModule",
        [B]
      );
      assert.deepEqual(await listModules(modifier), [B, C, A]);
    });
  });

  describe("disableModule", () => {
    const cases: [string, Address, Address, string, () => Address[]][] = [
      [
        "non-owner",
        SENTINEL,
        C,
        "OwnableUnauthorizedAccount",
        () => [alice.account.address],
      ],
      [
        "zero address",
        SENTINEL,
        zeroAddress,
        "InvalidModule",
        () => [zeroAddress],
      ],
      [
        "SENTINEL_MODULES",
        SENTINEL,
        SENTINEL,
        "InvalidModule",
        () => [SENTINEL],
      ],
      ["not enabled", SENTINEL, D, "AlreadyDisabledModule", () => [D]],
      ["wrong prevModule", SENTINEL, B, "AlreadyDisabledModule", () => [B]],
    ];
    for (const [label, prev, module, error, args] of cases) {
      it(`reverts with ${error} for ${label}`, async () => {
        const { modifier } = await loadFixture(setupWithModules);
        await assertions.revertWithCustomErrorWithArgs(
          modifier.write.disableModule([prev, module], {
            account: label === "non-owner" ? alice.account : owner.account,
          }),
          modifier,
          error,
          args()
        );
      });
    }

    const positions: [string, Address, Address, Address[]][] = [
      ["head", SENTINEL, C, [B, A]],
      ["middle", C, B, [C, A]],
      ["tail", B, A, [C, B]],
    ];
    for (const [position, prev, module, remaining] of positions) {
      it(`disables the ${position} module, emits DisabledModule, and keeps the rest linked`, async () => {
        const { modifier } = await loadFixture(setupWithModules);
        await assertions.emitWithArgs(
          modifier.write.disableModule([prev, module]),
          modifier,
          "DisabledModule",
          [module]
        );
        assert.equal(await modifier.read.isModuleEnabled([module]), false);
        assert.deepEqual(await listModules(modifier), remaining);
        for (const m of remaining) {
          assert.equal(await modifier.read.isModuleEnabled([m]), true);
        }
      });
    }

    it("disables the only module, emits DisabledModule, and keeps the rest linked", async () => {
      const { modifier } = await loadFixture(setup);
      await modifier.write.enableModule([A]);
      await assertions.emitWithArgs(
        modifier.write.disableModule([SENTINEL, A]),
        modifier,
        "DisabledModule",
        [A]
      );
      assert.equal(await modifier.read.isModuleEnabled([A]), false);
      assert.deepEqual(
        await modifier.read.getModulesPaginated([SENTINEL, 10n]),
        [[], SENTINEL]
      );
    });
  });

  describe("isModuleEnabled", () => {
    for (const [label, module] of [
      ["SENTINEL_MODULES", SENTINEL],
      ["zero address", zeroAddress],
      ["never enabled", D],
      ["disabled", B],
    ] as const) {
      it(`returns false for ${label}`, async () => {
        const { modifier } = await loadFixture(setupWithModules);
        await modifier.write.disableModule([C, B]);
        assert.equal(await modifier.read.isModuleEnabled([module]), false);
      });
    }

    it("returns true for an enabled module", async () => {
      const { modifier } = await loadFixture(setupWithModules);
      assert.equal(await modifier.read.isModuleEnabled([A]), true);
    });
  });

  describe("getModulesPaginated", () => {
    it("reverts with InvalidPageSize when pageSize is zero", async () => {
      const { modifier } = await loadFixture(setupWithModules);
      await assertions.revertWithCustomError(
        modifier.read.getModulesPaginated([SENTINEL, 0n]),
        modifier,
        "InvalidPageSize"
      );
    });

    for (const [label, start] of [
      ["not enabled", D],
      ["zero address", zeroAddress],
    ] as const) {
      it(`reverts with InvalidModule when start is ${label}`, async () => {
        const { modifier } = await loadFixture(setupWithModules);
        await assertions.revertWithCustomErrorWithArgs(
          modifier.read.getModulesPaginated([start, 1n]),
          modifier,
          "InvalidModule",
          [start]
        );
      });
    }

    it("returns an empty array and SENTINEL when no modules enabled", async () => {
      const { modifier } = await loadFixture(setup);
      assert.deepEqual(
        await modifier.read.getModulesPaginated([SENTINEL, 3n]),
        [[], SENTINEL]
      );
    });

    it("returns an empty array and SENTINEL when start is the tail", async () => {
      const { modifier } = await loadFixture(setupWithModules);
      assert.deepEqual(await modifier.read.getModulesPaginated([A, 3n]), [
        [],
        SENTINEL,
      ]);
    });

    it("returns modules in reverse order of enabling", async () => {
      const { modifier } = await loadFixture(setupWithModules);
      assert.deepEqual(await listModules(modifier), [C, B, A]);
    });

    for (const [label, pageSize] of [
      ["page larger than the list", 10n],
      ["pageSize equals module count", 3n],
    ] as const) {
      it(`returns SENTINEL as next when ${label}`, async () => {
        const { modifier } = await loadFixture(setupWithModules);
        assert.deepEqual(
          await modifier.read.getModulesPaginated([SENTINEL, pageSize]),
          [[C, B, A], SENTINEL]
        );
      });
    }

    it("returns the last element as next when more modules remain", async () => {
      const { modifier } = await loadFixture(setupWithModules);
      assert.deepEqual(
        await modifier.read.getModulesPaginated([SENTINEL, 2n]),
        [[C, B], B]
      );
    });

    it("walks the full list across pages, continuing from next", async () => {
      const { modifier } = await loadFixture(setupWithModules);
      await modifier.write.enableModule([D]);
      const seen: Address[] = [];
      let next: Address = SENTINEL;
      const pages: number[] = [];
      do {
        const [page, nextStart]: readonly [readonly Address[], Address] =
          await modifier.read.getModulesPaginated([next, 3n]);
        seen.push(...page);
        pages.push(page.length);
        next = nextStart;
      } while (next !== SENTINEL);
      assert.deepEqual(seen, [D, C, B, A]);
      assert.deepEqual(pages, [3, 1]);
    });

    it("omits a disabled module", async () => {
      const { modifier } = await loadFixture(setupWithModules);
      await modifier.write.disableModule([C, B]);
      assert.deepEqual(await listModules(modifier), [C, A]);
    });
  });
});
