const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const pkg = require(path.join(__dirname, "../../../electron-app/package.json"));

test("installer includes read-only catalog inputs without offline review and oracle trees", () => {
  const files = pkg.build.files;
  for (const required of [
    "capability-library/index.js",
    "capability-library/schemas/domain.schema.json",
    "capability-library/registry/domains.json",
    "capability-library/schemas/capability.schema.json",
    "capability-library/schemas/capability.v1.schema.json",
    "capability-library/schemas/sample-corpus.schema.json",
    "capability-library/registry/capabilities.json",
    "capability-library/shared/corpus.json",
    "capability-library/domains/*/capabilities/*/capabilities.json",
    "capability-library/domains/*/capabilities/*/corpus.json",
    "capability-library/domains/*/capabilities/*/batches/B*/manifest.json",
  ]) assert.ok(files.includes(required), `missing installer input: ${required}`);
  assert.ok(!files.some((entry) => entry === "capability-library/**/*" || /oracles|reviewed-v8|candidate-pool|examples|batches\/B\*\/\*\*/.test(entry)));
  assert.ok(files.includes("!node_modules/fast-uri/benchmark/**"), "do not package dependency benchmark fixtures");
});
