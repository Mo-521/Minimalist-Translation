#!/usr/bin/env node
"use strict";

// Rebuild only the HTML in the existing offline editable-review directory.
// Previously exported human drafts are immutable inputs/evidence, not written.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "../..");
const EVIDENCE = path.join(ROOT, ".governance/archive/evidence/layout-geometry-capability-audit/evidence/phase-2-paper-geometry");
const SOURCE = path.join(EVIDENCE, "human-review-main-flow-v1");
const OUTPUT = path.join(EVIDENCE, "human-review-body-editable-v1");
const PAPERS = Array.from({ length: 7 }, (_, index) => `paper${index + 1}`);
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const safeJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
const core = fs.readFileSync(path.join(__dirname, "layout-geometry-body-editor.js"), "utf8");
const ui = fs.readFileSync(path.join(__dirname, "layout-geometry-body-editor-ui.js"), "utf8");

function pageArticle(paper, page, sourceSha, predictionKey) {
  const n = page.pageNumber;
  const size = page.pageSize;
  const predicted = page.candidate.map((item) => ({
    id: item.id,
    canonicalColumnId: item.canonicalColumnId,
    geometry: item.geometry,
  }));
  const raster = path.join(OUTPUT, "pages", paper, `p${String(n).padStart(3, "0")}.jpg`);
  const image = `data:image/jpeg;base64,${fs.readFileSync(raster).toString("base64")}`;
  return `<article class="editable-page" id="p${n}" data-paper="${paper}" data-page="${n}" data-source-sha="${sourceSha}" data-prediction-key="${predictionKey}" data-box-label="候选">
    <header><h2>${paper} · p${n}</h2><span class="box-count"></span></header>
    <script type="application/json" class="body-page-size">${safeJson(size)}</script>
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
      <img src="${image}" width="${size.width}" height="${size.height}" draggable="false" alt="${paper} page ${n}">
      <svg class="correction-overlay" viewBox="0 0 ${size.width} ${size.height}" preserveAspectRatio="none" aria-label="可编辑最新正文候选框"></svg>
    </div></div>
  </article>`;
}

