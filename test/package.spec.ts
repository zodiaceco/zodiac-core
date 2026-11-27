import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";

import * as root from "../src/index";
import * as tooling from "../src/tooling";

const packageDir = join(import.meta.dirname, "..");
const src = join(packageDir, "src");
const manifest = JSON.parse(
  readFileSync(join(packageDir, "package.json"), "utf8")
);

/**
 * The source file a build output comes from: the builds compile `src/` into
 * `dist/esm` and `dist/cjs`, keeping the file layout.
 */
function sourceOf(output: string) {
  const match = /^\.\/dist\/(?:esm|cjs)\/(.+?)(?:\.d\.ts|\.js)$/.exec(output);
  assert.ok(match, `${output} is not a build output`);
  return join(src, `${match[1]}.ts`);
}

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

  for (const [subpath, entry] of [
    [".", "index.ts"],
    ["./tooling", "tooling.ts"],
  ] as const) {
    it(`maps "${subpath}" in package.json to the build of src/${entry}`, () => {
      const targets = manifest.exports[subpath];
      assert.deepEqual(Object.keys(targets), ["types", "import", "require"]);
      for (const target of Object.values<string>(targets)) {
        assert.equal(sourceOf(target), join(src, entry), target);
      }
      assert.ok(existsSync(join(src, entry)));
    });
  }

  it("maps main, module and types in package.json to the build of src/index.ts", () => {
    for (const field of ["main", "module", "types"]) {
      assert.equal(sourceOf(manifest[field]), join(src, "index.ts"), field);
    }
  });

  it("publishes the contracts and the build", () => {
    assert.equal(manifest.exports["./contracts/*"], "./contracts/*");
    for (const path of ["dist", "contracts"]) {
      assert.ok(manifest.files.includes(path), path);
    }
  });

  it("does not pull tooling into the root entry", () => {
    assert.equal(inTooling(moduleGraph(join(src, "index.ts"))), 0);
    assert.ok(inTooling(moduleGraph(join(src, "tooling.ts"))) > 0);
  });
});
