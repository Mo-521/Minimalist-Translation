"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const app = path.resolve(__dirname, "../../../electron-app");
const renderer = fs.readFileSync(path.join(app, "renderer.js"), "utf8");
const html = fs.readFileSync(path.join(app, "index.html"), "utf8");
const css = fs.readFileSync(path.join(app, "styles.css"), "utf8");

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this._textContent = "";
    this.classes = new Set();
    this.hidden = false;
    this.attributes = {};
    this.listeners = {};
    this.classList = { add: (v) => this.classes.add(v), remove: (v) => this.classes.delete(v) };
  }
  set textContent(value) { this._textContent = value; this.children = []; }
  get textContent() { return this._textContent; }
  appendChild(child) { this.children.push(child); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  click() { if (this.listeners.click) this.listeners.click(); }
  focus() { this.focused = true; }
}

function pageHarness(loader) {
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, new Element("div"));
    return nodes.get(id);
  };
  get("capabilityLibraryError").classes.add("hidden");
  const source = renderer.slice(renderer.indexOf("  function setupCapabilityLibraryPage()"), renderer.indexOf("  function syncDeveloperModeUi()"));
  vm.runInNewContext(source + "\nsetupCapabilityLibraryPage();", {
    document: { getElementById: get, createElement: (tag) => new Element(tag) },
    require: (name) => { assert.equal(name, "./capability-library"); return { loadCapabilityLibrary: loader }; },
    setText: (id, value) => { get(id).textContent = value; }, Set,
  });
  return nodes;
}

