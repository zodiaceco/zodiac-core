import { AbiCoder } from "ethers";

/**
 * Verifies the contract on a blockchain explorer using the provided API.
 *
 * @param {Object} params - The function parameters.
 * @param {string} params.contractName - The name of the contract.
 * @param {string} params.sourceName - The source name of the contract.
 * @param {string} params.compilerVersion - The version of the compiler used.
 * @param {Object} params.compilerInput - The compiler input in standard JSON format.
 * @param {string} params.address - The address of the deployed contract.
 * @param {Object} params.constructorArgs - The constructor arguments of the contract.
 * @param {string[]} params.constructorArgs.types - The types of the constructor arguments.
 * @param {unknown[]} params.constructorArgs.values - The values of the constructor arguments.
 * @param {number} params.chainId - The chain ID.
 * @param {string} params.apiKey - The API key for the blockchain explorer.
 * @param {string} [params.apiUrl] - Optional custom API URL. Defaults to the explorer for the chain.
 *
 * @returns {Promise<{ noop: boolean }>} The verification result.
 * @throws {Error} If the API URL is unreachable, the API key is invalid, or the verification fails.
 */
export async function verifySourceCode({
  contractName,
  sourceName,
  compilerVersion,
  compilerInput,
  address,
  constructorArgs: { types, values },
  chainId,
  apiKey,
  apiUrl,
}: {
  contractName: string;
  sourceName: string;
  compilerVersion: string;
  compilerInput: unknown;
  address: string;
  constructorArgs: {
    types: readonly string[];
    values: readonly unknown[];
  };
  chainId: number;
  apiKey: string;
  apiUrl?: string;
}): Promise<{ noop: boolean }> {
  const url = new URL(apiUrl || apiUrls[chainId] || ETHERSCAN_API_URL);
  const explorer = {
    url,
    chainId,
    apiKey: apiKey.trim(),
    isV2: /^\/v2\/api\/?$/.test(url.pathname),
  };
  const source = await request(explorer, { action: "getsourcecode", address });
  if (!isOk(source.status) || !Array.isArray(source.result)) {
    throw new Error(
      `Checking verification for ${address}: ${source.message} ${source.result}`
    );
  }
  const entry = source.result[0];
  if (entry?.SourceCode && (!explorer.isV2 || !entry.SimilarMatch)) {
    return { noop: true };
  }

  const constructorArguments = AbiCoder.defaultAbiCoder()
    .encode(types, values)
    .slice(2);
  const argumentField = explorer.isV2
    ? "constructorArguments"
    : "constructorArguements";
  const { status, message, result } = await request(
    explorer,
    { action: "verifysourcecode" },
    {
      contractaddress: address,
      sourceCode: JSON.stringify(compilerInput),
      codeformat: "solidity-standard-json-input",
      contractname: `${sourceName}:${contractName}`,
      compilerversion: compilerVersion,
      [argumentField]: constructorArguments,
    }
  );

  if (isAlreadyVerified(result)) {
    return { noop: true };
  }
  if (!isOk(status)) {
    throw new Error(
      `Submitting source code for ${address}: ${message} ${result}`
    );
  }

  if (explorer.isV2) {
    if (typeof result !== "string" || result.trim() === "") {
      throw new Error(
        `Etherscan did not return a verification GUID for ${address}`
      );
    }
    await waitForResult(explorer, result);
  }
  return { noop: false };
}

const ETHERSCAN_API_URL = "https://api.etherscan.io/v2/api";
const POLL_INTERVAL_MS = 3_000;
const MAX_STATUS_POLLS = 60;
const RATE_LIMIT_BACKOFF_MS = 1_000;
const MAX_REQUEST_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 30_000;
const V2_REQUEST_TIMEOUT_MS = 20_000;
const V2_RATE_LIMIT_RETRIES = 5;
const MAX_RATE_LIMIT_WAIT_MS = 60_000;
const REQUEST_INTERVAL_MS = 400;
let nextRequestAt = 0;

type Explorer = { url: URL; chainId: number; apiKey: string; isV2: boolean };
type ExplorerResponse = {
  status: string | number;
  message: string;
  result: unknown;
};

