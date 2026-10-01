#!/usr/bin/env node
"use strict";

// Fresh offline non-Body candidate generation and editable review output.
// Body baseline and Column truth are read-only. No acceptance or promotion occurs.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const source = require("./layout-geometry-candidate-intake");
const bodyFlow = require("./layout-geometry-main-flow-review");

const ROOT = path.resolve(__dirname, "../..");
const APP = path.join(ROOT, "lingoflow-client", "electron-app");
const EVIDENCE = path.join(ROOT, ".governance", "archive", "evidence", "layout-geometry-capability-audit", "evidence", "phase-2-paper-geometry");
const OUTPUT = path.join(EVIDENCE, "human-review-non-body-editable-v1");
const RASTERS = path.join(OUTPUT, "pages");
const COLUMN_CORPUS = path.join(APP, "capability-library", "capabilities", "cap.column-recognition", "corpus.json");
const PAPERS = Array.from({ length: 7 }, (_, index) => `paper${index + 1}`);
const EXCLUDED_PROTECTED = new Set(["formula", "margin", "image", "authoritative_preserve"]);
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const safeJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
const editorCore = fs.readFileSync(path.join(__dirname, "layout-geometry-non-body-editor.js"), "utf8");
const editorUi = fs.readFileSync(path.join(__dirname, "layout-geometry-non-body-editor-ui.js"), "utf8");
const bundledPdftoppm = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "native", "poppler", "Library", "bin", "pdftoppm.exe");
const PDFTOPPM = process.env.GEOMETRY_REVIEW_PDFTOPPM || (fs.existsSync(bundledPdftoppm) ? bundledPdftoppm : "pdftoppm");

function ensureCleanRasters(pdfPath, paper, sourceSha, pages) {
  const dir = path.join(RASTERS, paper);
  const metaPath = path.join(dir, "raster-meta.json");
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    if (meta.sourcePdfSha256 === sourceSha && meta.annotations === "hidden"
      && meta.pages.length === pages.length
      && meta.pages.every((item) => fs.existsSync(path.join(dir, item.image)))) return meta;
  }
  fs.mkdirSync(dir, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geometry-non-body-raster-"));
  const prefix = path.join(tempDir, "page");
  const result = spawnSync(PDFTOPPM, ["-jpeg", "-r", "144", "-hide-annotations", "-jpegopt", "quality=88,progressive=y,optimize=y", pdfPath, prefix], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.error && result.error.message || result.stderr || result.stdout || "clean rasterization failed");
  const rendered = fs.readdirSync(tempDir).filter((name) => /^page-\d+\.jpg$/i.test(name))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
  if (rendered.length !== pages.length) throw new Error(`${paper} clean raster page count ${rendered.length} != ${pages.length}`);
  const meta = {
    schemaVersion: "layout-geometry-review-raster/v3",
    renderer: "poppler-pdftoppm",
    annotations: "hidden",
    scale: 2,
    sourcePdfSha256: sourceSha,
    pages: rendered.map((name, index) => {
      const image = `p${String(index + 1).padStart(3, "0")}.jpg`;
      fs.copyFileSync(path.join(tempDir, name), path.join(dir, image));
      return { pageNumber: index + 1, image, pageWidth: pages[index].pageSize.width, pageHeight: pages[index].pageSize.height,
        imageWidth: Math.round(pages[index].pageSize.width * 2), imageHeight: Math.round(pages[index].pageSize.height * 2) };
    }),
  };
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  fs.rmSync(tempDir, { recursive: true, force: true });
  return meta;
}

function options(selected = "section_heading") {
  const independent = ["title", "author_affiliation", "abstract", "keywords", "section_heading", "figure", "figure_caption", "table", "references_section_header", "other_independent"];
  const protectedTypes = ["header", "footer", "page_number", "reference_entries", "watermark", "license_text", "side_mark", "authoritative_preserve"];
  const render = (types, label) => `<optgroup label="${label}">${types.map((type) => `<option value="${type}"${type === selected ? " selected" : ""}>${type}</option>`).join("")}</optgroup>`;
  return render(independent, "独立对象") + render(protectedTypes, "受保护对象");
}

