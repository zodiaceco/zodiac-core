import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";

import * as root from "../src/index";
import * as tooling from "../src/tooling";

const src = join(import.meta.dirname, "..", "src");

const ROOT_EXPORTS = [
  "encodeDeployProxy",
  "encodeDeploySingleton",
  "predictProxyAddress",
  "predictSingletonAddress",
];
const TOOLING_EXPORTS = [
  "deployFactories",
  "deployMastercopy",
  "deployProxy",
  "verifyMastercopy",
];

/** Every source file reachable from `entry` through relative imports. */
function moduleGraph(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const source = readFileSync(entry, "utf8");
  for (const [, specifier] of source.matchAll(
    /(?:from|import)\s+["'](\.[^"']+)["']/g
  )) {
    moduleGraph(
      resolve(dirname(entry), specifier.replace(/\.js$/, ".ts")),
      seen
    );
  }
  return seen;
}

const inTooling = (files: Set<string>) =>
  [...files].filter((file) => file.startsWith(join(src, "tooling"))).length;

describe("package exports", () => {
  it("exposes the encoding functions from the root entry", async () => {
    assert.deepEqual(Object.keys(root).sort(), ROOT_EXPORTS);
    for (const name of ROOT_EXPORTS) {
      const module = await import(`../src/encoding/${name}`);
      assert.equal(root[name as keyof typeof root], module.default, name);
    }
  });

  it("exposes the root exports plus tooling from ./tooling", () => {
    assert.deepEqual(
      Object.keys(tooling).sort(),
      [...ROOT_EXPORTS, ...TOOLING_EXPORTS].sort()
    );
    for (const name of ROOT_EXPORTS) {
      assert.equal(
        tooling[name as keyof typeof tooling],
        root[name as keyof typeof root],
        name
      );
    }
    for (const name of TOOLING_EXPORTS) {
      assert.equal(
        typeof tooling[name as keyof typeof tooling],
        "function",
        name
      );
    }
  });

  it("does not pull tooling into the root entry", () => {
    assert.equal(inTooling(moduleGraph(join(src, "index.ts"))), 0);
    assert.ok(inTooling(moduleGraph(join(src, "tooling.ts"))) > 0);
  });
});
