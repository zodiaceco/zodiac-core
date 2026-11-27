// SPDX-License-Identifier: LGPL-3.0-only
// Copyright (c) 2026 Zodiac Labs GmbH
// Zodiac Core Contracts
pragma solidity >=0.8.28 <0.9.0;

import {Ownable} from "../factory/Ownable.sol";

import {BaseModuleGuard} from "../guard/BaseGuard.sol";
import {IModuleGuard} from "../interfaces/IGuard.sol";

/// @title Guardable - A contract that manages fallback calls made to this contract
contract Guardable is Ownable {
  address public guard;

  event ChangedGuard(address guard);

  /// `guard_` does not implement IERC165.
  error NotIERC165Compliant(address guard_);

  /// @dev Set a guard that checks transactions before execution.
  /// @param _guard The address of the guard to be used or the 0 address to disable the guard.
  function setGuard(address _guard) external onlyOwner {
    if (_guard != address(0)) {
      if (
        !BaseModuleGuard(_guard).supportsInterface(
          type(IModuleGuard).interfaceId
        )
      ) revert NotIERC165Compliant(_guard);
    }
    guard = _guard;
    emit ChangedGuard(guard);
  }

  function getGuard() external view returns (address _guard) {
    return guard;
  }
}
