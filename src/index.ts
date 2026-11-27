// encoding
import encodeDeployProxy from "./encoding/encodeDeployProxy.js";
import predictProxyAddress from "./encoding/predictProxyAddress.js";
import encodeDeploySingleton from "./encoding/encodeDeploySingleton.js";
import predictSingletonAddress from "./encoding/predictSingletonAddress.js";

export {
  // encoding
  encodeDeploySingleton,
  predictSingletonAddress,
  encodeDeployProxy,
  predictProxyAddress,
};

import type {
  AbiArgs,
  Create2Args,
  EIP1193Provider,
  Transaction,
} from "./types.js";

export type { AbiArgs, Create2Args, EIP1193Provider, Transaction };
