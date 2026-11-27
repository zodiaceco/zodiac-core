// SPDX-License-Identifier: LGPL-3.0-only
// Copyright (c) 2026 Zodiac Labs GmbH
// Zodiac Core Contracts
pragma solidity >=0.8.28 <0.9.0;

abstract contract Initializable {
  bool private _initialized;

  error AlreadyInitialized();

  modifier initializer() {
    if (_initialized) revert AlreadyInitialized();
    _initialized = true;
    _;
  }
}
