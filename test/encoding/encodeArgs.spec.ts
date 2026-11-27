import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decodeFunctionData,
  encodeAbiParameters,
  parseAbi,
  type AbiParameter,
} from "viem";

import { encodeArgs, encodeSetUp } from "../../src/encoding/encodeArgs";
import { addr } from "../helpers/constants";

const tupleType = {
  type: "tuple",
  components: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
  ],
} as const;

describe("encodeArgs", () => {
  it("returns 0x for empty args", () => {
    assert.equal(encodeArgs({ types: [], values: [] }), "0x");
  });

  const kinds: [
    string,
    (string | AbiParameter)[],
    unknown[],
    readonly AbiParameter[],
  ][] = [
    [
      "human-readable strings",
      ["address", "uint256", "bytes"],
      [addr(1), 5n, "0xbaddad"],
      [{ type: "address" }, { type: "uint256" }, { type: "bytes" }],
    ],
    [
      "AbiParameter objects",
      [{ type: "address" }, { type: "bool", name: "flag" }],
      [addr(1), true],
      [{ type: "address" }, { type: "bool" }],
    ],
    [
      "a mix of both",
      ["address", { type: "uint8" }],
      [addr(1), 7],
      [{ type: "address" }, { type: "uint8" }],
    ],
    [
      "arrays and named tuples",
      [
        "uint256[]",
        "(address to, uint256 value)",
        "(address to, uint256 value)[2]",
      ],
      [
        [1n, 2n],
        { to: addr(1), value: 3n },
        [
          { to: addr(2), value: 4n },
          { to: addr(3), value: 5n },
        ],
      ],
      [{ type: "uint256[]" }, tupleType, { ...tupleType, type: "tuple[2]" }],
    ],
  ];
  for (const [kind, types, values, expectedTypes] of kinds) {
    it(`encodes ${kind}`, () => {
      assert.equal(
        encodeArgs({ types, values }),
        encodeAbiParameters(expectedTypes, values)
      );
    });
  }

  const invalid: [string, (string | AbiParameter)[], unknown[], string][] = [
    ["unparseable type string", ["uint257"], [1n], "UnknownSolidityTypeError"],
    [
      "types/values length mismatch",
      ["address", "uint256"],
      [addr(1)],
      "AbiEncodingLengthMismatchError",
    ],
    ["value not fitting its type", ["uint8"], [256], "IntegerOutOfRangeError"],
  ];
  for (const [label, types, values, name] of invalid) {
    it(`throws on ${label}`, () => {
      assert.throws(() => encodeArgs({ types, values }), { name });
    });
  }
});

describe("encodeSetUp", () => {
  const setUpAbi = parseAbi(["function setUp(bytes initializeParams)"]);

  for (const [label, args] of [
    ["empty args", { types: [], values: [] }],
    [
      "non-empty args",
      { types: ["address", "uint256"], values: [addr(1), 2n] },
    ],
  ] as const) {
    it(`wraps the encoded args in a setUp(bytes) call (${label})`, () => {
      const data = encodeSetUp(args);
      const { functionName, args: decoded } = decodeFunctionData({
        abi: setUpAbi,
        data,
      });
      assert.equal(functionName, "setUp");
      assert.deepEqual(decoded, [encodeArgs(args)]);
    });
  }
});
