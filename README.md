# Zodiac-Core

[![Build Status](https://github.com/gnosisguild/zodiac/workflows/zodiac/badge.svg?branch=master)](https://github.com/gnosisguild/zodiac/actions?branch=master)
[![Coverage Status](https://coveralls.io/repos/github/gnosis/zodiac/badge.svg?branch=master)](https://coveralls.io/github/gnosisguild/zodiac?branch=master)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](https://github.com/gnosisguild/CODE_OF_CONDUCT)

This package includes the base [Zodiac](https://github.com/gnosisguild/zodiac) contracts and interfaces from which Zodiac components are derived. It also includes a browser-safe TypeScript SDK for encoding module deployments and a separate tooling entrypoint for deployment and verification workflows.

## Base Contracts

[**`Module.sol`**](/contracts/core/Module.sol)

Modules are contracts enabled by an Avatar that implement some decision making logic. They should import Module.sol.

[**`GuardableModule.sol`**](/contracts/core/GuardableModule.sol)

A module with a guard enabled that can check transactions before and after execution. Useful for limiting the scope of addresses and functions that a module can call or ensure a certain state is never changed by a module.

[**`Modifier.sol`**](/contracts/core/Modifier.sol)

Modifiers are contracts that sit between Modules and Avatars to modify the Module's behavior. For example, they might enforce a delay on all functions a Module attempts to execute. Modifiers should import Modifier.sol and must expose an interface like IAvatar.sol

[**`GuardableModifier.sol`**](/contracts/core/GuardableModifier.sol)

A modifier with a guard enabled that can check transactions before and after execution. Useful for limiting the scope of addresses and functions that a modifier can call or ensure a certain state is never changed by a modifier.

## SDK

The SDK provides functions for encoding, deploying, and verifying Zodiac modules.

### Encoding

The functions in this section produce (but do not execute) payloads that when executed create mastercopies and module instances. These functions are commonly used in apps for deploying new instances of a Zodiac compliant module or modifier, as their payloads can be deployed by any connected account.

#### `encodeDeployProxy`

Generates a payload for deploying a new instance of a module/modifier - the new instance is a minimal proxy, deploy via ZodiacModuleProxyFactory and pointing to a module/modifier mastercopy.

```ts
import { encodeDeployProxy } from "@gnosis-guild/zodiac-core";

const transaction = await encodeDeployProxy({
  mastercopy: "0x<address>",
  setupArgs: { types: ["address", "uint256"], values: ["0x<address>", 0] },
  salt: "0x<bytes32>",
});
```

#### `predictProxyAddress`

Predicts the address of a new module instance, deployed via ZodiacModuleProxyFactory. Useful for deploying and making calls to a module or modifier in one multisend transaction.

```ts
import { predictProxyAddress } from "@gnosis-guild/zodiac-core";

const transaction = await predictProxyAddress({
  mastercopy: "0x<address>",
  setupArgs: { types: ["address", "uint256"], values: ["0x<address>", 0] },
  salt: "0x<bytes32>",
});
```

### Deployment

The functions in this section accept an EIP1193-compliant provider and execute transactions that create mastercopies and module instances. Commonly used in contract infrastructure with a provider like hardhat when developing new modules or modifiers.

#### `deployFactories`

Deploys all factories within a specified network. Typically, these factories are already deployed across networks; however, this function is useful for test setups.

```ts
import { deployFactories } from "@gnosis-guild/zodiac-core/tooling";

await deployFactories({
  provider, // an EIP1193 compliant provider
});
```

#### `deployMastercopy`

Deploys a mastercopy using the ERC2470 factory. If the master copy is already deployed, this script will perform no operation. Returns an object containing the mastercopy address and a boolean indicating whether the master copy was previously deployed.

```ts
import { deployMastercopy } from "@gnosis-guild/zodiac-core/tooling";

await deployMastercopy({
  bytecode, // the mastercopy bytecode
  constructorArgs: { // mastercopy creation args
    types: ["uint256", "...more constructor types"]
    values: ["0", "...more constructor values"]
  },
  salt, // create2 salt
  provider, // an EIP1193 compliant provider
});
```

#### `deployProxy`

Deploys a module instance as a proxy using the ZodiacModuleProxyFactory. If an instance with the same saltNonce already exists, this function does nothing. Returns an object containing the module instance address and a boolean indicating whether the master copy was previously deployed.

```ts
import { deployProxy } from "@gnosis-guild/zodiac-core/tooling";

await deployProxy({
  mastercopy, // the mastercopy address
  setupArgs: { // instance setup args
    types: ["uint256", "...more setup types"]
    values: ["0", "...more setup values"]
  },
  saltNonce, // an integer, used to salt proxy deployment
  provider, // an EIP1193 compliant provider
});
```

### Verification

**verifyMastercopy**

Checks whether a mastercopy is already verified and submits its source code if needed. On Etherscan V2, it waits for the verification result. With a legacy explorer URL, it returns once the explorer accepts the submission. Pass the Solidity standard JSON input in `artifact.compilerInput`, including imported sources and any linked library addresses in `settings.libraries`.

```ts
import { verifyMastercopy } from "@gnosis-guild/zodiac-core/tooling";

const result = await verifyMastercopy({
  chainId: 1,
  apiKey: "YourEtherscanApiKey",
  artifact: {
    contractName: "MyContract",
    sourceName: "MyContract.sol",
    compilerVersion: "v0.8.0+commit.c7dfd78e",
    compilerInput: {},
    address: "0x1234567890abcdef1234567890abcdef12345678",
    constructorArgs: {
      types: ["uint256"],
      values: [42],
    },
  },
  apiUrl: "https://api.customnet.io/api", // Optional custom API URL
});

console.log(result);
```
