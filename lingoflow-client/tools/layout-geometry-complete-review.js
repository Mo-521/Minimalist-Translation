#!/usr/bin/env node
"use strict";

// Offline, read-only presentation of the frozen Body and non-Body Geometry
// candidates. This does not accept, promote, or publish Geometry to runtime.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "../..");
const EVIDENCE = path.join(
  ROOT,
  ".governance",
  "tasks",
  "layout-geometry-capability-audit",
  "evidence",
  "phase-2-paper-geometry",
);
const FREEZE = path.join(EVIDENCE, "geometry-baseline-v1");
const BODY = path.join(EVIDENCE, "human-review-main-flow-v1");
const RASTER_ROOT = path.join(EVIDENCE, "human-review-non-body-editable-v1", "pages");
const OUTPUT = path.join(EVIDENCE, "human-review-geometry-complete-v1");
const PAPERS = Array.from({ length: 7 }, (_, index) => `paper${index + 1}`);

const hashFile = (filePath) => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

function bodyLabel(item) {
  return `BODY ${item.canonicalColumnId || "wide"}`;
}

function objectLabel(item) {
  return String(item.objectType || item.semanticRegionType || item.protectedKind || "object").replace(/_/g, " ");
}

function boxSvg(item, layer) {
  const box = item.geometry;
  const label = layer === "body" ? bodyLabel(item) : objectLabel(item);
  return `<g class="geometry-box layer-${layer}" data-layer="${layer}" data-object-type="${escapeHtml(item.objectType || "body_column")}">
    <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"/>
    <text x="${box.x + 2}" y="${Math.max(9, box.y - 2)}">${escapeHtml(label)}</text>
  </g>`;
}

function pageCard(paper, bodyPage, objectPage) {
  if (!objectPage || bodyPage.pageNumber !== objectPage.pageNumber) {
    throw new Error(`${paper} page identity mismatch at ${bodyPage.pageNumber}`);
  }
  const width = bodyPage.pageSize.width;
  const height = bodyPage.pageSize.height;
  if (width !== objectPage.pageSize.width || height !== objectPage.pageSize.height) {
    throw new Error(`${paper} p${bodyPage.pageNumber} page-size mismatch`);
  }
  const bodyBoxes = bodyPage.candidate || bodyPage.predicted || [];
  const objects = objectPage.predicted || [];
  const independent = objects.filter((item) => item.regionClass === "independent_region");
  const protectedObjects = objects.filter((item) => item.regionClass === "protected_region");
  const imagePath = `../human-review-non-body-editable-v1/pages/${paper}/p${String(bodyPage.pageNumber).padStart(3, "0")}.jpg`;
  const svg = [
    ...bodyBoxes.map((item) => boxSvg(item, "body")),
    ...independent.map((item) => boxSvg(item, "independent")),
    ...protectedObjects.map((item) => boxSvg(item, "protected")),
  ].join("\n");
  return `<article class="page-card" id="p${bodyPage.pageNumber}">
    <header><h2>${paper} · p${bodyPage.pageNumber}</h2><p>${width}×${height}pt · Body ${bodyBoxes.length} · 独立对象 ${independent.length} · 受保护对象 ${protectedObjects.length}</p></header>
    <div class="stage" style="--page-ratio:${width}/${height}">
      <img src="${imagePath}" width="${width}" height="${height}" alt="${paper} page ${bodyPage.pageNumber}">
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="完整 Geometry 候选叠加层">${svg}</svg>
    </div>
  </article>`;
}

