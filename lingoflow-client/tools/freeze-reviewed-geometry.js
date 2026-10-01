"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const source = path.join(root, ".governance/archive/evidence/layout-geometry-capability-audit/evidence/phase-2-paper-geometry/human-review-final-paper1-10-v8");
const destination = path.join(root, "lingoflow-client/electron-app/capability-library/capabilities/cap.layout-geometry/reviewed-v8");
const columnCorpus = path.join(root, "lingoflow-client/electron-app/capability-library/capabilities/cap.column-recognition/corpus.json");
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const readJson = (name) => JSON.parse(fs.readFileSync(name, "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function checkBoxes(page, paper, kind) {
  for (const [listName, boxes] of [["predicted", page.predicted], ["corrected", page.corrected]]) {
    assert(Array.isArray(boxes), `${paper} ${kind} p${page.pageNumber}: ${listName} is not an array`);
    for (const box of boxes) {
      const g = box.geometry;
      assert(g && [g.x, g.y, g.width, g.height].every(Number.isFinite), `${paper} ${kind} p${page.pageNumber}: invalid geometry`);
      assert(g.width > 0 && g.height > 0, `${paper} ${kind} p${page.pageNumber}: nonpositive box`);
      assert(g.x >= -1 && g.y >= -1 && g.x + g.width <= page.pageSize.width + 1 && g.y + g.height <= page.pageSize.height + 1,
        `${paper} ${kind} p${page.pageNumber}: box outside page`);
    }
  }
}

function run() {
  assert(!fs.existsSync(destination), `freeze destination already exists: ${destination}`);
  const manifest = readJson(path.join(source, "MANIFEST.json"));
  const column = readJson(columnCorpus);
  const records = [];
  const copies = [];
  for (const entry of manifest.results) {
    const paper = entry.paper;
    const upstream = column.samples.find((sample) => sample.source.sha256 === entry.sourceSha256);
    assert(upstream && upstream.source.pageCount === entry.pages, `${paper}: frozen Column dependency mismatch`);
    const record = { paper, sourcePdfSha256: entry.sourceSha256, pages: entry.pages, columnSampleId: upstream.id, exports: {} };
    for (const [kind, scope] of [["body", "body_column_only"], ["non-body", "non_body_objects_only"]]) {
      const name = `${paper}-${kind}-ground-truth-draft.json`;
      const sourcePath = path.join(source, name);
      const bytes = fs.readFileSync(sourcePath);
      const data = JSON.parse(bytes.toString("utf8"));
      assert(data.capabilityId === "cap.layout-geometry" && data.scope === scope && data.paper === paper, `${name}: identity mismatch`);
      assert(data.sourcePdfSha256 === entry.sourceSha256 && data.coordinateSpace === "pdf-page-top-left-points", `${name}: PDF identity/space mismatch`);
      assert(data.runtimeDecisionUse === "forbidden" && data.pages.length === entry.pages, `${name}: authority/page count mismatch`);
      data.pages.forEach((page, index) => {
        assert(page.pageNumber === index + 1 && page.confirmed === true, `${name}: unconfirmed or unordered page ${index + 1}`);
        checkBoxes(page, paper, kind);
      });
      record.exports[kind] = { file: name, sha256: sha256(bytes), confirmedPages: data.pages.length };
      copies.push({ name, bytes });
    }
    records.push(record);
  }
  assert(records.length === 10 && records.reduce((sum, item) => sum + item.pages, 0) === 126, "Expected ten papers / 126 pages");
  const freeze = {
    schemaVersion: "layout-geometry-reviewed-freeze/v1",
    capabilityId: "cap.layout-geometry",
    status: "human_review_confirmed_formal_promotion_pending",
    runtimeDecisionUse: "forbidden",
    reviewStatement: "User confirmed the latest paper1–10 visual review on 2026-09-27; minor residual imperfections acknowledged. All 126 Body and non-Body pages were confirmed in the exported review JSON.",
    sourceReviewDirectory: ".governance/archive/evidence/layout-geometry-capability-audit/evidence/phase-2-paper-geometry/human-review-final-paper1-10-v8",
    sourceManifestSha256: sha256(fs.readFileSync(path.join(source, "MANIFEST.json"))),
    columnCorpusSha256: sha256(fs.readFileSync(columnCorpus)),
    papers: records,
    promotionBlocker: "Candidate Pool and catalog loader reject the same PDF SHA-256 in a second capability sample; Column already owns these ten source hashes."
  };
  fs.mkdirSync(destination, { recursive: false });
  for (const { name, bytes } of copies) fs.writeFileSync(path.join(destination, name), bytes, { flag: "wx" });
  fs.writeFileSync(path.join(destination, "FREEZE_MANIFEST.json"), JSON.stringify(freeze, null, 2) + "\n", { flag: "wx" });
  for (const record of records) {
    for (const item of Object.values(record.exports)) {
      assert(sha256(fs.readFileSync(path.join(destination, item.file))) === item.sha256, `copied hash mismatch: ${item.file}`);
    }
  }
  process.stdout.write(`Frozen ${records.length} papers / 126 confirmed pages / ${copies.length} exports at ${destination}\n`);
}

run();
