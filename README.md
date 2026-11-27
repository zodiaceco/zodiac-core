# Zodiac Core Contracts

[![Build Status](https://github.com/zodiaceco/zodiac-core/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/zodiaceco/zodiac-core/actions/workflows/ci.yml?query=branch%3Amaster)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](https://github.com/gnosisguild/CODE_OF_CONDUCT)

Base Solidity contracts for building [Zodiac](https://docs.zodiac.eco) modules, modifiers, and guards, plus TypeScript helpers for deterministic deployment and verification.

Canonical mastercopy deployments and ABIs live in [zodiac-deployments](https://github.com/zodiaceco/zodiac-deployments) (`@zodiaceco/deployments`).

## Installation

```bash
npm install @zodiaceco/core-contracts
```

## Contracts

Import from `@zodiaceco/core-contracts/contracts/...`:

- [`core/Module.sol`](https://github.com/zodiaceco/zodiac-core/blob/master/contracts/core/Module.sol) — base contract for modules enabled on an Avatar (`exec`, `execAndReturnData`).
- [`core/Modifier.sol`](https://github.com/zodiaceco/zodiac-core/blob/master/contracts/core/Modifier.sol) — sits between modules and an Avatar (`IAvatar`) with `moduleOnly` and EIP-712/ERC-1271 `moduleOnlySigned` auth.
- [`core/GuardableModule.sol`](https://github.com/zodiaceco/zodiac-core/blob/master/contracts/core/GuardableModule.sol), [`core/GuardableModifier.sol`](https://github.com/zodiaceco/zodiac-core/blob/master/contracts/core/GuardableModifier.sol) — `Module` and `Modifier` with optional pre/post transaction guards.
- [`guard/BaseGuard.sol`](https://github.com/zodiaceco/zodiac-core/blob/master/contracts/guard/BaseGuard.sol) — `BaseGuard` and `BaseModuleGuard` base implementations.
- [`factory/ModuleProxyFactory.sol`](https://github.com/zodiaceco/zodiac-core/blob/master/contracts/factory/ModuleProxyFactory.sol) — deploys deterministic minimal proxies pointing to a mastercopy.
- [`interfaces/IAvatar.sol`](https://github.com/zodiaceco/zodiac-core/blob/master/contracts/interfaces/IAvatar.sol), [`interfaces/IGuard.sol`](https://github.com/zodiaceco/zodiac-core/blob/master/contracts/interfaces/IGuard.sol) — core Avatar and Guard interfaces.

## TypeScript Helpers

### Encoding (`@zodiaceco/core-contracts`)

Browser-safe functions, built on [viem](https://viem.sh), that encode `{ to, data }` deployment payloads and predict deterministic addresses. `types` accepts human-readable ABI parameters (`"address"`, `"(address to, uint256 value)[]"`) or viem `AbiParameter` objects.

```ts
import {
  encodeDeployProxy,
  predictProxyAddress,
} from "@zodiaceco/core-contracts";

const args = {
  mastercopy: "0x...",
  setupArgs: { types: ["address", "uint256"], values: ["0x...", 0n] },
  saltNonce: 0n,
} as const;

const tx = encodeDeployProxy(args);
const address = predictProxyAddress(args);
```

```ts
import {
  encodeDeploySingleton,
  predictSingletonAddress,
} from "@zodiaceco/core-contracts";

const args = {
  bytecode: "0x...",
  constructorArgs: { types: ["uint256"], values: [0n] },
  salt: "0x...",
} as const;

const tx = encodeDeploySingleton(args);
const address = predictSingletonAddress(args);
```

### Tooling (`@zodiaceco/core-contracts/tooling`)

Executes deployments via an EIP-1193 `provider` and verifies mastercopies. Deployment helpers are idempotent (`noop: true` if bytecode already exists).

```ts
import {
  deployFactories,
  deployMastercopy,
  deployProxy,
  verifyMastercopy,
} from "@zodiaceco/core-contracts/tooling";

// Deploy Nick's, ERC-2470, and ModuleProxyFactory (for local/test networks)
await deployFactories({ provider });

const mastercopy = await deployMastercopy({
  bytecode,
  constructorArgs: { types: ["uint256"], values: [0n] },
  salt,
  provider,
});

const proxy = await deployProxy({
  mastercopy: mastercopy.address,
  setupArgs: { types: ["address", "uint256"], values: [owner, 0n] },
  saltNonce: 0n,
  provider,
});

// Verifies via Etherscan V2 (or pass `apiUrl` for custom/legacy explorers)
await verifyMastercopy({
  chainId: 1,
  apiKey,
  artifact: {
    contractName: "MyModule",
    sourceName: "contracts/MyModule.sol",
    compilerVersion: "v0.8.30+commit.73712a01",
    compilerInput,
    address: mastercopy.address,
    constructorArgs: { types: ["uint256"], values: [0n] },
  },
});
```

## Development

Tests require [anvil](https://getfoundry.sh/introduction/installation); run `yarn test`.

## Audits

- [September 2021](https://github.com/zodiaceco/zodiac-core/blob/master/audits/GnosisZodiac2021Sep.pdf) (G0 Group) — initial Zodiac contracts
- [February 2023](https://github.com/zodiaceco/zodiac-core/blob/master/audits/ZodiacModifierUpdateFeb2023.pdf) — modifier update
- [October 2026](https://github.com/zodiaceco/zodiac-core/blob/master/audits/ZodiacOctober2026.pdf) (Côme du Crest) — zodiac-core and [Roles](https://github.com/zodiaceco/zodiac-modifier-roles) v3

## License

[LGPL-3.0+](https://github.com/zodiaceco/zodiac-core/blob/master/LICENSE). Provided without warranty of any kind.
