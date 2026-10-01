#!/usr/bin/env node
"use strict";

// Stages paper8–10 Column predictions for human review. This tool never writes
// the formal Column corpus, candidate pool, or a promoted regression oracle.
const fs = require("node:fs");
const path = require("node:path");
const pilot = require("./column-capability-pilot");
const workflow = require("../electron-app/capability-library/candidate-pool");

const ROOT = path.resolve(__dirname, "../..");
const EVIDENCE = path.join(ROOT, ".governance", "archive", "evidence", "layout-geometry-capability-audit", "evidence", "phase-2-paper-geometry");
const OUTPUT = path.join(EVIDENCE, "human-review-column-paper8-10-v1");
const RASTER_ROOT = path.join(EVIDENCE, "human-review-cross-sample-paper8-10-v2-current", "pages");
const SOURCE_ROOTS = ["D:\\PDF测试", path.join(ROOT, "lingoflow-client", "electron-app", "tmp", "pdfs")];
const PAPERS = [8, 9, 10];
const TYPES = ["single_column", "double_column", "mixed", "scanned_or_image"];
const safeJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

function findPdf(number) {
  for (const root of SOURCE_ROOTS) {
    if (!fs.existsSync(root)) continue;
    const name = fs.readdirSync(root).find((entry) => entry === `论文样本${number}.pdf`);
    if (name) return path.join(root, name);
  }
  throw new Error(`Missing PDF sample ${number}`);
}

