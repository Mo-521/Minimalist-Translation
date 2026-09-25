#!/usr/bin/env node
"use strict";

// Offline paper8–10 Geometry review pack. Column capture is evidence only:
// it is not written into cap.column-recognition corpus/baseline and is not promoted.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const source = require("./layout-geometry-candidate-intake");
const bodyFlow = require("./layout-geometry-main-flow-review");
const nonBody = require("./layout-geometry-non-body-editable");
const columnPilot = require("./column-capability-pilot");

const ROOT = path.resolve(__dirname, "../..");
const APP = path.join(ROOT, "lingoflow-client", "electron-app");
const EVIDENCE = path.join(ROOT, ".governance", "tasks", "layout-geometry-capability-audit", "evidence", "phase-2-paper-geometry");
const OUTPUT = path.join(EVIDENCE, "human-review-cross-sample-paper8-10-v1");
const SOURCE_ROOTS = ["D:\\PDF测试", path.join(APP, "tmp", "pdfs")];
const PAPERS = ["paper8", "paper9", "paper10"];
const bundledPdftoppm = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "native", "poppler", "Library", "bin", "pdftoppm.exe");
const PDFTOPPM = process.env.GEOMETRY_REVIEW_PDFTOPPM || (fs.existsSync(bundledPdftoppm) ? bundledPdftoppm : "pdftoppm");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const safeJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));
const bodyCore = fs.readFileSync(path.join(__dirname, "layout-geometry-body-editor.js"), "utf8");
const bodyUi = fs.readFileSync(path.join(__dirname, "layout-geometry-body-editor-ui.js"), "utf8");
const objectCore = fs.readFileSync(path.join(__dirname, "layout-geometry-non-body-editor.js"), "utf8");
const objectUi = fs.readFileSync(path.join(__dirname, "layout-geometry-non-body-editor-ui.js"), "utf8");

function findSamplePdf(paperNumber) {
  const suffix = new RegExp(`样本${paperNumber}\\.pdf$`, "i");
  for (const root of SOURCE_ROOTS) {
    if (!fs.existsSync(root)) continue;
    const match = fs.readdirSync(root).find((name) => suffix.test(name));
    if (match) return path.join(root, match);
  }
  throw new Error(`Missing 论文样本${paperNumber}.pdf in source roots`);
}