function pageHtml(paper, bodyCandidate, objectCandidate) {
  const paperLinks = PAPERS.map((item) => `<a href="${item}.html"${item === paper ? ' aria-current="page"' : ""}>${item}</a>`).join("");
  const cards = bodyCandidate.pages.map((bodyPage, index) => pageCard(paper, bodyPage, objectCandidate.pages[index])).join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${paper} 完整 Geometry 总览</title><style>
*{box-sizing:border-box}html,body{margin:0;background:#f4f1ea;color:#1c1917;font:14px/1.45 "Segoe UI",system-ui,sans-serif}.top{position:sticky;top:0;z-index:20;background:#1c1917;color:#fff;padding:12px 20px;box-shadow:0 2px 12px #0004}.top-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.top h1{font-size:18px;margin:0}.top p{margin:3px 0;color:#d6d3d1}.papers,.layers{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:9px}.papers a{color:#fff;background:#44403c;border-radius:18px;padding:6px 10px;text-decoration:none}.papers a[aria-current=page]{background:#fff;color:#1c1917}.layers label{border:1px solid #57534e;border-radius:18px;padding:5px 9px;cursor:pointer}.layers input{vertical-align:-1px;margin-right:5px}.notice{background:#fff7ed;color:#9a3412;border-bottom:1px solid #fed7aa;padding:8px 20px}main{max-width:1120px;margin:auto;padding:18px}.page-card{background:#fff;border:1px solid #d6d3d1;border-radius:12px;padding:16px;margin-bottom:26px}.page-card header{display:flex;justify-content:space-between;gap:14px;align-items:baseline}.page-card h2{font-size:18px;margin:0}.page-card header p{color:#57534e;margin:0}.stage{position:relative;width:min(100%,860px);margin:12px auto 0;box-shadow:0 8px 30px #1c191722;background:#fff;aspect-ratio:var(--page-ratio)}.stage img,.stage svg{position:absolute;inset:0;display:block;width:100%;height:100%}.geometry-box rect{vector-effect:non-scaling-stroke;stroke-width:1.45}.geometry-box text{font:700 8px/1 "Segoe UI",system-ui,sans-serif;paint-order:stroke;stroke:#fff;stroke-width:2px;stroke-linejoin:round}.layer-body rect{fill:#2563eb1f;stroke:#1d4ed8}.layer-body text{fill:#1d4ed8}.layer-independent rect{fill:#f9731624;stroke:#c2410c}.layer-independent text{fill:#9a3412}.layer-protected rect{fill:#e11d4820;stroke:#be123c;stroke-dasharray:5 3}.layer-protected text{fill:#9f1239}body.hide-body .layer-body,body.hide-independent .layer-independent,body.hide-protected .layer-protected,body.hide-labels .geometry-box text{display:none}@media(max-width:720px){main{padding:8px}.page-card{padding:9px}.page-card header{display:block}.top{position:relative}}
</style></head><body><div class="top"><div class="top-row"><div><h1>完整 Geometry 总览 · ${paper}</h1><p>冻结机器候选：Body + 全部非正文对象</p></div></div><nav class="papers">${paperLinks}<a href="index.html">全部论文</a></nav><div class="layers"><label><input type="checkbox" data-layer="body" checked>Body 正文</label><label><input type="checkbox" data-layer="independent" checked>独立对象</label><label><input type="checkbox" data-layer="protected" checked>受保护对象</label><label><input type="checkbox" data-layer="labels" checked>标签</label></div></div><div class="notice">蓝色：正文主阅读流；橙色：标题、作者、摘要、章节标题、图、表、图注等独立对象；红色虚线：页眉页脚、页码、References entries 等受保护对象。仅供离线审核，仍为 under review。</div><main>${cards}</main><script>
document.querySelectorAll('[data-layer]').forEach((input)=>input.addEventListener('change',()=>document.body.classList.toggle('hide-'+input.dataset.layer,!input.checked)));
</script></body></html>`;
}

function indexHtml(rows) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>完整 Geometry 总览</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f1ea;color:#1c1917;font:15px/1.5 "Segoe UI",system-ui,sans-serif}main{max-width:900px;margin:40px auto;padding:24px;background:#fff;border:1px solid #d6d3d1;border-radius:14px}h1{margin-top:0}p{color:#57534e}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.card{display:block;padding:16px;border:1px solid #d6d3d1;border-radius:10px;text-decoration:none;color:inherit}.card:hover{border-color:#2563eb;box-shadow:0 5px 18px #1d4ed81a}.card strong{display:block;font-size:18px}.status{margin-top:22px;padding:12px;background:#fff7ed;color:#9a3412;border-radius:8px}</style></head><body><main><h1>完整 Geometry 总览</h1><p>paper1–7 共 90 页，同时呈现冻结的 Body 主阅读流和非正文对象机器候选。</p><div class="grid">${rows.map((row) => `<a class="card" href="${row.paper}.html"><strong>${row.paper}</strong>${row.pages} 页 · Body ${row.bodyBoxes} · 非正文 ${row.objectBoxes}</a>`).join("")}</div><div class="status">under review · not accepted · not promoted · runtime forbidden · Column Truth read-only</div></main></body></html>`;
}

function main() {
  const freezeManifestPath = path.join(FREEZE, "FREEZE_MANIFEST.json");
  const freezeManifest = readJson(freezeManifestPath);
  if (freezeManifest.reviewStatus !== "under_review" || freezeManifest.runtimeDecisionUse !== "forbidden") {
    throw new Error("Frozen Geometry authority boundary is not review-only");
  }
  fs.mkdirSync(OUTPUT, { recursive: true });
  const rows = [];
  const build = {
    schemaVersion: "layout-geometry-complete-review/v1",
    generatedAt: new Date().toISOString(),
    sourceFreezeManifest: "../geometry-baseline-v1/FREEZE_MANIFEST.json",
    sourceFreezeSha256: hashFile(freezeManifestPath),
    status: "under_review",
    runtimeDecisionUse: "forbidden",
    candidateAcceptance: "not_performed",
    promotion: "not_performed",
    pages: 0,
    papers: [],
  };
  for (const paper of PAPERS) {
    const bodyPath = path.join(BODY, `${paper}-comparison.json`);
    const objectPath = path.join(FREEZE, "non-body-candidates", `${paper}.json`);
    const bodyCandidate = readJson(bodyPath);
    const objectCandidate = readJson(objectPath);
    if (bodyCandidate.sourcePdfSha256 !== objectCandidate.sourcePdfSha256) {
      throw new Error(`${paper} source PDF identity mismatch`);
    }
    if (bodyCandidate.pages.length !== objectCandidate.pages.length) {
      throw new Error(`${paper} page count mismatch`);
    }
    const freezePaper = freezeManifest.papers.find((item) => item.paper === paper);
    if (!freezePaper || hashFile(bodyPath) !== freezeManifest.bodyBaselineCandidateHashes?.[paper]) {
      // The Body manifest predates this aggregate field. Validate using its own
      // immutable manifest below instead of weakening identity checks.
      const bodyManifest = readJson(path.join(EVIDENCE, "body-baseline-v1", "FREEZE_MANIFEST.json"));
      const expected = bodyManifest.regressionEvidence.candidateFiles.find((item) => item.paper === paper);
      if (!expected || hashFile(bodyPath) !== expected.sha256) throw new Error(`${paper} Body freeze hash mismatch`);
    }
    if (hashFile(objectPath) !== freezePaper.candidate.sha256) throw new Error(`${paper} non-Body freeze hash mismatch`);
    objectCandidate.pages.forEach((page) => {
      const raster = path.join(RASTER_ROOT, paper, `p${String(page.pageNumber).padStart(3, "0")}.jpg`);
      if (!fs.existsSync(raster)) throw new Error(`${paper} p${page.pageNumber} raster missing`);
    });
    const html = pageHtml(paper, bodyCandidate, objectCandidate);
    const htmlPath = path.join(OUTPUT, `${paper}.html`);
    fs.writeFileSync(htmlPath, html);
    const bodyBoxes = bodyCandidate.pages.reduce((sum, page) => sum + (page.candidate || page.predicted || []).length, 0);
    const objectBoxes = objectCandidate.pages.reduce((sum, page) => sum + (page.predicted || []).length, 0);
    const row = { paper, pages: bodyCandidate.pages.length, bodyBoxes, objectBoxes };
    rows.push(row);
    build.pages += row.pages;
    build.papers.push({
      ...row,
      sourcePdfSha256: bodyCandidate.sourcePdfSha256,
      bodyCandidateSha256: hashFile(bodyPath),
      nonBodyCandidateSha256: hashFile(objectPath),
      htmlSha256: hashFile(htmlPath),
    });
  }
  fs.writeFileSync(path.join(OUTPUT, "index.html"), indexHtml(rows));
  fs.writeFileSync(path.join(OUTPUT, "BUILD_MANIFEST.json"), `${JSON.stringify(build, null, 2)}\n`);
  fs.writeFileSync(path.join(OUTPUT, "README.md"), `# 完整 Geometry 总览\n\n此目录同时显示冻结机器 Body 候选与冻结机器非正文候选。它是只读人工审核视图，不是人工 corrected 合并结果，也不构成 Accept、Promote 或 Runtime truth。\n`);
  process.stdout.write(`${OUTPUT}\n${build.papers.length} papers / ${build.pages} pages\n`);
}

main();
