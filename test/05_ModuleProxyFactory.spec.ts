import assert from "node:assert/strict";
import { beforeEach, after, describe, it } from "node:test";

import { startChain } from "./helpers/chain";
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

const chain = await startChain();
const { deployContract, getContractAt, assertions } = chain;

describe("ModuleProxyFactory", () => {
  after(async () => {
    await chain.stop();
  });

  const AddressOne = "0x0000000000000000000000000000000000000001";
  const saltNonce = 0x7255n;

  let moduleFactory: Awaited<ReturnType<typeof deployFactory>>;
  let moduleMasterCopy: Awaited<ReturnType<typeof deployMastercopy>>;
  let avatarAddress: `0x${string}`;
  let initData: Hex;
  let setupArgs: { types: string[]; values: unknown[] };

  function deployFactory() {
    return deployContract("ModuleProxyFactory");
  }

  function deployMastercopy(avatar: `0x${string}`) {
    return deployContract("TestModule", [avatar, avatar]);
  }

  async function createdProxy(hash: Hash | Promise<Hash>) {
    const publicClient = chain.publicClient;
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
    const avatar = await deployContract("TestAvatar");
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
      await assertions.revertWithCustomErrorWithArgs(
        moduleFactory.write.deployModule([zeroAddress, initData, saltNonce]),
        moduleFactory,
        "ZeroAddress",
        [zeroAddress]
      );
    });

    it("should fail to deploy module because target has no code deployed", async () => {
      await assertions.revertWithCustomErrorWithArgs(
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

      await assertions.revertWithCustomErrorWithArgs(
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

      const newModule = await getContractAt("TestModule", moduleAddress);
      assert.equal(await newModule.read.avatar(), avatarAddress);
    });

    it("should emit event on module deployment", async () => {
      const moduleAddress = predictProxyAddress({
        factory: moduleFactory.address,
        mastercopy: moduleMasterCopy.address,
        setupArgs,
        saltNonce,
      });
      await assertions.emitWithArgs(
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
      await assertions.revertWithCustomError(
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
