#!/usr/bin/env node
"use strict";

// Offline Human Review artifact only. Does not mutate oracles, Column truth, runtime, or candidate status.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { validateOracle } = require("../electron-app/capability-library/geometry-oracle");

const ROOT = path.resolve(__dirname, "../..");
const APP = path.resolve(__dirname, "../electron-app");
const EVIDENCE = path.join(ROOT, ".governance/tasks/layout-geometry-capability-audit/evidence/phase-2-paper-geometry");
const outputArgIndex = process.argv.indexOf("--output");
const outputName = outputArgIndex >= 0 ? process.argv[outputArgIndex + 1] : "human-review";
if (!outputName || path.basename(outputName) !== outputName) throw new Error("--output must be one directory name inside phase-2-paper-geometry");
const OUT = path.join(EVIDENCE, outputName);
const FRESH_BUILD = process.argv.includes("--fresh");
const BODY_ONLY = process.argv.includes("--body-only");
const EDITABLE_BODY = process.argv.includes("--editable-body");
if (EDITABLE_BODY && !BODY_ONLY) throw new Error("--editable-body requires --body-only");
const WRITE_LEGACY_REDIRECTS = outputName === "human-review";
const bundledPdftoppm = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "native", "poppler", "Library", "bin", "pdftoppm.exe");
const PDFTOPPM = process.env.GEOMETRY_REVIEW_PDFTOPPM || (fs.existsSync(bundledPdftoppm) ? bundledPdftoppm : "pdftoppm");
const SOURCE_ROOTS = ["D:\\PDF测试", path.join(APP, "tmp", "pdfs")];
const RENDER_SCALE = 2;
const PAPERS = ["paper1", "paper2", "paper3", "paper4", "paper5", "paper6", "paper7"];

const CLASS_META = {
  body_column: { label: "Body", short: "BODY", color: "#2563eb", fill: "rgba(37,99,235,0.22)", stroke: "#1d4ed8" },
  independent_region: { label: "Independent", short: "IND", color: "#c2410c", fill: "rgba(234,88,12,0.28)", stroke: "#9a3412" },
  protected_region: { label: "Protected", short: "PROT", color: "#be123c", fill: "rgba(225,29,72,0.30)", stroke: "#9f1239" },
  writable_space_expectation: { label: "Writable", short: "WRITE", color: "#047857", fill: "rgba(5,150,105,0.12)", stroke: "#047857" },
};
const SAFETY_MARGIN_META = { label: "Safety margin", short: "MARGIN", color: "#7c3aed", fill: "rgba(124,58,237,0.07)", stroke: "#7c3aed" };

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function resolvePdfByHash(expectedSha, expectedBytes) {
  for (const root of SOURCE_ROOTS) {
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root)) {
      if (!name.toLowerCase().endsWith(".pdf")) continue;
      const filePath = path.join(root, name);
      if (fs.statSync(filePath).size !== expectedBytes) continue;
      if (sha256(fs.readFileSync(filePath)) === expectedSha) return filePath;
    }
  }
  throw new Error(`PDF ${expectedSha} not found`);
}

