// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.28 <0.9.0;

import {Operation} from "../core/Operation.sol";

struct ModuleTx {
  address to;
  uint256 value;
  bytes data;
  Operation operation;
}

function moduleTxStructHash(
  ModuleTx memory moduleTx,
  bytes32 salt
) pure returns (bytes32) {
  return
    keccak256(
      abi.encode(
        MODULE_TX_TYPEHASH,
        moduleTx.to,
        moduleTx.value,
        keccak256(moduleTx.data),
        moduleTx.operation,
        salt
      )
    );
}

// keccak256(
//     "ModuleTx(address to,uint256 value,bytes data,uint8 operation,bytes32 salt)"
// );
bytes32 constant MODULE_TX_TYPEHASH =
  0x73d8543ad6d885f580270da0b8273accec78d8732db45947d0dd843b1f4d07e7;