function rasterize(pdfPath, paper, sourceSha, pageCount, pageSizes) {
  const dir = path.join(OUTPUT, "pages", paper);
  fs.mkdirSync(dir, { recursive: true });
  const existingMetaPath = path.join(dir, "raster-meta.json");
  if (fs.existsSync(existingMetaPath)) {
    const existing = JSON.parse(fs.readFileSync(existingMetaPath, "utf8"));
    if (existing.sourcePdfSha256 === sourceSha && Array.isArray(existing.pages) && existing.pages.length === pageCount) {
      return dir;
    }
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geometry-cross-sample-"));
  const prefix = path.join(tempDir, "page");
  const result = spawnSync(PDFTOPPM, [
    "-jpeg", "-r", "144", "-hide-annotations",
    "-jpegopt", "quality=88,progressive=y,optimize=y",
    pdfPath, prefix,
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.error && result.error.message || result.stderr || result.stdout || "rasterization failed");
  const rendered = fs.readdirSync(tempDir).filter((name) => /^page-\d+\.jpg$/i.test(name))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
  if (rendered.length !== pageCount) throw new Error(`${paper} raster page count ${rendered.length} != ${pageCount}`);
  const meta = {
    schemaVersion: "layout-geometry-review-raster/v3",
    renderer: "poppler-pdftoppm",
    annotations: "hidden",
    sourcePdfSha256: sourceSha,
    pages: rendered.map((name, index) => {
      const image = `p${String(index + 1).padStart(3, "0")}.jpg`;
      fs.copyFileSync(path.join(tempDir, name), path.join(dir, image));
      return {
        pageNumber: index + 1,
        image,
        pageWidth: pageSizes[index].width,
        pageHeight: pageSizes[index].height,
      };
    }),
  };
  fs.writeFileSync(path.join(dir, "raster-meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  fs.rmSync(tempDir, { recursive: true, force: true });
  return dir;
}

function inlineJpeg(paper, pageNumber) {
  const file = path.join(OUTPUT, "pages", paper, `p${String(pageNumber).padStart(3, "0")}.jpg`);
  return `data:image/jpeg;base64,${fs.readFileSync(file).toString("base64")}`;
}

function syntheticColumnSample(paper, capture) {
  const independentRegions = [];
  capture.pages.forEach((page) => {
    ((page.columnModel && page.columnModel.independentRegions) || []).forEach((region) => {
      if (region && region.type && String(region.source || "") !== "paper-page-zone") {
        independentRegions.push({ pageNumber: page.pageNumber, type: region.type });
      }
    });
  });
  return {
    id: `sample.column-observed.${paper}`,
    source: capture.source,
    expectedOutcomes: [{
      assertionId: "assert.column.page-region-truth",
      expected: {
        pageLayoutBasis: "body_text_flow_only",
        pages: capture.pages.map((page) => ({
          pageNumber: page.pageNumber,
          layout: page.layoutType,
        })),
        independentRegions,
      },
    }],
  };
}

function observedModels(capture) {
  const byPage = new Map();
  capture.pages.forEach((page) => {
    if (!page.columnModel) throw new Error(`${capture.source.fileName} p${page.pageNumber} capture missing columnModel`);
    byPage.set(page.pageNumber, page.columnModel);
  });
  return byPage;
}

function predictBody(extracted, sample, models) {
  const referenceStart = bodyFlow.referenceBoundary(extracted);
  return extracted.pages.map((page) => {
    const column = source.columnIdentity(sample, page.pageNumber);
    const model = models.get(page.pageNumber);
    const hints = bodyFlow.visualHintsForPage(page);
    const candidate = bodyFlow.predictPage(page, column, model, referenceStart, hints.visualObjects, hints.pageVisuals);
    return {
      pageNumber: page.pageNumber,
      pageSize: page.pageSize,
      columnLayout: column.layout,
      predicted: candidate,
      candidate,
    };
  });
}

function objectTypeOptions() {
  const independent = ["title", "author_affiliation", "abstract", "keywords", "section_heading", "figure", "figure_caption", "table", "references_section_header", "other_independent"];
  const protectedTypes = ["header", "footer", "page_number", "reference_entries", "watermark", "license_text", "side_mark", "authoritative_preserve"];
  const render = (types, label) => `<optgroup label="${label}">${types.map((type) => `<option value="${type}"${type === "section_heading" ? " selected" : ""}>${type}</option>`).join("")}</optgroup>`;
  return render(independent, "独立对象") + render(protectedTypes, "受保护对象");
}

function nav(paper, kind) {
  return PAPERS.map((item) => {
    const href = kind === "body" ? `${item}-body.html` : kind === "objects" ? `${item}-non-body.html` : `${item}-complete.html`;
    return `<a href="${href}"${item === paper ? ' aria-current="page"' : ""}>${item}</a>`;
  }).join("");
}

function bodyHtml(paper, sourceSha, predictionKey, pages) {
  const articles = pages.map((page) => {
    const predicted = page.candidate.map((item) => ({
      id: item.id,
      canonicalColumnId: item.canonicalColumnId,
      geometry: item.geometry,
    }));
    return `<article class="editable-page" id="p${page.pageNumber}" data-paper="${paper}" data-page="${page.pageNumber}" data-source-sha="${sourceSha}" data-prediction-key="${predictionKey}" data-box-label="候选">
      <header><h2>${paper} · p${page.pageNumber}</h2><span class="box-count"></span></header>
      <script type="application/json" class="body-page-size">${safeJson(page.pageSize)}</script>
      <script type="application/json" class="body-predicted">${safeJson(predicted)}</script>
      <div class="edit-toolbar">
        <button type="button" class="new-box" aria-pressed="false">＋ 新建正文框</button>
        <button type="button" class="delete-box" disabled>删除选中框</button>
        <button type="button" class="reset-page">重置当前页</button>
        <button type="button" class="confirm-page">确认当前页标注</button>
        <label>页面缩放 <select class="zoom-page"><option value="0.75">75%</option><option value="1">100%</option><option value="1.4" selected>140%</option><option value="1.75">175%</option><option value="2">200%</option></select></label>
      </div>
      <p class="edit-status" role="status"></p>
      <div class="stage-viewport"><div class="stage">
        <img src="${inlineJpeg(paper, page.pageNumber)}" width="${page.pageSize.width}" height="${page.pageSize.height}" draggable="false" alt="${paper} page ${page.pageNumber}">
        <svg class="correction-overlay" viewBox="0 0 ${page.pageSize.width} ${page.pageSize.height}" preserveAspectRatio="none" aria-label="可编辑正文候选框"></svg>
      </div></div>
    </article>`;
  }).join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${paper} 跨样本正文审核</title><style>
*{box-sizing:border-box}html,body{margin:0;background:#f4f1ea;color:#1c1917;font:14px/1.45 "Segoe UI",system-ui,sans-serif}
.top{position:sticky;top:0;z-index:10;background:#1c1917;color:#fff;padding:12px 20px}.top h1{font-size:17px;margin:0}.top p{margin:4px 0;color:#d6d3d1}.top nav{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px;align-items:center}.top a,.top button{color:#fff;background:#44403c;border:0;border-radius:18px;padding:6px 10px;text-decoration:none;cursor:pointer}.top a[aria-current=page]{background:#fff;color:#1c1917}.top input{max-width:190px}.banner{background:#ecfdf5;color:#065f46;padding:8px 20px;border-bottom:1px solid #a7f3d0}main{max-width:1050px;margin:auto;padding:18px}
article{background:#fff;border:1px solid #d6d3d1;border-radius:10px;padding:16px;margin-bottom:24px}article header{display:flex;justify-content:space-between;gap:12px;align-items:baseline}h2{font-size:17px;margin:0}.box-count{color:#57534e}.edit-toolbar{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin:10px 0}.edit-toolbar button,.edit-toolbar select{font:inherit;border:1px solid #a8a29e;border-radius:6px;background:#fff;padding:6px 8px;cursor:pointer}.edit-toolbar button:disabled{opacity:.4}.edit-toolbar .confirmed{background:#d1fae5;border-color:#059669}.edit-toolbar .new-box[aria-pressed=true]{background:#fef3c7}.edit-toolbar label{display:flex;gap:5px;align-items:center}.edit-status{font-size:12px;color:#57534e;min-height:18px;margin:4px 0}.stage-viewport{overflow:auto;max-width:100%}.stage{position:relative;max-width:none;margin:0 auto;touch-action:none;box-shadow:0 4px 18px #0002}.stage img,.stage svg{display:block;width:100%;height:auto}.stage img{user-select:none;-webkit-user-drag:none}.stage svg{position:absolute;inset:0;width:100%;height:100%;touch-action:none}.corrected-rect{fill:rgba(5,150,105,.08);stroke:#059669;stroke-width:1.8;vector-effect:non-scaling-stroke;cursor:move}.corrected-box.selected .corrected-rect{stroke:#047857;stroke-width:2.3}.corrected-label{font-size:8px;font-weight:700;fill:#047857;pointer-events:none}.resize-handle{fill:#fff;stroke:#047857;stroke-width:1.5;vector-effect:non-scaling-stroke;cursor:nwse-resize}.resize-handle[data-handle=n],.resize-handle[data-handle=s]{cursor:ns-resize}.resize-handle[data-handle=e],.resize-handle[data-handle=w]{cursor:ew-resize}.resize-handle[data-handle=ne],.resize-handle[data-handle=sw]{cursor:nesw-resize}.creation-preview{fill:rgba(5,150,105,.08);stroke:#047857;stroke-width:1.5;stroke-dasharray:4 3;pointer-events:none}
</style></head><body><div class="top"><h1>跨样本正文 Geometry · ${paper}</h1><p>paper8–10 机器正文候选，可编辑。未 Accept、未 Promote、不进入 Runtime。栏型来自只读捕获，不是已晋升 Column 语料。</p><nav>${nav(paper, "body")}<a href="${paper}-non-body.html">非正文</a><a href="${paper}-complete.html">总览</a><a href="index.html">全部论文</a><button id="export-ground-truth" type="button">导出 Ground Truth JSON</button><label>导入本轮 JSON <input id="import-ground-truth" type="file" accept="application/json,.json"></label></nav></div><div class="banner">本轮是跨样本审核，不是 paper1–7 冻结基线。请逐页确认后导出 JSON。</div><main>${articles}</main><script>${bodyCore}</script><script>${bodyUi}</script></body></html>`;
}

function nonBodyHtml(paper, sourceSha, predictionKey, pages) {
  const articles = pages.map((page) => `<article class="editable-page" id="p${page.pageNumber}" data-paper="${paper}" data-page="${page.pageNumber}" data-source-sha="${sourceSha}" data-prediction-key="${predictionKey}">
    <header><h2>${paper} · p${page.pageNumber}</h2><span class="box-count"></span></header>
    <script type="application/json" class="page-size">${safeJson(page.pageSize)}</script>
    <script type="application/json" class="machine-predicted">${safeJson(page.predicted)}</script>
    <div class="edit-toolbar">
      <label>对象类型 <select class="object-type">${objectTypeOptions()}</select></label>
      <button type="button" class="new-box" aria-pressed="false">＋ 新建对象框</button>
      <button type="button" class="delete-box" disabled>删除选中框</button>
      <button type="button" class="reset-page">重置当前页</button>
      <button type="button" class="confirm-page">确认当前页标注</button>
      <label>页面缩放 <select class="zoom-page"><option value="0.75">75%</option><option value="1">100%</option><option value="1.4" selected>140%</option><option value="1.75">175%</option><option value="2">200%</option></select></label>
    </div>
    <p class="edit-status" role="status"></p>
    <div class="stage-viewport"><div class="stage">
      <img src="${inlineJpeg(paper, page.pageNumber)}" width="${page.pageSize.width}" height="${page.pageSize.height}" draggable="false" alt="${paper} page ${page.pageNumber}">
      <svg class="correction-overlay" viewBox="0 0 ${page.pageSize.width} ${page.pageSize.height}" preserveAspectRatio="none" aria-label="可编辑非正文候选框"></svg>
    </div></div>
  </article>`).join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${paper} 跨样本非正文审核</title><style>
*{box-sizing:border-box}html,body{margin:0;background:#f4f1ea;color:#1c1917;font:14px/1.45 "Segoe UI",system-ui,sans-serif}.top{position:sticky;top:0;z-index:10;background:#1c1917;color:#fff;padding:12px 20px}.top h1{font-size:17px;margin:0}.top p{margin:4px 0;color:#d6d3d1}.top nav{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px;align-items:center}.top a,.top button{color:#fff;background:#44403c;border:0;border-radius:18px;padding:6px 10px;text-decoration:none;cursor:pointer}.top a[aria-current=page]{background:#fff;color:#1c1917}.top input{max-width:190px}.banner{background:#fff7ed;color:#9a3412;padding:8px 20px;border-bottom:1px solid #fed7aa}main{max-width:1120px;margin:auto;padding:18px}article{background:#fff;border:1px solid #d6d3d1;border-radius:10px;padding:16px;margin-bottom:24px}article header{display:flex;justify-content:space-between;gap:12px;align-items:baseline}h2{font-size:17px;margin:0}.box-count{color:#57534e}.edit-toolbar{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin:10px 0}.edit-toolbar button,.edit-toolbar select{font:inherit;border:1px solid #a8a29e;border-radius:6px;background:#fff;padding:6px 8px;cursor:pointer}.edit-toolbar button:disabled{opacity:.4}.edit-toolbar .confirmed{background:#d1fae5;border-color:#059669}.edit-toolbar .new-box[aria-pressed=true]{background:#fef3c7}.edit-toolbar label{display:flex;gap:5px;align-items:center}.edit-status{font-size:12px;color:#57534e;min-height:18px;margin:4px 0}.stage-viewport{overflow:auto;max-width:100%}.stage{position:relative;max-width:none;margin:0 auto;touch-action:none;box-shadow:0 4px 18px #0002}.stage img,.stage svg{display:block;width:100%;height:auto}.stage img{user-select:none;-webkit-user-drag:none}.stage svg{position:absolute;inset:0;width:100%;height:100%;touch-action:none}.corrected-rect{fill:rgba(217,119,6,.09);stroke:#d97706;stroke-width:1.8;vector-effect:non-scaling-stroke;cursor:move}.protected .corrected-rect{fill:rgba(220,38,38,.07);stroke:#dc2626}.selected .corrected-rect{stroke-width:2.5}.corrected-label{font-size:8px;font-weight:700;fill:#b45309;pointer-events:none}.protected .corrected-label{fill:#b91c1c}.resize-handle{fill:#fff;stroke:#111827;stroke-width:1.4;vector-effect:non-scaling-stroke;cursor:nwse-resize}.resize-handle[data-handle=n],.resize-handle[data-handle=s]{cursor:ns-resize}.resize-handle[data-handle=e],.resize-handle[data-handle=w]{cursor:ew-resize}.resize-handle[data-handle=ne],.resize-handle[data-handle=sw]{cursor:nesw-resize}.creation-preview{fill:rgba(5,150,105,.08);stroke:#047857;stroke-width:1.5;stroke-dasharray:4 3;pointer-events:none}
</style></head><body><div class="top"><h1>跨样本非正文 Geometry · ${paper}</h1><p>只显示非正文对象。未 Accept、未 Promote。栏型来自只读捕获。</p><nav>${nav(paper, "objects")}<a href="${paper}-body.html">正文</a><a href="${paper}-complete.html">总览</a><a href="index.html">全部论文</a><button id="export-ground-truth" type="button">导出 Ground Truth JSON</button><label>导入本轮 JSON <input id="import-ground-truth" type="file" accept="application/json,.json"></label></nav></div><div class="banner">橙色 independent，红色 protected。公式、安全余量、writable space 与 Body 不在本页显示。</div><main>${articles}</main><script>${objectCore}</script><script>${objectUi}</script></body></html>`;
}

function boxSvg(item, layer) {
  const box = item.geometry;
  const label = layer === "body" ? `BODY ${item.canonicalColumnId || "wide"}` : String(item.objectType || "object").replace(/_/g, " ");
  return `<g class="geometry-box layer-${layer}"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"/><text x="${box.x + 2}" y="${Math.max(9, box.y - 2)}">${escapeHtml(label)}</text></g>`;
}

function completeHtml(paper, bodyPages, objectPages) {
  const cards = bodyPages.map((bodyPage, index) => {
    const objectPage = objectPages[index];
    const bodies = bodyPage.candidate || [];
    const independent = objectPage.predicted.filter((item) => item.regionClass === "independent_region");
    const protectedObjects = objectPage.predicted.filter((item) => item.regionClass === "protected_region");
    const svg = [
      ...bodies.map((item) => boxSvg(item, "body")),
      ...independent.map((item) => boxSvg(item, "independent")),
      ...protectedObjects.map((item) => boxSvg(item, "protected")),
    ].join("");
    return `<article class="page-card" id="p${bodyPage.pageNumber}">
      <header><h2>${paper} · p${bodyPage.pageNumber}</h2><p>${bodyPage.pageSize.width}×${bodyPage.pageSize.height}pt · Body ${bodies.length} · 独立 ${independent.length} · 保护 ${protectedObjects.length}</p></header>
      <div class="stage" style="--page-ratio:${bodyPage.pageSize.width}/${bodyPage.pageSize.height}">
        <img src="${inlineJpeg(paper, bodyPage.pageNumber)}" width="${bodyPage.pageSize.width}" height="${bodyPage.pageSize.height}" alt="${paper} page ${bodyPage.pageNumber}">
        <svg viewBox="0 0 ${bodyPage.pageSize.width} ${bodyPage.pageSize.height}" preserveAspectRatio="none">${svg}</svg>
      </div>
    </article>`;
  }).join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${paper} 跨样本 Geometry 总览</title><style>
*{box-sizing:border-box}html,body{margin:0;background:#f4f1ea;color:#1c1917;font:14px/1.45 "Segoe UI",system-ui,sans-serif}.top{position:sticky;top:0;z-index:20;background:#1c1917;color:#fff;padding:12px 20px}.top h1{font-size:18px;margin:0}.top p{margin:3px 0;color:#d6d3d1}.papers,.layers{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px;align-items:center}.papers a{color:#fff;background:#44403c;border-radius:18px;padding:6px 10px;text-decoration:none}.papers a[aria-current=page]{background:#fff;color:#1c1917}.layers label{border:1px solid #57534e;border-radius:18px;padding:5px 9px;cursor:pointer}.notice{background:#fff7ed;color:#9a3412;padding:8px 20px}main{max-width:1120px;margin:auto;padding:18px}.page-card{background:#fff;border:1px solid #d6d3d1;border-radius:12px;padding:16px;margin-bottom:26px}.page-card header{display:flex;justify-content:space-between;gap:14px}.page-card h2{font-size:18px;margin:0}.stage{position:relative;width:min(100%,860px);margin:12px auto 0;aspect-ratio:var(--page-ratio);box-shadow:0 8px 30px #1c191722}.stage img,.stage svg{position:absolute;inset:0;width:100%;height:100%}.geometry-box rect{vector-effect:non-scaling-stroke;stroke-width:1.45;fill:#2563eb1f;stroke:#1d4ed8}.layer-independent rect{fill:#f9731624;stroke:#c2410c}.layer-protected rect{fill:#e11d4820;stroke:#be123c;stroke-dasharray:5 3}.geometry-box text{font:700 8px/1 "Segoe UI",system-ui,sans-serif;paint-order:stroke;stroke:#fff;stroke-width:2px}.layer-body text{fill:#1d4ed8}.layer-independent text{fill:#9a3412}.layer-protected text{fill:#9f1239}body.hide-body .layer-body,body.hide-independent .layer-independent,body.hide-protected .layer-protected{display:none}
</style></head><body><div class="top"><h1>跨样本完整 Geometry · ${paper}</h1><p>只读总览。编辑请打开正文/非正文页。未 Accept、未 Promote。</p><div class="papers">${nav(paper, "complete")}<a href="${paper}-body.html">正文编辑</a><a href="${paper}-non-body.html">非正文编辑</a><a href="index.html">全部论文</a></div><div class="layers"><label><input type="checkbox" data-layer="body" checked> Body</label><label><input type="checkbox" data-layer="independent" checked> Independent</label><label><input type="checkbox" data-layer="protected" checked> Protected</label></div></div><div class="notice">栏型来自当前 Column 检测器的只读捕获，不是已晋升 Column Truth。</div><main>${cards}</main><script>document.querySelectorAll("input[data-layer]").forEach(input=>input.addEventListener("change",()=>document.body.classList.toggle("hide-"+input.dataset.layer,!input.checked)))</script></body></html>`;
}

async function main() {
  fs.mkdirSync(path.join(OUTPUT, "column-capture"), { recursive: true });
  const localRequire = createRequire(path.join(APP, "main.js"));
  const pdfjs = await import(pathToFileURL(localRequire.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
  const manifest = {
    schemaVersion: "layout-geometry-cross-sample-review/v1",
    papers: PAPERS,
    columnCorpusMutation: "not_performed",
    candidateAcceptance: "not_performed",
    promotion: "not_performed",
    runtimeDecisionUse: "forbidden",
    note: "Uses frozen Body predictPage + visualHintsForPage and frozen non-Body predictNonBodyPages. Observed Column models are Geometry-task evidence only. cap.column-recognition corpus/baseline were not modified.",
    results: [],
  };
  const auditResults = [];
  for (const paper of PAPERS) {
    const paperNumber = Number(paper.replace("paper", ""));
    const pdfPath = findSamplePdf(paperNumber);
    const bytes = fs.readFileSync(pdfPath);
    const capture = await columnPilot.capture(pdfPath);
    fs.writeFileSync(path.join(OUTPUT, "column-capture", `${paper}.json`), `${JSON.stringify({
      schemaVersion: "column-pilot-output/v1",
      role: "geometry_cross_sample_observed_identity",
      promoted: false,
      source: capture.source,
      pages: capture.pages.map((page) => ({
        pageNumber: page.pageNumber,
        layoutType: page.layoutType,
        columns: page.columns,
        columnModel: page.columnModel,
      })),
    }, null, 2)}\n`);
    const sample = syntheticColumnSample(paper, capture);
    const models = observedModels(capture);
    const extracted = await source.extractPdf(pdfjs, pdfPath);
    if (extracted.pageCount !== capture.source.pageCount) throw new Error(`${paper} extract/capture page count mismatch`);
    rasterize(pdfPath, paper, capture.source.sha256, extracted.pageCount, extracted.pages.map((page) => page.pageSize));
    const bodyPages = predictBody(extracted, sample, models);
    const objects = nonBody.predictNonBodyPages(paper, extracted, sample, models, "observed Column identity");
    const bodyCandidate = {
      schemaVersion: "layout-geometry-main-flow-candidate/v1",
      paper,
      sourcePdfSha256: capture.source.sha256,
      sourceFileName: capture.source.fileName,
      coordinateSpace: "pdf-page-top-left-points",
      runtimeDecisionUse: "forbidden",
      candidateAcceptance: "not_performed",
      promotion: "not_performed",
      columnIdentityMode: "observed_capture_not_promoted",
      pages: bodyPages,
    };
    const objectCandidate = {
      schemaVersion: "layout-geometry-non-body-candidate/v1",
      paper,
      sourcePdfSha256: capture.source.sha256,
      sourceFileName: capture.source.fileName,
      coordinateSpace: "pdf-page-top-left-points",
      scope: "non_body_objects_only",
      runtimeDecisionUse: "forbidden",
      candidateAcceptance: "not_performed",
      promotion: "not_performed",
      columnIdentityMode: "observed_capture_not_promoted",
      pages: objects.pages,
    };
    const bodyBytes = `${JSON.stringify(bodyCandidate, null, 2)}\n`;
    const objectBytes = `${JSON.stringify(objectCandidate, null, 2)}\n`;
    fs.writeFileSync(path.join(OUTPUT, `${paper}-body-candidate.json`), bodyBytes);
    fs.writeFileSync(path.join(OUTPUT, `${paper}-non-body-candidate.json`), objectBytes);
    const bodyKey = hash(bodyBytes).slice(0, 16);
    const objectKey = hash(objectBytes).slice(0, 16);
    fs.writeFileSync(path.join(OUTPUT, `${paper}-body.html`), bodyHtml(paper, capture.source.sha256, bodyKey, bodyPages));
    fs.writeFileSync(path.join(OUTPUT, `${paper}-non-body.html`), nonBodyHtml(paper, capture.source.sha256, objectKey, objects.pages));
    fs.writeFileSync(path.join(OUTPUT, `${paper}-complete.html`), completeHtml(paper, bodyPages, objects.pages));
    const bodyMissingPages = bodyPages.filter((page, index) => {
      const nonBodyPage = objects.pages[index];
      const referencesOnly = nonBodyPage?.predicted?.some((box) => box.objectType === "reference_entries");
      return page.candidate.length === 0 && !referencesOnly;
    }).map((page) => page.pageNumber);
    const auditStatus = bodyMissingPages.length > 0 || objects.checks.status !== "pass"
      ? "review_required"
      : "geometry_checks_pass_column_review_required";
    auditResults.push({
      paper,
      status: auditStatus,
      pages: extracted.pageCount,
      bodyMissingPages,
      nonBodyChecks: objects.checks,
      generationGaps: objects.gaps,
    });
    manifest.results.push({
      paper,
      sourceFileName: capture.source.fileName,
      sourceSha256: capture.source.sha256,
      bytes: bytes.length,
      pages: extracted.pageCount,
      layouts: capture.pages.map((page) => page.layoutType),
      bodyBoxes: bodyPages.reduce((sum, page) => sum + page.candidate.length, 0),
      nonBodyBoxes: objects.pages.reduce((sum, page) => sum + page.predicted.length, 0),
      nonBodyChecks: objects.checks.status,
      gaps: objects.gaps.length,
      bodyMissingPages,
      auditStatus,
    });
  }
  fs.writeFileSync(path.join(OUTPUT, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(OUTPUT, "FINAL_AUDIT_REPORT.json"), `${JSON.stringify({
    schemaVersion: "layout-geometry-cross-sample-final-audit/v1",
    status: "under_review",
    source: "frozen_geometry_generators_on_new_samples",
    columnDependencyStatus: "observed_capture_not_promoted",
    columnCorpusMutation: "not_performed",
    candidateAcceptance: "not_performed",
    promotion: "not_performed",
    runtimeDecisionUse: "forbidden",
    papers: auditResults,
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(OUTPUT, "index.html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>paper8–10 Geometry 审核</title><style>body{font:16px/1.6 system-ui;max-width:820px;margin:36px auto;padding:0 20px}li{margin:10px 0}.warn{color:#9a3412}</style><h1>paper8–10 跨样本 Geometry 审核</h1><p>用已冻结的正文/非正文生成器跑新样本。栏型来自当前 Column 检测器的只读捕获，<strong>没有写入</strong> cap.column-recognition 正式语料，也没有 Accept / Promote。</p><p class="warn">请先看总览，再分别改正文和非正文；逐页确认后导出 JSON。</p><ol>${PAPERS.map((paper) => `<li><strong>${paper}</strong> · <a href="${paper}-complete.html">总览</a> · <a href="${paper}-body.html">正文编辑</a> · <a href="${paper}-non-body.html">非正文编辑</a></li>`).join("")}</ol><p><a href="FINAL_AUDIT_REPORT.json">最终机器审计报告</a> · <a href="MANIFEST.json">构建清单</a></p></html>`);
  fs.writeFileSync(path.join(OUTPUT, "README.md"), `# paper8–10 跨样本 Geometry 审核\n\n打开 \`index.html\`。每个 HTML 自包含页面图像。\n\n- 总览：正文 + 非正文只读叠加\n- 正文编辑：可移动/缩放/新建/删除/确认并导出 JSON\n- 非正文编辑：独立对象与保护区，同样可编辑导出\n\n栏型是 Geometry 任务内的只读捕获，不是已晋升 Column Truth。本轮未 Accept、未 Promote，不进入 Runtime。\n`);
  console.log(JSON.stringify({ output: OUTPUT, papers: manifest.results }, null, 2));
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { main, findSamplePdf, PAPERS };
