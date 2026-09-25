"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { PDFDocument } = require("../../../electron-app/node_modules/pdf-lib");
const pool = require("../../../electron-app/capability-library/candidate-pool");
const intake = require("../../../tools/capability-library-intake");
const cli = require("../../../tools/capability-candidate-pool");
const audit = { actor: "reviewer.fixture", reason: "Synthetic foundation contract", at: "2026-09-15T00:00:00.000Z" };
const copy = (value) => JSON.parse(JSON.stringify(value));
function submission() {
  return { id: "candidate.fixture", capabilityIds: ["cap.semantic-structure"], sample: {
    id: "sample.fixture", displayName: "Synthetic candidate",
    source: { fileName: "fixture.pdf", mediaType: "application/pdf", sha256: "a".repeat(64), bytes: 100, pageCount: 1 },
    provenance: { kind: "synthetic", reference: "test" }, rights: { status: "owned", canStoreMetadata: true, canStoreBinary: false },
    boundaryFeatureIds: ["boundary.structure.section-transition"],
    expectedOutcomes: [{ capabilityId: "cap.semantic-structure", assertionId: "assert.structure.single-producer", oracleType: "manual", expected: "human verified immutable structure" }],
    evidenceRefs: ["EVD-SYNTHETIC"], storage: { binaryCommitted: false, externalSourceRequiredForRun: true },
    authorityBoundary: { catalogRole: "regression_oracle", runtimeDecisionUse: "forbidden", finalDecisionsOwnedBy: ["AA-STRUCTURE-001"] }
  } };
}
function accepted() {
  let state = pool.submitCandidate(pool.loadState(), submission(), audit);
  state = pool.reviewCandidate(state, "candidate.fixture", "under_review", audit);
  return pool.reviewCandidate(state, "candidate.fixture", "accepted", audit);
}
test("submission ingress rejects top-level Authority fields and unknown fields instead of discarding them", () => {
  const item = submission(); item.semanticType = "body";
  assert.throws(() => pool.precheck(pool.loadState(), item), e => e.code === "CAPABILITY_LIBRARY_RUNTIME_AUTHORITY_FORBIDDEN");
  delete item.semanticType; item.extra = true;
  assert.throws(() => pool.submitCandidate(pool.loadState(), item, audit), e => e.code === "CANDIDATE_SCHEMA_INVALID");
});
test("precheck only checks format and duplicates; submit remains pending and frozen", () => {
  const state = pool.loadState(), item = submission();
  assert.equal(pool.precheck(state, item).rootCauseAssessment, "not_performed");
  const next = pool.submitCandidate(state, item, audit);
  assert.equal(next.pool.candidates[0].status, "pending"); assert.equal(next.corpus.samples.length, state.corpus.samples.length);
  assert.equal(state.pool.candidates.length, 0); assert.ok(Object.isFrozen(next.pool.candidates[0].sample));
  assert.throws(() => pool.reviewCandidate(next, item.id, "accepted", audit), /forbidden/);
  assert.throws(() => pool.promoteCandidate(next, item.id, audit), /accepted/);
});
test("human review transitions append history; insufficient evidence can return to review", () => {
  let state = pool.submitCandidate(pool.loadState(), submission(), audit);
  state = pool.reviewCandidate(state, "candidate.fixture", "under_review", audit);
  state = pool.reviewCandidate(state, "candidate.fixture", "insufficient_evidence", audit);
  state = pool.reviewCandidate(state, "candidate.fixture", "under_review", { ...audit, evidenceRefs: ["EVD-MORE"] });
  assert.equal(state.pool.candidates[0].history.length, 4);
  assert.throws(() => pool.reviewCandidate(state, "candidate.fixture", "accepted", {}), /actor/);
  assert.throws(() => pool.reviewCandidate(state, "candidate.fixture", "pending", audit), /forbidden/);
  const broken = copy(state); broken.pool.candidates[0].history[1].reason = "silent edit";
  assert.throws(() => pool.validateState(broken), /rewritten/);
  const changed = copy(state); changed.pool.candidates[0].sample.displayName = "rewritten submission";
  assert.throws(() => pool.validateState(changed), /rewritten/);
});
test("accepted requires evidence, complete oracles, and original Authority ownership", () => {
  for (const mutation of [s => {s.sample.evidenceRefs=[];}, s => {s.sample.expectedOutcomes=[];}, s => {s.sample.authorityBoundary.finalDecisionsOwnedBy=["AA-EVIDENCE-001"];}]) {
    const item=submission(); mutation(item);
    let state=pool.submitCandidate(pool.loadState(),item,audit);
    state=pool.reviewCandidate(state,item.id,"under_review",audit);
    assert.throws(()=>pool.reviewCandidate(state,item.id,"accepted",audit),error=>["CANDIDATE_INSUFFICIENT_EVIDENCE","CANDIDATE_AUTHORITY_MISMATCH"].includes(error.code));
  }
});
test("explicit promotion updates corpus and both references without rewriting provenance", () => {
  const state=accepted(), next=pool.promoteCandidate(state,"candidate.fixture",{...audit,evidenceRefs:["EVD-PROMOTION"]});
  assert.equal(next.corpus.samples.length,state.corpus.samples.length+1);
  const promotedSample=next.corpus.samples.find((sample)=>sample.id==="sample.fixture");
  assert.deepEqual(promotedSample.provenance,submission().sample.provenance);
  assert.ok(promotedSample.evidenceRefs.includes("EVD-PROMOTION"));
  assert.ok(next.capabilities.capabilities[0].regressionSampleIds.includes("sample.fixture"));
  assert.equal(next.pool.candidates[0].history.at(-1).action,"promote");
  assert.throws(()=>pool.promoteCandidate(next,"candidate.fixture",audit),/not yet promoted/);
  assert.throws(()=>pool.promoteCandidate(state,"candidate.fixture",{...audit,expectedOutcomes:submission().sample.expectedOutcomes}),/unreviewed/);
  const broken=copy(next); broken.capabilities.capabilities[0].regressionSampleIds=[];
  assert.throws(()=>pool.validateState(broken),/back-reference/);
});
test("missing evidence and oracle can be supplemented through recorded human review without rewriting submission",()=>{
  const item=submission(); item.sample.expectedOutcomes=[]; item.sample.evidenceRefs=[];
  let state=pool.submitCandidate(pool.loadState(),item,audit);
  state=pool.reviewCandidate(state,item.id,"under_review",audit);
  state=pool.reviewCandidate(state,item.id,"insufficient_evidence",audit);
  state=pool.reviewCandidate(state,item.id,"under_review",{...audit,evidenceRefs:["EVD-REVIEW"],expectedOutcomes:submission().sample.expectedOutcomes});
  state=pool.reviewCandidate(state,item.id,"accepted",audit);
  const next=pool.promoteCandidate(state,item.id,audit);
  assert.equal(next.pool.candidates[0].sample.expectedOutcomes.length,0);
  assert.equal(next.corpus.samples[0].expectedOutcomes.length,1);
  assert.equal(next.pool.candidates[0].history[3].expectedOutcomes.length,1);
});
test("identity and PDF hashes are checked across pool and corpus with no automatic merging",()=>{
  const state=pool.submitCandidate(pool.loadState(),submission(),audit);
  const item=submission(); item.id="candidate.other"; item.sample.id="sample.other";
  assert.deepEqual(pool.precheck(state,item).duplicateCandidateIds,["candidate.fixture"]);
  assert.throws(()=>pool.submitCandidate(state,item,audit),/Duplicate/);
  const promoted=pool.promoteCandidate(accepted(),"candidate.fixture",audit);
  assert.deepEqual(pool.precheck(promoted,item).duplicateCorpusIds,["sample.fixture"]);
  assert.throws(()=>pool.submitCandidate(promoted,item,audit),/Duplicate/);
});
test("full JSON schema rejects missing oracle expected, extra fields, invalid enums and unknown links",()=>{
  for(const mutate of [s=>{delete s.sample.expectedOutcomes[0].expected;},s=>{s.sample.source.extra=true;},s=>{s.sample.rights.status="unknown";},s=>{s.sample.boundaryFeatureIds.push(s.sample.boundaryFeatureIds[0]);},s=>{s.capabilityIds=["cap.unknown"];},s=>{s.sample.expectedOutcomes[0].assertionId="assert.unknown";}]){
    const item=submission(); mutate(item); assert.throws(()=>pool.submitCandidate(pool.loadState(),item,audit));
  }
});
test("Authority Guard rejects decision fields even nested inside an oracle",()=>{
  const library=require("../../../electron-app/capability-library");
  const fields=[...library.FORBIDDEN_RUNTIME_DECISION_FIELDS];
  library.FORBIDDEN_RUNTIME_DECISION_FIELDS.clear();
  assert.throws(()=>library.assertNoRuntimeDecisionFields({semanticType:"body"}));
  fields.forEach(field=>library.FORBIDDEN_RUNTIME_DECISION_FIELDS.add(field));
  const item=submission(); item.sample.expectedOutcomes[0].expected={semanticType:"body"};
  assert.throws(()=>pool.precheck(pool.loadState(),item),e=>e.code==="CAPABILITY_LIBRARY_RUNTIME_AUTHORITY_FORBIDDEN");
  for(const file of ["main.js","renderer.js","paper-layout-authority.js","semantic-structure-authority.js","semantic-structure-consumer-authority.js","pdf-pipeline-diagnostics.js"]){
    const source=fs.readFileSync(path.join(__dirname,"../../../electron-app",file),"utf8");
    assert.doesNotMatch(source,/require\([^)]*(?:candidate-pool|candidates\.json)/);
  }
});
test("snapshot persistence refuses overwrite and rejects partial or tampered transactions",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"candidate-pool-"));
  try{
    const target=path.join(root,"revision-1"); pool.saveState(accepted(),target);
    assert.equal(pool.loadCommittedState(target).pool.candidates[0].status,"accepted");
    assert.throws(()=>pool.saveState(accepted(),target));
    fs.writeFileSync(path.join(target,"COMMITTED"),"bad"); assert.throws(()=>pool.loadCommittedState(target),/snapshot/);
    fs.unlinkSync(path.join(target,"COMMITTED")); assert.throws(()=>pool.loadCommittedState(target));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("candidate CLI reuses PDF intake end-to-end without modifying baseline corpus",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"candidate-cli-"));
  try{
    const pdf=await PDFDocument.create(); pdf.addPage(); const source=path.join(root,"fixture.pdf"); fs.writeFileSync(source,await pdf.save());
    const item=submission(),sample=item.sample;
    const manifest=path.join(root,"manifest.json");
    fs.writeFileSync(manifest,JSON.stringify({...sample,finalDecisionsOwnedBy:sample.authorityBoundary.finalDecisionsOwnedBy,candidateId:item.id,capabilityIds:item.capabilityIds,audit}));
    const out=path.join(root,"intake"); await cli.main(["intake","--manifest",manifest,"--source",source,"--out",out]);
    const state=pool.loadCommittedState(out); assert.equal(state.pool.candidates[0].sample.source.pageCount,1);
    assert.equal(state.corpus.samples.length,pool.loadState().corpus.samples.length); assert.equal(fs.existsSync(path.join(out,"fixture.pdf")),false);
    const bad=path.join(root,"bad.json"); fs.writeFileSync(bad,JSON.stringify({...JSON.parse(fs.readFileSync(manifest)),columnType:"double"}));
    await assert.rejects(()=>intake.buildCorpusRecord({manifestPath:bad,sourcePath:source}));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
