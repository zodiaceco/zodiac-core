import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Address } from "viem";

import { predictProxyAddress } from "../src/index";

const mastercopy = "0x0000000000000000000000000000000000000123";
const setupArgs = { types: ["uint256"], values: [1n] };

describe("predictProxyAddress", () => {
  it("gives the same result for any valid mastercopy casing", () => {
    const checksummed = "0xBb6e024b9cFFACB947A71991E386681B1Cd1477D";
    assert.equal(
      predictProxyAddress({
        mastercopy: checksummed,
        setupArgs,
        saltNonce: 1,
      }),
      predictProxyAddress({
        mastercopy: checksummed.toLowerCase() as Address,
        setupArgs,
        saltNonce: 1,
      })
    );
    predictProxyAddress({ mastercopy, setupArgs, saltNonce: 1 });
  });

  it("rejects an invalid mastercopy", () => {
    const invalid = [
      "0x1234",
      "0xzz",
      `${mastercopy}00`,
      // bad checksum
      "0xbb6e024b9cFFACB947A71991E386681B1Cd1477D",
    ] as Address[];
    for (const mastercopy of invalid) {
      assert.throws(
        () => predictProxyAddress({ mastercopy, setupArgs, saltNonce: 1 }),
        /is invalid/
      );
    }
  });
});
