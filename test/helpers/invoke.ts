import type { Hex } from "viem";

type Options = { account?: unknown };

/**
 * `contract.write[functionName](args, options)` for a function picked at
 * runtime, as the specs that run once per contract variant do. Returns the
 * transaction hash.
 */
export function write(
  contract: { write: object },
  functionName: string,
  args: readonly unknown[],
  options?: Options
): Promise<Hex> {
  return (contract.write as any)[functionName](args, options);
}

/** As `write`, but simulates the call and returns its result. */
export async function simulate(
  contract: { simulate: object },
  functionName: string,
  args: readonly unknown[],
  options?: Options
): Promise<any> {
  return (await (contract.simulate as any)[functionName](args, options)).result;
}
