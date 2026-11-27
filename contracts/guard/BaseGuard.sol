// SPDX-License-Identifier: LGPL-3.0-only
// Copyright (c) 2026 Zodiac Labs GmbH
// Zodiac Core Contracts
pragma solidity >=0.8.28 <0.9.0;

import {IERC165} from "../interfaces/IERC165.sol";

import {IGuard, IModuleGuard} from "../interfaces/IGuard.sol";

import "../core/Operation.sol";

abstract contract BaseGuard is IGuard, IERC165 {
  function supportsInterface(
    bytes4 interfaceId
  ) external pure override returns (bool) {
    return
      interfaceId == type(IGuard).interfaceId || // 0xe6d7a83a
      interfaceId == type(IERC165).interfaceId; // 0x01ffc9a7
  }

  /// @dev Module transactions only use the first four parameters: to, value, data, and operation.
  /// Module.sol hardcodes the remaining parameters as 0 since they are not used for module transactions.
  /// @notice This interface is used to maintain compatibilty with Gnosis Safe transaction guards.
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
  ) external virtual;

  function checkAfterExecution(bytes32 txHash, bool success) external virtual;
}

abstract contract BaseModuleGuard is IModuleGuard, IERC165 {
  function checkModuleTransaction(
    address to,
    uint256 value,
    bytes memory data,
    Operation operation,
    address module
  ) external virtual returns (bytes32 moduleTxHash);

  function checkAfterModuleExecution(
    bytes32 txHash,
    bool success
  ) external virtual;

  function supportsInterface(
    bytes4 interfaceId
  ) external pure override returns (bool) {
    return
      interfaceId == type(IModuleGuard).interfaceId || // 0x58401ed8
      interfaceId == type(IERC165).interfaceId; // 0x01ffc9a7
  }
}
