// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.24;

import "../core/Module.sol";

/// Takes its owner from the setup parameters, as Roles and Delay do.
contract TestOwnableModule is Module {
  constructor(address _owner, address _avatar, address _target) {
    setUp(abi.encode(_owner, _avatar, _target));
  }

  function setUp(bytes memory initializeParams) public override initializer {
    (address _owner, address _avatar, address _target) = abi.decode(
      initializeParams,
      (address, address, address)
    );
    _transferOwnership(_owner);
    avatar = _avatar;
    target = _target;
  }
}
