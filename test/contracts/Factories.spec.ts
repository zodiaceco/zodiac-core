import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  getContractAddress,
  keccak256,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

import { MockMastercopy, Receiver } from "../../build/contracts";
import { bytecode as canonicalBytecode } from "../../src/factory/proxyFactory";
import { startChain } from "../helpers/chain";
import { addr } from "../helpers/constants";
import { salt as makeSalt } from "../helpers/signing";

const chain = await startChain();
const {
  deployContract,
  deployBytecode,
  getContractAt,
  loadFixture,
  assertions,
  publicClient,
} = chain;

after(() => chain.stop());

const initialize = (value: bigint) =>
  encodeFunctionData({
    abi: MockMastercopy.abi,
    functionName: "initialize",
    args: [value],
  });

/** Runtime code of an EIP-1167 minimal proxy for `mastercopy`. */
const proxyRuntime = (mastercopy: Address) =>
  concat([
    "0x363d3d373d3d3d363d73",
    mastercopy,
    "0x5af43d82803e903d91602b57fd5bf3",
  ]).toLowerCase();

/** Address deployModule deploys to, derived independently of the src helpers. */
function proxyAddress(
  factory: Address,
  mastercopy: Address,
  initializer: Hex,
  saltNonce: bigint
) {
  return getContractAddress({
    opcode: "CREATE2",
    from: factory,
    salt: keccak256(
      concat([
        keccak256(initializer),
        encodeAbiParameters([{ type: "uint256" }], [saltNonce]),
      ])
    ),
    bytecode: concat([
      "0x602d8060093d393df3363d3d373d3d3d363d73",
      mastercopy,
      "0x5af43d82803e903d91602b57fd5bf3",
    ]),
  });
}

