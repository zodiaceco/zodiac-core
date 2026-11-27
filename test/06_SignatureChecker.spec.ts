import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { startChain } from "./helpers/chain";
import { concat, size, zeroAddress, type Address, type Hex } from "viem";

import { salt, signModuleTx, type ModuleTx } from "./helpers/moduleTx";

const chain = await startChain();
const { deployContract, getContractAt, loadFixture, assertions } = chain;

describe("SignatureChecker", () => {
  after(async () => {
    await chain.stop();
  });

  async function setup() {
    const [signer, relayer] = chain.walletClients;
    const deployed = await deployContract("TestSignature");
    const testSignature = await getContractAt(
      "TestSignature",
      deployed.address,
      { client: { wallet: relayer } }
    );

    return { testSignature, signer, relayer };
  }

  type TestSignature = Awaited<ReturnType<typeof setup>>["testSignature"];

  function moduleTx(overrides: Partial<ModuleTx> = {}): ModuleTx {
    return {
      to: "0x0000000000000000000000000000000000000099",
      value: 0n,
      data: "0x",
      operation: 0,
      ...overrides,
    };
  }

  /**
   * Relays `check` for `tx` and `signature` and asserts which signer the
   * contract recovered.
   */
  async function expectRecovered(
    testSignature: TestSignature,
    tx: ModuleTx,
    txSalt: Hex,
    signature: Hex,
    expected: Address
  ) {
    await assertions.emitWithArgs(
      testSignature.write.check([
        tx.to,
        tx.value,
        tx.data,
        tx.operation,
        txSalt,
        signature,
      ]),
      testSignature,
      "Recovered",
      [expected]
    );
  }

  it("recovers an EOA signature", async () => {
    const { testSignature, signer } = await loadFixture(setup);

    const tx = moduleTx();
    const txSalt = salt("hello salt");
    const sig = await signModuleTx(signer, testSignature.address, tx, txSalt);

    await expectRecovered(testSignature, tx, txSalt, "0x", zeroAddress);
    await expectRecovered(
      testSignature,
      tx,
      txSalt,
      sig,
      signer.account.address
    );
  });

  it("recovers a signature over non-trivial ModuleTx fields", async () => {
    const { testSignature, signer } = await loadFixture(setup);

    const tx = moduleTx({
      to: "0x000000000000000000000000000000000000dEaD",
      value: 12345n,
      data: "0xbadfed",
      operation: 1,
    });
    const txSalt = salt("nontrivial");
    const sig = await signModuleTx(signer, testSignature.address, tx, txSalt);

    await expectRecovered(
      testSignature,
      tx,
      txSalt,
      sig,
      signer.account.address
    );
  });

  describe("contract signature", () => {
    const defaultSalt = salt("default salt");

    function makeContractSignature(
      signerSpecificSignature: Hex,
      signer: Address
    ): Hex {
      return concat([signer, signerSpecificSignature]);
    }

    it("uses the first 20 bytes as ERC1271 signer", async () => {
      const { testSignature } = await loadFixture(setup);

      const { address: signer } = await deployContract("ContractSignerYes");

      const tx = moduleTx();

      const sigUnknown = makeContractSignature(
        "0xdddddd",
        "0x1234567890000000000000000000000123456789"
      );
      const sigKnown = makeContractSignature("0xdddddd", signer);

      await expectRecovered(
        testSignature,
        tx,
        defaultSalt,
        sigUnknown,
        zeroAddress
      );
      await expectRecovered(testSignature, tx, defaultSalt, sigKnown, signer);
    });

    it("signer returns isValid maybe", async () => {
      const { testSignature } = await loadFixture(setup);

      const { address: signer } = await deployContract("ContractSignerMaybe");

      const tx = moduleTx();
      const sigGood = makeContractSignature("0x001122334455", signer);
      const sigBad = makeContractSignature("0x00112233445566", signer);

      await expectRecovered(testSignature, tx, defaultSalt, sigGood, signer);
      await expectRecovered(
        testSignature,
        tx,
        defaultSalt,
        sigBad,
        zeroAddress
      );
    });

    it("signer returns isValid yes", async () => {
      const { testSignature } = await loadFixture(setup);

      const { address: signer } = await deployContract("ContractSignerYes");

      const sig = makeContractSignature("0xaabbccddeeff", signer);
      await expectRecovered(
        testSignature,
        moduleTx(),
        defaultSalt,
        sig,
        signer
      );
    });

    it("signer returns isValid no", async () => {
      const { testSignature } = await loadFixture(setup);

      const { address: signer } = await deployContract("ContractSignerNo");

      const sig = makeContractSignature("0xaabbccddeeff", signer);
      await expectRecovered(
        testSignature,
        moduleTx(),
        defaultSalt,
        sig,
        zeroAddress
      );
    });

    it("signer returns isValid for empty specific signature only", async () => {
      const { testSignature } = await loadFixture(setup);

      const { address: signer } = await deployContract(
        "ContractSignerOnlyEmpty"
      );

      const tx = moduleTx();
      const sigGood = makeContractSignature("0x", signer);
      const sigBad = makeContractSignature("0xffff", signer);

      await expectRecovered(testSignature, tx, defaultSalt, sigGood, signer);
      await expectRecovered(
        testSignature,
        tx,
        defaultSalt,
        sigBad,
        zeroAddress
      );
    });

    it("supports empty ERC1271 contract signatures", async () => {
      const { testSignature } = await loadFixture(setup);

      const { address: signer } = await deployContract(
        "ContractSignerOnlyEmpty"
      );

      const sig = makeContractSignature("0x", signer);
      assert.equal(size(sig), 20);

      await expectRecovered(
        testSignature,
        moduleTx(),
        defaultSalt,
        sig,
        signer
      );
    });

    it("signer bad return size", async () => {
      const { testSignature } = await loadFixture(setup);

      const { address: signer } = await deployContract(
        "ContractSignerReturnSize"
      );

      const sig = makeContractSignature("0xaabbccddeeff", signer);
      await expectRecovered(
        testSignature,
        moduleTx(),
        defaultSalt,
        sig,
        zeroAddress
      );
    });

    it("signer with faulty entrypoint", async () => {
      const { testSignature } = await loadFixture(setup);

      const { address: signer } = await deployContract("ContractSignerFaulty");

      const sig = makeContractSignature("0xaabbccddeeff", signer);
      await expectRecovered(
        testSignature,
        moduleTx(),
        defaultSalt,
        sig,
        zeroAddress
      );
    });

    it("signer with no code deployed", async () => {
      const { testSignature } = await loadFixture(setup);
      const publicClient = chain.publicClient;

      const signerAddress = "0x1234567890000000000000000000000123456789";
      assert.equal(
        await publicClient.getCode({ address: signerAddress }),
        undefined
      );

      const sig = makeContractSignature("0xaabbccddeeff", signerAddress);
      await expectRecovered(
        testSignature,
        moduleTx(),
        defaultSalt,
        sig,
        zeroAddress
      );
    });
  });
});
