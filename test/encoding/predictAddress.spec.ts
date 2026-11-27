import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { getAddress, keccak256, toHex } from "viem";

import { TestModule } from "../../build/contracts";
import encodeDeployProxy from "../../src/encoding/encodeDeployProxy";
import encodeDeploySingleton from "../../src/encoding/encodeDeploySingleton";
import predictProxyAddress from "../../src/encoding/predictProxyAddress";
import predictSingletonAddress, {
  creationBytecode,
} from "../../src/encoding/predictSingletonAddress";
import { encodeArgs } from "../../src/encoding/encodeArgs";
import { address as erc2470Factory } from "../../src/factory/erc2470Factory";
import { address as nickFactory } from "../../src/factory/nickFactory";
import { address as canonicalProxyFactory } from "../../src/factory/proxyFactory";
import deployFactories from "../../src/tooling/deployFactories";
import { startChain } from "../helpers/chain";
import { addr } from "../helpers/constants";
import { withSender } from "../helpers/provider";

const chain = await startChain();
const { deployContract, loadFixture, publicClient } = chain;
const [owner] = chain.walletClients;

after(() => chain.stop());

async function setup() {
  await deployFactories({
    provider: withSender(chain.provider, owner.account.address),
  });
  const mastercopy = await deployContract("TestModule", [
    addr(1),
    addr(1),
    addr(1),
  ]);
  const customFactory = await deployContract("ModuleProxyFactory");
  return { mastercopy, customFactory };
}

const setupArgs = {
  types: ["address", "address", "address"],
  values: [addr(10), addr(11), addr(12)],
};

const hasCode = async (address: `0x${string}`) =>
  (await publicClient.getCode({ address })) !== undefined;

describe("predictProxyAddress", () => {
  for (const label of [
    "canonical factory (default)",
    "custom factory",
  ] as const) {
    it(`matches the address ModuleProxyFactory deploys to (${label})`, async () => {
      const { mastercopy, customFactory } = await loadFixture(setup);
      const factory =
        label === "custom factory" ? customFactory.address : undefined;
      const params = {
        factory,
        mastercopy: mastercopy.address,
        setupArgs,
        saltNonce: 7n,
      };
      const predicted = predictProxyAddress(params);
      assert.equal(await hasCode(predicted), false);

      await owner.sendTransaction(encodeDeployProxy(params));
      assert.equal(await hasCode(predicted), true);
      const proxy = chain.getContractAt("TestModule", predicted);
      assert.equal(await proxy.read.owner(), addr(10));
    });
  }

  const base = {
    factory: canonicalProxyFactory,
    mastercopy: addr(1),
    setupArgs,
    saltNonce: 0n,
  };
  for (const [input, changed] of [
    ["factory", { factory: addr(2) }],
    ["mastercopy", { mastercopy: addr(2) }],
    [
      "setup args",
      { setupArgs: { ...setupArgs, values: [addr(13), addr(11), addr(12)] } },
    ],
    ["saltNonce", { saltNonce: 1n }],
  ] as const) {
    it(`changes with ${input}`, () => {
      assert.notEqual(
        predictProxyAddress({ ...base, ...changed }),
        predictProxyAddress(base)
      );
    });
  }

  it("gives the same result for bigint, number and string saltNonces", () => {
    const results = [12n, 12, "12", "0xc"].map((saltNonce) =>
      predictProxyAddress({ ...base, saltNonce })
    );
    assert.deepEqual(new Set(results).size, 1);
  });

  it("gives the same result for any valid mastercopy casing", () => {
    const mastercopy = getAddress("0x5fbdb2315678afecb367f032d93f642f64180aa3");
    const results = [mastercopy, mastercopy.toLowerCase() as `0x${string}`].map(
      (m) => predictProxyAddress({ ...base, mastercopy: m })
    );
    assert.equal(results[0], results[1]);
  });

  for (const [label, params] of [
    [
      "invalid mastercopy",
      { ...base, mastercopy: "0x5FbDB2315678afecb367f032d93F642f64180aa4" },
    ],
    ["non-numeric saltNonce", { ...base, saltNonce: "salt" }],
  ] as const) {
    it(`throws on ${label}`, () => {
      assert.throws(() =>
        predictProxyAddress(params as Parameters<typeof predictProxyAddress>[0])
      );
    });
  }
});

describe("predictSingletonAddress", () => {
  const salt = keccak256(toHex("singleton"));
  const constructorArgs = {
    types: ["address", "address", "address"],
    values: [addr(1), addr(2), addr(3)],
  };

  for (const [label, factory] of [
    ["ERC-2470 (default)", undefined],
    ["Nick's factory", nickFactory],
  ] as const) {
    it(`matches the address ${label} deploys to`, async () => {
      await loadFixture(setup);
      const params = {
        factory,
        bytecode: TestModule.bytecode,
        constructorArgs,
        salt,
      };
      const predicted = predictSingletonAddress(params);
      assert.equal(await hasCode(predicted), false);
      await owner.sendTransaction(encodeDeploySingleton(params));
      assert.equal(await hasCode(predicted), true);
      assert.equal(
        await chain.getContractAt("TestModule", predicted).read.owner(),
        addr(1)
      );
    });
  }

  const base = {
    factory: erc2470Factory,
    bytecode: TestModule.bytecode,
    constructorArgs,
    salt,
  };
  for (const [input, changed] of [
    ["factory", { factory: nickFactory }],
    ["salt", { salt: keccak256(toHex("other")) }],
    ["bytecode", { bytecode: `${TestModule.bytecode}00` }],
    [
      "constructor args",
      {
        constructorArgs: {
          ...constructorArgs,
          values: [addr(4), addr(2), addr(3)],
        },
      },
    ],
  ] as const) {
    it(`changes with ${input}`, () => {
      assert.notEqual(
        predictSingletonAddress({ ...base, ...changed } as typeof base),
        predictSingletonAddress(base)
      );
    });
  }
});

describe("creationBytecode", () => {
  it("returns the bytecode unchanged without constructor args", () => {
    assert.equal(
      creationBytecode({
        bytecode: "0x6001",
        constructorArgs: { types: [], values: [] },
      }),
      "0x6001"
    );
  });

  it("appends the ABI-encoded constructor args", () => {
    const constructorArgs = {
      types: ["address", "uint256"],
      values: [addr(1), 2n],
    };
    assert.equal(
      creationBytecode({ bytecode: "0x6001", constructorArgs }),
      `0x6001${encodeArgs(constructorArgs).slice(2)}`
    );
  });
});