async function request(
  { url: baseUrl, chainId, apiKey, isV2 }: Explorer,
  query: { action: string } & Record<string, string>,
  body?: Record<string, string>
): Promise<ExplorerResponse> {
  const url = new URL(baseUrl);
  const routing = { apikey: apiKey, module: "contract", ...query };
  if (isV2 || !body) {
    for (const [name, value] of Object.entries({
      ...routing,
      chainid: String(chainId),
    })) {
      url.searchParams.set(name, value);
    }
  }
  const form =
    body && new URLSearchParams(isV2 ? body : { ...routing, ...body });

  if (isV2) return requestV2(url, form);

  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, {
      ...(form && { method: "POST", body: form }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const canRetry = attempt < MAX_REQUEST_ATTEMPTS;
    if (response.status === 429 && canRetry) {
      await response.body?.cancel();
      await sleep(RATE_LIMIT_BACKOFF_MS);
      continue;
    }
    if (!response.ok) {
      throw new Error(
        `Explorer ${query.action} on chain ${chainId} returned HTTP ${response.status}`
      );
    }
    const json = (await response.json()) as ExplorerResponse;
    if (
      canRetry &&
      String(json.status) === "0" &&
      typeof json.result === "string" &&
      /rate limit/i.test(json.result)
    ) {
      await sleep(RATE_LIMIT_BACKOFF_MS);
      continue;
    }
    return json;
  }
}

async function requestV2(
  url: URL,
  form?: URLSearchParams
): Promise<ExplorerResponse> {
  for (let attempt = 0; ; attempt++) {
    await queueRequest();
    const signal = AbortSignal.timeout(V2_REQUEST_TIMEOUT_MS);
    let response: Response;
    let json: ExplorerResponse | undefined;
    try {
      response = await fetch(url, {
        ...(form && { method: "POST", body: form }),
        redirect: "error",
        signal,
      });
      json = (await response.json().catch(() => undefined)) as
        | ExplorerResponse
        | undefined;
      signal.throwIfAborted();
    } catch (error) {
      if (signal.aborted) {
        throw new Error(
          `${url.host} didn't answer within ${V2_REQUEST_TIMEOUT_MS / 1_000}s`
        );
      }
      throw error;
    }

    const message = `${json?.message ?? ""} ${json?.result ?? ""}`;
    if (
      response.status === 429 ||
      /rate limit|too many requests/i.test(message)
    ) {
      const wait = retryAfterMs(response.headers);
      if (wait > MAX_RATE_LIMIT_WAIT_MS) {
        throw new Error(
          `${url.host} is rate-limiting requests ` +
            `(quota resets in ${Math.ceil(wait / 60_000)} min)`
        );
      }
      if (attempt >= V2_RATE_LIMIT_RETRIES) {
        throw new Error(`${url.host} is rate-limiting requests`);
      }
      await sleep(Math.max(3_000 * 2 ** attempt, wait));
      continue;
    }
    if (!response.ok || !json) {
      throw new Error(`Explorer request failed: ${response.status}`);
    }
    return json;
  }
}

async function queueRequest(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextRequestAt);
  nextRequestAt = slot + REQUEST_INTERVAL_MS;
  await sleep(slot - now);
}

function retryAfterMs(headers: Headers): number {
  const retryAfter = headers.get("retry-after");
  if (!retryAfter) return 0;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(retryAfter);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

async function waitForResult(explorer: Explorer, guid: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_STATUS_POLLS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    const { status, message, result } = await request(explorer, {
      action: "checkverifystatus",
      guid,
    });
    if (result === "Pending in queue") continue;
    if (
      (isOk(status) && result === "Pass - Verified") ||
      isAlreadyVerified(result)
    ) {
      return;
    }
    throw new Error(
      `Etherscan verification ${guid} failed: ${message} ${result}`
    );
  }
  throw new Error(
    `Etherscan verification ${guid} is still pending after ${MAX_STATUS_POLLS} status checks`
  );
}

function isOk(status: string | number): boolean {
  return String(status) === "1";
}

function isAlreadyVerified(result: unknown): boolean {
  return (
    typeof result === "string" &&
    /^(Already verified|(?:Contract )?source code already verified)\b/i.test(
      result
    )
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const apiUrls: Record<number, string | undefined> = {
  [77]: "https://blockscout.com/poa/sokol/api",
  [128]: "https://api.hecoinfo.com/api",
  [250]: "https://api.ftmscan.com/api",
  [256]: "https://api-testnet.hecoinfo.com/api",
  [1135]: "https://blockscout.lisk.com/api",
  [10200]: "https://gnosis-chiado.blockscout.com/api",
  [43113]: "https://api-testnet.snowtrace.io/api",
  [60808]: "https://explorer.gobob.xyz/api",
  [80001]: "https://api-testnet.polygonscan.com/api",
  [808813]: "https://bob-sepolia.explorer.gobob.xyz/api",
  [1313161554]: "https://explorer.mainnet.aurora.dev/api",
  [1313161555]: "https://explorer.testnet.aurora.dev/api",
  [1666600000]: "https://ctrver.t.hmny.io/verify",
  [1666700000]: "https://ctrver.t.hmny.io/verify?network=testnet",
};