test("glass migration retains incumbent page, mode and operation identities without mock routes", () => {
  assert.match(html, /ui-glass-workbench/);
  assert.deepEqual([...html.matchAll(/data-page="([^"]+)"/g)].map((m) => m[1]), ["home", "pdf", "desktop", "capabilities", "settings"]);
  assert.deepEqual([...html.matchAll(/data-pdf-mode="([^"]+)"/g)].map((m) => m[1]), ["simple_pdf", "paper_pdf"]);
  for (const id of ["pdfEntryView", "pdfWorkView", "pdfFileInput", "pdfSourceLangSelect", "pdfTargetLangSelect", "btnBackPdfModes", "btnPdfRawMode", "btnPdfSegmentMode", "btnPreparePdfTranslation", "btnPausePdfTranslation", "btnClearPdfFile", "btnExportPdfTranslation", "btnExportDeveloperDiagnostics", "btnOpenPdfOutput", "providerSettingsForm", "providerConfigDialog", "providerPreset", "providerApiKey", "providerAdvancedSettings", "btnSaveProvider", "btnOpenProviderHelp", "developerModeToggle", "btnOpenDiagnosticsDirectory", "btnLaunchDesktopTranslate"]) {
    assert.equal([...html.matchAll(new RegExp('id="' + id + '"', "g"))].length, 1, id);
  }
  const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
  assert.equal([...nav.matchAll(/<svg /g)].length, 5);
  assert.doesNotMatch(nav, /material-symbols/);
  assert.doesNotMatch(html, /id="page-(?:work|registry)"|71%|已稳定|试点中|data-open-work/);
  assert.match(html, /id="page-home"/);
  assert.match(html, /id="page-pdf" class="app-page translation-page active"/);
  assert.match(css, /\.ui-glass-workbench \[hidden\],[\s\S]*?display: none !important/);
});

test("draft workflow components retain live fields without mock progress or duplicate state", () => {
  assert.match(html, /class="ui-file-copy"><span class="pdf-drop-main" id="pdfFileName"/);
  assert.match(html, /id="btnPdfSegmentMode"[\s\S]*?<\/div><span id="pdfExtractStats"/);
  assert.match(html, /class="ui-desktop-empty"/);
  assert.doesNotMatch(html, /id="desktopEmptyStatus"|width:\s*71%/);
  assert.match(css, /\.ui-glass-workbench \.pdf-linear-steps \.pdf-flow-step \{[^}]*flex-direction: row/);
  assert.match(css, /\.ui-glass-workbench \.pdf-translation-stage \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(css, /\.ui-glass-workbench \.pdf-stage-actions \{[^}]*grid-row: 1 \/ span 2/);
});

test("paragraph labels are display-only and disabled actions are visually distinct", () => {
  const source = renderer.slice(renderer.indexOf("  function getSegmentDisplayStatus("), renderer.indexOf("  function openPdfSegmentModal("));
  const context = { getSegmentStatusLabel: (segment) => segment.status || "pending" };
  vm.runInNewContext(source, context);
  for (const [status, expected] of [["pending", "待翻译"], ["translating", "翻译中"], ["done", "已翻译"], ["failed", "翻译失败"], ["保留原文 · 公式", "保留原文 · 公式"]]) {
    const segment = Object.freeze({ id: "seg.fixture", type: "body", status, column: "right" });
    assert.equal(context.getSegmentDisplayStatus(segment), expected);
    assert.equal(context.getSegmentDisplayColumn(segment), "右栏");
    assert.equal(segment.status, status);
    assert.equal(segment.type, "body");
    assert.equal(segment.id, "seg.fixture");
  }
  const list = renderer.slice(renderer.indexOf('title.textContent = "段落 "'), renderer.indexOf("  function openPdfSegmentModal("));
  assert.doesNotMatch(list, /" · page "|meta.textContent = "page "/);
  assert.match(css, /\.pdf-secondary-action:disabled,[\s\S]*?opacity: 0\.45;[\s\S]*?cursor: not-allowed/);
});

test("draft settings switch and dialogs keep accessible real controls", () => {
  assert.match(html, /id="developerModeToggle" type="checkbox" aria-label="启用开发者模式"/);
  assert.match(html, /class="ui-switch-track" aria-hidden="true"/);
  assert.match(css, /input:checked \+ \.ui-switch-track::after \{ transform: translateX\(18px\)/);
  assert.match(html, /id="btnClosePdfSegmentModal"[^>]*aria-label="关闭段落详情"/);
  assert.match(html, /id="btnClosePdfExportModal"[^>]*aria-label="关闭导出窗口"/);
  assert.match(html, /id="btnSaveProvider" type="submit"[^>]*disabled/);
  assert.match(css, /\.ui-glass-workbench \.provider-new-action \{[^}]*border: 1px dashed/);
});

test("capability presentation shows only five Domains before a separated Domain Detail", () => {
  const library = require(path.join(app, "capability-library")).loadCapabilityLibrary();
  const before = JSON.stringify(library);
  const nodes = pageHarness(() => library);
  const domains = nodes.get("capabilityLibraryList").children;
  assert.equal(domains.length, 5);
  assert.deepEqual(domains.map(domain => domain.dataset.domain), library.domains.map(domain => domain.id));
  domains.forEach((domain) => {
    assert.equal(domain.children.length, 4);
    assert.equal(domain.children[3].tag, "button");
    assert.equal(domain.children[3].textContent, "查看详情");
    assert.equal(domain.children.some(child => child.tag === "article"), false);
  });
  const columnDomain = domains.find(domain => domain.dataset.domain === "column-region-recognition");
  assert.deepEqual(columnDomain.children[2].children.map(item => item.textContent), ["独立能力 2", "验收契约 0", "已有工程基线"]);
  columnDomain.children[3].click();
  assert.equal(nodes.get("capabilityLibraryHome").hidden, true);
  assert.equal(nodes.get("capabilityDomainDetail").hidden, false);
  assert.equal(nodes.get("capabilityDomainTitle").textContent, "栏与区域识别");
  assert.equal(nodes.get("capabilityEstablishedCount").textContent, "2 项");
  assert.equal(nodes.get("capabilityContractsCount").textContent, "0 项");
  const cards = nodes.get("capabilityEstablishedList").children;
  assert.equal(cards.length, 2);
  const columnCard = cards.find(card => card.children[0].children[0].children[1].textContent === "cap.column-recognition");
  const geometryCard = cards.find(card => card.children[0].children[0].children[1].textContent === "cap.layout-geometry");
  assert.equal(columnCard.children[0].children[0].children[0].textContent, "栏识别");
  assert.equal(geometryCard.children[0].children[0].children[0].textContent, "版面几何");
  assert.match(columnCard.children[4].textContent, /正式样本 10 个 \/ 126 页/);
  assert.match(geometryCard.children[4].textContent, /正式样本 10 个 \/ 126 页/);
  assert.equal(columnCard.children[0].children[1].children[0].textContent, "阶段 · 已建立回归基线");
  assert.equal(geometryCard.children[0].children[1].children[0].textContent, "阶段 · 有条件验收");
  assert.equal(geometryCard.children[0].children[1].children[1].textContent, "验证批次 · B001");
  const columnDetails = columnCard.children[5];
  const sampleList = columnDetails.children[14];
  assert.equal(sampleList.children.length, 10);
  assert.match(sampleList.children[0].textContent, /^paper1 · 论文样本1\.pdf · 6 页$/);
  assert.match(sampleList.children[6].textContent, /^paper7 · 论文样本7\.pdf · 11 页$/);
  assert.match(sampleList.children[9].textContent, /^paper10 · 论文样本10\.pdf · 10 页$/);
  assert.match(geometryCard.children[5].children[4].children[0].textContent, /cap\.column-recognition/);
  assert.equal(library.capabilities.find(item => item.id === "cap.layout-geometry").decisionAuthority.owner, "Geometry Authority");
  nodes.get("btnBackCapabilityDomains").click();
  assert.equal(nodes.get("capabilityLibraryHome").hidden, false);
  const structureDomain = domains.find(domain => domain.dataset.domain === "document-structure-identity");
  assert.deepEqual(structureDomain.children[2].children.map(item => item.textContent), ["独立能力 1", "验收契约 2", "已有条件验收能力"]);
  structureDomain.children[3].click();
  assert.equal(nodes.get("capabilityDomainMaturity").textContent, "1 项独立能力 · 10 份正式回归样本");
  assert.equal(nodes.get("capabilityEstablishedList").children.length, 1);
  const structureCard = nodes.get("capabilityEstablishedList").children[0];
  assert.equal(structureCard.children[0].children[0].children[0].textContent, "文档结构");
  assert.equal(structureCard.children[0].children[0].children[1].textContent, "cap.document-structure");
  assert.equal(structureCard.children[0].children[1].children[0].textContent, "阶段 · 有条件验收");
  assert.equal(structureCard.children[0].children[1].children[1].textContent, "验证批次 · B001");
  assert.match(structureCard.children[4].textContent, /当前 PDF 翻译仍使用旧结构链/);
  assert.equal(nodes.get("capabilityContractsList").children.length, 2);
  assert.equal(nodes.get("capabilityContractsList").children[0].children[0].textContent, "验收契约");
  assert.match(nodes.get("capabilityContractsList").children[0].children[1].children[2].textContent, /不代表已建立/);
  assert.equal(JSON.stringify(library), before);
  assert.ok(Object.isFrozen(library));
});

test("empty or invalid catalog remains explicit instead of fabricating successful coverage", () => {
  const empty = pageHarness(() => ({ domains: [], capabilities: [], samples: [], schemaVersion: "capability-library-snapshot/v2" }));
  assert.equal(empty.get("capabilityLibraryList").children[0].textContent, "尚无 Domain 定义。");
  assert.equal(empty.get("capabilityLibraryLoadStatus").textContent, "能力域已加载，共 0 项。");
  const invalid = pageHarness(() => { throw new Error("schema mismatch"); });
  assert.equal(invalid.get("capabilityLibrarySchemaBadge").textContent, "数据校验失败");
  assert.ok(!invalid.get("capabilityLibraryError").classes.has("hidden"));
  assert.match(invalid.get("capabilityLibraryError").textContent, /schema mismatch/);
});

test("unregistered icon fonts cannot mark blank glyphs ready even if check returns true", async () => {
  const body = new Element("body");
  const source = renderer.slice(renderer.indexOf("  function setupMaterialIconReadiness()"), renderer.indexOf("  function setupAppNav()"));
  vm.runInNewContext(source + "\nsetupMaterialIconReadiness();", {
    document: { body, querySelectorAll: () => [], fonts: { check: () => true, load: () => Promise.resolve([]) } },
    window: { setTimeout: () => {} },
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(body.classes.has("icons-fallback"));
  assert.ok(!body.classes.has("icons-ready"));
});
