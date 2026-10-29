import { expect } from "chai";

import { network } from "hardhat";

import { address as erc2470FactoryAddress } from "../src/factory/erc2470Factory";
import { address as moduleFactoryAddress } from "../src/factory/proxyFactory";
import { address as nickFactoryAddress } from "../src/factory/nickFactory";
import { address as moduleSetupFactoryAddress } from "../src/factory/moduleSetupFactory";

import { deployFactories } from "../src/tooling";

import createEIP1193 from "./createEIP1193";

const connection = await network.create();
const { ethers, networkHelpers, provider: hardhatProvider } = connection;
const { loadFixture } = networkHelpers;

async function setup() {
  // loadFixture snapshots & restores; nothing else needed
}

describe("deployFactories", () => {
  after(async () => {
    await connection.close();
  });

  it("Deploys all factories on an empty network", async () => {
    await loadFixture(setup);

    const [signer] = await ethers.getSigners();
    const provider = signer.provider!;

    expect(await provider.getCode(nickFactoryAddress)).to.equal("0x");
    expect(await provider.getCode(erc2470FactoryAddress)).to.equal("0x");
    expect(await provider.getCode(moduleFactoryAddress)).to.equal("0x");
    expect(await provider.getCode(moduleSetupFactoryAddress)).to.equal("0x");

    await deployFactories({
      provider: createEIP1193(hardhatProvider, signer),
    });

    expect(await provider.getCode(nickFactoryAddress)).to.not.equal("0x");
    expect(await provider.getCode(erc2470FactoryAddress)).to.not.equal("0x");
    expect(await provider.getCode(moduleFactoryAddress)).to.not.equal("0x");
    expect(await provider.getCode(moduleSetupFactoryAddress)).to.not.equal(
      "0x"
    );
  });

  it("Does nothing if all factories exist", async () => {
    await loadFixture(setup);
    const [signer] = await ethers.getSigners();
    const provider = signer.provider!;

    expect(await provider.getCode(nickFactoryAddress)).to.equal("0x");
    expect(await provider.getCode(erc2470FactoryAddress)).to.equal("0x");
    expect(await provider.getCode(moduleFactoryAddress)).to.equal("0x");
    expect(await provider.getCode(moduleSetupFactoryAddress)).to.equal("0x");

    await deployFactories({
      provider: createEIP1193(hardhatProvider, signer),
    });

    expect(await provider.getCode(nickFactoryAddress)).to.not.equal("0x");
    expect(await provider.getCode(erc2470FactoryAddress)).to.not.equal("0x");
    expect(await provider.getCode(moduleFactoryAddress)).to.not.equal("0x");
    expect(await provider.getCode(moduleSetupFactoryAddress)).to.not.equal(
      "0x"
    );

    await deployFactories({
      provider: createEIP1193(hardhatProvider, signer),
    });

    expect(await provider.getCode(nickFactoryAddress)).to.not.equal("0x");
    expect(await provider.getCode(erc2470FactoryAddress)).to.not.equal("0x");
    expect(await provider.getCode(moduleFactoryAddress)).to.not.equal("0x");
    expect(await provider.getCode(moduleSetupFactoryAddress)).to.not.equal(
      "0x"
    );
  });
});
