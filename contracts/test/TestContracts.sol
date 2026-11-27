// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.28 <0.9.0;

import {GuardableModifier} from "../core/GuardableModifier.sol";
import {GuardableModule} from "../core/GuardableModule.sol";
import {Modifier} from "../core/Modifier.sol";
import {Module} from "../core/Module.sol";
import {Operation} from "../core/Operation.sol";
import {SignatureChecker} from "../signature/SignatureChecker.sol";
import {ModuleTx, moduleTxStructHash} from "./TestTypedData.sol";

/* solhint-disable */

/// @dev Exposes SignatureChecker's internal functions.
contract TestSignatureChecker is SignatureChecker {
  function exposeHashTypedData(
    bytes32 structHash
  ) external view returns (bytes32) {
    return hashTypedData(structHash);
  }

  function exposeSignedBy(
    bytes32 hash,
    bytes calldata signature
  ) external view returns (address) {
    return signedBy(hash, signature);
  }
}

/// @dev Concrete Module for tests. `setUp` takes `(owner, avatar, target)`.
contract TestModule is Module {
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

  function executeTransaction(
    address to,
    uint256 value,
    bytes memory data,
    Operation operation
  ) external returns (bool) {
    return exec(to, value, data, operation);
  }

  function executeTransactionReturnData(
    address to,
    uint256 value,
    bytes memory data,
    Operation operation
  ) external returns (bool, bytes memory) {
    return execAndReturnData(to, value, data, operation);
  }
}

/// @dev Same surface as TestModule. GuardableModule's `exec` is not virtual,
///      so it cannot share that base.
contract TestGuardableModule is GuardableModule {
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

  function executeTransaction(
    address to,
    uint256 value,
    bytes memory data,
    Operation operation
  ) external returns (bool) {
    return exec(to, value, data, operation);
  }

  function executeTransactionReturnData(
    address to,
    uint256 value,
    bytes memory data,
    Operation operation
  ) external returns (bool, bytes memory) {
    return execAndReturnData(to, value, data, operation);
  }
}

/// @dev Concrete Modifier for tests. `setUp` takes `(owner, avatar, target)`.
contract TestModifier is Modifier {
  constructor(address _owner, address _avatar, address _target) {
    setUp(abi.encode(_owner, _avatar, _target));
  }

  function setUp(bytes memory initializeParams) public override initializer {
    (address _owner, address _avatar, address _target) = abi.decode(
      initializeParams,
      (address, address, address)
    );
    setupModules();
    _transferOwnership(_owner);
    avatar = _avatar;
    target = _target;
  }

  function attemptToSetupModules() external {
    setupModules();
  }

  function execTransactionFromModule(
    address to,
    uint256 value,
    bytes calldata data,
    Operation operation
  ) public override moduleOnly returns (bool) {
    return exec(to, value, data, operation);
  }

  function execTransactionFromModuleReturnData(
    address to,
    uint256 value,
    bytes calldata data,
    Operation operation
  ) public override moduleOnly returns (bool, bytes memory) {
    return execAndReturnData(to, value, data, operation);
  }

  function execTransactionFromModuleSigned(
    ModuleTx calldata moduleTx,
    bytes32 salt,
    bytes calldata signature
  )
    external
    moduleOnlySigned(moduleTxStructHash(moduleTx, salt), signature)
    returns (bool)
  {
    return exec(moduleTx.to, moduleTx.value, moduleTx.data, moduleTx.operation);
  }

  function execTransactionFromModuleReturnDataSigned(
    ModuleTx calldata moduleTx,
    bytes32 salt,
    bytes calldata signature
  )
    external
    moduleOnlySigned(moduleTxStructHash(moduleTx, salt), signature)
    returns (bool, bytes memory)
  {
    return
      execAndReturnData(
        moduleTx.to,
        moduleTx.value,
        moduleTx.data,
        moduleTx.operation
      );
  }

  /// @dev sentOrSignedByModule() outside of any authenticated call.
  function exposeSentOrSignedByModule() external view returns (address) {
    return sentOrSignedByModule();
  }

  function moduleOnlySentOrSignedByModule()
    external
    moduleOnly
    returns (address)
  {
    return sentOrSignedByModule();
  }

  function moduleOnlySignedSentOrSignedByModule(
    bytes32 structHash,
    bytes calldata signature
  ) external moduleOnlySigned(structHash, signature) returns (address) {
    return sentOrSignedByModule();
  }

  function moduleOnlyNestedInModuleOnly()
    external
    moduleOnly
    returns (address)
  {
    return _moduleOnly();
  }

  function moduleOnlySignedNestedInModuleOnly(
    bytes32 structHash,
    bytes calldata signature
  ) external moduleOnly returns (address) {
    return _moduleOnlySigned(structHash, signature);
  }

  function _moduleOnly() private moduleOnly returns (address) {
    return sentOrSignedByModule();
  }

  function _moduleOnlySigned(
    bytes32 structHash,
    bytes calldata signature
  ) private moduleOnlySigned(structHash, signature) returns (address) {
    return sentOrSignedByModule();
  }
}

contract TestGuardableModifier is TestModifier, GuardableModifier {
  constructor(
    address _owner,
    address _avatar,
    address _target
  ) TestModifier(_owner, _avatar, _target) {}

  function exec(
    address to,
    uint256 value,
    bytes memory data,
    Operation operation
  ) internal override(Module, GuardableModifier) returns (bool) {
    return GuardableModifier.exec(to, value, data, operation);
  }

  function execAndReturnData(
    address to,
    uint256 value,
    bytes memory data,
    Operation operation
  ) internal override(Module, GuardableModifier) returns (bool, bytes memory) {
    return GuardableModifier.execAndReturnData(to, value, data, operation);
  }
}
