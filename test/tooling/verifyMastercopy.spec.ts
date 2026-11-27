import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { encodeArgs } from "../../src/encoding/encodeArgs";
import verifyMastercopy from "../../src/tooling/verifyMastercopy";
import { addr } from "../helpers/constants";
import { withFakeTimers } from "../helpers/timers";

type Answer = { status?: number; json?: unknown };
type Request = {
  url: URL;
  method: string;
  body?: URLSearchParams;
  action: string | null;
};

const artifact = {
  contractName: "TestModule",
  sourceName: "contracts/test/TestContracts.sol",
  compilerVersion: "v0.8.30+commit.73712a01",
  compilerInput: { language: "Solidity", sources: {} },
  address: addr(1),
  constructorArgs: { types: ["address", "uint256"], values: [addr(2), 3n] },
};

const ok = (result: unknown) => ({
  json: { status: "1", message: "OK", result },
});
const notOk = (result: unknown) => ({
  json: { status: "0", message: "NOTOK", result },
});
const unverified = ok([{ SourceCode: "" }]);

/**
 * Runs `fn` against a fake explorer. `answers` maps each action to the
 * responses for its successive requests; the last one repeats.
 */
async function withExplorer<T>(
  answers: Partial<
    Record<"getsourcecode" | "verifysourcecode" | "checkverifystatus", Answer[]>
  >,
  fn: (requests: Request[]) => Promise<T>
): Promise<T> {
  const original = globalThis.fetch;
  const requests: Request[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    const body = init?.body instanceof URLSearchParams ? init.body : undefined;
    const action =
      url.searchParams.get("action") ?? body?.get("action") ?? null;
    requests.push({ url, method: init?.method ?? "GET", body, action });
    const queue = answers[action as keyof typeof answers];
    if (!queue?.length) throw new Error(`Unexpected request: ${action}`);
    const { status = 200, json } = queue.length > 1 ? queue.shift()! : queue[0];
    return new Response(JSON.stringify(json), { status });
  }) as typeof fetch;
  try {
    return await withFakeTimers(() => fn(requests));
  } finally {
    globalThis.fetch = original;
  }
}

const V2 = "https://api.etherscan.io/v2/api";
const LEGACY = "https://explorer.example/api";
const endpoint = (url: URL) => `${url.origin}${url.pathname}`;

const verify = (
  options: Partial<Parameters<typeof verifyMastercopy>[0]> = {}
) => verifyMastercopy({ chainId: 100, apiKey: "KEY", artifact, ...options });

const verifiesOnV2 = {
  getsourcecode: [unverified],
  verifysourcecode: [ok("guid-1")],
  checkverifystatus: [ok("Pass - Verified")],
};