function pageArticle(paper, page, sourceSha, predictionKey) {
  const imageFile = path.join(RASTERS, paper, `p${String(page.pageNumber).padStart(3, "0")}.jpg`);
  const image = `data:image/jpeg;base64,${fs.readFileSync(imageFile).toString("base64")}`;
  return `<article class="editable-page" id="p${page.pageNumber}" data-paper="${paper}" data-page="${page.pageNumber}" data-source-sha="${sourceSha}" data-prediction-key="${predictionKey}">
    <header><h2>${paper} · p${page.pageNumber}</h2><span class="box-count"></span></header>
    <script type="application/json" class="page-size">${safeJson(page.pageSize)}</script>
    <script type="application/json" class="machine-predicted">${safeJson(page.predicted)}</script>
    <div class="edit-toolbar">
      <label>对象类型 <select class="object-type">${options()}</select></label>
      <button type="button" class="new-box" aria-pressed="false">＋ 新建对象框</button>
      <button type="button" class="delete-box" disabled>删除选中框</button>
      <button type="button" class="reset-page">重置当前页</button>
      <button type="button" class="confirm-page">确认当前页标注</button>
      <label>页面缩放 <select class="zoom-page"><option value="0.75">75%</option><option value="1">100%</option><option value="1.4" selected>140%</option><option value="1.75">175%</option><option value="2">200%</option></select></label>
    </div>
    <p class="edit-status" role="status"></p>
    <div class="stage-viewport"><div class="stage">
      <img src="${image}" width="${page.pageSize.width}" height="${page.pageSize.height}" draggable="false" alt="${paper} page ${page.pageNumber}">
      <svg class="correction-overlay" viewBox="0 0 ${page.pageSize.width} ${page.pageSize.height}" preserveAspectRatio="none" aria-label="可编辑非正文候选框"></svg>
    </div></div>
  </article>`;
}

