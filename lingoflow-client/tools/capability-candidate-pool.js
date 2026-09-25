#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const workflow = require("../electron-app/capability-library/candidate-pool");
const { buildCorpusRecord } = require("./capability-library-intake");
const { assertNoRuntimeDecisionFields } = require("../electron-app/capability-library");
async function main(argv = process.argv.slice(2)) {
  const [action, ...args] = argv;
  if (action === "--help") { console.log("intake --manifest FILE --source PDF --out NEW_DIRECTORY [--state COMMITTED_DIRECTORY]\nreview --id CANDIDATE --status under_review|accepted|insufficient_evidence --audit FILE --state DIRECTORY --out NEW_DIRECTORY\npromote --id CANDIDATE --audit FILE --state DIRECTORY --out NEW_DIRECTORY\nOnly offline evidence snapshots are produced; no UI or runtime decisions."); return; }
  if (!["intake", "review", "promote"].includes(action)) throw new Error("Unknown workflow action");
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!["--manifest", "--source", "--out", "--state", "--id", "--status", "--audit"].includes(key) || !value || value.startsWith("--") || options[key.slice(2)]) throw new Error("Invalid or duplicate argument");
    options[key.slice(2)] = value;
  }
  if (!options.out) throw new Error("--out must name a new snapshot directory");
  const state = options.state ? workflow.loadCommittedState(path.resolve(options.state)) : workflow.loadState();
  const read = (name) => { if (!name) throw new Error("Manifest/audit required"); const value = JSON.parse(fs.readFileSync(name, "utf8")); assertNoRuntimeDecisionFields(value); return value; };
  let next;
  if (action === "intake") {
    const manifest = read(options.manifest);
    const sample = await buildCorpusRecord({ manifestPath: options.manifest, sourcePath: options.source });
    next = workflow.submitCandidate(state, { id: manifest.candidateId, capabilityIds: manifest.capabilityIds, sample }, manifest.audit);
  } else {
    if (!options.state) throw new Error("Review/promotion requires an explicit committed snapshot");
    const audit = read(options.audit);
    next = action === "review" ? workflow.reviewCandidate(state, options.id, options.status, audit) : workflow.promoteCandidate(state, options.id, audit);
  }
  workflow.saveState(next, path.resolve(options.out));
  console.log(JSON.stringify({ action, snapshot: path.resolve(options.out), runtimeDecisionUse: "forbidden" }));
}
if (require.main === module) main().catch((error) => { console.error(`${error.code || "CANDIDATE_WORKFLOW_FAILED"}: ${error.message}`); process.exitCode = 1; });
module.exports = { main };
