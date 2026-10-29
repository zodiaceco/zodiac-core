import { expect } from "chai";
import { AbiCoder, Contract, getBytes, keccak256, ZeroHash } from "ethers";

import { network } from "hardhat";

import {
  address as moduleSetupFactoryAddress,
  predictModuleAddress,
} from "../src/factory/moduleSetupFactory";
import { address as moduleProxyFactoryAddress } from "../src/factory/proxyFactory";
import { deployFactories } from "../src/tooling";
import createEIP1193 from "./createEIP1193";

const connection = await network.create();
const { ethers } = connection;

const AddressOne = "0x0000000000000000000000000000000000000001";
const saltNonce = keccak256("0x7255");

function deploymentNonce(
  initializer: string,
  setupCalls: string[],
  salt = saltNonce
) {
  const coder = AbiCoder.defaultAbiCoder();
  return keccak256(
    coder.encode(
      ["bytes32", "bytes32", "bytes32"],
      [
        keccak256(initializer),
        keccak256(coder.encode(["bytes[]"], [setupCalls])),
        salt,
      ]
    )
  );
}

describe("ModuleSetupFactory", () => {
  after(async () => {
    await connection.close();
  });

  let factory: Contract;
  let factoryAddress: string;
  let moduleProxyFactory: Contract;

  beforeEach(async () => {
    const [signer] = await ethers.getSigners();
    await deployFactories({
      provider: createEIP1193(connection.provider, signer),
    });
    moduleProxyFactory = await ethers.getContractAt(
      "ModuleProxyFactory",
      moduleProxyFactoryAddress
    );

    factory = await ethers.getContractAt(
      "ModuleSetupFactory",
      moduleSetupFactoryAddress
    );
    factoryAddress = moduleSetupFactoryAddress;
  });

  describe("createAndSetupModule", () => {
    let mastercopy: Contract;
    let avatar: string;
    let finalOwner: string;
    let target: string;
    let initializer: string;
    let setupCalls: string[];

    function encodeInitializer(owner: string) {
      return mastercopy.interface.encodeFunctionData("setUp", [
        AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "address"],
          [owner, avatar, avatar]
        ),
      ]);
    }

    beforeEach(async () => {
      const [, owner, otherTarget] = await ethers.getSigners();
      finalOwner = owner.address;
      target = otherTarget.address;

      const Avatar = await ethers.getContractFactory("TestAvatar");
      avatar = await (await Avatar.deploy()).getAddress();

      const Module = await ethers.getContractFactory("TestOwnableModule");
      mastercopy = await Module.deploy(avatar, avatar, avatar);

      initializer = encodeInitializer(finalOwner);
      setupCalls = [
        mastercopy.interface.encodeFunctionData("setTarget", [target]),
      ];
    });

    async function args(
      calls = setupCalls,
      salt = saltNonce,
      init = initializer
    ) {
      return [await mastercopy.getAddress(), init, calls, salt] as const;
    }

    async function predict(
      calls = setupCalls,
      salt = saltNonce,
      init = initializer
    ) {
      return predictModuleAddress({
        mastercopy: await mastercopy.getAddress(),
        initializer: init,
        setupCalls: calls,
        saltNonce: salt,
      });
    }

    function patchedInitializer() {
      return encodeInitializer(factoryAddress);
    }

    it("deploys through the ModuleProxyFactory, configures and hands over the module", async () => {
      const expected = await predict();

      const tx = factory.createAndSetupModule(...(await args()));
      await expect(tx)
        .to.emit(moduleProxyFactory, "ModuleProxyCreation")
        .withArgs(expected, await mastercopy.getAddress());
      await expect(tx)
        .to.emit(factory, "ModuleSetup")
        .withArgs(expected, await mastercopy.getAddress(), saltNonce);

      const module = await ethers.getContractAt("TestOwnableModule", expected);
      expect(await module.owner()).to.equal(finalOwner);
      expect(await module.avatar()).to.equal(avatar);
      expect(await module.getFunction("target")()).to.equal(target);
    });

    it("does not mutate byte-array initializers when predicting addresses", async () => {
      const bytesInitializer = getBytes(initializer);
      const original = bytesInitializer.slice();
      const mastercopyAddress = await mastercopy.getAddress();
      const params = {
        mastercopy: mastercopyAddress,
        initializer: bytesInitializer,
        setupCalls,
        saltNonce,
      };

      const expected = predictModuleAddress(params);
      expect(bytesInitializer).to.deep.equal(original);
      expect(predictModuleAddress(params)).to.equal(expected);

      await factory.createAndSetupModule(
        mastercopyAddress,
        bytesInitializer,
        setupCalls,
        saltNonce
      );
      const module = await ethers.getContractAt("TestOwnableModule", expected);
      expect(await module.owner()).to.equal(finalOwner);
    });

    it("can be relayed by anyone", async () => {
      const [, , , relayer] = await ethers.getSigners();

      await (factory.connect(relayer) as Contract).createAndSetupModule(
        ...(await args())
      );

      const module = await ethers.getContractAt(
        "TestOwnableModule",
        await predict()
      );
      expect(await module.owner()).to.equal(finalOwner);
    });

    it("reverts when the module was already set up", async () => {
      await factory.createAndSetupModule(...(await args()));

      await expect(factory.createAndSetupModule(...(await args())))
        .to.be.revertedWithCustomError(factory, "AlreadyInitialized")
        .withArgs(await predict());
    });

    it("does not replay the setup calls once the owner changed the module", async () => {
      const [, owner, , other] = await ethers.getSigners();
      await factory.createAndSetupModule(...(await args()));
      const module = await ethers.getContractAt(
        "TestOwnableModule",
        await predict()
      );

      await (module.connect(owner) as Contract).setTarget(other.address);
      await expect(
        factory.createAndSetupModule(...(await args()))
      ).to.be.revertedWithCustomError(factory, "AlreadyInitialized");

      expect(await module.getFunction("target")()).to.equal(other.address);
      expect(await module.owner()).to.equal(finalOwner);
    });

    it("completes a module that was deployed straight through the ModuleProxyFactory", async () => {
      await moduleProxyFactory.deployModule(
        await mastercopy.getAddress(),
        patchedInitializer(),
        deploymentNonce(initializer, setupCalls)
      );
      const module = await ethers.getContractAt(
        "TestOwnableModule",
        await predict()
      );
      expect(await module.owner()).to.equal(factoryAddress);

      await expect(factory.createAndSetupModule(...(await args()))).to.emit(
        factory,
        "ModuleSetup"
      );

      expect(await module.owner()).to.equal(finalOwner);
      expect(await module.getFunction("target")()).to.equal(target);
    });

    it("does not let a front-runner take the address with different setup calls", async () => {
      const [, , , attacker] = await ethers.getSigners();
      const hijack = [
        mastercopy.interface.encodeFunctionData("setTarget", [
          attacker.address,
        ]),
      ];

      await factory.createAndSetupModule(...(await args(hijack)));
      await factory.createAndSetupModule(...(await args()));

      expect(await predict(hijack)).not.to.equal(await predict());
      const module = await ethers.getContractAt(
        "TestOwnableModule",
        await predict()
      );
      expect(await module.owner()).to.equal(finalOwner);
      expect(await module.getFunction("target")()).to.equal(target);
    });

    it("does not let a front-runner take the address with a different owner", async () => {
      const [, , , attacker] = await ethers.getSigners();
      const hijack = encodeInitializer(attacker.address);

      await factory.createAndSetupModule(
        ...(await args(setupCalls, saltNonce, hijack))
      );
      await factory.createAndSetupModule(...(await args()));

      expect(await predict(setupCalls, saltNonce, hijack)).not.to.equal(
        await predict()
      );
      const module = await ethers.getContractAt(
        "TestOwnableModule",
        await predict()
      );
      expect(await module.owner()).to.equal(finalOwner);
    });

    it("deploys a distinct module per saltNonce", async () => {
      expect(await predict(setupCalls, ZeroHash)).not.to.equal(await predict());
    });

    it("reverts when a setup call gives ownership away", async () => {
      const calls = [
        mastercopy.interface.encodeFunctionData("transferOwnership", [target]),
      ];

      await expect(factory.createAndSetupModule(...(await args(calls))))
        .to.be.revertedWithCustomError(mastercopy, "OwnableUnauthorizedAccount")
        .withArgs(factoryAddress);
    });

    it("rejects an initializer that is not setUp(bytes)", async () => {
      const notSetUp = mastercopy.interface.encodeFunctionData("setTarget", [
        target,
      ]);

      await expect(
        factory.createAndSetupModule(
          ...(await args(setupCalls, saltNonce, notSetUp))
        )
      ).to.be.revertedWithCustomError(factory, "InvalidInitializer");
    });

    it("rejects an initializer shorter than a selector and three words", async () => {
      const noOwner = mastercopy.interface.encodeFunctionData("setUp", ["0x"]);

      await expect(
        factory.createAndSetupModule(
          ...(await args(setupCalls, saltNonce, noOwner))
        )
      ).to.be.revertedWithCustomError(factory, "InvalidInitializer");
    });

    it("rejects itself as the final owner", async () => {
      await expect(
        factory.createAndSetupModule(
          ...(await args(setupCalls, saltNonce, patchedInitializer()))
        )
      ).to.be.revertedWithCustomError(factory, "InvalidInitializer");
    });

    it("reverts with the index of the failing setup call", async () => {
      const calls = [...setupCalls, failingCall()];

      await expect(factory.createAndSetupModule(...(await args(calls))))
        .to.be.revertedWithCustomError(factory, "SetupCallFailed")
        .withArgs(1, (reason: string) => reason.length > 2);
    });

    it("leaves nothing deployed when a setup call fails", async () => {
      const calls = [...setupCalls, failingCall()];

      await expect(
        factory.createAndSetupModule(...(await args(calls)))
      ).to.be.revertedWithCustomError(factory, "SetupCallFailed");

      expect(await ethers.provider.getCode(await predict(calls))).to.equal(
        "0x"
      );
    });

    function failingCall() {
      return mastercopy.interface.encodeFunctionData("setUp", [
        AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "address"],
          [finalOwner, avatar, avatar]
        ),
      ]);
    }

    it("reverts when the mastercopy has no code", async () => {
      await expect(
        factory.createAndSetupModule(
          AddressOne,
          initializer,
          setupCalls,
          saltNonce
        )
      )
        .to.be.revertedWithCustomError(moduleProxyFactory, "TargetHasNoCode")
        .withArgs(AddressOne);
    });
  });
});