function documentHtml(paper, sourceSha, predictionKey, pages) {
  const links = PAPERS.map((item) => `<a href="${item}.html"${item === paper ? ' aria-current="page"' : ""}>${item}</a>`).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${paper} 非正文 Geometry 审核</title><style>
*{box-sizing:border-box}html,body{margin:0;background:#f4f1ea;color:#1c1917;font:14px/1.45 "Segoe UI",system-ui,sans-serif}.top{position:sticky;top:0;z-index:10;background:#1c1917;color:#fff;padding:12px 20px}.top h1{font-size:17px;margin:0}.top p{margin:4px 0;color:#d6d3d1}.top nav{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px;align-items:center}.top a,.top button{color:#fff;background:#44403c;border:0;border-radius:18px;padding:6px 10px;text-decoration:none;cursor:pointer}.top a[aria-current=page]{background:#fff;color:#1c1917}.top input{max-width:190px}.banner{background:#fff7ed;color:#9a3412;padding:8px 20px;border-bottom:1px solid #fed7aa}main{max-width:1120px;margin:auto;padding:18px}article{background:#fff;border:1px solid #d6d3d1;border-radius:10px;padding:16px;margin-bottom:24px}article header{display:flex;justify-content:space-between;gap:12px;align-items:baseline}h2{font-size:17px;margin:0}.box-count{color:#57534e}.edit-toolbar{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin:10px 0}.edit-toolbar button,.edit-toolbar select{font:inherit;border:1px solid #a8a29e;border-radius:6px;background:#fff;padding:6px 8px;cursor:pointer}.edit-toolbar button:disabled{opacity:.4}.edit-toolbar .confirmed{background:#d1fae5;border-color:#059669}.edit-toolbar .new-box[aria-pressed=true]{background:#fef3c7}.edit-toolbar label{display:flex;gap:5px;align-items:center}.edit-status{font-size:12px;color:#57534e;min-height:18px;margin:4px 0}.stage-viewport{overflow:auto;max-width:100%}.stage{position:relative;max-width:none;margin:0 auto;touch-action:none;box-shadow:0 4px 18px #0002}.stage img,.stage svg{display:block;width:100%;height:auto}.stage img{user-select:none;-webkit-user-drag:none}.stage svg{position:absolute;inset:0;width:100%;height:100%;touch-action:none}.corrected-rect{fill:rgba(217,119,6,.09);stroke:#d97706;stroke-width:1.8;vector-effect:non-scaling-stroke;cursor:move}.protected .corrected-rect{fill:rgba(220,38,38,.07);stroke:#dc2626}.selected .corrected-rect{stroke-width:2.5}.corrected-label{font-size:8px;font-weight:700;fill:#b45309;pointer-events:none}.protected .corrected-label{fill:#b91c1c}.resize-handle{fill:#fff;stroke:#111827;stroke-width:1.4;vector-effect:non-scaling-stroke;cursor:nwse-resize}.resize-handle[data-handle=n],.resize-handle[data-handle=s]{cursor:ns-resize}.resize-handle[data-handle=e],.resize-handle[data-handle=w]{cursor:ew-resize}.resize-handle[data-handle=ne],.resize-handle[data-handle=sw]{cursor:nesw-resize}.creation-preview{fill:rgba(5,150,105,.08);stroke:#047857;stroke-width:1.5;stroke-dasharray:4 3;pointer-events:none}
</style></head><body><div class="top"><h1>非正文 Geometry · ${paper}</h1><p>仅显示非正文对象候选。Body 已冻结且不显示；PDF 坐标绑定；未 Accept、未 Promote、不进入 Runtime。</p><nav>${links}<a href="index.html">全部论文</a><button id="export-ground-truth" type="button">导出 Ground Truth JSON</button><label>导入本轮 JSON <input id="import-ground-truth" type="file" accept="application/json,.json"></label></nav></div><div class="banner">橙色为 independent region，红色为 protected region。公式、安全余量、writable space 与 Body 框均不在本轮显示。</div><main>${pages.map((page) => pageArticle(paper, page, sourceSha, predictionKey)).join("\n")}</main><script>${editorCore}</script><script>${editorUi}</script></body></html>`;
}

function overlaps(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width), y1 = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}

function candidateChecks(pages) {
  const outOfBounds = [];
  const mixedTypeOverlaps = [];
  const referenceLaneViolations = [];
  const captionOverextensionSuspects = [];
  const tableOverextensionSuspects = [];
  const figureTableOwnershipConflicts = [];
  pages.forEach((page) => {
    page.predicted.forEach((item, index) => {
      const g = item.geometry;
      if (g.x < 0 || g.y < 0 || g.width < 3 || g.height < 3 || g.x + g.width > page.pageSize.width + 0.01 || g.y + g.height > page.pageSize.height + 0.01) {
        outOfBounds.push({ pageNumber: page.pageNumber, id: item.id });
      }
      if (item.objectType === "figure_caption" && (g.height > 96 || g.height > page.pageSize.height * 0.13)) {
        captionOverextensionSuspects.push({ pageNumber: page.pageNumber, id: item.id, height: g.height });
      }
      if (item.objectType === "table" && g.height > page.pageSize.height * 0.34) {
        tableOverextensionSuspects.push({ pageNumber: page.pageNumber, id: item.id, height: g.height });
      }
      page.predicted.slice(index + 1).forEach((other) => {
        if (item.objectType === other.objectType) return;
        const hit = overlaps(g, other.geometry);
        const smaller = Math.min(g.width * g.height, other.geometry.width * other.geometry.height);
        if (smaller > 0 && hit / smaller > 0.6) mixedTypeOverlaps.push({ pageNumber: page.pageNumber, first: item.id, second: other.id, overlapRatio: Math.round(hit / smaller * 1000) / 1000 });
      });
    });
    const references = page.predicted.filter((item) => item.objectType === "reference_entries");
    const mid = page.pageSize.width / 2;
    if (page.columnLayout === "double_column") references.forEach((item) => {
      const g = item.geometry;
      if (g.x < mid - 2 && g.x + g.width > mid + 2) {
        referenceLaneViolations.push({ pageNumber: page.pageNumber, id: item.id, reason: "crosses_column_gutter" });
      }
    });
    references.forEach((item, index) => references.slice(index + 1).forEach((other) => {
      const hit = overlaps(item.geometry, other.geometry);
      const smaller = Math.min(item.geometry.width * item.geometry.height, other.geometry.width * other.geometry.height);
      if (smaller > 0 && hit / smaller > 0.12) {
        referenceLaneViolations.push({ pageNumber: page.pageNumber, first: item.id, second: other.id, reason: "reference_boxes_mutually_overlap", overlapRatio: Math.round(hit / smaller * 1000) / 1000 });
      }
    }));
    const figures = page.predicted.filter((item) => item.objectType === "figure");
    const tables = page.predicted.filter((item) => item.objectType === "table");
    figures.forEach((figure) => tables.forEach((table) => {
      const hit = overlaps(figure.geometry, table.geometry);
      const smaller = Math.min(figure.geometry.width * figure.geometry.height, table.geometry.width * table.geometry.height);
      if (smaller > 0 && hit / smaller > 0.04) {
        figureTableOwnershipConflicts.push({ pageNumber: page.pageNumber, figure: figure.id, table: table.id, overlapRatio: Math.round(hit / smaller * 1000) / 1000 });
      }
    }));
  });
  return {
    status: outOfBounds.length || mixedTypeOverlaps.length || referenceLaneViolations.length || captionOverextensionSuspects.length || tableOverextensionSuspects.length || figureTableOwnershipConflicts.length ? "review_required" : "pass",
    outOfBounds,
    mixedTypeOverlaps,
    referenceLaneViolations,
    captionOverextensionSuspects,
    tableOverextensionSuspects,
    figureTableOwnershipConflicts,
  };
}

function predictNonBodyPages(paper, extracted, sample, models, identityLabel = "frozen Column identity") {
  const headingFontNames = source.deriveHeadingFontNames(extracted);
  extracted.pages.forEach((page) => { page.headingFontNames = headingFontNames; });
  const referenceStartPage = source.detectReferenceStartPage(extracted);
  const referenceFlow = bodyFlow.referenceBoundary(extracted);
  const gaps = [];
  const pages = extracted.pages.map((page) => {
    const column = source.columnIdentity(sample, page.pageNumber);
    const model = models.get(page.pageNumber);
    if (!model || model.layoutType !== column.layout) throw new Error(`${paper} p${page.pageNumber} ${identityLabel} conflict`);
    const lines = source.groupLines(page.items);
    const independent = source.buildIndependentRegions(page, column.independentTypes, lines, model);
    independent.gaps.forEach((gap) => gaps.push(gap));
    const protectedRegions = source.protectedRegionsFromSemantics(page, lines, independent.regions, referenceStartPage, column.layout, model)
      .filter((item) => !EXCLUDED_PROTECTED.has(item.kind))
      .map((item) => {
        if (item.kind !== "reference_entries" || referenceFlow?.resumePageNumber !== page.pageNumber) return item;
        const stop = referenceFlow.resumeY - 4;
        return { ...item, geometry: { ...item.geometry,
          height: Math.min(item.geometry.y + item.geometry.height, stop) - item.geometry.y } };
      })
      .filter((item) => item.geometry.height > 2);
    const independentRegions = independent.regions.filter((item) => {
      if (item.type !== "section_heading") return true;
      const regionText = lines.filter((line) => overlaps(item.geometry, source.lineBox(line)) > 0)
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((line) => String(line.text || "").replace(/\s+/g, " ").trim())
        .filter(Boolean).join(" ");
      const structuralHeading = /^(?:(?:\d+(?:\.\d+)*|[A-Z](?:\.\d+)*)(?:[.)])?\s+|(?:proposition|lemma|remark|theorem|corollary)\s+\d+|(?:acknowledg(?:e)?ments?|appendix|conclusions?|discussion|ethical considerations|limitations|methods?|results?)\b)/i.test(regionText);
      if (!structuralHeading && (regionText.match(/[=<>∑∫√≈≤≥α-ωΑ-Ωλρδψημσ]/g) || []).length >= 2) return false;
      return !independent.regions.some((other) => other !== item
        && ["title", "author_affiliation", "abstract", "keywords", "references_section_header", "other_independent"].includes(other.type)
        && overlaps(item.geometry, other.geometry) / Math.max(1, item.geometry.width * item.geometry.height) > 0.35)
        && !protectedRegions.some((other) => other.kind === "reference_entries"
          && overlaps(item.geometry, other.geometry) / Math.max(1, item.geometry.width * item.geometry.height) > 0.35);
    });
    const predicted = [
      ...independentRegions.map((item, index) => ({
        id: `p${page.pageNumber}.independent.${item.type}.${index + 1}`,
        sourceRegionId: `p${page.pageNumber}.independent.${item.type}.${index + 1}`,
        objectType: item.type,
        regionClass: "independent_region",
        semanticRegionType: item.type,
        protectedKind: null,
        geometry: item.geometry,
      })),
      ...protectedRegions.map((item, index) => ({
        id: `p${page.pageNumber}.protected.${item.kind}.${index + 1}`,
        sourceRegionId: `p${page.pageNumber}.protected.${item.kind}.${index + 1}`,
        objectType: item.kind,
        regionClass: "protected_region",
        semanticRegionType: null,
        protectedKind: item.kind,
        geometry: item.geometry,
      })),
    ];
    return { pageNumber: page.pageNumber, pageSize: page.pageSize, columnLayout: column.layout, predicted };
  });
  return { gaps, pages, checks: candidateChecks(pages) };
}

async function main() {
  const localRequire = createRequire(path.join(APP, "main.js"));
  const pdfjs = await import(pathToFileURL(localRequire.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
  const corpus = JSON.parse(fs.readFileSync(COLUMN_CORPUS, "utf8"));
  fs.mkdirSync(OUTPUT, { recursive: true });
  const manifest = {
    schemaVersion: "layout-geometry-non-body-editable-review/v1",
    scope: "non_body_objects_only",
    bodyBaseline: "body-main-reading-flow-paper1-7-2026-09-23",
    columnDependencyMode: "read_only",
    runtimeDecisionUse: "forbidden",
    candidateAcceptance: "not_performed",
    promotion: "not_performed",
    papers: [],
  };
  const generationReport = { schemaVersion: "layout-geometry-non-body-generation-report/v1", status: "under_review", papers: [] };
  for (const paper of PAPERS) {
    const sample = corpus.samples.find((entry) => entry.id === `sample.column-pilot.${paper}`);
    if (!sample) throw new Error(`Missing frozen Column sample: ${paper}`);
    const pdfPath = source.resolvePdfByHash(sample.source.sha256, sample.source.bytes);
    const extracted = await source.extractPdf(pdfjs, pdfPath);
    const models = source.loadColumnModels(paper);
    const { gaps, pages } = predictNonBodyPages(paper, extracted, sample, models);
    const rasterMeta = ensureCleanRasters(pdfPath, paper, sample.source.sha256, pages);
    if (rasterMeta.sourcePdfSha256 !== sample.source.sha256 || rasterMeta.pages.length !== pages.length) throw new Error(`${paper} raster identity conflict`);
    const candidate = {
      schemaVersion: "layout-geometry-non-body-candidate/v1",
      paper,
      sourcePdfSha256: sample.source.sha256,
      coordinateSpace: "pdf-page-top-left-points",
      scope: "non_body_objects_only",
      bodyBaseline: manifest.bodyBaseline,
      runtimeDecisionUse: "forbidden",
      candidateAcceptance: "not_performed",
      promotion: "not_performed",
      pages,
    };
    const bytes = `${JSON.stringify(candidate, null, 2)}\n`;
    fs.writeFileSync(path.join(OUTPUT, `${paper}-non-body-candidate.json`), bytes);
    const predictionKey = hash(bytes).slice(0, 16);
    fs.writeFileSync(path.join(OUTPUT, `${paper}.html`), documentHtml(paper, sample.source.sha256, predictionKey, pages));
    const typeCounts = {};
    pages.flatMap((page) => page.predicted).forEach((item) => { typeCounts[item.objectType] = (typeCounts[item.objectType] || 0) + 1; });
    const checks = candidateChecks(pages);
    manifest.papers.push({ paper, pages: pages.length, machineBoxes: pages.reduce((sum, page) => sum + page.predicted.length, 0), candidateSha256: hash(bytes), predictionKey });
    generationReport.papers.push({ paper, pages: pages.length, typeCounts, gaps, checks });
  }
  fs.writeFileSync(path.join(OUTPUT, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(OUTPUT, "GENERATION_REPORT.json"), `${JSON.stringify(generationReport, null, 2)}\n`);
  fs.writeFileSync(path.join(OUTPUT, "index.html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>非正文 Geometry 审核</title><style>body{font:16px/1.6 system-ui;max-width:780px;margin:36px auto;padding:0 20px}li{margin:9px 0}.warn{color:#9a3412}</style><h1>paper1–7 非正文 Geometry 可编辑审核</h1><p>只显示非正文对象候选。Body 已冻结且不显示。橙色为 independent region，红色为 protected region。</p><p class="warn">本轮仍 under review；不 Accept、不 Promote、不进入 Runtime。公式、安全余量与 writable space 不在本轮。</p><p><a href="GENERATION_REPORT.json">生成报告</a> · <a href="MANIFEST.json">构建清单</a></p><ol>${PAPERS.map((paper) => `<li><a href="${paper}.html">${paper}</a> · <a href="${paper}-non-body-candidate.json">候选 JSON</a></li>`).join("")}</ol></html>`);
  fs.writeFileSync(path.join(OUTPUT, "README.md"), "# 非正文 Geometry 可编辑审核\n\n打开 `index.html`。页面只显示非正文对象候选；Body、公式、安全余量与 writable space 均不显示。可新增、移动、缩放、删除、修改对象类型、重置、逐页确认并导出 JSON。\n\n所有坐标为 `pdf-page-top-left-points`。机器 predicted 与人工 corrected 分开保存。本轮未 Accept、未 Promote，不进入 Runtime，不修改 Column Truth 或冻结 Body。\n");
  console.log(JSON.stringify({ output: OUTPUT, papers: manifest.papers.length, pages: manifest.papers.reduce((sum, item) => sum + item.pages, 0), machineBoxes: manifest.papers.reduce((sum, item) => sum + item.machineBoxes, 0) }));
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { main, candidateChecks, predictNonBodyPages };
