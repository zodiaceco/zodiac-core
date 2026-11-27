/**
 * Regenerates `test/helpers/genesis.json`, the state the test chain boots
 * with: the canonical Safe 1.4.1 deployments, with code and storage read from
 * mainnet. Zodiac's own contracts are not in here; tests compile and deploy
 * them from disk.
 *
 *   node scripts/genesis.ts [rpc-url]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { createPublicClient, http, pad, type Address } from "viem";
import { mainnet } from "viem/chains";

import { CHAIN_ID } from "../test/helpers/constants.ts";

const safe141: Record<string, Address> = {
  Safe: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
  SafeL2: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
  SafeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  CompatibilityFallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
  TokenCallbackHandler: "0xeDCF620325E82e3B9836eaaeFdc4283E99Dd7562",
  MultiSend: "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526",
  MultiSendCallOnly: "0x9641d764fc13c8B624c04430C7356C1C7C8102e2",
  SignMessageLib: "0xd53cd0aB83D845Ac265BE939c57F53AD838012c9",
  CreateCall: "0x9b35Af71d77eaf8d7e40252370304687390A1A52",
  SimulateTxAccessor: "0x3d4BA2E0884aa488718476ca2FB8Efc291A46199",
};

// The singletons' constructors set `threshold = 1` (slot 4) so nobody can
// call `setup` on them directly. Proxies never see this slot.
const storage: Partial<Record<string, `0x${string}`[]>> = {
  Safe: ["0x4"],
  SafeL2: ["0x4"],
};

const client = createPublicClient({
  chain: mainnet,
  transport: http(process.argv[2] ?? "https://ethereum-rpc.publicnode.com"),
});

const alloc: Record<string, object> = {};
for (const [name, address] of Object.entries(safe141)) {
  const code = await client.getCode({ address });
  if (!code) throw new Error(`No code for ${name} at ${address}`);

  const slots: Record<string, string> = {};
  for (const slot of storage[name] ?? []) {
    slots[pad(slot)] = (await client.getStorageAt({ address, slot }))!;
  }

  alloc[address] = {
    balance: "0x0",
    code,
    ...(Object.keys(slots).length > 0 && { storage: slots }),
  };
}

const genesis = {
  config: { chainId: CHAIN_ID },
  nonce: "0x0",
  timestamp: "0x0",
  gasLimit: "0x1c9c380",
  difficulty: "0x0",
  alloc,
};

writeFileSync(
  join(import.meta.dirname, "..", "test", "helpers", "genesis.json"),
  JSON.stringify(genesis, null, 2) + "\n"
);
