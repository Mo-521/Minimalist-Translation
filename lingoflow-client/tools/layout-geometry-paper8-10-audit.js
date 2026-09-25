#!/usr/bin/env node
"use strict";

// Offline generalization audit for paper8-paper10. Column captures are
// provisional evidence only and are never written into Column truth/corpus.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const source = require("./layout-geometry-candidate-intake");
const mainFlow = require("./layout-geometry-main-flow-review");
const nonBody = require("./layout-geometry-non-body-editable");

const ROOT = path.resolve(__dirname, "../..");
const APP = path.join(ROOT, "lingoflow-client", "electron-app");
const OUTPUT = path.join(ROOT, ".governance", "tasks", "layout-geometry-capability-audit", "evidence", "phase-3-paper8-10-final-audit");
const FREEZE = path.join(ROOT, ".governance", "tasks", "layout-geometry-capability-audit", "evidence", "phase-2-paper-geometry", "geometry-baseline-v1", "FREEZE_MANIFEST.json");
const SAMPLES = [8, 9, 10].map((number) => ({
  key: `paper${number}`,
  pdf: `D:\\PDF测试\\论文样本${number}.pdf`,
  capture: path.join(OUTPUT, `paper${number}-column-capture.json`),
}));
const bundledPdftoppm = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "native", "poppler", "Library", "bin", "pdftoppm.exe");
const PDFTOPPM = process.env.GEOMETRY_REVIEW_PDFTOPPM || (fs.existsSync(bundledPdftoppm) ? bundledPdftoppm : "pdftoppm");
const EXCLUDED_PROTECTED = new Set(["formula", "margin", "image", "authoritative_preserve"]);

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const hashFile = (filePath) => hash(fs.readFileSync(filePath));
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

function provisionalColumnSample(key, capture) {
  return {
    id: `sample.column-audit-provisional.${key}`,
    source: capture.source,
    expectedOutcomes: [{
      capabilityId: "cap.column-recognition",
      assertionId: "assert.column.page-region-truth",
      oracleType: "provisional_capture",
      expected: {
        pageLayoutBasis: "body_text_flow_only",
        pages: capture.pages.map((page) => ({ pageNumber: page.pageNumber, layout: page.layoutType })),
        independentRegions: [],
      },
    }],
  };
}

function modelsFromCapture(capture) {
  return new Map(capture.pages.map((page) => [page.pageNumber, page.columnModel]));
}

