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
    this.textContent = "";
    this.classes = new Set();
    this.classList = { add: (v) => this.classes.add(v), remove: (v) => this.classes.delete(v) };
  }
  appendChild(child) { this.children.push(child); }
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

test("capability presentation consumes the frozen catalog and confines technical identity to details", () => {
  const library = require(path.join(app, "capability-library")).loadCapabilityLibrary();
  const before = JSON.stringify(library);
  const nodes = pageHarness(() => library);
  assert.equal(nodes.get("capabilityLibraryCapabilityCount").textContent, String(library.capabilities.length));
  assert.equal(nodes.get("capabilityLibrarySampleCount").textContent, String(library.samples.length));
  assert.equal(nodes.get("capabilityLibraryAuthorityCount").textContent, String(new Set(library.capabilities.map(c => c.architectureRecord)).size));
  const cards = nodes.get("capabilityLibraryList").children;
  assert.equal(cards.length, library.capabilities.length);
  const statusLabels = { defined: "已定义", pilot_ready: "待试点", covered: "已建立回归基线", deprecated: "已停用" };
  cards.forEach((card, i) => {
    const definition = library.capabilities[i];
    const head = card.children[0];
    assert.equal(head.children.length, 2);
    assert.equal(head.children[0].tag, "h4");
    const details = card.children[3].children[0];
    assert.equal(details.tag, "details");
    assert.ok(details.children[1].textContent.includes(definition.id));
    assert.ok(details.children[1].textContent.includes(definition.architectureRecord));
    assert.equal(details.children[2].textContent, definition.decisionAuthority.statement);
    const status = head.children[1];
    assert.equal(status.dataset.state, definition.status);
    assert.equal(status.textContent, statusLabels[definition.status]);
    assert.equal(card.children[3].children[1].tag, "span");
    assert.equal(card.children[3].children[1].textContent, "样本投递尚未开放");
  });
  const columnIndex = library.capabilities.findIndex((definition) => definition.id === "cap.column-recognition");
  const columnCard = cards[columnIndex];
  assert.match(columnCard.children[2].children[0].textContent, /回归基线 7 个样本 \/ 90 页/);
  const sampleList = columnCard.children[3].children[0].children[10];
  assert.equal(sampleList.children.length, 7);
  assert.match(sampleList.children[0].textContent, /^paper1 · 论文样本1\.pdf · 6 页$/);
  assert.match(sampleList.children[6].textContent, /^paper7 · 论文样本7\.pdf · 11 页$/);
  assert.equal(JSON.stringify(library), before);
  assert.ok(Object.isFrozen(library));
});

test("empty or invalid catalog remains explicit instead of fabricating successful coverage", () => {
  const empty = pageHarness(() => ({ capabilities: [], samples: [], schemaVersion: "capability-library-snapshot/v1" }));
  assert.equal(empty.get("capabilityLibrarySampleCount").textContent, "0");
  assert.equal(empty.get("capabilityLibraryList").children[0].textContent, "尚无能力定义。");
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