describe("verifyMastercopy", () => {
  it("returns the artifact address and noop flag", async () => {
    await withExplorer(verifiesOnV2, async () => {
      assert.deepEqual(await verify(), {
        address: artifact.address,
        noop: false,
      });
    });
  });

  for (const [label, apiUrl, entry] of [
    [
      "legacy source present",
      LEGACY,
      { SourceCode: "contract X {}", SimilarMatch: "0x0" },
    ],
    [
      "V2 exact match",
      undefined,
      { SourceCode: "contract X {}", SimilarMatch: "" },
    ],
  ] as const) {
    it(`returns noop: true when already verified (${label})`, async () => {
      await withExplorer({ getsourcecode: [ok([entry])] }, async (requests) => {
        assert.deepEqual(await verify({ apiUrl }), {
          address: artifact.address,
          noop: true,
        });
        assert.deepEqual(
          requests.map((r) => r.action),
          ["getsourcecode"]
        );
      });
    });
  }

  it("submits again when V2 reports only a similar match", async () => {
    await withExplorer(
      {
        ...verifiesOnV2,
        getsourcecode: [
          ok([{ SourceCode: "contract X {}", SimilarMatch: "0x0" }]),
        ],
      },
      async (requests) => {
        assert.deepEqual(await verify(), {
          address: artifact.address,
          noop: false,
        });
        assert.deepEqual(
          requests.map((r) => r.action),
          ["getsourcecode", "verifysourcecode", "checkverifystatus"]
        );
      }
    );
  });

  it("returns noop: true when the submission answers already verified", async () => {
    await withExplorer(
      {
        getsourcecode: [unverified],
        verifysourcecode: [notOk("Contract source code already verified")],
      },
      async (requests) => {
        assert.deepEqual(await verify(), {
          address: artifact.address,
          noop: true,
        });
        assert.equal(requests.length, 2);
      }
    );
  });

  for (const [label, options, expected] of [
    ["default → Etherscan V2", { chainId: 100 }, V2],
    [
      "known chain id → built-in legacy URL",
      { chainId: 10200 },
      "https://gnosis-chiado.blockscout.com/api",
    ],
    ["explicit apiUrl wins", { chainId: 10200, apiUrl: LEGACY }, LEGACY],
  ] as const) {
    it(`selects the endpoint (${label})`, async () => {
      await withExplorer(
        { getsourcecode: [ok([{ SourceCode: "x" }])] },
        async (requests) => {
          await verify(options);
          const [request] = requests;
          assert.equal(endpoint(request.url), expected);
          assert.equal(
            request.url.searchParams.get("chainid"),
            String(options.chainId)
          );
          assert.equal(
            request.url.searchParams.get("address"),
            artifact.address
          );
        }
      );
    });
  }

  const encodedArgs = encodeArgs(artifact.constructorArgs).slice(2);
  const expectedFields = {
    contractaddress: artifact.address,
    sourceCode: JSON.stringify(artifact.compilerInput),
    codeformat: "solidity-standard-json-input",
    contractname: "contracts/test/TestContracts.sol:TestModule",
    compilerversion: artifact.compilerVersion,
  };

  it("submits standard JSON input with V2 routing (query string, constructorArguments)", async () => {
    await withExplorer(verifiesOnV2, async (requests) => {
      await verify({ apiKey: "  KEY  " });
      const submission = requests.find((r) => r.action === "verifysourcecode")!;
      assert.equal(submission.method, "POST");
      assert.deepEqual(Object.fromEntries(submission.url.searchParams), {
        apikey: "KEY",
        module: "contract",
        action: "verifysourcecode",
        chainid: "100",
      });
      assert.deepEqual(Object.fromEntries(submission.body!), {
        ...expectedFields,
        constructorArguments: encodedArgs,
      });
    });
  });

  it("submits standard JSON input with legacy routing (form body, constructorArguements)", async () => {
    await withExplorer(
      { getsourcecode: [unverified], verifysourcecode: [ok("guid-1")] },
      async (requests) => {
        assert.deepEqual(await verify({ apiUrl: LEGACY }), {
          address: artifact.address,
          noop: false,
        });
        const submission = requests.find(
          (r) => r.action === "verifysourcecode"
        )!;
        assert.equal(submission.method, "POST");
        assert.equal(submission.url.search, "");
        assert.deepEqual(Object.fromEntries(submission.body!), {
          apikey: "KEY",
          module: "contract",
          action: "verifysourcecode",
          ...expectedFields,
          constructorArguements: encodedArgs,
        });
        // Legacy explorers are not polled.
        assert.equal(requests.length, 2);
      }
    );
  });

  it("polls V2 checkverifystatus until Pass - Verified", async () => {
    await withExplorer(
      {
        ...verifiesOnV2,
        checkverifystatus: [
          ok("Pending in queue"),
          ok("Pending in queue"),
          ok("Pass - Verified"),
        ],
      },
      async (requests) => {
        await verify();
        const polls = requests.filter((r) => r.action === "checkverifystatus");
        assert.equal(polls.length, 3);
        for (const poll of polls)
          assert.equal(poll.url.searchParams.get("guid"), "guid-1");
      }
    );
  });

  const failures: [string, Parameters<typeof withExplorer>[0], RegExp][] = [
    [
      "getsourcecode status not ok",
      { getsourcecode: [notOk("Invalid API Key")] },
      /Checking verification for .*Invalid API Key/,
    ],
    [
      "submission status not ok",
      {
        getsourcecode: [unverified],
        verifysourcecode: [notOk("Fail - Unable to verify")],
      },
      /Submitting source code for .*Fail - Unable to verify/,
    ],
    [
      "V2 returns no GUID",
      { getsourcecode: [unverified], verifysourcecode: [ok("")] },
      /did not return a verification GUID/,
    ],
    [
      "verification result is a failure",
      {
        ...verifiesOnV2,
        checkverifystatus: [notOk("Fail - Unable to verify")],
      },
      /verification guid-1 failed: .*Fail - Unable to verify/,
    ],
    [
      "rate-limit retries are exhausted",
      {
        getsourcecode: [
          { status: 429, json: notOk("Max rate limit reached").json },
        ],
      },
      /is rate-limiting requests$/,
    ],
  ];
  for (const [label, answers, error] of failures) {
    it(`throws when ${label}`, async () => {
      await withExplorer(answers, async (requests) => {
        await assert.rejects(verify(), error);
        if (label === "rate-limit retries are exhausted")
          assert.equal(requests.length, 6);
      });
    });
  }
});