async function setup() {
  const factory = await deployContract("ModuleProxyFactory");
  const mastercopy = await deployContract("MockMastercopy");
  const otherMastercopy = await deployContract("MockMastercopy");
  const singletonFactory = await deployContract("SingletonFactory");
  return { factory, mastercopy, otherMastercopy, singletonFactory };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

async function getCode(address: Address) {
  return (await publicClient.getCode({ address }))?.toLowerCase();
}

describe("ModuleProxyFactory", () => {
  describe("deployModule", () => {
    const failures: [
      string,
      string,
      (f: Fixture) => Promise<[Address, Hex, bigint]>,
      (f: Fixture) => unknown[] | undefined,
    ][] = [
      [
        "zero-address mastercopy",
        "ZeroAddress",
        async () => [zeroAddress, initialize(1n), 0n],
        () => [zeroAddress],
      ],
      [
        "mastercopy without code",
        "TargetHasNoCode",
        async () => [addr(1), initialize(1n), 0n],
        () => [addr(1)],
      ],
      [
        "same initializer and saltNonce reused",
        "TakenAddress",
        async (f) => {
          await f.factory.write.deployModule([
            f.mastercopy.address,
            initialize(1n),
            0n,
          ]);
          return [f.mastercopy.address, initialize(1n), 0n];
        },
        () => [zeroAddress],
      ],
      [
        "initializer reverts",
        "FailedInitialization",
        async (f) => [f.mastercopy.address, initialize(0n), 0n],
        () => [],
      ],
      [
        "mastercopy lacks the called function",
        "FailedInitialization",
        async (f) => [
          f.mastercopy.address,
          toFunctionSelector("missing()"),
          0n,
        ],
        () => [],
      ],
    ];
    for (const [label, error, prepare, args] of failures) {
      it(`reverts with ${error} for ${label}`, async () => {
        const f = await loadFixture(setup);
        const call = await prepare(f);
        await assertions.revertWithCustomErrorWithArgs(
          f.factory.write.deployModule(call),
          f.factory,
          error,
          args(f) ?? []
        );
      });
    }

    it("leaves no proxy behind when initialization fails", async () => {
      const f = await loadFixture(setup);
      const proxy = proxyAddress(
        f.factory.address,
        f.mastercopy.address,
        initialize(0n),
        0n
      );
      await assertions.revertWithCustomError(
        f.factory.write.deployModule([
          f.mastercopy.address,
          initialize(0n),
          0n,
        ]),
        f.factory,
        "FailedInitialization"
      );
      assert.equal(await getCode(proxy), undefined);
    });

    it("deploys an EIP-1167 proxy at CREATE2(keccak256(keccak256(initializer), saltNonce))", async () => {
      const f = await loadFixture(setup);
      await f.factory.write.deployModule([
        f.mastercopy.address,
        initialize(1n),
        42n,
      ]);
      const proxy = proxyAddress(
        f.factory.address,
        f.mastercopy.address,
        initialize(1n),
        42n
      );
      assert.equal(await getCode(proxy), proxyRuntime(f.mastercopy.address));
    });

    it("calls the initializer on the proxy with the factory as msg.sender", async () => {
      const f = await loadFixture(setup);
      await f.factory.write.deployModule([
        f.mastercopy.address,
        initialize(7n),
        0n,
      ]);
      const proxy = getContractAt(
        "MockMastercopy",
        proxyAddress(
          f.factory.address,
          f.mastercopy.address,
          initialize(7n),
          0n
        )
      );
      assert.equal(await proxy.read.value(), 7n);
      assert.equal(await proxy.read.initializer(), f.factory.address);
    });

    it("emits ModuleProxyCreation and returns the proxy address", async () => {
      const f = await loadFixture(setup);
      const call = [f.mastercopy.address, initialize(1n), 0n] as const;
      const { result } = await f.factory.simulate.deployModule(call);
      assert.equal(result, proxyAddress(f.factory.address, ...call));
      await assertions.emitWithArgs(
        f.factory.write.deployModule(call),
        f.factory,
        "ModuleProxyCreation",
        [result, f.mastercopy.address]
      );
    });

    const variations: [string, (f: Fixture) => [Address, Hex, bigint]][] = [
      ["saltNonce", (f) => [f.mastercopy.address, initialize(1n), 1n]],
      ["initializer", (f) => [f.mastercopy.address, initialize(2n), 0n]],
      ["mastercopy", (f) => [f.otherMastercopy.address, initialize(1n), 0n]],
    ];
    for (const [input, vary] of variations) {
      it(`deploys a distinct proxy for a different ${input}`, async () => {
        const f = await loadFixture(setup);
        const first = [f.mastercopy.address, initialize(1n), 0n] as const;
        const second = vary(f);
        await f.factory.write.deployModule(first);
        const { result } = await f.factory.simulate.deployModule(second);
        await f.factory.write.deployModule(second);
        assert.notEqual(result, proxyAddress(f.factory.address, ...first));
        assert.equal(result, proxyAddress(f.factory.address, ...second));
        assert.equal(await getCode(result), proxyRuntime(second[0]));
      });
    }
  });

  describe("proxy", () => {
    async function deployProxy(f: Fixture) {
      await f.factory.write.deployModule([
        f.mastercopy.address,
        initialize(1n),
        0n,
      ]);
      return getContractAt(
        "MockMastercopy",
        proxyAddress(
          f.factory.address,
          f.mastercopy.address,
          initialize(1n),
          0n
        )
      );
    }

    it("delegates calls to the mastercopy with its own storage", async () => {
      const f = await loadFixture(setup);
      const proxy = await deployProxy(f);
      await proxy.write.setValue([9n]);
      assert.equal(await proxy.read.value(), 9n);
      assert.equal(await f.mastercopy.read.value(), 0n);
      assert.equal(await f.mastercopy.read.initializer(), zeroAddress);
    });

    it("bubbles reverts from the mastercopy", async () => {
      const f = await loadFixture(setup);
      const proxy = await deployProxy(f);
      await assertions.revertWithCustomError(proxy.read.boom(), proxy, "Boom");
    });
  });

  describe("canonical deployment", () => {
    it("behaves like the bytecode in src/factory/proxyFactory", async () => {
      const f = await loadFixture(setup);
      const canonical = getContractAt(
        "ModuleProxyFactory",
        await deployBytecode(canonicalBytecode)
      );

      for (const factory of [f.factory, canonical]) {
        const call = [f.mastercopy.address, initialize(3n), 5n] as const;
        const { result } = await factory.simulate.deployModule(call);
        await assertions.emitWithArgs(
          factory.write.deployModule(call),
          factory,
          "ModuleProxyCreation",
          [result, f.mastercopy.address]
        );
        assert.equal(result, proxyAddress(factory.address, ...call));
        assert.equal(await getCode(result), proxyRuntime(f.mastercopy.address));
        const proxy = getContractAt("MockMastercopy", result);
        assert.equal(await proxy.read.initializer(), factory.address);
        assert.equal(await proxy.read.value(), 3n);

        const failures: [readonly [Address, Hex, bigint], string, unknown[]][] =
          [
            [[zeroAddress, initialize(1n), 0n], "ZeroAddress", [zeroAddress]],
            [[addr(1), initialize(1n), 0n], "TargetHasNoCode", [addr(1)]],
            [call, "TakenAddress", [zeroAddress]],
            [
              [f.mastercopy.address, initialize(0n), 0n],
              "FailedInitialization",
              [],
            ],
          ];
        for (const [args, error, errorArgs] of failures) {
          await assertions.revertWithCustomErrorWithArgs(
            factory.write.deployModule(args),
            factory,
            error,
            errorArgs
          );
        }
      }
    });
  });
});

describe("SingletonFactory", () => {
  const SALT = makeSalt("singleton");
  const singletonAddress = (f: Fixture, initCode: Hex, salt: Hex) =>
    getContractAddress({
      opcode: "CREATE2",
      from: f.singletonFactory.address,
      salt,
      bytecode: initCode,
    });

  it("deploys init code at its CREATE2 address and returns it", async () => {
    const f = await loadFixture(setup);
    const { result } = await f.singletonFactory.simulate.deploy([
      Receiver.bytecode,
      SALT,
    ]);
    assert.equal(result, singletonAddress(f, Receiver.bytecode, SALT));
    await f.singletonFactory.write.deploy([Receiver.bytecode, SALT]);
    assert.notEqual(await getCode(result), undefined);
    assert.equal(await getContractAt("Receiver", result).read.pokes(), 0n);
  });

  it("deploys the same init code elsewhere for a different salt", async () => {
    const f = await loadFixture(setup);
    const other = makeSalt("other");
    await f.singletonFactory.write.deploy([Receiver.bytecode, SALT]);
    const { result } = await f.singletonFactory.simulate.deploy([
      Receiver.bytecode,
      other,
    ]);
    await f.singletonFactory.write.deploy([Receiver.bytecode, other]);
    assert.notEqual(result, singletonAddress(f, Receiver.bytecode, SALT));
    assert.equal(result, singletonAddress(f, Receiver.bytecode, other));
    assert.notEqual(await getCode(result), undefined);
  });

  it("returns the zero address when address already taken", async () => {
    const f = await loadFixture(setup);
    await f.singletonFactory.write.deploy([Receiver.bytecode, SALT]);
    const { result } = await f.singletonFactory.simulate.deploy([
      Receiver.bytecode,
      SALT,
    ]);
    assert.equal(result, zeroAddress);
  });

  it("returns the zero address when constructor reverts", async () => {
    const f = await loadFixture(setup);
    // PUSH1 0 PUSH1 0 REVERT
    const initCode = "0x60006000fd";
    const { result } = await f.singletonFactory.simulate.deploy([
      initCode,
      SALT,
    ]);
    assert.equal(result, zeroAddress);
    await f.singletonFactory.write.deploy([initCode, SALT]);
    assert.equal(await getCode(singletonAddress(f, initCode, SALT)), undefined);
  });
});
