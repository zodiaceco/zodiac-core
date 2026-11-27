// SPDX-License-Identifier: LGPL-3.0-only
// Copyright (c) 2026 Zodiac Labs GmbH
// Zodiac Core Contracts
pragma solidity >=0.8.28 <0.9.0;

import "../core/Operation.sol";

interface IGuard {
  function checkTransaction(
    address to,
    uint256 value,
    bytes memory data,
    Operation operation,
    uint256 safeTxGas,
    uint256 baseGas,
    uint256 gasPrice,
    address gasToken,
    address payable refundReceiver,
    bytes memory signatures,
    address msgSender
  ) external;

  function checkAfterExecution(bytes32 txHash, bool success) external;
}

interface IModuleGuard {
  function checkModuleTransaction(
    address to,
    uint256 value,
    bytes memory data,
    Operation operation,
    address module
  ) external returns (bytes32 moduleTxHash);

  function checkAfterModuleExecution(
    bytes32 moduleTxHash,
    bool success
  ) external;
}
