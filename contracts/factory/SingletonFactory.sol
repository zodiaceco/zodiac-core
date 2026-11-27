// SPDX-License-Identifier: LGPL-3.0-only
// Copyright (c) 2026 Zodiac Labs GmbH
// Zodiac Core Contracts
pragma solidity >=0.8.28 <0.9.0;

/**
 * @title Singleton Factory (EIP-2470)
 * @notice Exposes CREATE2 (EIP-1014) to deploy bytecode on deterministic addresses based on initialization code and salt.
 */
contract SingletonFactory {
  /**
   * @notice Deploys `_initCode` using `_salt` for defining the deterministic address.
   * @param _initCode Initialization code.
   * @param _salt Arbitrary value to modify resulting address.
   * @return createdContract Created contract address.
   */
  function deploy(
    bytes memory _initCode,
    bytes32 _salt
  ) public returns (address payable createdContract) {
    assembly {
      createdContract := create2(
        0,
        add(_initCode, 0x20),
        mload(_initCode),
        _salt
      )
    }
  }
}
// IV is a value changed to generate the vanity address.
// IV: 6583047
