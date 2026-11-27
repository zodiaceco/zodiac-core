// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.24;

import {BaseGuard, BaseModuleGuard} from "../guard/BaseGuard.sol";
import {IERC165} from "../interfaces/IERC165.sol";
import {Operation} from "../core/Operation.sol";

/* solhint-disable */

/// @dev Avatar stand-in. Emits every module transaction it receives, with the
///      caller, then executes it, so tests can check both what was forwarded
///      and what came back.
contract MockAvatar {
  event ExecTransactionFromModule(
    address sender,
    address to,
    uint256 value,
    bytes data,
    Operation operation
  );
  event ExecTransactionFromModuleReturnData(
    address sender,
    address to,
    uint256 value,
    bytes data,
    Operation operation
  );

  error AvatarReverted();

  bool public reverts;

  receive() external payable {}

  function setReverts(bool _reverts) external {
    reverts = _reverts;
  }

  function execTransactionFromModule(
    address to,
    uint256 value,
    bytes calldata data,
    Operation operation
  ) external returns (bool success) {
    emit ExecTransactionFromModule(msg.sender, to, value, data, operation);
    (success, ) = _execute(to, value, data, operation);
  }

  function execTransactionFromModuleReturnData(
    address to,
    uint256 value,
    bytes calldata data,
    Operation operation
  ) external returns (bool success, bytes memory returnData) {
    emit ExecTransactionFromModuleReturnData(
      msg.sender,
      to,
      value,
      data,
      operation
    );
    (success, returnData) = _execute(to, value, data, operation);
  }

  function _execute(
    address to,
    uint256 value,
    bytes calldata data,
    Operation operation
  ) private returns (bool, bytes memory) {
    if (reverts) revert AvatarReverted();
    if (operation == Operation.DelegateCall) return to.delegatecall(data);
    return to.call{value: value}(data);
  }
}

/// @dev Destination of module transactions. `succeed` and `fail` keep no
///      state, so they are safe to delegatecall into.
contract Receiver {
  error Failed();

  uint256 public pokes;

  function succeed(
    bytes calldata payload
  ) external payable returns (bytes memory) {
    return payload;
  }

  function fail() external payable {
    revert Failed();
  }

  function poke() external payable {
    pokes++;
  }
}

/// @dev Module guard that emits what it is asked to check. Either check can be
///      made to revert, and the pre-check can call out (to re-enter).
contract MockModuleGuard is BaseModuleGuard {
  event PreChecked(
    address to,
    uint256 value,
    bytes data,
    Operation operation,
    address module
  );
  event PostChecked(bytes32 moduleTxHash, bool success);

  error PreCheckFailed();
  error PostCheckFailed();

  bytes32 public moduleTxHash = keccak256("moduleTxHash");
  bool public failPreCheck;
  bool public failPostCheck;
  address public hookTarget;
  bytes public hookData;

  function setModuleTxHash(bytes32 _moduleTxHash) external {
    moduleTxHash = _moduleTxHash;
  }

  function setFailPreCheck(bool _fail) external {
    failPreCheck = _fail;
  }

  function setFailPostCheck(bool _fail) external {
    failPostCheck = _fail;
  }

  /// @dev Has the pre-check call `target` with `data`, bubbling its revert.
  function setHook(address target, bytes calldata data) external {
    hookTarget = target;
    hookData = data;
  }

  function checkModuleTransaction(
    address to,
    uint256 value,
    bytes memory data,
    Operation operation,
    address module
  ) external override returns (bytes32) {
    if (failPreCheck) revert PreCheckFailed();
    if (hookTarget != address(0)) {
      (bool success, bytes memory returnData) = hookTarget.call(hookData);
      if (!success) {
        assembly {
          revert(add(returnData, 32), mload(returnData))
        }
      }
    }
    emit PreChecked(to, value, data, operation, module);
    return moduleTxHash;
  }

  function checkAfterModuleExecution(
    bytes32 _moduleTxHash,
    bool success
  ) external override {
    if (failPostCheck) revert PostCheckFailed();
    emit PostChecked(_moduleTxHash, success);
  }
}

/// @dev Minimal Safe-style transaction guard, to exercise BaseGuard.
contract MockTransactionGuard is BaseGuard {
  function checkTransaction(
    address,
    uint256,
    bytes memory,
    Operation,
    uint256,
    uint256,
    uint256,
    address,
    address payable,
    bytes memory,
    address
  ) external override {}

  function checkAfterExecution(bytes32, bool) external override {}
}

/// @dev ERC-165 contract that supports nothing.
contract MockUnsupportedInterface is IERC165 {
  function supportsInterface(bytes4) external pure returns (bool) {
    return false;
  }
}

/// @dev ERC-1271 signer whose answer is set by the test.
contract MockERC1271 {
  enum Mode {
    Magic,
    OtherValue,
    Short,
    Empty,
    Revert,
    WriteState
  }

  Mode public mode;
  bool public strict;
  bytes32 public expectedHash;
  bytes public expectedSignature;
  uint256 public writes;

  function setMode(Mode _mode) external {
    mode = _mode;
  }

  /// @dev Answers with the magic value only for this hash and signature.
  function expect(bytes32 hash, bytes calldata signature) external {
    strict = true;
    expectedHash = hash;
    expectedSignature = signature;
  }

  /// @dev Not `view`, so WriteState can try to write under STATICCALL.
  function isValidSignature(
    bytes32 hash,
    bytes calldata signature
  ) external returns (bytes4) {
    Mode _mode = mode;
    if (_mode == Mode.Revert) revert("MockERC1271: reverted");
    if (_mode == Mode.WriteState) {
      writes++;
      return 0x1626ba7e;
    }
    if (_mode == Mode.Short) {
      assembly {
        mstore(
          0,
          0x1626ba7e00000000000000000000000000000000000000000000000000000000
        )
        return(0, 3)
      }
    }
    if (_mode == Mode.Empty) {
      assembly {
        return(0, 0)
      }
    }
    if (_mode == Mode.OtherValue) return 0xdeadbeef;
    if (
      strict &&
      (hash != expectedHash ||
        keccak256(signature) != keccak256(expectedSignature))
    ) {
      return 0xdeadbeef;
    }
    return 0x1626ba7e;
  }
}

/// @dev Runs several calls in one transaction, bubbling the first revert.
contract Multicall {
  struct Call {
    address target;
    bytes data;
  }

  function multicall(
    Call[] calldata calls
  ) external returns (bytes[] memory results) {
    results = new bytes[](calls.length);
    for (uint256 i = 0; i < calls.length; i++) {
      (bool success, bytes memory returnData) = calls[i].target.call(
        calls[i].data
      );
      if (!success) {
        assembly {
          revert(add(returnData, 32), mload(returnData))
        }
      }
      results[i] = returnData;
    }
  }
}

/// @dev Mastercopy for ModuleProxyFactory tests.
contract MockMastercopy {
  error InitializationFailed();
  error Boom();

  address public initializer;
  uint256 public value;

  /// @dev Reverts when `_value` is zero.
  function initialize(uint256 _value) external {
    if (_value == 0) revert InitializationFailed();
    initializer = msg.sender;
    value = _value;
  }

  function setValue(uint256 _value) external {
    value = _value;
  }

  function boom() external pure {
    revert Boom();
  }
}
