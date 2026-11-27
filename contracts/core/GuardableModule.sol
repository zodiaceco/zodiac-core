// SPDX-License-Identifier: LGPL-3.0-only
// Copyright (c) 2026 Zodiac Labs GmbH
// Zodiac Core Contracts
pragma solidity >=0.8.28 <0.9.0;

import {IModuleGuard} from "../interfaces/IGuard.sol";
import {Guardable} from "../guard/Guardable.sol";
import {Module} from "./Module.sol";
import {IAvatar} from "../interfaces/IAvatar.sol";
import "./Operation.sol";

/// @title GuardableModule  - A contract that can pass messages to a Module Manager contract if enabled by that contract.
abstract contract GuardableModule is Module, Guardable {
  /// @dev Passes a transaction to be executed by the avatar.
  /// @notice Can only be called by this contract.
  /// @param to Destination address of module transaction.
  /// @param value Ether value of module transaction.
  /// @param data Data payload of module transaction.
  /// @param operation Operation type of module transaction: 0 == call, 1 == delegate call.
  function exec(
    address to,
    uint256 value,
    bytes memory data,
    Operation operation
  ) internal override returns (bool success) {
    bytes32 moduleTxHash;
    address currentGuard = guard;
    if (currentGuard != address(0)) {
      moduleTxHash = IModuleGuard(currentGuard).checkModuleTransaction(
        to,
        value,
        data,
        operation,
        address(this)
      );
    }
    success = IAvatar(target).execTransactionFromModule(
      to,
      value,
      data,
      operation
    );
    if (currentGuard != address(0)) {
      IModuleGuard(currentGuard).checkAfterModuleExecution(
        moduleTxHash,
        success
      );
    }
  }

  /// @dev Passes a transaction to be executed by the target and returns data.
  /// @notice Can only be called by this contract.
  /// @param to Destination address of module transaction.
  /// @param value Ether value of module transaction.
  /// @param data Data payload of module transaction.
  /// @param operation Operation type of module transaction: 0 == call, 1 == delegate call.
  function execAndReturnData(
    address to,
    uint256 value,
    bytes memory data,
    Operation operation
  ) internal virtual override returns (bool success, bytes memory returnData) {
    bytes32 moduleTxHash;
    address currentGuard = guard;
    if (currentGuard != address(0)) {
      moduleTxHash = IModuleGuard(currentGuard).checkModuleTransaction(
        to,
        value,
        data,
        operation,
        address(this)
      );
    }

    (success, returnData) = IAvatar(target).execTransactionFromModuleReturnData(
      to,
      value,
      data,
      operation
    );

    if (currentGuard != address(0)) {
      IModuleGuard(currentGuard).checkAfterModuleExecution(
        moduleTxHash,
        success
      );
    }
  }
}
