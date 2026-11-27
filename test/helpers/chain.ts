import { spawn } from "node:child_process";

import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  custom,
  getAddress,
  getContract,
  http,
  numberToHex,
  type Address,
  type ContractConstructorArgs,
  type Hex,
  type GetContractReturnType,
} from "viem";
import { foundry } from "viem/chains";

import * as contracts from "../../build/contracts";
import type { EIP1193Provider } from "../../src/types";
import createAssertions from "./assertions";
import { CHAIN_ID } from "./constants";

type Contracts = typeof contracts;
export type ContractName = keyof Contracts;
type AbiOf<N extends ContractName> = Contracts[N]["abi"];

const chain = { ...foundry, id: CHAIN_ID };

// viem polls for receipts; its default 4s interval would make every
// `waitForTransactionReceipt` take 4s.
const pollingInterval = 10;

/**
 * Starts a private anvil chain for one test file. Contracts from `contracts/`
 * are deployed by the tests themselves, from the artifacts `scripts/compile.ts`
 * writes.
 *
 * Every chain listens on its own free port, so test files run in parallel
 * without sharing state.
 */
export async function startChain() {
  const url = await spawnAnvil();
  const rpc = http(url)({ chain, retryCount: 0 });

  const transport = createTransport(rpc);
  // The test wallets send every transaction with a fixed, generous gas limit.
  // anvil's estimate only covers the outer call: an inner call that runs out
  // of gas fails without reverting it (an avatar reporting `success: false`),
  // so an estimated limit would make such calls fail silently.
  const walletTransport = createTransport(rpc, { gas: WALLET_GAS });

  const publicClient = createPublicClient({
    chain,
    transport,
    pollingInterval,
  });
  const testClient = createTestClient({
    chain,
    transport,
    mode: "anvil",
    pollingInterval,
  });

  // anvil's default dev accounts, unlocked on the node.
  const accounts = await createWalletClient({
    chain,
    transport,
  }).getAddresses();
  const walletClients = accounts.map((account) =>
    createWalletClient({
      account,
      chain,
      transport: walletTransport,
      pollingInterval,
    })
  );

  type PublicClient = typeof publicClient;
  type WalletClient = (typeof walletClients)[number];
  type Contract<N extends ContractName> = GetContractReturnType<
    AbiOf<N>,
    { public: PublicClient; wallet: WalletClient }
  >;
  type Options = { client?: { wallet?: WalletClient } };

  function getContractAt<N extends ContractName>(
    name: N,
    address: Address,
    { client: { wallet = walletClients[0] } = {} }: Options = {}
  ): Contract<N> {
    return getContract({
      abi: contracts[name].abi,
      address,
      client: { public: publicClient, wallet },
    }) as Contract<N>;
  }

  /** Deploys `name` from the compiled artifacts and waits for it to be mined. */
  async function deployContract<N extends ContractName>(
    name: N,
    args?: ContractConstructorArgs<AbiOf<N>>,
    options: Options = {}
  ): Promise<Contract<N>> {
    const wallet = options.client?.wallet ?? walletClients[0];
    const { abi, bytecode } = contracts[name];
    const hash = await wallet.deployContract({
      abi,
      bytecode,
      args,
    } as Parameters<WalletClient["deployContract"]>[0]);
    const { contractAddress, status } =
      await publicClient.waitForTransactionReceipt({ hash });
    if (status !== "success" || !contractAddress) {
      throw new Error(`Deploying ${name} failed`);
    }
    return getContractAt(name, getAddress(contractAddress), options);
  }

  /** Deploys raw creation `bytecode` and waits for it to be mined. */
  async function deployBytecode(
    bytecode: Hex,
    wallet: WalletClient = walletClients[0]
  ): Promise<Address> {
    const hash = await wallet.sendTransaction({ data: bytecode } as Parameters<
      WalletClient["sendTransaction"]
    >[0]);
    const { contractAddress, status } =
      await publicClient.waitForTransactionReceipt({ hash });
    if (status !== "success" || !contractAddress) {
      throw new Error("Deploying bytecode failed");
    }
    return getAddress(contractAddress);
  }

  const fixtures: { fixture: Function; id: `0x${string}`; result: unknown }[] =
    [];

  /**
   * Runs `fixture` once and snapshots the chain. Every later call reverts to
   * that snapshot and returns the same result, so each test starts from the
   * same state without paying for the setup again.
   *
   * Reverting discards snapshots taken after it, so fixtures loaded later than
   * this one run again the next time they are used.
   */
  async function loadFixture<T>(fixture: () => Promise<T>): Promise<T> {
    if (fixture.name === "") {
      throw new Error(
        "loadFixture needs a named function: an inline one is a new fixture on every call"
      );
    }

    const index = fixtures.findIndex((entry) => entry.fixture === fixture);
    if (index === -1) {
      const result = await fixture();
      fixtures.push({ fixture, id: await testClient.snapshot(), result });
      return result;
    }

    const entry = fixtures[index];
    await testClient.revert({ id: entry.id });
    entry.id = await testClient.snapshot();
    fixtures.splice(index + 1);
    return entry.result as T;
  }

  const provider: EIP1193Provider = {
    request: (args) => publicClient.request(args as any),
  };

  return {
    url,
    publicClient,
    testClient,
    walletClients,
    provider,
    deployContract,
    deployBytecode,
    getContractAt,
    loadFixture,
    assertions: createAssertions(publicClient),
    stop: () => stopAnvil(url),
  };
}

