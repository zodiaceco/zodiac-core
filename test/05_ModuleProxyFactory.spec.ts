import assert from "node:assert/strict";
import { beforeEach, after, describe, it } from "node:test";

import { network } from "hardhat";
import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  parseAbiParameters,
  parseEventLogs,
  zeroAddress,
  type Hash,
  type Hex,
} from "viem";

import { predictProxyAddress } from "../src/index";

const connection = await network.create();
const { viem } = connection;

describe("ModuleProxyFactory", () => {
  after(async () => {
    await connection.close();
  });

  const AddressOne = "0x0000000000000000000000000000000000000001";
  const saltNonce = 0x7255n;

  let moduleFactory: Awaited<ReturnType<typeof deployFactory>>;
  let moduleMasterCopy: Awaited<ReturnType<typeof deployMastercopy>>;
  let avatarAddress: `0x${string}`;
  let initData: Hex;
  let setupArgs: { types: string[]; values: unknown[] };

  function deployFactory() {
    return viem.deployContract("ModuleProxyFactory");
  }

  function deployMastercopy(avatar: `0x${string}`) {
    return viem.deployContract("TestModule", [avatar, avatar]);
  }

  async function createdProxy(hash: Hash | Promise<Hash>) {
    const publicClient = await viem.getPublicClient();
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: await hash,
    });
    const [event] = parseEventLogs({
      abi: moduleFactory.abi,
      logs: receipt.logs,
      eventName: "ModuleProxyCreation",
    });
    return event.args.proxy;
  }

  beforeEach(async () => {
    const avatar = await viem.deployContract("TestAvatar");
    moduleFactory = await deployFactory();
    moduleMasterCopy = await deployMastercopy(avatar.address);

    initData = encodeFunctionData({
      abi: moduleMasterCopy.abi,
      functionName: "setUp",
      args: [
        encodeAbiParameters(parseAbiParameters("address, address"), [
          avatar.address,
          avatar.address,
        ]),
      ],
    });
    setupArgs = {
      types: ["address", "address"],
      values: [avatar.address, avatar.address],
    };
    avatarAddress = getAddress(avatar.address);
  });

  describe("createProxy", () => {
    it("should deploy the expected address", async () => {
      const expectedAddress = predictProxyAddress({
        factory: moduleFactory.address,
        mastercopy: moduleMasterCopy.address,
        setupArgs,
        saltNonce,
      });

      const actualAddress = await createdProxy(
        moduleFactory.write.deployModule([
          moduleMasterCopy.address,
          initData,
          saltNonce,
        ])
      );

      assert.equal(actualAddress, expectedAddress);
    });

    it("should fail to deploy module because address is zero", async () => {
      await viem.assertions.revertWithCustomErrorWithArgs(
        moduleFactory.write.deployModule([zeroAddress, initData, saltNonce]),
        moduleFactory,
        "ZeroAddress",
        [zeroAddress]
      );
    });

    it("should fail to deploy module because target has no code deployed", async () => {
      await viem.assertions.revertWithCustomErrorWithArgs(
        moduleFactory.write.deployModule([AddressOne, initData, saltNonce]),
        moduleFactory,
        "TargetHasNoCode",
        [AddressOne]
      );
    });

    it("should fail to deploy because address is already taken", async () => {
      await moduleFactory.write.deployModule([
        moduleMasterCopy.address,
        initData,
        saltNonce,
      ]);

      await viem.assertions.revertWithCustomErrorWithArgs(
        moduleFactory.write.deployModule([
          moduleMasterCopy.address,
          initData,
          saltNonce,
        ]),
        moduleFactory,
        "TakenAddress",
        [zeroAddress]
      );
    });
  });

  describe("deployModule", () => {
    it("should deploy module", async () => {
      const moduleAddress = await createdProxy(
        moduleFactory.write.deployModule([
          moduleMasterCopy.address,
          initData,
          saltNonce,
        ])
      );

      const newModule = await viem.getContractAt("TestModule", moduleAddress);
      assert.equal(await newModule.read.avatar(), avatarAddress);
    });

    it("should emit event on module deployment", async () => {
      const moduleAddress = predictProxyAddress({
        factory: moduleFactory.address,
        mastercopy: moduleMasterCopy.address,
        setupArgs,
        saltNonce,
      });
      await viem.assertions.emitWithArgs(
        moduleFactory.write.deployModule([
          moduleMasterCopy.address,
          initData,
          saltNonce,
        ]),
        moduleFactory,
        "ModuleProxyCreation",
        [moduleAddress, moduleMasterCopy.address]
      );
    });

    it("should fail to deploy because parameters are not valid", async () => {
      await viem.assertions.revertWithCustomError(
        moduleFactory.write.deployModule([
          moduleMasterCopy.address,
          "0xaabc",
          saltNonce,
        ]),
        moduleFactory,
        "FailedInitialization"
      );
    });
  });
});
