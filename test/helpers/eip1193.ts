import type { Address } from "viem";

import type { EIP1193Provider } from "../../src/types";

/**
 * Wraps an EIP-1193 provider so that `eth_sendTransaction` requests without a
 * `from` field are sent from `from`. Hardhat's local accounts are unlocked, so
 * the wrapped provider signs with the node itself, exactly as a wallet would.
 */
export default function withSender(
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
