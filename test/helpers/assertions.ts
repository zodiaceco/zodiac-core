import assert from "node:assert/strict";

import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  getAbiItem,
  isAddressEqual,
  parseEventLogs,
  type Abi,
  type AbiEvent,
  type Address,
  type Hash,
  type Hex,
} from "viem";

type Contract = { abi: Abi | readonly unknown[]; address: Address };

type ReceiptClient = {
  waitForTransactionReceipt: (args: { hash: Hash }) => Promise<{
    status: "success" | "reverted";
    logs: { address: Address; data: Hex; topics: readonly Hex[] }[];
  }>;
};

/**
 * Transaction assertions for the test chain. `tx` is the pending result of a
 * `contract.write.*` call (or any promise of a transaction hash).
 */
export default function createAssertions(client: ReceiptClient) {
  async function logsOf(
    tx: Promise<Hash>,
    contract: Contract,
    eventName: string
  ) {
    const receipt = await client.waitForTransactionReceipt({ hash: await tx });
    assert.equal(receipt.status, "success", "Transaction reverted");
    const logs = parseEventLogs({
      abi: contract.abi as Abi,
      logs: receipt.logs.filter((log) =>
        isAddressEqual(log.address, contract.address)
      ) as any,
      eventName: eventName as never,
    });
    const event = getAbiItem({
      abi: contract.abi as Abi,
      name: eventName,
    }) as AbiEvent;
    return logs.map(({ args }: { args: unknown }) =>
      Array.isArray(args)
        ? args
        : event.inputs.map(
            (input, i) => (args as Record<string, unknown>)[input.name ?? i]
          )
    );
  }

  /** Expects `tx` to revert, for any reason. */
  async function revert(tx: Promise<unknown>) {
    await revertData(tx);
  }

  /** Expects `tx` to revert without any revert data. */
  async function revertWithoutReason(tx: Promise<unknown>) {
    const data = await revertData(tx, { allowEmpty: true });
    assert.equal(data, "0x", `Expected a bare revert, got ${data}`);
  }

  /** Expects `tx` to revert with `Error(reason)`, as `require(cond, reason)`. */
  async function revertWith(tx: Promise<unknown>, reason: string) {
    const data = await revertData(tx);
    const { errorName, args } = decodeErrorResult({ abi: [], data });
    assert.equal(
      errorName,
      "Error",
      `Expected a revert reason, got ${errorName}`
    );
    assert.equal(args[0], reason);
  }

  /** Expects `tx` to revert with custom error `errorName` from `contract`. */
  async function revertWithCustomError(
    tx: Promise<unknown>,
    contract: Contract,
    errorName: string
  ) {
    const data = await revertData(tx);
    const decoded = decodeErrorResult({ abi: contract.abi as Abi, data });
    assert.equal(decoded.errorName, errorName);
    return decoded.args ?? [];
  }

  /** As `revertWithCustomError`, also comparing the error's arguments. */
  async function revertWithCustomErrorWithArgs(
    tx: Promise<unknown>,
    contract: Contract,
    errorName: string,
    expected: readonly unknown[]
  ) {
    const args = await revertWithCustomError(tx, contract, errorName);
    assert.deepEqual(normalize(args), normalize(expected));
  }

  /** Expects `tx` to succeed with `contract` emitting `eventName`. */
  async function emit(
    tx: Promise<Hash>,
    contract: Contract,
    eventName: string
  ) {
    const logs = await logsOf(tx, contract, eventName);
    assert.ok(logs.length > 0, `Expected "${eventName}" to be emitted`);
  }

  /** As `emit`, with at least one of the events carrying `expected`. */
  async function emitWithArgs(
    tx: Promise<Hash>,
    contract: Contract,
    eventName: string,
    expected: readonly unknown[]
  ) {
    const logs = await logsOf(tx, contract, eventName);
    assert.ok(logs.length > 0, `Expected "${eventName}" to be emitted`);
    const want = normalize(expected);
    const got = logs.map(normalize);
    if (!got.some((args) => isDeepEqual(args, want))) {
      assert.deepEqual(got.length === 1 ? got[0] : got, want);
    }
  }

  /** Expects `tx` to succeed without `contract` emitting `eventName`. */
  async function notEmit(
    tx: Promise<Hash>,
    contract: Contract,
    eventName: string
  ) {
    const logs = await logsOf(tx, contract, eventName);
    assert.equal(logs.length, 0, `Expected "${eventName}" not to be emitted`);
  }

  /**
   * Expects `tx` to succeed and returns the events that any of `contracts`
   * emitted, in log order.
   */
  async function events(tx: Promise<Hash>, contracts: readonly Contract[]) {
    const receipt = await client.waitForTransactionReceipt({ hash: await tx });
    assert.equal(receipt.status, "success", "Transaction reverted");
    return receipt.logs.flatMap((log) => {
      const contract = contracts.find((c) =>
        isAddressEqual(c.address, log.address)
      );
      if (!contract) return [];
      return parseEventLogs({
        abi: contract.abi as Abi,
        logs: [log as any],
      }).map(({ eventName, args }) => ({
        address: contract.address,
        eventName,
        args: args as Record<string, unknown>,
      }));
    });
  }

  return {
    revert,
    revertWithoutReason,
    revertWith,
    revertWithCustomError,
    revertWithCustomErrorWithArgs,
    emit,
    emitWithArgs,
    notEmit,
    events,
  };
}

/** Awaits `tx`, expecting it to fail, and returns the raw revert data. */
async function revertData(
  tx: Promise<unknown>,
  { allowEmpty = false } = {}
): Promise<Hex> {
  let error: unknown;
  try {
    await tx;
  } catch (e) {
    error = e;
  }
  assert.ok(error, "Expected the transaction to revert");

  const found =
    error instanceof BaseError
      ? error.walk((e) => rawData(e) !== undefined)
      : rawData(error) !== undefined
        ? error
        : null;
  const data = found ? rawData(found) : undefined;
  if (data === undefined) {
    if (allowEmpty && isBareRevert(error)) return "0x";
    throw error;
  }
  return data;
}

function rawData(error: unknown): Hex | undefined {
  if (error instanceof ContractFunctionRevertedError) return error.raw;
  const data = (error as { data?: unknown })?.data;
  if (isHex(data)) return data;
  const nested = (data as { data?: unknown })?.data;
  if (isHex(nested)) return nested;
  return undefined;
}

/** A revert that carried no data: nodes report it without a `data` field. */
function isBareRevert(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /execution reverted(?!:)/i.test(message);
}

const isHex = (value: unknown): value is Hex =>
  typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value);

/** Lowercases hex strings, so checksummed and plain addresses compare equal. */
function normalize(value: unknown): unknown {
  if (typeof value === "string" && isHex(value)) return value.toLowerCase();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalize(v)])
    );
  }
  return value;
}

function isDeepEqual(a: unknown, b: unknown) {
  try {
    assert.deepEqual(a, b);
    return true;
  } catch {
    return false;
  }
}