function regionCaption(region) {
  if (region.regionClass === "body_column") return `BODY ${region.canonicalColumnRef.columnId}`;
  if (region.regionClass === "independent_region") return region.semanticRegionType.replace(/_/g, " ");
  if (region.regionClass === "protected_region") return region.protectedKind.replace(/_/g, " ");
  if (region.regionClass === "writable_space_expectation") return `WRITE ${region.canonicalColumnRef.columnId}`;
  return region.regionClass;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function overlaySvg(page) {
  const visibleRegions = BODY_ONLY ? page.regions.filter((region) => region.regionClass === "body_column") : page.regions;
  const shapes = visibleRegions.map((region) => {
    const meta = region.regionClass === "protected_region" && region.protectedKind === "margin"
      ? SAFETY_MARGIN_META
      : CLASS_META[region.regionClass];
    const box = region.expectedGeometry;
    const dash = region.regionClass === "writable_space_expectation" || region.protectedKind === "margin" ? "stroke-dasharray=\"6 4\"" : "";
    const labelY = Math.max(10, box.y - 2);
    return `<g class="region ${region.regionClass}" data-region-id="${escapeHtml(region.regionId)}" data-class="${region.regionClass}">
      <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="${meta.fill}" stroke="${meta.stroke}" stroke-width="1.2" ${dash}/>
      <text x="${box.x + 2}" y="${labelY}" fill="${meta.color}" font-size="8" font-family="ui-sans-serif,system-ui,sans-serif" font-weight="700">${escapeHtml(regionCaption(region))}</text>
    </g>`;
  }).join("");
  return `<svg class="page-overlay" viewBox="0 0 ${page.pageSize.width} ${page.pageSize.height}" preserveAspectRatio="none" aria-hidden="true">${shapes}</svg>`;
}

function pageArticle(paperKey, page, imgSrc) {
  const n = page.identity.pageNumber;
  const reviewedRegions = BODY_ONLY ? page.regions.filter((region) => region.regionClass === "body_column") : page.regions;
  const coords = reviewedRegions.map((region) => `<li><code>${escapeHtml(region.regionId)}</code> ${escapeHtml(JSON.stringify(region.expectedGeometry))}</li>`).join("");
  return `<article class="page-card" id="${paperKey}-p${n}" data-paper="${paperKey}" data-page="${n}">
    <header class="page-head"><h2>${paperKey} · p${n}</h2><p class="hint">${page.pageSize.width}×${page.pageSize.height}pt · overlay locked to PDF pixels</p></header>
    <div class="stage">
      <img src="${imgSrc}" width="${page.pageSize.width}" height="${page.pageSize.height}" alt="${paperKey} page ${n}">
      ${overlaySvg(page)}
    </div>
    <form class="verdict" data-paper="${paperKey}" data-page="${n}">
      <fieldset>
        <legend>Page verdict <span>(does not accept or promote the candidate)</span></legend>
        <label><input type="radio" name="verdict-${paperKey}-${n}" value="accept"> accept</label>
        <label><input type="radio" name="verdict-${paperKey}-${n}" value="adjust_geometry"> adjust geometry</label>
        <label><input type="radio" name="verdict-${paperKey}-${n}" value="wrong_region_or_identity"> wrong region or identity</label>
        <label><input type="radio" name="verdict-${paperKey}-${n}" value="insufficient_evidence"> insufficient evidence</label>
      </fieldset>
      <label class="notes">Region ID <input type="text" name="region-${paperKey}-${n}" placeholder="optional, e.g. p${n}.body.left"></label>
      <label class="notes">Reviewer notes <textarea name="notes-${paperKey}-${n}" rows="2" placeholder="What is wrong or why this page is acceptable"></textarea></label>
    </form>
    <details class="coords"><summary>Coordinate details</summary><ul>${coords}</ul></details>
  </article>`;
}

function editableBodyArticle(paperKey, page, imgSrc, sourceSha) {
  const n = page.identity.pageNumber;
  const predicted = page.regions.filter((region) => region.regionClass === "body_column")
    .map((region) => ({
      id: region.regionId,
      canonicalColumnId: region.canonicalColumnRef.columnId,
      geometry: region.expectedGeometry,
    }));
  const safeJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
  const shapes = predicted.map((item) => {
    const box = item.geometry;
    return `<rect class="predicted-rect" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"/>`;
  }).join("");
  return `<article class="page-card editable-page" id="${paperKey}-p${n}" data-paper="${paperKey}" data-page="${n}" data-source-sha="${sourceSha}">
    <header class="page-head"><h2>${paperKey} · p${n}</h2><p class="hint">${page.pageSize.width}×${page.pageSize.height} PDF pt · 机器预测独立保留</p></header>
    <script type="application/json" class="body-page-size">${safeJson(page.pageSize)}</script>
    <script type="application/json" class="body-predicted">${safeJson(predicted)}</script>
    <div class="edit-toolbar">
      <button type="button" class="new-box" aria-pressed="false">＋ 新建正文框</button>
      <button type="button" class="delete-box" disabled>删除选中框</button>
      <button type="button" class="reset-page">重置当前页</button>
      <button type="button" class="confirm-page">确认当前页标注</button>
      <label>页面缩放 <select class="zoom-page"><option value="0.75">75%</option><option value="1">100%</option><option value="1.4" selected>140%</option><option value="1.75">175%</option><option value="2">200%</option></select></label>
      <span class="box-count"></span>
    </div>
    <p class="edit-status" role="status"></p>
    <div class="stage-viewport"><div class="stage editable-stage">
      <img src="${imgSrc}" width="${page.pageSize.width}" height="${page.pageSize.height}" draggable="false" alt="${paperKey} page ${n}">
      <svg class="prediction-overlay" viewBox="0 0 ${page.pageSize.width} ${page.pageSize.height}" preserveAspectRatio="none" aria-hidden="true">${shapes}</svg>
      <svg class="correction-overlay" viewBox="0 0 ${page.pageSize.width} ${page.pageSize.height}" preserveAspectRatio="none" aria-label="可编辑人工正文框"></svg>
    </div></div>
  </article>`;
}

function sharedCss() {
  return `*{box-sizing:border-box}html,body{margin:0;background:#f4f1ea;color:#1c1917;font:14px/1.45 "Segoe UI",ui-sans-serif,system-ui,sans-serif}
header.top{position:sticky;top:0;z-index:20;background:#1c1917;color:#fafaf9;padding:12px 20px;display:flex;flex-wrap:wrap;gap:12px;align-items:center}
header.top h1{margin:0;font-size:16px;font-weight:650}
header.top p{margin:0;color:#d6d3d1;font-size:12px}
.banner{background:#fff7ed;border-bottom:1px solid #fdba74;padding:8px 20px;font-size:13px}
nav.papers,nav.layers{display:flex;flex-wrap:wrap;gap:8px}
nav a,button.export{color:#fafaf9;background:#44403c;border:0;border-radius:999px;padding:6px 12px;text-decoration:none;cursor:pointer}
nav a[aria-current="page"]{background:#fafaf9;color:#1c1917}
.layers label{background:#292524;border-radius:999px;padding:6px 10px;font-size:12px;cursor:pointer}
.layers input{margin-right:6px}
main{max-width:980px;margin:0 auto;padding:20px}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin:0 0 16px;padding:0;list-style:none}
.legend span{display:inline-block;width:12px;height:12px;margin-right:6px;vertical-align:middle}
.page-card{background:#fff;border:1px solid #d6d3d1;border-radius:12px;padding:16px;margin:0 0 28px}
.page-head{display:flex;justify-content:space-between;gap:12px;align-items:baseline}
.page-head h2{margin:0;font-size:18px}
.hint{margin:0;color:#57534e;font-size:12px}
.stage{position:relative;width:min(100%, 860px);margin:12px auto;background:#e7e5e4;box-shadow:0 8px 30px rgba(28,25,23,.12)}
.stage img,.stage svg{display:block;width:100%;height:auto}
.stage svg{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}
.stage-viewport{overflow:auto;max-width:100%;margin:12px auto}
.editable-stage{max-width:none;margin:0 auto;touch-action:none}
.editable-stage img{user-select:none;-webkit-user-drag:none}
.editable-stage .correction-overlay{pointer-events:auto;touch-action:none}
.predicted-rect{fill:none;stroke:#2563eb;stroke-width:1.6;stroke-dasharray:5 3;vector-effect:non-scaling-stroke}
.corrected-rect{fill:rgba(245,158,11,.09);stroke:#d97706;stroke-width:1.5;vector-effect:non-scaling-stroke;cursor:move}
.corrected-box.selected .corrected-rect{stroke:#b45309;stroke-width:2.3}
.corrected-label{font-size:8px;font-weight:700;fill:#92400e;pointer-events:none}
.resize-handle{fill:#fff;stroke:#b45309;stroke-width:1.5;vector-effect:non-scaling-stroke;cursor:nwse-resize}
.resize-handle[data-handle="n"],.resize-handle[data-handle="s"]{cursor:ns-resize}
.resize-handle[data-handle="e"],.resize-handle[data-handle="w"]{cursor:ew-resize}
.resize-handle[data-handle="ne"],.resize-handle[data-handle="sw"]{cursor:nesw-resize}
.creation-preview{fill:rgba(245,158,11,.12);stroke:#d97706;stroke-width:1.5;stroke-dasharray:4 3;pointer-events:none}
.edit-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px}
.edit-toolbar button,.edit-toolbar select{font:inherit;border:1px solid #a8a29e;border-radius:7px;background:#fff;padding:6px 9px;color:#292524;cursor:pointer}
.edit-toolbar button:disabled{opacity:.45;cursor:not-allowed}
.edit-toolbar .confirmed{background:#d1fae5;border-color:#059669;color:#065f46}
.edit-toolbar .new-box[aria-pressed="true"]{background:#fef3c7;border-color:#d97706}
.edit-toolbar label{display:flex;align-items:center;gap:5px}
.box-count{color:#57534e;margin-left:auto}
.edit-status{color:#57534e;font-size:12px;min-height:18px;margin:7px 0 0}
.editor-legend{display:flex;gap:18px;flex-wrap:wrap}
.editor-legend i{display:inline-block;width:16px;height:11px;vertical-align:middle;margin-right:5px}
.machine-key{border:2px dashed #2563eb}.human-key{border:2px solid #d97706;background:rgba(245,158,11,.09)}
body.hide-body .body_column,body.hide-ind .independent_region,body.hide-prot .protected_region,body.hide-write .writable_space_expectation{display:none}
.verdict{display:grid;gap:8px;margin-top:12px}
.verdict legend span{font-weight:400;color:#57534e}
.verdict fieldset{border:1px solid #e7e5e4;border-radius:8px;display:grid;gap:6px;padding:10px}
.notes{display:grid;gap:4px}
.notes input,.notes textarea{width:100%;border:1px solid #d6d3d1;border-radius:8px;padding:8px;font:inherit}
.coords{margin-top:8px;color:#57534e}
.coords ul{font-family:ui-monospace,Consolas,monospace;font-size:11px}
footer{padding:12px 20px 40px;color:#57534e;font-size:12px;text-align:center}`;
}

function sharedJs() {
  return `const KEY="geometry-human-review-v1";
const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||"{}")}catch{return {}}};
const save=(data)=>localStorage.setItem(KEY,JSON.stringify(data));
function collect(){
  const data=load();
  document.querySelectorAll("article.page-card").forEach((card)=>{
    const paper=card.dataset.paper, page=Number(card.dataset.page);
    const verdict=[...card.querySelectorAll("input[type=radio]")].find((item)=>item.checked)?.value||"";
    const regionId=card.querySelector("input[type=text]").value.trim();
    const notes=card.querySelector("textarea").value.trim();
    const id=paper+"-p"+page;
    if(!verdict && !regionId && !notes) { delete data[id]; return; }
    data[id]={paper,page,verdict,regionId,notes,at:new Date().toISOString(),candidateStatusUnchanged:true,promotion:"not_performed"};
  });
  save(data); return data;
}
function restore(){
  const data=load();
  document.querySelectorAll("article.page-card").forEach((card)=>{
    const rec=data[card.dataset.paper+"-p"+card.dataset.page]; if(!rec) return;
    const radio=card.querySelector("input[value='"+rec.verdict+"']"); if(radio) radio.checked=true;
    card.querySelector("input[type=text]").value=rec.regionId||"";
    card.querySelector("textarea").value=rec.notes||"";
  });
}
document.querySelectorAll(".verdict").forEach((form)=>form.addEventListener("input", collect));
document.getElementById("export-json")?.addEventListener("click", ()=>{
  const blob=new Blob([JSON.stringify({schemaVersion:"layout-geometry-human-review/v1",runtimeDecisionUse:"forbidden",promotion:"not_performed",pages:collect()},null,2)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="geometry-human-review.json"; a.click();
});
document.querySelectorAll("[data-layer]").forEach((input)=>input.addEventListener("change", ()=>{
  document.body.classList.toggle("hide-"+input.dataset.layer, !input.checked);
}));
restore();`;
}

function shell(title, current, body) {
  const links = PAPERS.map((paper) => `<a href="${paper}.html"${paper === current ? " aria-current=page" : ""}>${paper}</a>`).join("");
  const layerControls = BODY_ONLY ? "" : `<nav class="layers" aria-label="overlay layers">
    <label><input type="checkbox" data-layer="body" checked> Body</label>
    <label><input type="checkbox" data-layer="ind" checked> Independent</label>
    <label><input type="checkbox" data-layer="prot" checked> Protected</label>
    <label><input type="checkbox" data-layer="write" checked> Writable</label>
  </nav>`;
  const legend = EDITABLE_BODY
    ? `<div class="editor-legend"><span><i class="machine-key"></i>蓝色虚线：机器预测（只读）</span><span><i class="human-key"></i>橙色实线：人工修正（可编辑）</span></div>`
    : BODY_ONLY
    ? `<ul class="legend"><li><span style="background:#2563eb"></span>Body / 主阅读流正文框</li></ul>`
    : `<ul class="legend">
  <li><span style="background:#2563eb"></span>Body column</li>
  <li><span style="background:#ea580c"></span>Independent region</li>
  <li><span style="background:#e11d48"></span>Protected region</li>
  <li><span style="background:#059669"></span>Writable space (dashed)</li>
</ul>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${sharedCss()}</style></head>
<body>
<header class="top">
  <div><h1>${BODY_ONLY ? "Body Geometry Human Review" : "Layout Geometry Human Review"}</h1><p>${BODY_ONLY ? "Body boxes only. Formula remains in the main reading flow." : "PDF pixels + overlay."} Not accepted. Not promoted. Not runtime truth.</p></div>
  <nav class="papers">${links}<a href="index.html">All papers</a></nav>
  ${layerControls}
  ${EDITABLE_BODY ? `<button class="export" id="export-ground-truth" type="button">导出 Ground Truth JSON</button><label class="import-label">导入并还原 JSON <input id="import-ground-truth" type="file" accept="application/json,.json"></label>` : `<button class="export" id="export-json" type="button">Export notes JSON</button>`}
</header>
<div class="banner">${EDITABLE_BODY ? "仅编辑正文框。机器框和人工框分开保存；本页确认不等于 Candidate Accept 或 Promote。导出 JSON 可再导入还原。" : BODY_ONLY ? "Only Body boxes are visible; all other region overlays are intentionally omitted for this review round. " : ""}Page verdicts stay in this review artifact only. They do not change candidate status, Column truth, or production UI.</div>
<main>
${legend}
${body}
</main>
<footer>cap.layout-geometry review artifact · runtimeDecisionUse: forbidden</footer>
${EDITABLE_BODY ? `<script>${fs.readFileSync(path.join(__dirname, "layout-geometry-body-editor.js"), "utf8")}</script><script>${fs.readFileSync(path.join(__dirname, "layout-geometry-body-editor-ui.js"), "utf8")}</script>` : `<script>${sharedJs()}</script>`}
</body></html>`;
}

function jpegDataUri(paperKey, pageNumber) {
  const file = path.join(OUT, "pages", paperKey, `p${String(pageNumber).padStart(3, "0")}.jpg`);
  return `data:image/jpeg;base64,${fs.readFileSync(file).toString("base64")}`;
}

function ensureRasters(paperKey, pageCount, oraclePages, oracle) {
  const dir = path.join(OUT, "pages", paperKey);
  const metaPath = path.join(dir, "raster-meta.json");
  if (!FRESH_BUILD && fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    const complete = meta.scale === RENDER_SCALE
      && Array.isArray(meta.pages)
      && meta.pages.length === pageCount
      && meta.pages.every((item) => fs.existsSync(path.join(dir, item.image)));
    if (complete) return { meta, pdfPath: resolvePdfByHash(oracle.sample.sha256, oracle.sample.bytes), reusedRasterCache: true };
  }
  const pdfPath = resolvePdfByHash(oracle.sample.sha256, oracle.sample.bytes);
  return { meta: rasterizePdfPages(pdfPath, paperKey, pageCount, oraclePages), pdfPath, reusedRasterCache: false };
}
function rasterizePdfPages(filePath, paperKey, pageCount, oraclePages) {
  const dir = path.join(OUT, "pages", paperKey);
  fs.mkdirSync(dir, { recursive: true });
  const prefix = path.join(dir, "source-page");
  const result = spawnSync(PDFTOPPM, [
    "-jpeg",
    "-r", String(72 * RENDER_SCALE),
    "-jpegopt", "quality=88,progressive=y,optimize=y",
    filePath,
    prefix,
  ], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.error && result.error.message || result.stderr || result.stdout || "rasterize failed");
  }
  const rendered = fs.readdirSync(dir)
    .map((name) => ({ name, match: /^source-page-(\d+)\.jpg$/i.exec(name) }))
    .filter((item) => item.match)
    .sort((left, right) => Number(left.match[1]) - Number(right.match[1]));
  if (rendered.length !== pageCount) throw new Error(`${paperKey} raster page count ${rendered.length} != ${pageCount}`);
  const meta = {
    schemaVersion: "layout-geometry-review-raster/v2",
    renderer: "poppler-pdftoppm",
    scale: RENDER_SCALE,
    sourcePdfSha256: sha256(fs.readFileSync(filePath)),
    pages: rendered.map((item, index) => {
      const pageNumber = index + 1;
      const oraclePage = oraclePages[index];
      if (!oraclePage || oraclePage.identity.pageNumber !== pageNumber) {
        throw new Error(`${paperKey} oracle page sequence mismatch at ${pageNumber}`);
      }
      const image = `p${String(pageNumber).padStart(3, "0")}.jpg`;
      fs.renameSync(path.join(dir, item.name), path.join(dir, image));
      return {
        pageNumber,
        image,
        pageWidth: oraclePage.pageSize.width,
        pageHeight: oraclePage.pageSize.height,
        imageWidth: Math.round(oraclePage.pageSize.width * RENDER_SCALE),
        imageHeight: Math.round(oraclePage.pageSize.height * RENDER_SCALE),
      };
    }),
  };
  fs.writeFileSync(path.join(dir, "raster-meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}

async function main() {
  if (FRESH_BUILD && fs.existsSync(OUT) && fs.readdirSync(OUT).length) {
    throw new Error(`fresh output already exists and is not empty: ${OUT}`);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = {
    schemaVersion: "layout-geometry-visual-review-build/v1",
    outputName,
    buildMode: FRESH_BUILD ? "fresh_from_source_pdf_and_oracle" : "incremental",
    readsExistingHtml: false,
    reusedRasterCache: false,
    visualScope: BODY_ONLY ? "body_column_only" : "all_geometry_regions",
    editableBodyLayer: EDITABLE_BODY,
    runtimeDecisionUse: "forbidden",
    promotion: "not_performed",
    papers: [],
  };
  for (const paperKey of PAPERS) {
    const oraclePath = path.join(EVIDENCE, "oracles", `${paperKey}-geometry-oracle.json`);
    const oracleBytes = fs.readFileSync(oraclePath);
    const oracle = JSON.parse(oracleBytes.toString("utf8"));
    validateOracle(oracle);
    const rasterBuild = ensureRasters(paperKey, oracle.sample.pageCount, oracle.pages, oracle);
    const articles = oracle.pages.map((page) => EDITABLE_BODY
      ? editableBodyArticle(paperKey, page, jpegDataUri(paperKey, page.identity.pageNumber), oracle.sample.sha256)
      : pageArticle(paperKey, page, jpegDataUri(paperKey, page.identity.pageNumber))).join("\n");
    const htmlPath = path.join(OUT, `${paperKey}.html`);
    fs.writeFileSync(htmlPath, shell(`Geometry review ${paperKey}`, paperKey, articles));
    if (WRITE_LEGACY_REDIRECTS) fs.writeFileSync(path.join(EVIDENCE, "overlays", `${paperKey}.html`), `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=../human-review/${paperKey}.html"><p>Moved to <a href="../human-review/${paperKey}.html">${paperKey} human review</a>.</p>`);
    manifest.papers.push({
      paperKey,
      pageCount: oracle.sample.pageCount,
      sourcePdf: { sha256: sha256(fs.readFileSync(rasterBuild.pdfPath)), bytes: fs.statSync(rasterBuild.pdfPath).size },
      oracle: { file: path.relative(EVIDENCE, oraclePath).replace(/\\/g, "/"), sha256: sha256(oracleBytes) },
      rasters: rasterBuild.meta.pages.map((item) => {
        const imagePath = path.join(OUT, "pages", paperKey, item.image);
        return { pageNumber: item.pageNumber, image: `pages/${paperKey}/${item.image}`, sha256: sha256(fs.readFileSync(imagePath)) };
      }),
      html: { file: `${paperKey}.html`, sha256: sha256(fs.readFileSync(htmlPath)) },
      reusedRasterCache: rasterBuild.reusedRasterCache,
    });
  }
  let coverageReport = null;
  if (BODY_ONLY) {
    const reportSource = path.join(EVIDENCE, "body-coverage-report.json");
    const reportBytes = fs.readFileSync(reportSource);
    coverageReport = JSON.parse(reportBytes.toString("utf8"));
    if (coverageReport.scope !== "body_column_only") throw new Error("body coverage report scope mismatch");
    fs.writeFileSync(path.join(OUT, "body-coverage-report.json"), reportBytes);
    manifest.bodyCoverageReport = { file: "body-coverage-report.json", sha256: sha256(reportBytes), status: coverageReport.status };
  }
  const indexBody = `<p>Each <code>paperN.html</code> is a single self-contained file with inlined page rasters. Copy one file anywhere; no <code>pages/</code> directory is required.</p>${EDITABLE_BODY ? `<p>Editable Body annotation: move, resize, delete, create, reset and confirm per page; export or import one paper's Ground Truth JSON.</p>` : ""}${BODY_ONLY ? `<p><a href="body-coverage-report.json">Body coverage report</a>: ${escapeHtml(coverageReport.status)}, ${coverageReport.coveredLineCount}/${coverageReport.highConfidenceLineCount} high-confidence main-reading-flow lines covered.</p>` : `<p><a href="../KNOWN_ISSUES.md">Known issues / uncertain pages</a></p>`}<ul>${PAPERS.map((paper) => `<li><a href="${paper}.html">${paper}</a></li>`).join("")}</ul>`;
  fs.writeFileSync(path.join(OUT, "index.html"), shell("Geometry review paper1–7", "", indexBody));
  if (WRITE_LEGACY_REDIRECTS) fs.writeFileSync(path.join(EVIDENCE, "overlays", "index.html"), `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=../human-review/index.html"><p>Moved to <a href="../human-review/index.html">human review</a>.</p>`);
  fs.writeFileSync(path.join(OUT, "README.md"), `# Human Review Artifact

Each \`paperN.html\` is a **single self-contained file**: page rasters are inlined as JPEG base64. You can copy one HTML file to any empty folder and open it; no \`pages/\` directory is required.

- ${EDITABLE_BODY ? "Blue dashed boxes are immutable machine predictions; orange boxes are separate human corrections. Drag boxes to move, drag selected handles to resize, use New Body Box to draw on blank space, or delete selected boxes." : "Overlay, layer toggles, verdicts, notes, and export notes are unchanged."}
- ${EDITABLE_BODY ? "Reset Current Page restores the machine boxes and clears confirmation. Confirm Current Page saves review state but does **not** accept or promote candidates. Export Ground Truth JSON saves predicted and corrected lists plus confirmation for every page in the current paper. Import JSON restores that draft after verifying the source PDF and machine predictions." : "Verdicts are local notes only and do **not** accept or promote candidates."}
- ${EDITABLE_BODY ? "Local browser storage is best-effort on file:// pages. Export the JSON to keep a portable, auditable copy; import it to resume or verify restoration." : "Review notes remain local."}
- ${EDITABLE_BODY ? "DEMO_GROUND_TRUTH_DRAFT.json is a non-truth paper1 demonstration: import it into paper1.html to see moved/resized and newly created boxes. DEMO_TRACE.json records the programmatic smoke." : ""}
- Oracle JSON files are not modified by this viewer.
- Visual scope: ${BODY_ONLY ? "Body / main-reading-flow boxes only; all other overlays omitted" : "all Geometry region classes"}.
- Editable layer: ${EDITABLE_BODY ? "separate corrected Body boxes, PDF-point coordinates, per-page confirmation, Ground Truth JSON export/import" : "not enabled"}.
- Build mode: ${FRESH_BUILD ? "fresh from source PDF + current oracle; no existing HTML or raster cache was read" : "incremental raster cache allowed"}.
- \`pages/\` may remain as build evidence; the HTML does not load those files.
`);
  manifest.reusedRasterCache = manifest.papers.some((paper) => paper.reusedRasterCache);
  fs.writeFileSync(path.join(OUT, "BUILD_MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ out: OUT, papers: PAPERS.length, pages: manifest.papers.reduce((sum, paper) => sum + paper.pageCount, 0), scale: RENDER_SCALE, buildMode: manifest.buildMode, reusedRasterCache: manifest.reusedRasterCache, promotion: "not_performed", runtimeDecisionUse: "forbidden" }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
