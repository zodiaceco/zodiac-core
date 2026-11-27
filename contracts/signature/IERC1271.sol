// SPDX-License-Identifier: LGPL-3.0-only
// Copyright (c) 2026 Zodiac Labs GmbH
// Zodiac Core Contracts
pragma solidity >=0.8.28 <0.9.0;

interface IERC1271 {
  /**
   * @notice EIP1271 method to validate a signature.
   * @param hash Hash of the data signed on the behalf of address(this).
   * @param signature Signature byte array associated with _data.
   *
   * MUST return the bytes4 magic value 0x1626ba7e when function passes.
   * MUST NOT modify state (using STATICCALL for solc < 0.5, view modifier for solc > 0.5)
   * MUST allow external calls
   */
  function isValidSignature(
    bytes32 hash,
    bytes memory signature
  ) external view returns (bytes4);
}
