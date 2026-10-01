const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const pkg = require(path.join(__dirname, "../../../electron-app/package.json"));

test("installer includes read-only catalog inputs without offline review and oracle trees", () => {
  const files = pkg.build.files;
  for (const required of [
    "capability-library/index.js",
    "capability-library/capability.schema.json",
    "capability-library/sample-corpus.schema.json",
    "capability-library/capabilities.json",
    "capability-library/corpus.json",
    "capability-library/capabilities/*/capabilities.json",
    "capability-library/capabilities/*/corpus.json",
  ]) assert.ok(files.includes(required), `missing installer input: ${required}`);
  assert.ok(!files.some((entry) => entry === "capability-library/**/*" || /oracles|reviewed-v8|candidate-pool|examples/.test(entry)));
  assert.ok(files.includes("!node_modules/fast-uri/benchmark/**"), "do not package dependency benchmark fixtures");
});
