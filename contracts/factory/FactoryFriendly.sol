// SPDX-License-Identifier: LGPL-3.0-only
// Copyright (c) 2026 Zodiac Labs GmbH
// Zodiac Core Contracts
pragma solidity >=0.8.28 <0.9.0;

import {Initializable} from "./Initializable.sol";

/// @title Zodiac FactoryFriendly - A contract that allows other contracts to be initializable and pass bytes as arguments to define contract state
abstract contract FactoryFriendly is Initializable {
  function setUp(bytes memory initializeParams) public virtual;
}
