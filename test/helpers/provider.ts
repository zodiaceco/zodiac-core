import type { Address } from "viem";

import type { EIP1193Provider, RequestArguments } from "../../src/types";

/**
 * Wraps an EIP-1193 provider so that `eth_sendTransaction` requests without a
 * `from` field are sent from `from`. anvil's dev accounts are unlocked, so the
 * node signs, as a wallet would.
 */
export function withSender(
  provider: EIP1193Provider,
  from: Address
): EIP1193Provider {
  return {
    request: ({ method, params }) => {
      if (method === "eth_sendTransaction") {
        const [transaction] = params as [Record<string, unknown>];
        return provider.request({
          method,
          params: [{ from, ...transaction }],
        });
      }
      return provider.request({ method, params });
    },
  };
}

export type RecordedRequest = {
  method: string;
  params: any[];
  result?: unknown;
};

/**
 * Wraps `provider`, recording every request with its result. `override` can
 * answer a request instead of `provider`: return `undefined` to pass it on.
 */
export function recording(
  provider: EIP1193Provider,
  override?: (args: RequestArguments) => Promise<unknown> | undefined
) {
  const requests: RecordedRequest[] = [];
  const wrapped: EIP1193Provider = {
    async request(args) {
      const entry: RecordedRequest = {
        method: args.method,
        params: (args.params ?? []) as any[],
      };
      requests.push(entry);
      entry.result = await (override?.(args) ?? provider.request(args));
      return entry.result;
    },
  };
  const of = (method: string) => requests.filter((r) => r.method === method);
  return { provider: wrapped, requests, of };
}

/** A provider answered entirely by `handler`, failing on anything else. */
export function stubProvider(
  handlers: Record<string, (params: any[]) => unknown>
) {
  const requests: RecordedRequest[] = [];
  const provider: EIP1193Provider = {
    async request({ method, params }) {
      requests.push({ method, params: (params ?? []) as any[] });
      const handler = handlers[method];
      if (!handler) throw new Error(`Unexpected request: ${method}`);
      return handler((params ?? []) as any[]);
    },
  };
  return { provider, requests };
}
