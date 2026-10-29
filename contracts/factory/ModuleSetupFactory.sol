// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.24;

interface IModuleProxyFactory {
  function deployModule(
    address masterCopy,
    bytes memory initializer,
    uint256 saltNonce
  ) external returns (address proxy);
}

interface IModule {
  function setUp(bytes memory initializeParams) external;

  function owner() external view returns (address);

  function transferOwnership(address newOwner) external;
}

/// @title ModuleSetupFactory - Deploys and configures Zodiac modules in one transaction.
/// @notice Anyone can relay deployment. The module is owned by this factory
/// while the setup calls run, and handed to the owner its initializer names.
contract ModuleSetupFactory {
  IModuleProxyFactory public constant moduleProxyFactory = IModuleProxyFactory(
    0x000000000000aDdB49795b0f9bA5BC298cDda236
  );

  event ModuleSetup(
    address indexed module,
    address indexed mastercopy,
    bytes32 indexed saltNonce
  );

  error InvalidInitializer();

  error SetupCallFailed(uint256 index, bytes reason);

  error AlreadyInitialized(address module);

  /// @notice Deploys and configures a module.
  /// @dev Replaces the owner in `initializer` with this factory, executes
  /// `setupCalls`, then transfers ownership to the original owner.
  function createAndSetupModule(
    address mastercopy,
    bytes calldata initializer,
    bytes[] calldata setupCalls,
    bytes32 saltNonce
  ) external returns (address module) {
    (bytes memory patchedInitializer, address owner) = _patchInitializer(
      initializer
    );

    uint256 deploymentNonce = uint256(
      keccak256(
        abi.encode(
          keccak256(initializer),
          keccak256(abi.encode(setupCalls)),
          saltNonce
        )
      )
    );
    module = _calculateAddress(mastercopy, patchedInitializer, deploymentNonce);

    if (module.code.length == 0) {
      moduleProxyFactory.deployModule(
        mastercopy,
        patchedInitializer,
        deploymentNonce
      );
    }

    if (IModule(module).owner() != address(this)) {
      revert AlreadyInitialized(module);
    }

    for (uint256 i; i < setupCalls.length; ++i) {
      (bool success, bytes memory reason) = module.call(setupCalls[i]);
      if (!success) revert SetupCallFailed(i, reason);
    }

    IModule(module).transferOwnership(owner);
    assert(IModule(module).owner() == owner);

    emit ModuleSetup(module, mastercopy, saltNonce);
  }

  /// Copies `initializer`, replaces its owner with this factory, and returns
  /// the copy and original owner.
  function _patchInitializer(
    bytes calldata initializer
  ) private view returns (bytes memory patched, address owner) {
    if (
      initializer.length < 4 + 3 * 32 ||
      bytes4(initializer) != IModule.setUp.selector ||
      uint256(bytes32(initializer[0x04:0x24])) != 0x20
    ) {
      revert InvalidInitializer();
    }

    owner = address(bytes20(initializer[0x50:0x64]));
    if (owner == address(this)) revert InvalidInitializer();

    patched = initializer;
    assembly {
      mstore(add(patched, 0x64), address())
    }
  }

  function _calculateAddress(
    address mastercopy,
    bytes memory initializer,
    uint256 deploymentNonce
  ) private pure returns (address) {
    bytes32 salt = keccak256(
      abi.encodePacked(keccak256(initializer), deploymentNonce)
    );
    bytes32 bytecodeHash = keccak256(
      abi.encodePacked(
        hex"602d8060093d393df3363d3d373d3d3d363d73",
        mastercopy,
        hex"5af43d82803e903d91602b57fd5bf3"
      )
    );
    return
      address(
        uint160(
          uint256(
            keccak256(
              abi.encodePacked(
                bytes1(0xff),
                address(moduleProxyFactory),
                salt,
                bytecodeHash
              )
            )
          )
        )
      );
  }
}
