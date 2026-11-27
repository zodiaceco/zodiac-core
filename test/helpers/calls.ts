import {
  encodeAbiParameters,
  encodeErrorResult,
  encodeFunctionData,
  type Hex,
} from "viem";

import { Receiver } from "../../build/contracts";

/** Calldata for `Receiver.succeed(payload)`, which returns `payload`. */
export const succeed = (payload: Hex = "0xabcdef") =>
  encodeFunctionData({
    abi: Receiver.abi,
    functionName: "succeed",
    args: [payload],
  });

/** Return data of `Receiver.succeed(payload)`. */
export const succeeded = (payload: Hex = "0xabcdef") =>
  encodeAbiParameters([{ type: "bytes" }], [payload]);

/** Calldata for `Receiver.fail()`, which reverts with `Failed()`. */
export const fail = () =>
  encodeFunctionData({ abi: Receiver.abi, functionName: "fail" });

/** Revert data of `Receiver.fail()`. */
export const failedError = () =>
  encodeErrorResult({ abi: Receiver.abi, errorName: "Failed" });

export const poke = () =>
  encodeFunctionData({ abi: Receiver.abi, functionName: "poke" });
