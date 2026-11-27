import { numberToHex, type Address, type Hex } from "viem";
import {
  funding as nickFunding,
  deployer as nickDeployer,
  address as nickFactoryAddress,
  signedDeployTransaction as nickSignedDeployTransaction,
} from "../factory/nickFactory.js";

import {
  funding as erc2470Funding,
  deployer as erc2470Deployer,
  address as erc2470FactoryAddress,
  signedDeployTransaction as erc2470SignedDeployTransaction,
} from "../factory/erc2470Factory.js";

import {
  bytecode as proxyFactoryBytecode,
  salt as proxyFactorySalt,
} from "../factory/proxyFactory.js";

import deployMastercopy from "./deployMastercopy.js";
import waitForTransaction from "./waitForTransaction.js";

import { EIP1193Provider } from "../types.js";

/**
 * Deploys Nick's factory, the ERC-2470 factory, and the ModuleProxyFactory on
 * the target network if not already present. Mostly useful for local/test setups.
 *
 * @param params.provider - EIP-1193 provider to send deployment transactions.
 */
export default async function ({
  provider,
}: {
  provider: EIP1193Provider;
}): Promise<void> {
  await deployKnownFactory({
    funding: nickFunding,
    deployer: nickDeployer,
    signedTransaction: nickSignedDeployTransaction,
    factoryAddress: nickFactoryAddress,
    provider,
  });

  await deployKnownFactory({
    funding: erc2470Funding,
    deployer: erc2470Deployer,
    signedTransaction: erc2470SignedDeployTransaction,
    factoryAddress: erc2470FactoryAddress,
    provider,
  });

  await deployMastercopy({
    bytecode: proxyFactoryBytecode,
    constructorArgs: { types: [], values: [] },
    salt: proxyFactorySalt,
    provider,
  });
}

/**
 * Deploys a presigned factory contract if not already present, funding its
 * deployer first if needed.
 *
 * @throws If the factory bytecode is not found after deployment.
 */
async function deployKnownFactory({
  funding,
  deployer,
  signedTransaction,
  factoryAddress,
  provider,
}: {
  funding: bigint;
  deployer: Address;
  signedTransaction: Hex;
  factoryAddress: Address;
  provider: EIP1193Provider;
}): Promise<void> {
  // Check if the factory contract is already deployed
  {
    const code = await provider.request({
      method: "eth_getCode",
      params: [factoryAddress, "latest"],
    });

    if (code != "0x") {
      return;
    }
  }

  // Send funding to the deployer address
  {
    const balance = (await provider.request({
      method: "eth_getBalance",
      params: [deployer, "latest"],
    })) as string;
    const missingFunds = funding - BigInt(balance || 0);
    if (missingFunds > 0) {
      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [{ to: deployer, value: numberToHex(missingFunds) }],
      })) as Hex;
      await waitForTransaction(hash, provider);
    }
  }

  // Send the signed deploy transaction
  {
    const hash = (await provider.request({
      method: "eth_sendRawTransaction",
      params: [signedTransaction],
    })) as Hex;
    await waitForTransaction(hash, provider);
  }

  // Verify that the factory contract is deployed
  {
    const code = await provider.request({
      method: "eth_getCode",
      params: [factoryAddress, "latest"],
    });
    if (code == "0x") {
      throw new Error("Bytecode for Factory not found after deployment");
    }
  }
}