export type Chain = Awaited<ReturnType<typeof startChain>>;

const WALLET_GAS = 10_000_000n;

/**
 * Transactions behave as on an in-process node: a transaction that would
 * revert is rejected when sent, and one that is sent is mined by the time its
 * hash is returned.
 *  - anvil mines reverting transactions, dropping the revert data. Gas
 *    estimation fails on them instead, with the revert data on the error,
 *    which is what the assertions decode.
 *  - anvil answers before the block exists, so a read or snapshot right after
 *    a write could still see the state before it.
 *
 * With `gas`, every transaction is sent with that gas limit.
 */
function createTransport(
  rpc: ReturnType<ReturnType<typeof http>>,
  { gas }: { gas?: bigint } = {}
) {
  return custom(
    {
      async request({ method, params }) {
        if (method !== "eth_sendTransaction") {
          return rpc.request({ method, params });
        }
        const transaction = gas
          ? { ...params[0], gas: numberToHex(gas) }
          : params[0];
        await rpc.request({ method: "eth_estimateGas", params: [transaction] });
        const hash = await rpc.request({ method, params: [transaction] });
        while (
          !(await rpc.request({
            method: "eth_getTransactionReceipt",
            params: [hash],
          }))
        ) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        return hash;
      },
    },
    { retryCount: 0 }
  );
}

const processes = new Map<string, ReturnType<typeof spawn>>();

// A test file that crashes never reaches its `after` hook. Don't leave its
// anvil running.
process.on("exit", () => {
  for (const anvil of processes.values()) anvil.kill();
});

function stopAnvil(url: string) {
  processes.get(url)?.kill();
  processes.delete(url);
}

function spawnAnvil(): Promise<string> {
  const anvil = spawn(
    "anvil",
    [
      "--chain-id",
      String(CHAIN_ID),
      // anvil predeploys Nick's factory, which deployFactories has to deploy.
      "--disable-default-create2-deployer",
      "--port",
      "0",
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  return new Promise((resolve, reject) => {
    let output = "";
    const cleanup = () => {
      anvil.stdout.off("data", onStdout);
      anvil.stderr.off("data", onStderr);
      anvil.off("error", onError);
      anvil.off("exit", onExit);
      anvil.stdout.resume();
      anvil.stderr.resume();
    };
    const onStdout = (chunk: Buffer) => {
      output += chunk;
      const match = output.match(/Listening on (\S+)/);
      if (match) {
        const url = `http://${match[1]}`;
        processes.set(url, anvil);
        cleanup();
        resolve(url);
      }
    };
    const onStderr = (chunk: Buffer) => {
      output += chunk;
    };
    const onError = (error: Error) => {
      cleanup();
      reject(
        Object.assign(error, {
          message: `Could not start anvil (install it with foundryup): ${error.message}`,
        })
      );
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`anvil exited with code ${code}\n${output}`));
    };
    anvil.stdout.on("data", onStdout);
    anvil.stderr.on("data", onStderr);
    anvil.on("error", onError);
    anvil.on("exit", onExit);
  });
}
