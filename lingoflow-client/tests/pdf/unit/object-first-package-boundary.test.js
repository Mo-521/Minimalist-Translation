"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const pkg = require("../../../electron-app/package.json");
const { physicalScriptPath } = require(
  "../../../electron-app/capability-library/domains/document-structure-identity/capabilities/cap.document-structure/offline/pdf-evidence-runner.cjs");

const base = "capability-library/domains/document-structure-identity/capabilities/cap.document-structure";

test("installer lists Object-first code and unpacks external Python scripts only", () => {
  for (const entry of [
    `${base}/integration/shadow-runtime.cjs`,
    `${base}/integration/object-first-contract.cjs`,
    `${base}/offline/*.cjs`,
    `${base}/offline/pdf-evidence/*.py`,
    `!${base}/offline/*.test.cjs`,
  ]) assert.ok(pkg.build.files.includes(entry), `missing package rule: ${entry}`);
  assert.ok(pkg.build.asarUnpack.includes(`${base}/offline/pdf-evidence/*.py`));
  assert.ok(!pkg.build.files.some(entry => entry.includes(".governance/tasks")));
});

test("external Python receives a physical script path in packaged mode", () => {
  const packed = path.join("C:", "Program Files", "App", "resources", "app.asar",
    "capability-library", "pdf-evidence", "visual-regions.py");
  assert.equal(physicalScriptPath(packed), packed.replace("app.asar", "app.asar.unpacked"));
  const development = path.join("C:", "workspace", "offline", "pdf-evidence", "visual-regions.py");
  assert.equal(physicalScriptPath(development), development);
});
