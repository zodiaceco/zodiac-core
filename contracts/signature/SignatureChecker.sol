// SPDX-License-Identifier: LGPL-3.0-only
// Copyright (c) 2026 Zodiac Labs GmbH
// Zodiac Core Contracts
pragma solidity >=0.8.28 <0.9.0;

import {IERC1271} from "./IERC1271.sol";

/// @title SignatureChecker - Verifies EIP-712 signatures.
/// @dev Supports EOA (ECDSA) and ERC-1271 contract signatures.
abstract contract SignatureChecker {
  /**
   * @dev Computes the EIP-712 digest as
   *      `keccak256(0x1901 ‖ domainSeparator ‖ structHash)`.
   *      This contract derives the domain separator from the current chain ID
   *      and its own address; the inheriting contract defines `structHash`.
   * @param structHash EIP-712 hash of the typed message (`hashStruct(message)`).
   * @return Domain-separated digest to sign or verify.
   */
  function hashTypedData(bytes32 structHash) internal view returns (bytes32) {
    bytes32 domainSeparator = keccak256(
      abi.encode(DOMAIN_SEPARATOR_TYPEHASH, block.chainid, this)
    );
    return
      keccak256(
        abi.encodePacked(
          bytes1(0x19),
          bytes1(0x01),
          domainSeparator,
          structHash
        )
      );
  }

  /**
   * @notice Recovers the signer of an arbitrary EIP-712 digest.
   * @dev Signature layout:
   *      - EOA:     `r || s || v`                 (65 bytes)
   *      - ERC1271: `signer || contractSignature` (signature[0:20] = signer)
   *
   *      A 65-byte signature is checked as an EOA signature first. If recovery
   *      fails, it is then checked as an ERC1271 signature.
   * @param hash The EIP-712 digest that was signed.
   * @param signature Signature using the EOA or ERC-1271 layout above.
   * @return signer The recovered signer, or address(0) when invalid.
   */
  function signedBy(
    bytes32 hash,
    bytes calldata signature
  ) internal view returns (address signer) {
    if (signature.length < 20) {
      return address(0);
    }

    if (signature.length == 65) {
      bytes32 r = bytes32(signature[0:32]);
      bytes32 s = bytes32(signature[32:64]);
      uint8 v = uint8(signature[64]);
      signer = ecrecover(hash, v, r, s);
      // ecrecover fails by returning address(0)
      if (signer != address(0)) {
        return signer;
      }
    }

    signer = address(bytes20(signature));
    return
      _isValidContractSignature(signer, hash, signature[20:])
        ? signer
        : address(0);
  }

  /**
   * @dev Asks the signer contract whether the signature is valid for the hash.
   * @param signer The address of the signer contract.
   * @param hash Hash of the data signed.
   * @param signature The contract signature.
   * @return result Indicates whether the signature is valid.
   */
  function _isValidContractSignature(
    address signer,
    bytes32 hash,
    bytes calldata signature
  ) private view returns (bool result) {
    uint256 size;
    // eslint-disable-line no-inline-assembly
    assembly {
      size := extcodesize(signer)
    }
    if (size == 0) {
      return false;
    }

    (bool success, bytes memory returnData) = signer.staticcall(
      abi.encodeWithSelector(
        IERC1271.isValidSignature.selector,
        hash,
        signature
      )
    );

    return success && bytes4(returnData) == EIP1271_MAGIC_VALUE;
  }

  // keccak256(
  //     "EIP712Domain(uint256 chainId,address verifyingContract)"
  // );
  bytes32 private constant DOMAIN_SEPARATOR_TYPEHASH =
    0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218;

  // bytes4(keccak256(
  //     "isValidSignature(bytes32,bytes)"
  // ));
  bytes4 private constant EIP1271_MAGIC_VALUE = 0x1626ba7e;
}
