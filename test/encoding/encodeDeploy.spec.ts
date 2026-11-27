import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  concat,
  decodeFunctionData,
  getAddress,
  getContractAddress,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  toHex,
  type Hex,
} from "viem";

import encodeDeployProxy from "../../src/encoding/encodeDeployProxy";
import encodeDeploySingleton from "../../src/encoding/encodeDeploySingleton";
import { encodeArgs, encodeSetUp } from "../../src/encoding/encodeArgs";
import * as erc2470 from "../../src/factory/erc2470Factory";
import * as nick from "../../src/factory/nickFactory";
import * as proxyFactory from "../../src/factory/proxyFactory";
import { addr } from "../helpers/constants";

const setupArgs = { types: ["address", "uint256"], values: [addr(1), 2n] };
const bytecode: Hex = "0x6080604052";
const salt = keccak256(toHex("salt"));
const noArgs = { types: [], values: [] };

describe("encodeDeployProxy", () => {
  for (const [label, factory, expected] of [
    ["canonical factory (default)", undefined, proxyFactory.address],
    ["custom factory", addr(9), addr(9)],
  ] as const) {
    it(`targets ${label}`, () => {
      const { to } = encodeDeployProxy({
        factory,
        mastercopy: addr(2),
        setupArgs,
        saltNonce: 0n,
      });
      assert.equal(to, expected);
    });
  }

  it("encodes deployModule(mastercopy, setUp calldata, saltNonce)", () => {
    const { data } = encodeDeployProxy({
      mastercopy: addr(2),
      setupArgs,
      saltNonce: 3n,
    });
    const { functionName, args } = decodeFunctionData({
      abi: proxyFactory.abi,
      data,
    });
    assert.equal(functionName, "deployModule");
    assert.deepEqual(args, [addr(2), encodeSetUp(setupArgs), 3n]);
  });

  it("accepts bigint, number and string saltNonces", () => {
    const encoded = [5n, 5, "5"].map(
      (saltNonce) =>
        encodeDeployProxy({ mastercopy: addr(2), setupArgs, saltNonce }).data
    );
    assert.equal(new Set(encoded).size, 1);
  });
});

describe("encodeDeploySingleton", () => {
  const decode2470 = (data: Hex) =>
    decodeFunctionData({ abi: erc2470.abi, data });

  it("defaults to the ERC-2470 factory, encoding deploy(creationBytecode, salt)", () => {
    const { to, data } = encodeDeploySingleton({
      bytecode,
      constructorArgs: noArgs,
      salt,
    });
    assert.equal(to, erc2470.address);
    const { functionName, args } = decode2470(data);
    assert.equal(functionName, "deploy");
    assert.deepEqual(args, [bytecode, salt]);
  });

  it("uses raw salt ‖ creationBytecode calldata for Nick's factory", () => {
    const tx = encodeDeploySingleton({
      factory: nick.address,
      bytecode,
      constructorArgs: noArgs,
      salt,
    });
    assert.deepEqual(tx, { to: nick.address, data: concat([salt, bytecode]) });
  });

  it("recognises Nick's factory in any address casing", () => {
    const casings = [
      nick.address.toLowerCase(),
      getAddress(nick.address),
      `0x${nick.address.slice(2).toUpperCase()}`,
    ];
    for (const factory of casings) {
      const { data } = encodeDeploySingleton({
        factory: factory as `0x${string}`,
        bytecode,
        constructorArgs: noArgs,
        salt,
      });
      assert.equal(data, concat([salt, bytecode]), factory);
    }
  });

  it("uses the ERC-2470 encoding for any other factory", () => {
    const { to, data } = encodeDeploySingleton({
      factory: addr(9),
      bytecode,
      constructorArgs: noArgs,
      salt,
    });
    assert.equal(to, addr(9));
    assert.deepEqual(decode2470(data).args, [bytecode, salt]);
  });

  for (const [label, factory] of [
    ["ERC-2470", erc2470.address],
    ["Nick's factory", nick.address],
  ] as const) {
    it(`appends constructor args to the bytecode (${label})`, () => {
      const { data } = encodeDeploySingleton({
        factory,
        bytecode,
        constructorArgs: setupArgs,
        salt,
      });
      const creation = concat([bytecode, encodeArgs(setupArgs)]);
      if (factory === nick.address) {
        assert.equal(data, concat([salt, creation]));
      } else {
        assert.deepEqual(decode2470(data).args, [creation, salt]);
      }
    });
  }
});

describe("factory constants", () => {
  it("derives the ModuleProxyFactory address from the ERC-2470 factory, salt and bytecode", () => {
    const derived = getContractAddress({
      opcode: "CREATE2",
      from: erc2470.address,
      salt: proxyFactory.salt,
      bytecode: proxyFactory.bytecode,
    });
    assert.equal(proxyFactory.address, derived);
    // The address Zodiac's ModuleProxyFactory is deployed at on every chain.
    assert.equal(derived, "0x000000000000aDdB49795b0f9bA5BC298cDda236");
  });

  for (const [label, factory] of [
    ["Nick's factory", nick],
    ["ERC-2470", erc2470],
  ] as const) {
    it(`recovers the documented deployer from the ${label} presigned transaction`, async () => {
      const deployer = await recoverTransactionAddress({
        serializedTransaction: factory.signedDeployTransaction as any,
      });
      assert.equal(deployer, getAddress(factory.deployer));
      // A contract creation, replayable on any chain.
      const tx = parseTransaction(factory.signedDeployTransaction);
      assert.equal(tx.to, undefined);
      assert.equal(tx.chainId, undefined);
    });

    it(`funds the ${label} deployer with at least gasPrice × gasLimit`, () => {
      const { gas, gasPrice } = parseTransaction(
        factory.signedDeployTransaction
      );
      assert.ok(factory.funding >= gas! * gasPrice!);
    });
  }
});