function rasterize(pdfPath, key, sourceSha, pages) {
  const dir = path.join(OUTPUT, "pages", key);
  const metaPath = path.join(dir, "raster-meta.json");
  if (fs.existsSync(metaPath)) {
    const current = readJson(metaPath);
    if (current.sourcePdfSha256 === sourceSha && current.pages.length === pages.length
      && current.pages.every((page) => fs.existsSync(path.join(dir, page.image)))) return current;
  }
  fs.mkdirSync(dir, { recursive: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "geometry-paper8-10-"));
  const result = spawnSync(PDFTOPPM, ["-jpeg", "-r", "144", "-hide-annotations", "-jpegopt", "quality=88,progressive=y,optimize=y", pdfPath, path.join(temp, "page")], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Poppler rasterization failed");
  const rendered = fs.readdirSync(temp).filter((name) => /^page-\d+\.jpg$/i.test(name))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
  if (rendered.length !== pages.length) throw new Error(`${key} raster page count mismatch`);
  const meta = {
    schemaVersion: "layout-geometry-audit-raster/v1",
    renderer: "poppler-pdftoppm",
    annotations: "hidden",
    sourcePdfSha256: sourceSha,
    pages: rendered.map((name, index) => {
      const image = `p${String(index + 1).padStart(3, "0")}.jpg`;
      fs.copyFileSync(path.join(temp, name), path.join(dir, image));
      return { pageNumber: index + 1, image, pageWidth: pages[index].pageSize.width, pageHeight: pages[index].pageSize.height };
    }),
  };
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  fs.rmSync(temp, { recursive: true, force: true });
  return meta;
}

function allInBounds(page) {
  const failures = [];
  [...page.body, ...page.nonBody].forEach((item) => {
    const g = item.geometry;
    const finite = g && [g.x, g.y, g.width, g.height].every(Number.isFinite);
    if (!finite || g.x < 0 || g.y < 0 || g.width <= 0 || g.height <= 0
      || g.x + g.width > page.pageSize.width + 0.02 || g.y + g.height > page.pageSize.height + 0.02) {
      failures.push(item.id);
    }
  });
  return failures;
}

function bodyLaneFailures(page) {
  // A references-only tail page is intentionally owned by reference_entries;
  // the frozen Body definition does not require a main-reading-flow envelope
  // where no body flow remains.
  if (page.nonBody.some((item) => item.objectType === "reference_entries")) return [];
  const required = page.columnLayout === "double_column" ? ["left", "right"] : ["single"];
  return required.filter((lane) => !page.body.some((item) => item.canonicalColumnId === lane));
}

function boxSvg(item, layer) {
  const g = item.geometry;
  const label = layer === "body" ? `BODY ${item.canonicalColumnId || "wide"}` : String(item.objectType || "object").replace(/_/g, " ");
  return `<g class="box ${layer}" data-layer="${layer}"><rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}"/><text x="${g.x + 2}" y="${Math.max(9, g.y - 2)}">${escapeHtml(label)}</text></g>`;
}

function paperHtml(candidate) {
  const links = SAMPLES.map((sample) => `<a href="${sample.key}.html"${sample.key === candidate.paper ? ' aria-current="page"' : ""}>${sample.key}</a>`).join("");
  const cards = candidate.pages.map((page) => {
    const independent = page.nonBody.filter((item) => item.regionClass === "independent_region");
    const protectedObjects = page.nonBody.filter((item) => item.regionClass === "protected_region");
    const missing = page.checks.missingBodyLanes.length ? ` · 缺 Body lane: ${page.checks.missingBodyLanes.join(", ")}` : "";
    const shapes = [
      ...page.body.map((item) => boxSvg(item, "body")),
      ...independent.map((item) => boxSvg(item, "independent")),
      ...protectedObjects.map((item) => boxSvg(item, "protected")),
    ].join("");
    return `<article><header><h2>${candidate.paper} · p${page.pageNumber}</h2><p>${page.columnLayout} · Body ${page.body.length} · 独立 ${independent.length} · 保护 ${protectedObjects.length}${missing}</p></header><div class="stage" style="--ratio:${page.pageSize.width}/${page.pageSize.height}"><img src="pages/${candidate.paper}/p${String(page.pageNumber).padStart(3, "0")}.jpg" alt="${candidate.paper} page ${page.pageNumber}"><svg viewBox="0 0 ${page.pageSize.width} ${page.pageSize.height}" preserveAspectRatio="none">${shapes}</svg></div></article>`;
  }).join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${candidate.paper} Geometry 最终泛化审核</title><style>
*{box-sizing:border-box}html,body{margin:0;background:#f4f1ea;color:#1c1917;font:14px/1.45 "Segoe UI",system-ui,sans-serif}.top{position:sticky;top:0;z-index:10;background:#1c1917;color:white;padding:12px 20px}.top h1{margin:0;font-size:18px}.top p{margin:4px 0;color:#d6d3d1}.nav,.layers{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-top:8px}.nav a{color:#fff;background:#44403c;border-radius:18px;padding:6px 10px;text-decoration:none}.nav a[aria-current=page]{background:#fff;color:#1c1917}.layers label{border:1px solid #57534e;border-radius:18px;padding:5px 9px}.warn{background:#fef3c7;color:#92400e;border-bottom:1px solid #f59e0b;padding:9px 20px}main{max-width:1120px;margin:auto;padding:18px}article{background:#fff;border:1px solid #d6d3d1;border-radius:12px;padding:16px;margin-bottom:26px}article header{display:flex;justify-content:space-between;gap:12px;align-items:baseline}h2{font-size:18px;margin:0}article header p{color:#57534e;margin:0}.stage{position:relative;width:min(100%,860px);aspect-ratio:var(--ratio);margin:12px auto 0;box-shadow:0 8px 28px #1c191722}.stage img,.stage svg{position:absolute;inset:0;width:100%;height:100%}.box rect{vector-effect:non-scaling-stroke;stroke-width:1.45}.box text{font:700 8px "Segoe UI",system-ui,sans-serif;paint-order:stroke;stroke:#fff;stroke-width:2px}.body rect{fill:#2563eb1f;stroke:#1d4ed8}.body text{fill:#1d4ed8}.independent rect{fill:#f9731624;stroke:#c2410c}.independent text{fill:#9a3412}.protected rect{fill:#e11d4820;stroke:#be123c;stroke-dasharray:5 3}.protected text{fill:#9f1239}body.hide-body .body,body.hide-independent .independent,body.hide-protected .protected,body.hide-labels text{display:none}
</style></head><body><div class="top"><h1>${candidate.paper} Geometry 最终泛化审核</h1><p>冻结 Geometry 规则 + 未冻结 Column 临时候选 · 完整 Body/非正文叠加</p><nav class="nav">${links}<a href="index.html">总览</a><a href="${candidate.paper}-geometry-candidate.json">候选 JSON</a></nav><div class="layers"><label><input type="checkbox" data-layer="body" checked>Body</label><label><input type="checkbox" data-layer="independent" checked>独立对象</label><label><input type="checkbox" data-layer="protected" checked>受保护对象</label><label><input type="checkbox" data-layer="labels" checked>标签</label></div></div><div class="warn">Column 结果仅为本次审计捕获，尚未经人工冻结；Geometry 仍 under review，不 Accept、不 Promote、不进入 Runtime。</div><main>${cards}</main><script>document.querySelectorAll('[data-layer]').forEach((input)=>input.addEventListener('change',()=>document.body.classList.toggle('hide-'+input.dataset.layer,!input.checked)));</script></body></html>`;
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const freeze = readJson(FREEZE);
  if (freeze.reviewStatus !== "under_review" || freeze.runtimeDecisionUse !== "forbidden") throw new Error("Geometry freeze authority boundary mismatch");
  const localRequire = createRequire(path.join(APP, "main.js"));
  const pdfjs = await import(pathToFileURL(localRequire.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
  const summary = {
    schemaVersion: "layout-geometry-new-sample-final-audit/v1",
    generatedAt: new Date().toISOString(),
    geometryBaselineId: freeze.baselineId,
    geometryBaselineSha256: hashFile(FREEZE),
    columnDependencyStatus: "provisional_under_review_not_frozen",
    columnTruthModified: false,
    runtimeDecisionUse: "forbidden",
    candidateAcceptance: "not_performed",
    promotion: "not_performed",
    papers: [],
  };
  for (const sampleConfig of SAMPLES) {
    const capture = readJson(sampleConfig.capture);
    if (hashFile(sampleConfig.pdf) !== capture.source.sha256) throw new Error(`${sampleConfig.key} source identity mismatch`);
    const extracted = await source.extractPdf(pdfjs, sampleConfig.pdf);
    if (extracted.pageCount !== capture.source.pageCount) throw new Error(`${sampleConfig.key} page count mismatch`);
    const sample = provisionalColumnSample(sampleConfig.key, capture);
    const models = modelsFromCapture(capture);
    const referenceStart = mainFlow.referenceBoundary(extracted);
    const nonBodyBundle = nonBody.predictNonBodyPages(sampleConfig.key, extracted, sample, models, "provisional audit Column candidate");
    const pages = extracted.pages.map((page, index) => {
      const model = models.get(page.pageNumber);
      const column = source.columnIdentity(sample, page.pageNumber);
      if (!model || model.layoutType !== column.layout) throw new Error(`${sampleConfig.key} p${page.pageNumber} Column identity conflict`);
      const hints = mainFlow.visualHintsForPage(page);
      const body = mainFlow.predictPage(page, column, model, referenceStart, hints.visualObjects, hints.pageVisuals)
        .map((item) => ({ id: item.id, objectType: "body_column", regionClass: "body_column", canonicalColumnId: item.canonicalColumnId, geometry: item.geometry }));
      const nonBodyPage = nonBodyBundle.pages[index];
      const combined = { pageNumber: page.pageNumber, pageSize: page.pageSize, columnLayout: column.layout, body, nonBody: nonBodyPage.predicted };
      combined.checks = { outOfBounds: allInBounds(combined), missingBodyLanes: bodyLaneFailures(combined) };
      return combined;
    });
    rasterize(sampleConfig.pdf, sampleConfig.key, capture.source.sha256, pages);
    const candidate = {
      schemaVersion: "layout-geometry-complete-candidate/v1",
      paper: sampleConfig.key,
      source: capture.source,
      coordinateSpace: "pdf-page-top-left-points",
      geometryBaselineId: freeze.baselineId,
      columnDependency: { status: "provisional_under_review_not_frozen", capture: path.basename(sampleConfig.capture), sha256: hashFile(sampleConfig.capture) },
      runtimeDecisionUse: "forbidden",
      candidateAcceptance: "not_performed",
      promotion: "not_performed",
      pages,
    };
    const candidatePath = path.join(OUTPUT, `${sampleConfig.key}-geometry-candidate.json`);
    fs.writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`);
    fs.writeFileSync(path.join(OUTPUT, `${sampleConfig.key}.html`), paperHtml(candidate));
    const typeCounts = {};
    pages.flatMap((page) => page.nonBody).forEach((item) => { typeCounts[item.objectType] = (typeCounts[item.objectType] || 0) + 1; });
    const outOfBounds = pages.flatMap((page) => page.checks.outOfBounds.map((id) => ({ pageNumber: page.pageNumber, id })));
    const missingBodyLanes = pages.flatMap((page) => page.checks.missingBodyLanes.map((lane) => ({ pageNumber: page.pageNumber, lane })));
    summary.papers.push({
      paper: sampleConfig.key,
      pages: pages.length,
      columnLayouts: capture.pages.reduce((acc, page) => ({ ...acc, [page.layoutType]: (acc[page.layoutType] || 0) + 1 }), {}),
      bodyBoxes: pages.reduce((sum, page) => sum + page.body.length, 0),
      nonBodyBoxes: pages.reduce((sum, page) => sum + page.nonBody.length, 0),
      typeCounts,
      generationGaps: nonBodyBundle.gaps,
      checks: { outOfBounds, missingBodyLanes, nonBody: nonBodyBundle.checks },
      status: outOfBounds.length || missingBodyLanes.length || nonBodyBundle.checks.status !== "pass" ? "review_required" : "geometry_checks_pass_column_review_required",
      candidateSha256: hashFile(candidatePath),
    });
  }
  const totalPages = summary.papers.reduce((sum, paper) => sum + paper.pages, 0);
  fs.writeFileSync(path.join(OUTPUT, "FINAL_AUDIT_REPORT.json"), `${JSON.stringify({ ...summary, totalPages }, null, 2)}\n`);
  const cards = summary.papers.map((paper) => `<a class="card" href="${paper.paper}.html"><strong>${paper.paper}</strong><span>${paper.pages} 页 · Body ${paper.bodyBoxes} · 非正文 ${paper.nonBodyBoxes}</span><em>${paper.status}</em></a>`).join("");
  fs.writeFileSync(path.join(OUTPUT, "index.html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>paper8-10 Geometry 最终泛化审核</title><style>body{margin:0;background:#f4f1ea;color:#1c1917;font:15px/1.5 "Segoe UI",system-ui,sans-serif}main{max-width:900px;margin:38px auto;padding:24px;background:#fff;border:1px solid #d6d3d1;border-radius:14px}h1{margin-top:0}.intro{color:#57534e}.cards{display:grid;gap:12px}.card{display:grid;gap:4px;padding:16px;border:1px solid #d6d3d1;border-radius:10px;color:inherit;text-decoration:none}.card:hover{border-color:#2563eb}.card strong{font-size:19px}.card em{color:#9a3412;font-style:normal}.warn{margin-top:20px;padding:12px;background:#fef3c7;color:#92400e;border-radius:8px}a.report{display:inline-block;margin-top:14px}</style><main><h1>paper8-10 Geometry 最终泛化审核</h1><p class="intro">冻结 Geometry 规则在 3 份新 PDF、共 ${totalPages} 页上的完整 Body + 非正文候选。</p><div class="cards">${cards}</div><a class="report" href="FINAL_AUDIT_REPORT.json">查看机器审核报告</a><div class="warn">Column 捕获是临时候选，未写入 Column Truth；所有 Geometry 结果仍 under review，不 Accept、不 Promote、不进入 Runtime。</div></main>`);
  process.stdout.write(`${OUTPUT}\n${summary.papers.length} papers / ${totalPages} pages\n`);
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