function makePaperHtml(candidate) {
  const paper = candidate.paper;
  const pages = candidate.predicted.map((entry) => {
    const image = `pages/${paper}/p${String(entry.pageNumber).padStart(3, "0")}.jpg`;
    const options = TYPES.map((type) => `<option value="${type}">${type}</option>`).join("");
    return `<article class="page" data-page="${entry.pageNumber}">
      <div class="page-head"><h2>${paper} · p${entry.pageNumber}</h2><span class="predicted">机器: ${entry.layoutType}</span><span class="state">未确认</span></div>
      <div class="controls"><label>人工栏型 <select class="corrected">${options}</select></label><label class="confirm-label"><input type="checkbox" class="confirmed"> 确认本页</label><button class="reset" type="button">重置本页</button></div>
      <label class="note-label">审核备注 <input class="note" type="text" placeholder="可选；例如：右栏只有 References"></label>
      <div class="image-wrap"><img src="${image}" alt="${paper} page ${entry.pageNumber}"><div class="center-guide"></div></div>
    </article>`;
  }).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${paper} Column 人工审核</title>
  <style>*{box-sizing:border-box}body{margin:0;background:#f4f1eb;color:#1c1917;font:15px/1.45 system-ui,"Microsoft YaHei",sans-serif}header{position:sticky;top:0;z-index:2;background:#1c1917;color:white;padding:14px 20px}header h1{margin:0;font-size:20px}header p{margin:4px 0 10px;color:#d6d3d1}nav{display:flex;gap:10px;flex-wrap:wrap;align-items:center}a{color:#2563eb}nav a{color:#bfdbfe}button,.import{border:1px solid #78716c;background:#fff;color:#1c1917;border-radius:7px;padding:7px 11px;cursor:pointer;font:inherit}.import input{max-width:190px;color:white}main{max-width:1180px;margin:20px auto;padding:0 14px}.warning{background:#fef3c7;border:1px solid #f59e0b;padding:10px;border-radius:8px;margin-bottom:16px}.page{background:white;border:1px solid #d6d3d1;border-radius:12px;padding:16px;margin:0 0 24px}.page-head{display:flex;gap:14px;align-items:baseline;flex-wrap:wrap}.page-head h2{margin:0}.predicted{color:#57534e}.state{color:#a16207;font-weight:700}.page.is-confirmed .state{color:#15803d}.controls{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:10px 0}.controls select{font:inherit;padding:7px}.note-label{display:flex;gap:10px;align-items:center;margin-bottom:12px}.note{flex:1;min-width:200px;padding:7px;font:inherit}.image-wrap{position:relative;margin:auto;max-width:850px}.image-wrap img{display:block;width:100%;height:auto}.center-guide{display:none;position:absolute;left:50%;top:0;bottom:0;border-left:2px dashed #0891b2;pointer-events:none}.page.is-double .center-guide{display:block}.changed .corrected{outline:2px solid #d97706}@media(max-width:650px){header{position:static}.page{padding:10px}}</style></head><body>
  <header><h1>${paper} · Column 逐页审核</h1><p>栏型只按正文阅读流判断；标题、图表和 References 的排版本身不决定正文栏型。机器预测不可改，人工修正单独保存。</p><nav><a href="index.html">返回总览</a><button id="export" type="button">导出审核 JSON</button><label class="import">导入审核 JSON <input id="import" type="file" accept=".json,application/json"></label><span id="counter"></span></nav></header>
  <main><div class="warning">待审核候选，不是正式 Column Truth。确认页面只记录审核意见，不会 Accept 或 Promote。</div>${pages}</main>
  <script id="candidate" type="application/json">${safeJson(candidate)}</script><script>
  (() => {
    const candidate = JSON.parse(document.getElementById('candidate').textContent);
    const key = 'column-review:' + candidate.paper + ':' + candidate.source.sha256 + ':' + candidate.runtimeBaseline['main.js'];
    const byPage = new Map(candidate.predicted.map(row => [row.pageNumber, row]));
    const edits = new Map();
    function defaultEdit(page) { return { pageNumber: page, corrected: byPage.get(page).layoutType, confirmed: false, note: '' }; }
    function render(article) {
      const page = Number(article.dataset.page), edit = edits.get(page) || defaultEdit(page), original = byPage.get(page);
      article.querySelector('.corrected').value = edit.corrected;
      article.querySelector('.confirmed').checked = edit.confirmed;
      article.querySelector('.note').value = edit.note;
      article.querySelector('.state').textContent = edit.confirmed ? '已确认' : '未确认';
      article.classList.toggle('is-confirmed', edit.confirmed);
      article.classList.toggle('is-double', edit.corrected === 'double_column' || edit.corrected === 'mixed');
      article.classList.toggle('changed', edit.corrected !== original.layoutType);
    }
    function save() {
      localStorage.setItem(key, JSON.stringify(Array.from(edits.values())));
      document.getElementById('counter').textContent = Array.from(edits.values()).filter(row => row.confirmed).length + '/' + candidate.predicted.length + ' 页已确认';
    }
    try {
      for (const edit of JSON.parse(localStorage.getItem(key) || '[]')) {
        if (byPage.has(edit.pageNumber) && ${safeJson(TYPES)}.includes(edit.corrected)) edits.set(edit.pageNumber, { ...defaultEdit(edit.pageNumber), ...edit, confirmed: edit.confirmed === true, note: String(edit.note || '') });
      }
    } catch {}
    document.querySelectorAll('.page').forEach(article => {
      const page = Number(article.dataset.page);
      render(article);
      article.querySelector('.corrected').addEventListener('change', event => { const edit = edits.get(page) || defaultEdit(page); edit.corrected = event.target.value; edit.confirmed = false; edits.set(page, edit); render(article); save(); });
      article.querySelector('.confirmed').addEventListener('change', event => { const edit = edits.get(page) || defaultEdit(page); edit.confirmed = event.target.checked; edits.set(page, edit); render(article); save(); });
      article.querySelector('.note').addEventListener('input', event => { const edit = edits.get(page) || defaultEdit(page); edit.note = event.target.value; edits.set(page, edit); save(); });
      article.querySelector('.reset').addEventListener('click', () => { edits.delete(page); render(article); save(); });
    });
    save();
    document.getElementById('export').addEventListener('click', () => {
      const payload = { schemaVersion: 'column-human-review-draft/v1', status: 'under_review', promotion: 'forbidden_until_explicit_human_approval', paper: candidate.paper, source: candidate.source, runtimeBaseline: candidate.runtimeBaseline,
        pages: candidate.predicted.map(row => ({ pageNumber: row.pageNumber, predicted: row.layoutType, ...defaultEdit(row.pageNumber), ...(edits.get(row.pageNumber) || {}) })) };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2) + '\\n'], {type:'application/json'}));
      const a = document.createElement('a'); a.href = url; a.download = candidate.paper + '-column-ground-truth-draft.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    document.getElementById('import').addEventListener('change', async event => {
      const file = event.target.files[0]; if (!file) return;
      try {
        const payload = JSON.parse(await file.text());
        if (payload.schemaVersion !== 'column-human-review-draft/v1' || payload.paper !== candidate.paper || payload.source?.sha256 !== candidate.source.sha256 || payload.runtimeBaseline?.['main.js'] !== candidate.runtimeBaseline['main.js'] || !Array.isArray(payload.pages) || payload.pages.length !== candidate.predicted.length) throw Error('文件与当前论文或版本不匹配');
        const imported = new Map();
        for (const row of payload.pages) {
          if (!byPage.has(row.pageNumber) || row.predicted !== byPage.get(row.pageNumber).layoutType || !${safeJson(TYPES)}.includes(row.corrected)) throw Error('页码或机器预测不匹配');
          imported.set(row.pageNumber, { pageNumber: row.pageNumber, corrected: row.corrected, confirmed: row.confirmed === true, note: String(row.note || '') });
        }
        edits.clear(); imported.forEach((value, page) => edits.set(page, value));
        document.querySelectorAll('.page').forEach(render); save();
      } catch (error) { alert('导入失败：' + error.message); }
      event.target.value = '';
    });
  })();</script></body></html>`;
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const manifest = { schemaVersion: "column-review-build/v1", status: "under_review", accepted: false, promoted: false, papers: [] };
  let stagedState = workflow.loadState();
  for (const number of PAPERS) {
    const paper = `paper${number}`;
    const capture = await pilot.capture(findPdf(number));
    const predicted = capture.pages.map((page) => ({ pageNumber: page.pageNumber, layoutType: page.layoutType, confidence: page.columnModel && page.columnModel.evidence && page.columnModel.evidence.confidence }));
    const candidate = { schemaVersion: "column-promotion-candidate-draft/v1", status: "under_review", paper, source: capture.source, runtimeBaseline: capture.runtimeBaseline, pageLayoutBasis: "body_text_flow_only", predicted };
    const candidateId = `candidate.column-pilot.${paper}`;
    const sample = {
      id: `sample.column-pilot.${paper}`,
      displayName: `Column review ${paper}`,
      source: { ...capture.source, mediaType: "application/pdf" },
      provenance: { kind: "user_provided", reference: `Offline ${paper} Column review before promotion` },
      rights: { status: "metadata_only", canStoreMetadata: true, canStoreBinary: false },
      boundaryFeatureIds: ["boundary.column.single", "boundary.column.double", "boundary.column.mixed-full-width", "boundary.column.page-transition"],
      expectedOutcomes: [],
      evidenceRefs: [`human-review-column-paper8-10-v1/${paper}.html`],
      storage: { binaryCommitted: false, externalSourceRequiredForRun: true },
      authorityBoundary: { catalogRole: "regression_oracle", runtimeDecisionUse: "forbidden", finalDecisionsOwnedBy: ["AA-COLUMN-001"] },
    };
    stagedState = workflow.submitCandidate(stagedState, { id: candidateId, capabilityIds: ["cap.column-recognition"], sample }, {
      actor: "Codex offline staging", reason: "User requested paper8–10 as candidates; page layouts still require human review",
    });
    stagedState = workflow.reviewCandidate(stagedState, candidateId, "under_review", {
      actor: "Codex offline staging", reason: "Awaiting explicit human review and corrected page-level oracle",
    });
    const imageSource = path.join(RASTER_ROOT, paper);
    const imageTarget = path.join(OUTPUT, "pages", paper);
    fs.mkdirSync(imageTarget, { recursive: true });
    predicted.forEach((page) => {
      const name = `p${String(page.pageNumber).padStart(3, "0")}.jpg`;
      if (!fs.existsSync(path.join(imageSource, name))) throw new Error(`Missing review raster ${paper}/${name}`);
      fs.copyFileSync(path.join(imageSource, name), path.join(imageTarget, name));
    });
    fs.writeFileSync(path.join(OUTPUT, `${paper}-column-capture.json`), `${JSON.stringify(capture, null, 2)}\n`);
    fs.writeFileSync(path.join(OUTPUT, `${paper}-column-candidate.json`), `${JSON.stringify(candidate, null, 2)}\n`);
    fs.writeFileSync(path.join(OUTPUT, `${paper}.html`), makePaperHtml(candidate));
    manifest.papers.push({ paper, pages: predicted.length, sourceSha256: capture.source.sha256, layouts: predicted.map((page) => page.layoutType) });
  }
  fs.writeFileSync(path.join(OUTPUT, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const snapshotDir = path.join(OUTPUT, "CANDIDATE_POOL_SNAPSHOT");
  if (!fs.existsSync(snapshotDir)) workflow.saveState(stagedState, snapshotDir);
  const snapshot = workflow.loadCommittedState(snapshotDir);
  for (const number of PAPERS) {
    const id = `candidate.column-pilot.paper${number}`;
    const staged = snapshot.pool.candidates.find((entry) => entry.id === id);
    if (!staged || staged.status !== "under_review" || staged.promotedSampleId) throw new Error(`Missing unpromoted review candidate ${id}`);
  }
  fs.writeFileSync(path.join(OUTPUT, "index.html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>paper8–10 Column 晋升前审核</title><style>body{font:16px/1.6 system-ui;max-width:760px;margin:36px auto;padding:0 20px}li{margin:14px 0}.warn{background:#fef3c7;padding:12px;border-radius:8px}</style><h1>paper8–10 Column 晋升前审核</h1><p>本轮是重新检测后的机器候选。逐页检查正文栏型、修改并确认，再分别导出 JSON。</p><ol>${manifest.papers.map((row) => `<li><a href="${row.paper}.html">${row.paper} · ${row.pages} 页</a> · <a href="${row.paper}-column-candidate.json">机器候选</a></li>`).join("")}</ol><p class="warn">未修改 paper1–7 正式 Truth；paper8–10 尚未 Accept / Promote。导出的 JSON 也只是人工审核草稿，需再次验收后才能进入正式回归语料。</p></html>`);
  console.log(JSON.stringify({ output: OUTPUT, papers: manifest.papers.map((row) => ({ paper: row.paper, pages: row.pages, layouts: row.layouts })) }));
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { main, makePaperHtml };
