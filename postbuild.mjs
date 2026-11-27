import { writeFileSync } from "node:fs";

// Package root is `"type": "module"`, so `dist/esm/*.js` are ESM already and
// `dist/cjs/*.js` need their own package.json flipping the type to commonjs.
writeFileSync(
  "dist/cjs/package.json",
  JSON.stringify({ type: "commonjs" }) + "\n"
);