function documentHtml(paper, sourceSha, predictionKey, pages) {
  const links = PAPERS.map((item) => `<a href="${item}.html"${item === paper ? ' aria-current="page"' : ""}>${item}</a>`).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${paper} 最新正文 Geometry 审核</title><style>
*{box-sizing:border-box}html,body{margin:0;background:#f4f1ea;color:#1c1917;font:14px/1.45 "Segoe UI",system-ui,sans-serif}
.top{position:sticky;top:0;z-index:10;background:#1c1917;color:#fff;padding:12px 20px}.top h1{font-size:17px;margin:0}.top p{margin:4px 0;color:#d6d3d1}.top nav{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px;align-items:center}.top a,.top button{color:#fff;background:#44403c;border:0;border-radius:18px;padding:6px 10px;text-decoration:none;cursor:pointer}.top a[aria-current=page]{background:#fff;color:#1c1917}.top input{max-width:190px}.banner{background:#ecfdf5;color:#065f46;padding:8px 20px;border-bottom:1px solid #a7f3d0}main{max-width:1050px;margin:auto;padding:18px}
article{background:#fff;border:1px solid #d6d3d1;border-radius:10px;padding:16px;margin-bottom:24px}article header{display:flex;justify-content:space-between;gap:12px;align-items:baseline}h2{font-size:17px;margin:0}.box-count{color:#57534e}.edit-toolbar{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin:10px 0}.edit-toolbar button,.edit-toolbar select{font:inherit;border:1px solid #a8a29e;border-radius:6px;background:#fff;padding:6px 8px;cursor:pointer}.edit-toolbar button:disabled{opacity:.4}.edit-toolbar .confirmed{background:#d1fae5;border-color:#059669}.edit-toolbar .new-box[aria-pressed=true]{background:#fef3c7}.edit-toolbar label{display:flex;gap:5px;align-items:center}.edit-status{font-size:12px;color:#57534e;min-height:18px;margin:4px 0}.stage-viewport{overflow:auto;max-width:100%}.stage{position:relative;max-width:none;margin:0 auto;touch-action:none;box-shadow:0 4px 18px #0002}.stage img,.stage svg{display:block;width:100%;height:auto}.stage img{user-select:none;-webkit-user-drag:none}.stage svg{position:absolute;inset:0;width:100%;height:100%;touch-action:none}.corrected-rect{fill:rgba(5,150,105,.08);stroke:#059669;stroke-width:1.8;vector-effect:non-scaling-stroke;cursor:move}.corrected-box.selected .corrected-rect{stroke:#047857;stroke-width:2.3}.corrected-label{font-size:8px;font-weight:700;fill:#047857;pointer-events:none}.resize-handle{fill:#fff;stroke:#047857;stroke-width:1.5;vector-effect:non-scaling-stroke;cursor:nwse-resize}.resize-handle[data-handle=n],.resize-handle[data-handle=s]{cursor:ns-resize}.resize-handle[data-handle=e],.resize-handle[data-handle=w]{cursor:ew-resize}.resize-handle[data-handle=ne],.resize-handle[data-handle=sw]{cursor:nesw-resize}.creation-preview{fill:rgba(5,150,105,.08);stroke:#047857;stroke-width:1.5;stroke-dasharray:4 3;pointer-events:none}
</style></head><body><div class="top"><h1>最新正文 Geometry · ${paper}</h1><p>仅显示最新机器候选的可编辑副本。PDF 坐标绑定；未 Accept、未 Promote、不进入 Runtime。</p><nav>${links}<a href="index.html">全部论文</a><button id="export-ground-truth" type="button">导出 Ground Truth JSON</button><label>导入本轮 JSON <input id="import-ground-truth" type="file" accept="application/json,.json"></label></nav></div><div class="banner">旧预测和上一轮人工框不叠加显示；此前导出的 paperN-body-ground-truth-draft.json 保持原样。本轮编辑请重新导出 JSON 保存。</div><main>${pages.map((page) => pageArticle(paper, page, sourceSha, predictionKey)).join("\n")}</main><script>${core}</script><script>${ui}</script></body></html>`;
}

function main() {
  const preserve = PAPERS.map((paper) => {
    const file = path.join(OUTPUT, `${paper}-body-ground-truth-draft.json`);
    return { paper, file, sha256: hash(fs.readFileSync(file)) };
  });
  const manifest = { schemaVersion: "layout-geometry-editable-latest-review/v1", scope: "main_reading_flow_body_only", sourceCandidate: "human-review-main-flow-v1/paperN-comparison.json", priorDraftsPreserved: true, runtimeDecisionUse: "forbidden", candidateAcceptance: "not_performed", promotion: "not_performed", papers: [] };
  for (const paper of PAPERS) {
    const sourceBytes = fs.readFileSync(path.join(SOURCE, `${paper}-comparison.json`));
    const comparison = JSON.parse(sourceBytes);
    if (comparison.pages.length === 0 || comparison.pages.some((page, index) => page.pageNumber !== index + 1)) throw new Error(`${paper}: invalid page sequence`);
    const predictionKey = hash(sourceBytes).slice(0, 16);
    const html = documentHtml(paper, comparison.sourcePdfSha256, predictionKey, comparison.pages);
    fs.writeFileSync(path.join(OUTPUT, `${paper}.html`), html);
    manifest.papers.push({ paper, pages: comparison.pages.length, candidateSha256: hash(sourceBytes), machineBoxes: comparison.pages.reduce((sum, page) => sum + page.candidate.length, 0), htmlSha256: hash(html), priorDraftSha256: preserve.find((item) => item.paper === paper).sha256 });
  }
  for (const item of preserve) if (hash(fs.readFileSync(item.file)) !== item.sha256) throw new Error(`${item.paper}: prior draft changed`);
  fs.writeFileSync(path.join(OUTPUT, "index.html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>最新正文 Geometry 审核</title><style>body{font:16px/1.6 system-ui;max-width:760px;margin:36px auto;padding:0 20px}li{margin:9px 0}</style><h1>paper1–7 最新正文 Geometry 审核</h1><p>只显示最新机器正文框，可直接编辑并逐页确认。旧预测和已有人工标注文件保留但不叠加显示。本轮仍 under review，不 Accept、不 Promote。</p><ol>${PAPERS.map((paper) => `<li><a href="${paper}.html">${paper}</a></li>`).join("")}</ol></html>`);
  fs.writeFileSync(path.join(OUTPUT, "LATEST_MACHINE_REVIEW_MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(OUTPUT, "README.md"), `# 最新正文 Geometry 可编辑审核\n\n打开 index.html 进入 paper1–7。每个 HTML 均自包含 PDF 页面图像，仅显示最新机器正文候选的可编辑副本；旧预测、旧人工框不叠加。\n\n可移动、缩放、删除、新建、重置、逐页确认，并导出本轮 Ground Truth JSON。机器 predicted 与人工 corrected 仍分别存于导出 JSON；既有 paperN-body-ground-truth-draft.json 均原样保留。浏览器本地草稿按本轮 candidate hash 隔离，避免上一轮编辑自动载入。\n\n本轮只供离线审核，未 Accept、未 Promote，不进入 Runtime；不修改 Column Truth、其他 Geometry 对象或安全余量。\n`);
  console.log(JSON.stringify({ output: OUTPUT, papers: manifest.papers.length, pages: manifest.papers.reduce((sum, paper) => sum + paper.pages, 0), machineBoxes: manifest.papers.reduce((sum, paper) => sum + paper.machineBoxes, 0) }));
}

if (require.main === module) main();
module.exports = { main };
