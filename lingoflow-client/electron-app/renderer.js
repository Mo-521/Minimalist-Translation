(function () {
  console.log("[LINGOFLOW][REAL RENDERER LOADED]", new Date().toISOString());
  var semanticStructureConsumerAuthority = typeof require === "function"
    ? require("./semantic-structure-consumer-authority")
    : null;

  var DEFAULT_SERVER_BASE_URL = "https://lingoproxy-255344-7-1429669493.sh.run.tcloudbase.com";
  var DEFAULT_BETA_TOKEN = "lf_beta_test_token";
  var PDF_TRANSLATION_PROVIDER = "deepseek_chat";
  var DEFAULT_TEST_USERS = [
    { token: "lf_beta_test_token", userId: "test-rio", name: "Rio Test User", email: "rio.test@lingoflow.local" },
    { token: "lf_test_alice", userId: "test-alice", name: "Alice Tester", email: "alice@lingoflow.local" },
    { token: "lf_test_bob", userId: "test-bob", name: "Bob Tester", email: "bob@lingoflow.local" },
  ];
  var PDF_DEBUG_LOGS = false;

  function debugPdfLog() {
    if (PDF_DEBUG_LOGS) console.log.apply(console, arguments);
  }

  function debugPdfWarn() {
    if (PDF_DEBUG_LOGS) console.warn.apply(console, arguments);
  }


function requireSemanticTranslationDisposition(segment, consumerName) {
  if (!segment || !segment.semanticPolicy || typeof segment.semanticPolicy !== "object") {
    var missingPolicyError = new Error("Semantic policy is required by " + consumerName);
    missingPolicyError.code = "SEMANTIC_CONSUMER_POLICY_REQUIRED";
    throw missingPolicyError;
  }
  var disposition = String(segment.semanticPolicy.translationDisposition || "");
  if (["translate", "preserve", "blocked"].indexOf(disposition) < 0) {
    var invalidPolicyError = new Error("Unsupported semantic translation disposition at " + consumerName + ": " + (disposition || "<empty>"));
    invalidPolicyError.code = "SEMANTIC_CONSUMER_POLICY_INVALID";
    throw invalidPolicyError;
  }
  return disposition;
}

function requireCanonicalSemanticType(segment, consumerName) {
  var semanticType = String(segment && (segment.semanticType || segment.type) || "");
  if (!semanticType) {
    var missingTypeError = new Error("Canonical semantic type is required by " + consumerName);
    missingTypeError.code = "SEMANTIC_CONSUMER_TYPE_REQUIRED";
    throw missingTypeError;
  }
  return semanticType;
}

  var PDF_TRANSLATION_MODE_DEFS = {
    simple_pdf: {
      label: "普通版 PDF",
      title: "普通版 PDF 翻译",
      summary: "适合单栏普通文档；优先完整翻译正文与流式排版。",
      suitable: "适合：单栏文档、作文、合同、说明书。",
      detail: "特点：完整翻译正文，优先流式排版。",
      selectedHint: "当前使用普通版 PDF：将尽量完整翻译正文，适合单栏或简单排版文档。",
      startText: "开始普通 PDF 翻译",
      steps: ["选择文件", "提取正文", "翻译正文", "导出结果"],
    },
    paper_pdf: {
      label: "论文版 PDF",
      title: "论文版 PDF 翻译",
      summary: "适合双栏论文、期刊文献、arXiv；默认保留图片、公式块和 References。",
      suitable: "适合：双栏论文、期刊文献、arXiv。",
      detail: "特点：识别标题/摘要/正文/图注，保留图片、公式和 References。",
      selectedHint: "当前使用论文版 PDF：将识别论文结构，默认保留图片、公式块和 References。",
      startText: "开始论文 PDF 翻译",
      steps: ["选择论文", "结构扫描", "翻译正文", "导出论文版"],
    },
  };

  
function isPaperOverlayCandidateStrict(segment) {
  if (!segment) return false;
  return requireSemanticTranslationDisposition(segment, "isPaperOverlayCandidateStrict") === "translate";
}

function isPaperPreserveSegmentStrict(segment) {
  if (!segment) return false;
  return requireSemanticTranslationDisposition(segment, "isPaperPreserveSegmentStrict") === "preserve";
}

function getPaperOverlaySegmentEntriesStrict() {
  return state.segments
    .map(function(segment, index) { return {segment: segment, index: index}; })
    .filter(function(entry) {
      return isPaperOverlayCandidateStrict(entry.segment) && entry.segment.status === "done" && entry.segment.translatedText && String(entry.segment.translatedText).trim();
    });
}

function getRemainingPaperSegmentEntriesStrict() {
  return state.segments
    .map(function(segment, index) { return {segment: segment, index: index}; })
    .filter(function(entry) {
      return isPaperOverlayCandidateStrict(entry.segment) && (!isPdfSegmentTranslated(entry.segment) || entry.segment.status === "pending" || entry.segment.status === "failed");
    });
}

function getPaperExportCompletenessStrict() {
  var candidates = state.segments.filter(isPaperOverlayCandidateStrict);
  var done = candidates.filter(isPdfSegmentTranslated).length;
  var pending = candidates.filter(function(segment) { return segment.status !== "failed" && (segment.status === "pending" || segment.status === "translating" || !isPdfSegmentTranslated(segment)); }).length;
  var failed = candidates.filter(function(segment) { return segment.status === "failed"; }).length;
  var bodyHeadingNotDone = candidates.filter(function(segment) {
    var t = requireCanonicalSemanticType(segment, "getPaperExportCompletenessStrict");
    return (t === "body" || t === "heading") && !isPdfSegmentTranslated(segment);
  }).length;
  return { totalSegments: candidates.length, doneSegments: done, pendingSegments: pending, failedSegments: failed, bodyHeadingNotDone: bodyHeadingNotDone };
}



function isSimplePdfTranslatableSegment(segment) {
  if (!segment) return false;
  return requireSemanticTranslationDisposition(segment, "isSimplePdfTranslatableSegment") === "translate";
}
function getSimplePdfTranslatableEntries() {
  return state.segments.map(function(s,i){return{segment:s,index:i};}).filter(function(e){return isSimplePdfTranslatableSegment(e.segment);});
}
function getSimplePdfTranslatedEntries() {
  return getSimplePdfTranslatableEntries().filter(function(e){return e.segment.status==="done"&&e.segment.translatedText&&String(e.segment.translatedText).trim();});
}
function getRemainingSimplePdfSegmentEntries() {
  return getSimplePdfTranslatableEntries().filter(function(e){return!isPdfSegmentTranslated(e.segment)||e.segment.status==="pending"||e.segment.status==="failed";});
}
function getSimplePdfTranslationCompleteness() {
  var entries = getSimplePdfTranslatableEntries();
  var done = getSimplePdfTranslatedEntries().length;
  var total = entries.length;
  var pending = entries.filter(function(e){return e.segment.status!=="failed"&&(e.segment.status==="pending"||e.segment.status==="translating"||!isPdfSegmentTranslated(e.segment));}).length;
  var failed = entries.filter(function(e){return e.segment.status==="failed";}).length;
  return {totalSegments:total,doneSegments:done,pendingSegments:pending,failedSegments:failed};
}
function hasTranslatedSimplePdfSegments() {
  return getSimplePdfTranslatedEntries().length>0;
}

function warnSimplePdfDeprecatedPaperWrapper(functionName) {
  console.warn("[PDF_BOUNDARY] simple_pdf must not call deprecated paper/overlay wrapper: " + functionName);
}

var SIMPLE_PDF_SERIALIZED_FORBIDDEN_FIELDS = [
  "bbox",
  "lineBoxes",
  "lines",
  "column",
  "layoutType",
  "writeBox",
  "maskApplied",
  "classificationReason",
  "skipReason",
  "referenceMode",
  "formulaLinePreserve",
  "imageRegion",
  "zoneType",
];

function assertSerializedSimplePdfSegmentClean(segment) {
  SIMPLE_PDF_SERIALIZED_FORBIDDEN_FIELDS.forEach(function(fieldName) {
    if (segment && Object.prototype.hasOwnProperty.call(segment, fieldName)) {
      throw new Error("[PDF_BOUNDARY] simple_pdf payload leaked paper field: " + fieldName);
    }
  });
  return segment;
}

function assertSimplePdfPayloadClean(payload) {
  if (!payload || state.pdfTranslationMode !== "simple_pdf") return payload;
  if (payload.exportStrategy !== "document_flow") {
    throw new Error("[PDF_BOUNDARY] simple_pdf exportStrategy must be document_flow");
  }
  ["segments", "simpleBlocks", "allSegments"].forEach(function(listName) {
    (Array.isArray(payload[listName]) ? payload[listName] : []).forEach(assertSerializedSimplePdfSegmentClean);
  });
  return payload;
}

function assertSimpleRendererBoundary() {
  // Boundary contract for simple_pdf renderer path:
  // - Use isSimplePdfTranslatableSegment / getSimplePdfTranslationCompleteness only.
  // - Do not call paper helpers from simple main path:
  //   isPdfOverlayCandidate, isPaperOverlayCandidateStrict, isPaperPreserveSegmentStrict,
  //   getPaperOverlaySegmentEntriesStrict, getRemainingPaperSegmentEntriesStrict,
  //   getPaperExportCompletenessStrict.
  // - serializeSimplePdfSegment must not emit bbox, lineBoxes, lines, column, writeBox, layoutType,
  //   classificationReason, or skipReason.
  return {
    forbiddenPayloadFields: SIMPLE_PDF_SERIALIZED_FORBIDDEN_FIELDS.slice(),
    simpleExportStrategy: "document_flow",
    paperExportStrategy: "overlay",
  };
}

function isPdfOverlayCandidate(segment) {
    // Deprecated compatibility wrapper.
    // Do not use in simple_pdf main path.
    // Use isSimplePdfTranslatableSegment for simple_pdf.
    // Use isPaperOverlayCandidateStrict for paper_pdf.
    if (state.pdfTranslationMode === "simple_pdf") {
      warnSimplePdfDeprecatedPaperWrapper("isPdfOverlayCandidate");
      return isSimplePdfTranslatableSegment(segment);
    }
    return state.pdfTranslationMode === "paper_pdf" ? isPaperOverlayCandidateStrict(segment) : false;
  }

  function isPaperPreserveSegment(segment) {
    // Deprecated compatibility wrapper.
    // Do not use in simple_pdf main path.
    // Use isSimplePdfTranslatableSegment for simple_pdf.
    // Use isPaperPreserveSegmentStrict for paper_pdf.
    if (state.pdfTranslationMode === "simple_pdf") {
      warnSimplePdfDeprecatedPaperWrapper("isPaperPreserveSegment");
      return false;
    }
    return state.pdfTranslationMode === "paper_pdf" ? isPaperPreserveSegmentStrict(segment) : false;
  }

  function getPreserveReasonLabel(segment) {
    if (!segment) return "其他";
    var type = String(segment.type || "unknown");
    var skipReason = String(segment.skipReason || segment.reportSkipReason || "");
    if (/formula_(?:equation_block_)?preserve|formula_preserve_original/i.test(skipReason) || type === "formula") return "公式块";
    var labels = {
      reference: "参考文献",
      author: "作者",
      footer: "页脚",
      header: "页眉",
      pageNumber: "页码",
      licenseText: "版权/许可",
      imageText: "图片文字",
      margin: "页边内容",
      noise: "噪声",
      watermark: "水印",
    };
    return labels[type] || "其他";
  }

  function getSegmentSkipReason(segment) {
    if (!segment) return "";
    if (segment.skipReason) return String(segment.skipReason);
    if (segment.reportSkipReason) return String(segment.reportSkipReason);
    var type = String(segment.type || "");
    if (isPaperPreserveSegment(segment)) {
      if (type === "formula") return "formula_equation_block_preserve";
      return (type || "unknown") + "_preserve_original";
    }
    return "";
  }

  function getSegmentStatusLabel(segment) {
    if (isPaperPreserveSegment(segment) || String(segment && segment.status || "") === "preserved" || /_preserve_original|formula_.*preserve/i.test(getSegmentSkipReason(segment))) {
      return "保留原文 · " + getPreserveReasonLabel(segment);
    }
    return String(segment && segment.status || "pending");
  }

  var state = {
    serverBaseUrl: readSetting("lingoflow.serverBaseUrl", DEFAULT_SERVER_BASE_URL).replace(/\/+$/, ""),
    betaToken: readSetting("lingoflow.betaToken", DEFAULT_BETA_TOKEN),
    targetLanguage: "en",
    pdfSourceLang: "auto",
    pdfTargetLang: "zh-CN",
    targetLabel: "英语",
    serverOnline: false,
    refreshInFlight: false,
    desktopFeatureRunning: false,
    lastUsageRefreshAt: 0,
    testUsers: DEFAULT_TEST_USERS.slice(),
    pdfExtract: null,
    pdfCurrentFileId: null,
    selectedFile: null,
    pdfTaskSeq: 0,
    pdfTranslateTaskSeq: 0,
    pdfTranslating: false,
    pdfTranslateCancelRequested: false,
    pdfTranslatePaused: false,
    pdfTranslateAbortController: null,
    lastPdfOutputPath: "",
    extractedText: "",
    segments: [],
    semanticStructureArtifact: null,
    semanticStructureConsumerReports: [],
    translatedSegments: [],
    previewText: "",
    outputText: "",
    textItems: [],
    lines: [],
    rawLines: [],
    rawTextByPage: [],
    paragraphs: [],
    error: null,
    progress: 0,
    pdfPreviewMode: "raw",
    activeSegment: null,
    pdfTranslationMode: null,
    modeLockedByUser: false,
    provider: null,
    providerFormBaseline: "",
    providerConnectionStates: {},
    pdfPartialRegressionMode: false,
    pdfPartialTranslateRatio: 0,
  };

  var REFRESH_INTERVAL_MS = 15000;
  var DESKTOP_STATUS_INTERVAL_MS = 2000;
  var ACTIVE_USAGE_REFRESH_MS = 3000;

  function isValidPdfTranslationMode(mode) {
    return mode === "simple_pdf" || mode === "paper_pdf";
  }

  function getPdfTranslationModeDef(mode) {
    return isValidPdfTranslationMode(mode) ? PDF_TRANSLATION_MODE_DEFS[mode] : null;
  }

  function getPdfTranslationModePayload() {
    return {
      pdfTranslationMode: state.pdfTranslationMode,
      modeLockedByUser: Boolean(state.modeLockedByUser),
    };
  }

  function detectPdfModeSuggestion(_analysis) {
    return null;
  }

  function requirePdfTranslationModeMessage() {
    if (state.pdfTranslationMode) return "";
    return "请先选择 PDF 翻译模式。";
  }

  function buildSimplePdfProgress(summary) {
    summary = summary || {};
    var translated = Number(summary.progressNumerator || summary.writtenSegments || summary.translatedSegments || summary.doneSegments || 0);
    var denominator = Number(summary.progressDenominator || summary.translatableSegments || summary.totalSegments || 0);
    var written = Number(summary.writtenSegments || summary.writeApplied || summary.writtenCount || translated || 0);
    var failed = Number(summary.failedTranslatableSegments || summary.failedSegments || 0);
    return [
      "正文翻译：" + translated + " / " + denominator,
      "写入：" + written,
      "失败：" + failed,
    ].join(" · ");
  }

  function buildPaperPdfProgress(summary) {
    summary = summary || {};
    var translated = Number(summary.progressNumerator || summary.writtenSegments || summary.translatedSegments || summary.doneSegments || 0);
    var denominator = Number(summary.progressDenominator || summary.translatableSegments || 0);
    var skippedByType = summary.skippedByType || {};
    var segmentsByType = summary.segmentsByType || {};
    var preserved = Number(summary.preservedSegments || summary.preserveOriginal || 0);
    var references = Number(summary.skippedReferences || skippedByType.reference || segmentsByType.reference || 0);
    var formulaImagePreserved = Number(summary.skippedFormulas || 0) +
      Number(summary.skippedImageText || 0) +
      Number(summary.formulaWholeSegmentPreserve || 0) +
      Number(segmentsByType.imageText || 0);
    var risks = Number(summary.warningCount || 0) +
      Number(summary.failedTranslatableSegments || summary.failedSegments || 0) +
      Number(summary.oversizedSegmentCount || 0) +
      Number(summary.crossPageSegmentCount || 0);
    var visualAuditStatus = String(summary.paperVisualAuditStatus || "");
    var visualAuditLabel = visualAuditStatus === "pass" ? "视觉审核 pass"
      : visualAuditStatus === "fail" ? "视觉审核 fail(失败" + Number(summary.paperVisualAuditFailCount || 0) + "项)"
      : visualAuditStatus === "warning" ? "视觉审核 warning(" + Number(summary.paperVisualAuditWarnCount || 0) + "警告)"
      : "";
    return [
      "正文翻译：" + translated + " / " + denominator,
      "保留原文：" + preserved,
      "References：" + references,
      "公式/图片保留：" + formulaImagePreserved,
      "风险段落：" + risks,
      visualAuditLabel,
    ].filter(Boolean).join(" · ");
  }

  function getPdfModeProgressText() {
    var isSimple = state.pdfTranslationMode === "simple_pdf";
    var counts = isSimple ? getSimplePdfTranslationCompleteness() : getPaperExportCompletenessStrict();
    var preservedCount = isSimple ? 0 : state.segments.filter(isPaperPreserveSegmentStrict).length;
    if (state.pdfTranslationMode === "paper_pdf") {
      var referenceCount = state.segments.filter(function (segment) { return String(segment.type || "") === "reference"; }).length;
      var formulaOrImageCount = state.segments.filter(function (segment) {
        var type = String(segment.type || "");
        return type === "formula" || type === "imageText";
      }).length;
      return buildPaperPdfProgress({
        progressNumerator: counts.doneSegments,
        progressDenominator: counts.totalSegments,
        preservedSegments: preservedCount,
        segmentsByType: {
          reference: referenceCount,
          imageText: formulaOrImageCount,
        },
      });
    }
    return buildSimplePdfProgress({
      progressNumerator: counts.doneSegments,
      progressDenominator: counts.totalSegments,
      writtenSegments: counts.doneSegments,
      failedTranslatableSegments: counts.failedSegments,
    });
  }

  function updatePdfModeStepLabels() {
    var def = getPdfTranslationModeDef(state.pdfTranslationMode);
    var labels = def ? def.steps : ["选择文件", "提取文字", "分块翻译", "导出结果"];
    ["select", "extract", "translate", "export"].forEach(function (key, index) {
      var step = document.querySelector('.pdf-flow-step[data-step="' + key + '"]');
      if (!step) return;
      var label = step.querySelector("span:last-child");
      if (label) label.textContent = labels[index];
      step.classList.toggle("is-disabled", !state.pdfTranslationMode);
      if (step.tagName === "BUTTON") step.disabled = step.id === "btnExportPdfTranslation"
        ? ((!hasTranslatedPdfSegments() && !state.segments.length) || state.pdfTranslating || !state.pdfTranslationMode)
        : !state.pdfTranslationMode;
    });
  }

  var targetLanguages = [
    { code: "en", label: "英语" },
    { code: "zh", label: "中文" },
    { code: "ja", label: "日语" },
    { code: "ko", label: "韩语" },
    { code: "fr", label: "法语" },
    { code: "de", label: "德语" },
    { code: "es", label: "西班牙语" },
  ];

  function getTargetLanguageByCode(code) {
    var normalized = String(code || "").trim().toLowerCase();
    return targetLanguages.find(function (item) { return item.code === normalized; }) || targetLanguages[0];
  }

  function normalizePdfLang(code) {
    var value = String(code || "").trim();
    var lower = value.toLowerCase().replace("_", "-");
    if (!lower) return "";
    if (lower === "zh" || lower === "zh-cn" || lower === "cn") return "zh-CN";
    return lower;
  }

  function sameConcreteLanguage(sourceLang, targetLang) {
    var source = normalizePdfLang(sourceLang);
    var target = normalizePdfLang(targetLang);
    return source && target && source !== "auto" && source === target;
  }

  function toLegacyTranslateLang(code) {
    var normalized = normalizePdfLang(code);
    return normalized === "zh-CN" ? "zh" : normalized;
  }

  function getPdfLangLabel(code) {
    var normalized = normalizePdfLang(code);
    var labels = {
      auto: "自动检测",
      "zh-CN": "中文",
      en: "英语",
      ja: "日语",
      ko: "韩语",
      fr: "法语",
      de: "德语",
      es: "西班牙语",
    };
    return labels[normalized] || normalized || "";
  }

  function inferTextLanguage(text) {
    var value = String(text || "").slice(0, 4000);
    var chineseCount = (value.match(/[\u3400-\u9fff]/g) || []).length;
    var latinCount = (value.match(/[A-Za-z]/g) || []).length;
    if (chineseCount >= 20 && chineseCount > latinCount * 0.25) return "zh-CN";
    if (latinCount >= 40) return "en";
    return "auto";
  }

  function syncPdfLanguageSelects() {
    var sourceSelect = document.getElementById("pdfSourceLangSelect");
    var targetSelect = document.getElementById("pdfTargetLangSelect");
    if (sourceSelect) sourceSelect.value = state.pdfSourceLang;
    if (targetSelect) targetSelect.value = state.pdfTargetLang;
  }

  function autoSwitchPdfTargetLanguage(text) {
    var inferred = inferTextLanguage(text);
    var source = normalizePdfLang(state.pdfSourceLang);
    var effectiveSource = source === "auto" ? inferred : source;
    var target = normalizePdfLang(state.pdfTargetLang);
    if (effectiveSource === "zh-CN" && target === "zh-CN") {
      state.pdfTargetLang = "en";
    } else if (effectiveSource === "en" && target === "en") {
      state.pdfTargetLang = "zh-CN";
    }
    syncPdfLanguageSelects();
  }

  function getTestUsers() {
    return Array.isArray(state.testUsers) && state.testUsers.length ? state.testUsers : DEFAULT_TEST_USERS.slice();
  }

  function readSetting(key, fallback) {
    try {
      var stored = window.localStorage.getItem(key);
      if (stored && stored.trim()) return stored.trim();
    } catch (_e) {
      // Ignore storage failures in static previews.
    }
    try {
      if (typeof process !== "undefined" && process.env) {
        var envName = key === "lingoflow.serverBaseUrl" ? "LINGOFLOW_SERVER_BASE_URL" : "LINGOFLOW_BETA_TOKEN";
        var envValue = process.env[envName];
        if (envValue && envValue.trim()) return envValue.trim();
      }
    } catch (_err) {
      // Electron environment may be unavailable in browser preview.
    }
    return fallback;
  }

  function setupWindowControls() {
    try {
      if (typeof require !== "function") return;
      var ipc = require("electron").ipcRenderer;
      var minBtn = document.getElementById("btnMinimize");
      var maxBtn = document.getElementById("btnMaximize");
      var closeBtn = document.getElementById("btnClose");
      if (minBtn) minBtn.addEventListener("click", function () { ipc.send("window-minimize"); });
      if (maxBtn) maxBtn.addEventListener("click", function () { ipc.send("window-maximize-toggle"); });
      if (closeBtn) closeBtn.addEventListener("click", function () { ipc.send("window-close"); });
    } catch (_e) {
      // Static browser preview.
    }
  }

  function setupMaterialIconReadiness() {
    document.body.classList.remove("icons-ready");
    document.querySelectorAll(".material-symbols-outlined").forEach(function (icon) {
      if (!icon.getAttribute("data-icon")) {
        icon.setAttribute("data-icon", String(icon.textContent || "").trim());
      }
      icon.setAttribute("aria-hidden", "true");
    });

    if (document.fonts && document.fonts.load) {
      // Check if font is already loaded in the cache (fast path for repeat visits)
      var alreadyLoaded = document.fonts.check("24px 'Material Symbols Outlined'");
      if (alreadyLoaded) {
        document.body.classList.add("icons-ready");
        return;
      }
      // Race: font load promise vs. 800ms fallback timeout.
      // Google Fonts CDN is unreliable in some networks — don't wait more than 800ms
      // before showing fallback characters, which are now complete for all icons.
      var settled = false;
      var markReady = function () {
        if (settled) return;
        settled = true;
        document.body.classList.add("icons-ready");
      };
      var markFallback = function () {
        if (settled) return;
        settled = true;
        document.body.classList.add("icons-fallback");
      };
      document.fonts.load("24px 'Material Symbols Outlined'").then(markReady).catch(markFallback);
      window.setTimeout(markFallback, 800);
      return;
    }
    document.body.classList.add("icons-fallback");
  }

  function setupAppNav() {
    var links = document.querySelectorAll("a.sidebar-nav-item[data-page]");
    var pages = {
      desktop: document.getElementById("page-desktop"),
      pdf: document.getElementById("page-pdf"),
      settings: document.getElementById("page-settings"),
    };

    function showPage(key) {
      Object.keys(pages).forEach(function (k) {
        var el = pages[k];
        if (el) el.classList.toggle("active", k === key);
      });

      links.forEach(function (link) {
        var page = link.getAttribute("data-page");
        var active = page === key;
        link.classList.toggle("active", active);
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      });
    }

    links.forEach(function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        var page = link.getAttribute("data-page");
        if (page && pages[page]) showPage(page);
      });
    });
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function setHtml(id, value) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = value;
  }

  function setButtonText(button, value) {
    if (!button) return;
    var label = button.querySelector("span:not(.material-symbols-outlined)");
    if (label) label.textContent = value;
    else button.textContent = value;
  }

  function formatChars(value) {
    var num = Number(value || 0);
    if (!Number.isFinite(num)) num = 0;
    if (num >= 10000) return (num / 10000).toFixed(num % 10000 === 0 ? 0 : 1) + "万";
    if (num >= 1000) return (num / 1000).toFixed(num % 1000 === 0 ? 0 : 1) + "k";
    return String(Math.max(0, Math.round(num)));
  }

  function percent(used, total) {
    var u = Number(used || 0);
    var t = Number(total || 0);
    if (!Number.isFinite(u) || !Number.isFinite(t) || t <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((u / t) * 100)));
  }

  function authHeaders(extra) {
    var headers = Object.assign({ "Content-Type": "application/json" }, extra || {});
    if (state.betaToken) headers.Authorization = "Bearer " + state.betaToken;
    return headers;
  }

  async function requestJson(path, options) {
    var response = await fetch(state.serverBaseUrl + path, options || {});
    var text = await response.text();
    var data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_e) {
        data = { raw: text };
      }
    }
    if (!response.ok) {
      var message = data && (data.error || data.detail || data.message);
      var requestError = new Error(message ? JSON.stringify(message) : "HTTP " + response.status);
      requestError.httpStatus = Number(response.status || 0);
      requestError.responseData = data;
      throw requestError;
    }
    return data || {};
  }

  async function requestFirstJson(paths, options) {
    var lastError = null;
    for (var i = 0; i < paths.length; i += 1) {
      try {
        return await requestJson(paths[i], options);
      } catch (err) {
        if (err && err.name === "AbortError") throw err;
        if (!err || Number(err.httpStatus || 0) !== 404) throw err;
        lastError = err;
      }
    }
    throw lastError || new Error("server endpoint unavailable");
  }

  async function refreshServerState() {
    if (state.refreshInFlight) return;
    state.refreshInFlight = true;
    setText("userName", "连接服务器中");
    setText("userEmail", state.serverBaseUrl);
    setText("quotaCurrentPlan", "读取服务器中");
    setText("quotaCurrentStatus", "连接中");
    renderUsageChart([]);

    try {
      await requestJson("/health");
      state.serverOnline = true;
    } catch (_err) {
      state.serverOnline = false;
      renderServerOffline();
      state.refreshInFlight = false;
      return;
    }

    try {
      await Promise.all([
        loadUserSummary(),
        loadQuota(),
        loadUsageHistory(),
        loadServerDiagnostics(),
      ]);
    } finally {
      state.refreshInFlight = false;
    }
  }

  async function refreshUsageSurfaces() {
    if (state.refreshInFlight) return;
    state.refreshInFlight = true;
    try {
      await Promise.all([loadQuota(), loadUsageHistory()]);
      state.lastUsageRefreshAt = Date.now();
    } finally {
      state.refreshInFlight = false;
    }
  }

  function refreshUsageSurfacesSoon(minIntervalMs) {
    var elapsed = Date.now() - Number(state.lastUsageRefreshAt || 0);
    if (elapsed >= minIntervalMs) {
      refreshUsageSurfaces();
    }
  }

  function renderServerOffline() {
    setText("userName", "服务器未连接");
    setText("userEmail", state.serverBaseUrl);
    setText("quotaCurrentPlan", "服务器离线");
    setText("quotaCurrentStatus", "不可用");
    setHtml("userMonthlyUsageValue", '<span class="text-primary font-bold">--</span>');
    setHtml("userRemainingUsageValue", '<span class="text-tertiary font-bold">--</span>');
    setProgress("userMonthlyUsageBar", 0);
    setProgress("userRemainingUsageBar", 0);
    renderUsageChart([]);
    var claimBtn = document.getElementById("btnClaimTrialQuota");
    if (claimBtn) {
      claimBtn.textContent = "服务器未连接";
      claimBtn.disabled = true;
      claimBtn.setAttribute("data-state", "offline");
    }
  }

  async function loadUserSummary() {
    try {
      var data = await requestFirstJson(["/v1/user-summary", "/user-summary"], { headers: authHeaders() });
      setText("userName", data.name || data.username || data.displayName || "LingoFlow User");
      setText("userEmail", data.email || data.account || data.userId || "服务器用户");
    } catch (_err) {
      setText("userName", "LingoFlow User");
      setText("userEmail", "服务器已连接，用户接口尚未提供");
    }
  }

  async function loadQuota() {
    var claimBtn = document.getElementById("btnClaimTrialQuota");
    try {
      var data = await requestFirstJson(["/v1/quota", "/quota"], { headers: authHeaders() });
      var total = Number(data.total || data.totalChars || data.monthlyLimit || data.limit || 0);
      var used = Number(data.used || data.usedChars || data.monthlyUsed || 0);
      var remaining = Number(data.remaining || data.remainingChars || Math.max(0, total - used));
      var plan = data.plan || data.planName || data.tier || "服务器方案";
      var status = data.status || (data.claimed ? "已领取" : "可领取");

      setText("quotaCurrentPlan", plan);
      setText("quotaCurrentStatus", status);
      setText("userMonthlyUsageTitle", "本月用量");
      setText("userRemainingUsageTitle", "剩余额度");
      setHtml("userMonthlyUsageValue", '<span class="text-primary font-bold">' + formatChars(used) + "</span> / " + formatChars(total) + " 字");
      setHtml("userRemainingUsageValue", '<span class="text-tertiary font-bold">' + formatChars(remaining) + "</span> / " + formatChars(total) + " 字");
      setProgress("userMonthlyUsageBar", percent(used, total));
      setProgress("userRemainingUsageBar", percent(remaining, total));

      if (claimBtn) {
        claimBtn.disabled = !!data.claimed;
        claimBtn.textContent = data.claimed ? "已领取" : "领取服务器额度";
        claimBtn.setAttribute("data-state", data.claimed ? "claimed" : "ready");
      }
    } catch (_err) {
      setText("quotaCurrentPlan", "服务器已连接");
      setText("quotaCurrentStatus", "额度接口未提供");
      setHtml("userMonthlyUsageValue", '<span class="text-primary font-bold">等待接口</span>');
      setHtml("userRemainingUsageValue", '<span class="text-tertiary font-bold">等待接口</span>');
      setProgress("userMonthlyUsageBar", 0);
      setProgress("userRemainingUsageBar", 0);
      if (claimBtn) {
        claimBtn.disabled = true;
        claimBtn.textContent = "等待服务器额度接口";
        claimBtn.setAttribute("data-state", "pending");
      }
    }
  }

  async function loadUsageHistory() {
    try {
      var data = await requestFirstJson(
        ["/v1/usage/history-7d", "/v1/usage-history-7d", "/usage-history-7d"],
        { headers: authHeaders() },
      );
      var rows = Array.isArray(data) ? data : data.days || data.history || data.items || [];
      renderUsageChart(rows);
    } catch (_err) {
      renderUsageChart([]);
    }
  }

  async function loadServerDiagnostics() {
    return;
  }

  function setProgress(id, value) {
    var el = document.getElementById(id);
    if (el) el.style.width = Math.max(0, Math.min(100, value)) + "%";
  }

  function normalizeUsageRows(rows) {
    var sourceRows = Array.isArray(rows) ? rows : [];
    var normalized = [];
    for (var i = 0; i < 7; i += 1) {
      normalized.push({
        day: "day" + (i + 1),
        value: 0,
      });
    }
    var today = new Date();
    var todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    function readValue(item) {
      return Number(item && (item.value ?? item.chars ?? item.characters ?? item.used ?? item.count ?? item.total) || 0);
    }
    function assign(index, item) {
      if (index < 0 || index > 6) return;
      normalized[index].value += readValue(item);
    }
    sourceRows.forEach(function (item, index) {
      var explicitDay = String(item && (item.day || item.label || "") || "").toLowerCase();
      var dayMatch = explicitDay.match(/^day\s*([1-7])$/);
      if (dayMatch) {
        assign(Number(dayMatch[1]) - 1, item);
        return;
      }
      var explicitIndex = Number(item && (item.index ?? item.dayIndex ?? item.offset));
      if (Number.isFinite(explicitIndex) && explicitIndex >= 0 && explicitIndex <= 6) {
        assign(explicitIndex, item);
        return;
      }
      var dateText = item && (item.date || item.dayDate || item.createdAt || item.created_at);
      if (dateText) {
        var parsed = new Date(String(dateText).slice(0, 10));
        if (!Number.isNaN(parsed.getTime())) {
          var rowStart = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime();
          var age = Math.round((todayStart - rowStart) / 86400000);
          assign(6 - age, item);
          return;
        }
      }
      assign(index, item);
    });
    return normalized;
  }

  function renderUsageChart(rows) {
    var yAxisEl = document.getElementById("userUsageYAxis");
    var barsEl = document.getElementById("userUsageBars");
    var xAxisEl = document.getElementById("userUsageXAxis");
    if (!yAxisEl || !barsEl || !xAxisEl) return;

    var days = normalizeUsageRows(rows || []);
    var hasUsage = days.some(function (item) { return Number(item.value || 0) > 0; });
    var maxValue = Math.max.apply(null, days.map(function (item) { return item.value; }).concat([1000]));
    var topTick = Math.ceil(maxValue / 1000) * 1000;
    var midTick = Math.round(topTick / 2);

    yAxisEl.innerHTML = "";
    [formatChars(topTick), formatChars(midTick), "0"].forEach(function (tick) {
      var label = document.createElement("span");
      label.className = "user-usage-y-label";
      label.textContent = tick;
      yAxisEl.appendChild(label);
    });

    barsEl.innerHTML = "";
    barsEl.classList.toggle("is-empty", !hasUsage);
    xAxisEl.innerHTML = "";
    days.forEach(function (item) {
      var barCol = document.createElement("div");
      var bar = document.createElement("div");
      var dayLabel = document.createElement("span");
      var height = item.value <= 0 ? 0 : Math.max(12, Math.round((item.value / topTick) * 100));

      barCol.className = "user-usage-bar-col";
      bar.className = "user-usage-bar";
      bar.style.height = height + "%";
      bar.classList.toggle("is-empty", item.value <= 0);
      bar.title = item.day + " " + formatChars(item.value) + " 字";

      dayLabel.className = "user-usage-x-label";
      dayLabel.textContent = item.day;

      barCol.appendChild(bar);
      barsEl.appendChild(barCol);
      xAxisEl.appendChild(dayLabel);
    });
    if (!hasUsage) {
      var emptyState = document.createElement("div");
      emptyState.className = "user-usage-empty-state";
      emptyState.textContent = rows && rows.length ? "近7天暂无使用量" : "暂无用量数据";
      barsEl.appendChild(emptyState);
    }
  }

  function setupQuotaActions() {
    var claimBtn = document.getElementById("btnClaimTrialQuota");
    if (!claimBtn) return;
    claimBtn.addEventListener("click", async function () {
      claimBtn.disabled = true;
      claimBtn.textContent = "领取中";
      try {
        await requestFirstJson(
          ["/v1/quota/claim", "/quota/claim"],
          { method: "POST", headers: authHeaders(), body: "{}" },
        );
        await loadQuota();
      } catch (_err) {
        claimBtn.textContent = "领取接口未提供";
        claimBtn.setAttribute("data-state", "pending");
      }
    });
  }

  async function loadSharedConfig() {
    var ipc = getElectronIpc();
    if (!ipc) return;
    try {
      var config = await ipc.invoke("lingoflow-config:get");
      if (config && config.serverBaseUrl) {
        state.serverBaseUrl = String(config.serverBaseUrl).replace(/\/+$/, "");
      }
      if (config && config.betaToken) {
        state.betaToken = String(config.betaToken);
      }
      if (config && Array.isArray(config.testUsers)) {
        state.testUsers = config.testUsers;
      }
      var lang = getTargetLanguageByCode(config && config.targetLanguage);
      state.targetLanguage = lang.code;
      state.targetLabel = lang.label;
      setText("targetLangLabel", lang.label);
      state.provider = config && config.provider || null;
    } catch (_err) {
      // Keep local defaults when the shared config is unavailable.
    }
  }

  function renderTestUserSelect() {
    var select = document.getElementById("testUserSelect");
    if (!select) return;
    var users = getTestUsers();
    select.innerHTML = "";
    users.forEach(function (user) {
      var option = document.createElement("option");
      option.value = user.token || "";
      option.textContent = user.name || user.email || user.userId || "Test User";
      option.selected = option.value === state.betaToken;
      select.appendChild(option);
    });
    select.disabled = users.length === 0;
  }

  function setupTestUserSwitch() {
    var select = document.getElementById("testUserSelect");
    if (!select) return;
    select.addEventListener("change", async function () {
      var token = select.value;
      if (!token) return;
      state.betaToken = token;
      try {
        window.localStorage.setItem("lingoflow.betaToken", token);
      } catch (_err) {
        // Ignore storage failures.
      }
      var ipc = getElectronIpc();
      if (ipc) {
        try {
          var config = await ipc.invoke("lingoflow-config:set-beta-token", token);
          if (config && Array.isArray(config.testUsers)) state.testUsers = config.testUsers;
        } catch (_err) {
          // The in-memory token still lets this window test the selected user.
        }
      }
      renderTestUserSelect();
      state.refreshInFlight = false;
      await refreshServerState();
    });
  }

  async function persistTargetLanguage(code) {
    var lang = getTargetLanguageByCode(code);
    state.targetLanguage = lang.code;
    state.targetLabel = lang.label;
    setText("targetLangLabel", lang.label);
    try {
      window.localStorage.setItem("lingoflow.targetLanguage", lang.code);
    } catch (_err) {
      // Storage can be blocked in static previews.
    }

    var ipc = getElectronIpc();
    if (!ipc) return;
    try {
      await ipc.invoke("lingoflow-config:set-target-language", lang.code);
    } catch (_err) {
      // The visible selection still updates; launch will use the last saved config if IPC fails.
    }
  }

  async function setupTranslatePage() {
    await loadSharedConfig();
    setText("targetLangLabel", state.targetLabel);

    var desktopBtn = document.getElementById("btnLaunchDesktopTranslate");
    var showLauncherBtn = document.getElementById("btnShowDesktopLauncher");
    var targetBtn = document.getElementById("targetLangBtn");
    var targetMenu = document.getElementById("targetLangMenu");

    if (desktopBtn) {
      desktopBtn.disabled = false;
      desktopBtn.title = "启动桌面翻译";
      setButtonText(desktopBtn, "启动桌面翻译");
      desktopBtn.addEventListener("click", launchDesktopTranslate);
      refreshDesktopFeatureStatus();
    }

    if (showLauncherBtn) {
      showLauncherBtn.disabled = false;
      showLauncherBtn.title = "显示桌面翻译悬浮球";
      showLauncherBtn.addEventListener("click", showDesktopLauncher);
    }

    if (targetBtn && targetMenu) {
      targetBtn.disabled = false;
      targetBtn.addEventListener("click", function () {
        targetMenu.classList.toggle("hidden");
      });
      targetMenu.innerHTML = "";
      targetLanguages.forEach(function (item) {
        var option = document.createElement("button");
        option.type = "button";
        option.className = "translate-lang-option";
        option.textContent = item.label;
        option.addEventListener("click", function () {
          persistTargetLanguage(item.code);
          targetMenu.classList.add("hidden");
        });
        targetMenu.appendChild(option);
      });
    }
  }

  function setProviderFeedback(message, status) {
    var feedback = document.getElementById("providerFeedback");
    if (!feedback) return;
    feedback.textContent = String(message || "");
    feedback.setAttribute("data-state", status || "idle");
  }

  function setProviderDialogFeedback(message, status) {
    var feedback = document.getElementById("providerDialogFeedback");
    if (!feedback) return;
    feedback.textContent = String(message || "");
    feedback.setAttribute("data-state", status || "idle");
    feedback.classList.toggle("hidden", !message);
  }

  function setProviderStatusBadge(status, text) {
    var badge = document.getElementById("providerReadyBadge");
    if (!badge) return;
    badge.textContent = text || (status === "connected" ? "已连接" : status === "connecting" ? "连接中" : status === "failed" ? "连接失败" : "未连接");
    badge.setAttribute("data-state", status || "disconnected");
  }

  function setProviderSaveFeedback(message, status) {
    var feedback = document.getElementById("providerSaveFeedback");
    if (!feedback) {
      setProviderFeedback(message, status);
      return;
    }
    feedback.textContent = String(message || "");
    feedback.setAttribute("data-state", status || "idle");
  }

  function setProviderDiagnosticDetails(diagnostic) {
    var details = document.getElementById("providerDiagnosticDetails");
    var toggle = document.getElementById("btnToggleProviderDiagnostics");
    if (!details) return;
    if (!diagnostic) {
      details.textContent = "";
      details.classList.add("hidden");
      if (toggle) {
        toggle.classList.add("hidden");
        toggle.setAttribute("aria-expanded", "false");
        toggle.textContent = "开发调试信息";
      }
      return;
    }
    details.textContent = JSON.stringify(diagnostic, null, 2);
    details.classList.add("hidden");
    if (toggle) {
      toggle.classList.remove("hidden");
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "开发调试信息";
    }
  }

  function summarizeProviderDiagnostic(result) {
    var diagnostic = result && result.diagnostic || {};
    var status = diagnostic.status || diagnostic.statusCode;
    var code = diagnostic.code || diagnostic.errno;
    var cause = diagnostic.cause;
    while (cause && cause.cause) cause = cause.cause;
    var causeMessage = cause && cause.message;
    var parts = [];
    if (status) parts.push("HTTP " + status);
    if (code) parts.push(String(code));
    parts.push(String(result && result.message || diagnostic.message || "未知错误"));
    if (causeMessage && causeMessage !== result.message) parts.push("Cause: " + causeMessage);
    return parts.join(" · ");
  }

  function applyProviderPreset(presetId, overwrite) {
    var presets = Array.isArray(state.providerPresets) ? state.providerPresets : [];
    var preset = presets.find(function (item) { return item && item.id === presetId; });
    if (!preset || preset.id === "custom") return;
    var baseUrl = document.getElementById("providerBaseUrl");
    var model = document.getElementById("providerModel");
    if (baseUrl && (overwrite || !baseUrl.value)) baseUrl.value = preset.baseUrl || "";
    if (model && (overwrite || !model.value)) model.value = preset.model || "";
  }

  function populateProviderForm(provider) {
    provider = provider || {};
    var baseUrl = document.getElementById("providerBaseUrl");
    var model = document.getElementById("providerModel");
    var apiKey = document.getElementById("providerApiKey");
    var apiKeyHint = document.getElementById("providerApiKeyHint");
    var presetSelect = document.getElementById("providerPreset");
    var profileId = document.getElementById("providerProfileId");
    var profileName = document.getElementById("providerProfileName");
    if (profileId) profileId.value = provider.id || "";
    if (profileName) profileName.value = provider.name || "";
    if (presetSelect) presetSelect.value = provider.preset || "custom";
    if (baseUrl) baseUrl.value = provider.baseUrl || "";
    if (model) model.value = provider.model || "";
    if (apiKey) apiKey.value = "";
    if (apiKeyHint) {
      apiKeyHint.textContent = provider.apiKeyConfigured
        ? "已保存密钥 " + (provider.apiKeyMasked || "") + "；留空可继续使用。"
        : "密钥尚未配置。";
    }
  }

  function providerFormSignature() {
    var payload = getProviderFormPayload();
    return JSON.stringify([payload.id, payload.name, payload.preset, payload.baseUrl, payload.apiKey, payload.model]);
  }

  function rememberProviderFormBaseline() {
    state.providerFormBaseline = providerFormSignature();
    updateProviderSaveState();
  }

  function updateProviderSaveState() {
    var saveButton = document.getElementById("btnSaveProvider");
    if (!saveButton) return;
    saveButton.disabled = providerFormSignature() === state.providerFormBaseline;
  }

  function applyProviderPublicConfig(provider) {
    provider = provider || {};
    state.provider = provider;
    populateProviderForm(provider);
    var status = state.providerConnectionStates[provider.id] || "disconnected";
    if (provider.id) state.providerConnectionStates[provider.id] = status;
    setProviderStatusBadge(status);
    rememberProviderFormBaseline();
  }

  function providerConnectionLabel(status) {
    return status === "connected" ? "已连接" : status === "connecting" ? "连接中" : status === "failed" ? "重试连接" : "连接";
  }

  function updateProviderConnectionUi(providerId, status) {
    state.providerConnectionStates[providerId] = status;
    var manager = state.providerManager || {};
    if (manager.activeProviderId === providerId) setProviderStatusBadge(status);
    Array.from(document.querySelectorAll(".provider-profile-card")).forEach(function (card) {
      if (card.getAttribute("data-provider-id") !== providerId) return;
      card.setAttribute("data-connection-state", status);
      var button = card.querySelector(".provider-connect-action");
      if (!button) return;
      button.setAttribute("data-state", status);
      button.textContent = providerConnectionLabel(status);
      button.setAttribute("aria-label", providerConnectionLabel(status));
      button.disabled = status === "connecting" || status === "connected";
    });
  }

  async function connectProviderProfile(profile) {
    var ipc = getElectronIpc();
    if (!ipc || !profile || !profile.id) return;
    if (!profile.active) {
      var nextManager = await ipc.invoke("lingoflow-provider:activate", profile.id);
      Object.keys(state.providerConnectionStates).forEach(function (providerId) {
        state.providerConnectionStates[providerId] = "disconnected";
      });
      state.providerManager = nextManager;
      profile = nextManager.active || profile;
      renderProviderProfiles(nextManager);
      applyProviderPublicConfig(profile);
    }
    updateProviderConnectionUi(profile.id, "connecting");
    setProviderFeedback("正在连接 " + (profile.name || providerPresetLabel(profile.preset)) + "…", "idle");
    try {
      var result = await ipc.invoke("lingoflow-provider:test", profile);
      if (result && result.ok) {
        updateProviderConnectionUi(profile.id, "connected");
        setProviderFeedback("Provider 已连接 · " + (result.provider || "Custom") + " · " + Number(result.latencyMs || 0) + " ms", "success");
      } else {
        updateProviderConnectionUi(profile.id, "failed");
        setProviderFeedback("连接失败：" + summarizeProviderDiagnostic(result), "error");
      }
    } catch (err) {
      updateProviderConnectionUi(profile.id, "failed");
      setProviderFeedback("连接失败：" + String(err && err.message || err), "error");
    }
  }

  function providerPresetLabel(presetId) {
    var preset = (state.providerPresets || []).find(function (entry) { return entry && entry.id === presetId; });
    return preset && preset.label || presetId || "Custom";
  }

  function renderProviderProfiles(manager) {
    manager = manager || state.providerManager || {};
    state.providerManager = manager;
    var list = document.getElementById("providerProfileList");
    if (!list) return;
    list.innerHTML = "";
    var profiles = Array.isArray(manager.profiles) ? manager.profiles : [];
    if (!profiles.length) {
      list.innerHTML = '<div class="provider-profile-empty">暂无配置，请新建第一个 Provider 连接。</div>';
      setProviderStatusBadge("disconnected");
      return;
    }
    profiles.forEach(function (profile) {
      var card = document.createElement("div");
      card.className = "provider-profile-card" + (profile.active ? " is-active" : "");
      card.setAttribute("data-provider-id", profile.id || "");
      card.innerHTML = '<button type="button" class="provider-profile-select"><span class="provider-profile-mark"></span><span class="provider-profile-copy"><strong></strong><small></small></span></button><button type="button" class="provider-profile-expand"><span>展开</span><span class="material-symbols-outlined" aria-hidden="true">chevron_right</span></button><button type="button" class="provider-status-badge provider-connect-action"></button>';
      card.querySelector("strong").textContent = profile.name || providerPresetLabel(profile.preset);
      card.querySelector("small").textContent = providerPresetLabel(profile.preset) + " · " + (profile.model || "未设置模型");
      var profileStatus = state.providerConnectionStates[profile.id] || "disconnected";
      state.providerConnectionStates[profile.id] = profileStatus;
      card.setAttribute("data-connection-state", profileStatus);
      var connectButton = card.querySelector(".provider-connect-action");
      connectButton.setAttribute("data-state", profileStatus);
      connectButton.textContent = providerConnectionLabel(profileStatus);
      connectButton.setAttribute("aria-label", providerConnectionLabel(profileStatus) + " " + (profile.name || providerPresetLabel(profile.preset)));
      connectButton.disabled = profileStatus === "connecting" || profileStatus === "connected";
      connectButton.addEventListener("click", function () { connectProviderProfile(profile); });
      var selectButton = card.querySelector(".provider-profile-select");
      selectButton.setAttribute("aria-label", (profile.active ? "当前配置：" : "切换到配置：") + (profile.name || providerPresetLabel(profile.preset)));
      selectButton.addEventListener("click", async function () {
        var ipc = getElectronIpc();
        if (!ipc) return;
        selectButton.disabled = true;
        try {
          var nextManager = await ipc.invoke("lingoflow-provider:activate", profile.id);
          Object.keys(state.providerConnectionStates).forEach(function (providerId) {
            if (providerId !== profile.id) state.providerConnectionStates[providerId] = "disconnected";
          });
          renderProviderProfiles(nextManager);
          applyProviderPublicConfig(nextManager.active || profile);
          setProviderFeedback("已切换到 " + (nextManager.active && nextManager.active.name || profile.name) + "。", "success");
        } catch (err) {
          setProviderFeedback("切换失败：" + String(err && err.message || err), "error");
        } finally { selectButton.disabled = false; }
      });
      card.querySelector(".provider-profile-expand").addEventListener("click", function () { openProviderDialog(profile); });
      list.appendChild(card);
    });
  }

  function renderProviderTemplates() {
    var grid = document.getElementById("providerTemplateGrid");
    if (!grid) return;
    grid.innerHTML = "";
    (state.providerPresets || []).forEach(function (preset) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "provider-template-card";
      button.setAttribute("data-preset", preset.id);
      button.innerHTML = '<strong></strong><small></small>';
      button.querySelector("strong").textContent = preset.label;
      button.querySelector("small").textContent = preset.id === "custom" ? "手动配置" : preset.model;
      button.addEventListener("click", function () {
        var select = document.getElementById("providerPreset");
        if (select) select.value = preset.id;
        applyProviderPreset(preset.id, true);
        var name = document.getElementById("providerProfileName");
        if (name && !name.value.trim()) name.value = preset.label;
        grid.querySelectorAll(".provider-template-card").forEach(function (entry) { entry.classList.toggle("is-selected", entry === button); });
      });
      grid.appendChild(button);
    });
  }

  function resetProviderProfileForm() {
    var id = document.getElementById("providerProfileId");
    var name = document.getElementById("providerProfileName");
    var key = document.getElementById("providerApiKey");
    var select = document.getElementById("providerPreset");
    if (id) id.value = "";
    if (name) name.value = "";
    if (key) key.value = "";
    if (select) select.value = "deepseek";
    applyProviderPreset("deepseek", true);
    setProviderDiagnosticDetails(null);
    setProviderDialogFeedback("", "idle");
    rememberProviderFormBaseline();
  }

  function openProviderDialog(profile) {
    var dialog = document.getElementById("providerConfigDialog");
    var title = document.getElementById("providerConfigDialogTitle");
    var advanced = document.getElementById("providerAdvancedSettings");
    var keyInput = document.getElementById("providerApiKey");
    var toggle = document.getElementById("btnToggleProviderKey");
    if (!dialog) return;
    if (profile) populateProviderForm(profile);
    else resetProviderProfileForm();
    if (title) title.textContent = profile ? "编辑配置" : "新建配置";
    if (advanced) advanced.open = false;
    if (keyInput) keyInput.type = "password";
    if (toggle) {
      toggle.textContent = "显示";
      toggle.setAttribute("aria-pressed", "false");
    }
    setProviderDialogFeedback("", "idle");
    rememberProviderFormBaseline();
    if (!dialog.open) dialog.showModal();
  }

  function closeProviderDialog() {
    var dialog = document.getElementById("providerConfigDialog");
    if (dialog && dialog.open) dialog.close();
  }

  function getProviderFormPayload() {
    var baseUrl = document.getElementById("providerBaseUrl");
    var apiKey = document.getElementById("providerApiKey");
    var model = document.getElementById("providerModel");
    return {
      id: String(document.getElementById("providerProfileId") && document.getElementById("providerProfileId").value || ""),
      name: String(document.getElementById("providerProfileName") && document.getElementById("providerProfileName").value || "").trim(),
      type: "openai_compatible",
      preset: String(document.getElementById("providerPreset") && document.getElementById("providerPreset").value || "custom"),
      baseUrl: String(baseUrl && baseUrl.value || "").trim(),
      apiKey: String(apiKey && apiKey.value || "").trim(),
      model: String(model && model.value || "").trim(),
    };
  }

  async function loadProviderSettings() {
    var ipc = getElectronIpc();
    if (!ipc) return;
    try {
      state.providerPresets = await ipc.invoke("lingoflow-provider:presets");
      var manager = await ipc.invoke("lingoflow-provider:get");
      renderProviderTemplates();
      renderProviderProfiles(manager);
      applyProviderPublicConfig(manager.active || {});
    } catch (err) {
      setProviderFeedback("读取 Provider 配置失败：" + String(err && err.message || err), "error");
    }
  }

  async function setupProviderSettingsPage() {
    var form = document.getElementById("providerSettingsForm");
    var toggleButton = document.getElementById("btnToggleProviderKey");
    var keyInput = document.getElementById("providerApiKey");
    var presetSelect = document.getElementById("providerPreset");
    var diagnosticToggle = document.getElementById("btnToggleProviderDiagnostics");
    var newProfileButton = document.getElementById("btnNewProviderProfile");
    var closeDialogButton = document.getElementById("btnCloseProviderDialog");
    var cancelDialogButton = document.getElementById("btnCancelProviderDialog");
    var dialog = document.getElementById("providerConfigDialog");
    if (!form) return;
    await loadProviderSettings();

    if (diagnosticToggle) {
      diagnosticToggle.addEventListener("click", function () {
        var details = document.getElementById("providerDiagnosticDetails");
        if (!details || !details.textContent) return;
        var expand = details.classList.contains("hidden");
        details.classList.toggle("hidden", !expand);
        diagnosticToggle.setAttribute("aria-expanded", expand ? "true" : "false");
        diagnosticToggle.textContent = expand ? "收起开发调试信息" : "开发调试信息";
      });
    }

    if (presetSelect) {
      presetSelect.addEventListener("change", function () {
        applyProviderPreset(presetSelect.value, true);
        var profileName = document.getElementById("providerProfileName");
        if (profileName) profileName.value = presetSelect.options[presetSelect.selectedIndex].text;
        setProviderDiagnosticDetails(null);
        updateProviderSaveState();
      });
    }

    if (newProfileButton) newProfileButton.addEventListener("click", function () { openProviderDialog(null); });
    if (closeDialogButton) closeDialogButton.addEventListener("click", closeProviderDialog);
    if (cancelDialogButton) cancelDialogButton.addEventListener("click", closeProviderDialog);
    if (dialog) dialog.addEventListener("click", function (event) {
      if (event.target === dialog) closeProviderDialog();
    });

    if (toggleButton && keyInput) {
      toggleButton.addEventListener("click", function () {
        var reveal = keyInput.type === "password";
        keyInput.type = reveal ? "text" : "password";
        toggleButton.textContent = reveal ? "隐藏" : "显示";
        toggleButton.setAttribute("aria-pressed", reveal ? "true" : "false");
      });
    }

    form.addEventListener("input", updateProviderSaveState);
    form.addEventListener("change", updateProviderSaveState);

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var ipc = getElectronIpc();
      if (!ipc) return;
      var saveButton = document.getElementById("btnSaveProvider");
      if (saveButton) saveButton.disabled = true;
      setProviderDialogFeedback("正在保存配置…", "idle");
      setProviderDiagnosticDetails(null);
      try {
        var manager = await ipc.invoke("lingoflow-provider:save", getProviderFormPayload());
        state.providerConnectionStates[manager.active && manager.active.id] = "disconnected";
        renderProviderProfiles(manager);
        applyProviderPublicConfig(manager.active || {});
        setProviderFeedback("配置已保存。点击“连接”确认当前 Provider。", "success");
        setProviderDialogFeedback("配置已保存。", "success");
        window.setTimeout(closeProviderDialog, 420);
      } catch (err) {
        setProviderFeedback("保存失败。", "error");
        setProviderDialogFeedback("保存失败：" + String(err && err.message || err), "error");
        setProviderDiagnosticDetails({ name: err && err.name || "Error", message: String(err && err.message || err), stack: String(err && err.stack || "") });
      } finally {
        updateProviderSaveState();
      }
    });
  }

  function formatFileSize(bytes) {
    var size = Number(bytes || 0);
    if (!Number.isFinite(size) || size <= 0) return "";
    if (size >= 1024 * 1024) return (size / 1024 / 1024).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1) + " MB";
    if (size >= 1024) return Math.round(size / 1024) + " KB";
    return Math.round(size) + " B";
  }

  function countTextChars(text) {
    return String(text || "").replace(/\s/g, "").length;
  }

  function getRawTextCount(rawPages) {
    return (rawPages || []).reduce(function (sum, page) {
      return sum + countTextChars(page && page.text ? page.text : "");
    }, 0);
  }

  function getSegmentTextCount(segments) {
    return (segments || []).reduce(function (sum, segment) {
      return sum + countTextChars(segment && segment.sourceText ? segment.sourceText : "");
    }, 0);
  }

  function getPdfTextCounts(result, segments) {
    var rawPages = result && Array.isArray(result.rawTextByPage) ? result.rawTextByPage : state.rawTextByPage;
    var sourceSegments = Array.isArray(segments) ? segments : state.segments;
    return {
      rawTextCount: getRawTextCount(rawPages),
      segmentTextCount: getSegmentTextCount(sourceSegments),
      segmentCount: (sourceSegments || []).length,
    };
  }

  function getPdfCountDiffRatio(rawTextCount, segmentTextCount) {
    if (!rawTextCount) return 0;
    return Math.abs(rawTextCount - segmentTextCount) / rawTextCount;
  }

  function formatPdfCountSummary(counts) {
    return "原始 " + counts.rawTextCount + " 字 · 分段 " + counts.segmentTextCount + " 字 · " + counts.segmentCount + " 段";
  }

  function makeUiPreview(text) {
    var value = String(text || "").replace(/\s+/g, " ").trim();
    return value.length > 50 ? value.slice(0, 50) + "..." : value;
  }

  function getSegmentStatusCounts() {
    var counts = { done: 0, failed: 0, pending: 0, translating: 0, preserved: 0, total: state.segments.length };
    state.segments.forEach(function (segment) {
      var key = segment.status || "pending";
      if (Object.prototype.hasOwnProperty.call(counts, key)) counts[key] += 1;
      else counts.pending += 1;
    });
    return counts;
  }

  function hasTranslatedPdfSegments() {
    return state.segments.some(function (segment) {
      return segment.status === "done" && segment.translatedText && String(segment.translatedText).trim();
    });
  }

  function hasTranslatedPdfOverlaySegments() {
    return state.segments.some(function (segment) {
      return isPaperOverlayCandidateStrict(segment) &&
        segment.status === "done" &&
        segment.translatedText &&
        String(segment.translatedText).trim();
    });
  }

  function getTranslatedPdfSegmentEntries() {
    return state.segments
      .map(function (segment, index) {
        return { segment: segment, index: index };
      })
      .filter(function (entry) {
        return entry.segment.status === "done" && entry.segment.translatedText && String(entry.segment.translatedText).trim();
      });
  }

  function getPaperOverlaySegmentEntries() {
    // Deprecated compatibility wrapper. Paper/legacy only.
    if (state.pdfTranslationMode === "simple_pdf") {
      warnSimplePdfDeprecatedPaperWrapper("getPaperOverlaySegmentEntries");
      return [];
    }
    return getPaperOverlaySegmentEntriesStrict();
  }

  function isPdfSegmentTranslated(segment) {
    return segment &&
      segment.status === "done" &&
      segment.translatedText &&
      String(segment.translatedText).trim();
  }

  function getRemainingPaperSegmentEntries() {
    // Deprecated compatibility wrapper. Paper/legacy only.
    if (state.pdfTranslationMode === "simple_pdf") {
      warnSimplePdfDeprecatedPaperWrapper("getRemainingPaperSegmentEntries");
      return [];
    }
    return getRemainingPaperSegmentEntriesStrict();
  }

  function getPaperExportCompleteness() {
    // Deprecated compatibility wrapper. Paper/legacy only.
    if (state.pdfTranslationMode === "simple_pdf") {
      warnSimplePdfDeprecatedPaperWrapper("getPaperExportCompleteness");
      return { totalSegments: 0, doneSegments: 0, pendingSegments: 0, failedSegments: 0 };
    }
    return getPaperExportCompletenessStrict();
  }

  function getPdfPartialTranslateRatio() {
    var raw = "";
    try {
      raw = (typeof process !== "undefined" && process.env && process.env.PDF_TRANSLATE_LIMIT_RATIO) || "";
    } catch (_err) {
      raw = "";
    }
    if (!raw) {
      try { raw = window.localStorage && window.localStorage.getItem("PDF_TRANSLATE_LIMIT_RATIO") || ""; } catch (_err2) { raw = ""; }
    }
    var value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || value >= 1) return 0;
    return Math.max(0.01, Math.min(0.99, value));
  }

  function isPromptLeakTranslation(text) {
    var value = String(text || "");
    return /根据上下文|以正式文件阅读的方式|保留专业术语|不得概括|不得扩展|不得省略|不得改写|不得添加|仅返回翻译后的段落|不得包含解释|不得包含标签|不得包含\s*Markdown|You are a translator|Translate the following|Do not include|Return only|system prompt|user prompt/i.test(value);
  }

  function getTranslationOutputSemanticFailure(sourceText, translatedText) {
    var source = String(sourceText || "").trim();
    var translated = String(translatedText || "").trim();
    if (/无法(?:进行)?翻译|不能(?:进行)?翻译|未(?:提供|收到).{0,16}(?:原文|文本|内容|段落)|请(?:先)?提供.{0,16}(?:原文|文本|内容|段落)|(?:cannot|unable to) translate|please provide (?:the )?(?:source |original )?(?:text|content)/i.test(translated)) return "invalid_translation_refusal";
    var sourceWords = source.match(/[A-Za-z]{2,}/g) || [];
    var translatedWords = translated.match(/[A-Za-z]{2,}/g) || [];
    var hasTargetScript = /[\u3400-\u9fff]/.test(translated);
    if (!hasTargetScript && sourceWords.length >= 4 && translatedWords.length >= 4) {
      var normalizedSource = source.toLowerCase().replace(/\s+/g, " ").trim();
      var normalizedTranslation = translated.toLowerCase().replace(/\s+/g, " ").trim();
      if (normalizedTranslation === normalizedSource || translatedWords.length >= Math.ceil(sourceWords.length * 0.75)) return "invalid_translation_source_language_unchanged";
    }
    var leadingAscii = (translated.match(/^[\x20-\x7e]{8,}/) || [""])[0].trim();
    if (hasTargetScript && leadingAscii && source.toLowerCase().indexOf(leadingAscii.toLowerCase()) === 0 && !/\bet\s+al\.?\s*(?:\d{4})?/i.test(leadingAscii) && /[A-Za-z]{3,}\s+[A-Za-z]{2,}/.test(leadingAscii)) return "invalid_translation_leading_source_carryover";
    var leadingLowercaseFragment = (translated.match(/^([a-z]{4,})(?=[\u3400-\u9fff])/) || [""])[0];
    if (leadingLowercaseFragment && source.toLowerCase().indexOf(leadingLowercaseFragment) === 0 && !/^(?:kbol|lbol|ledd|mbh|agn|jwst|wfc)$/i.test(leadingLowercaseFragment)) return "invalid_translation_leading_source_carryover";
    return "";
  }

  function getInvalidTranslationReason(sourceText, translatedText) {
    var source = String(sourceText || "").trim();
    var translated = String(translatedText || "").trim();
    if (!translated) return "empty_translation";
    if (isPromptLeakTranslation(translated)) return "invalid_translation_prompt_leak";
    var semanticFailure = getTranslationOutputSemanticFailure(source, translated);
    if (semanticFailure) return semanticFailure;
    if (source.length > 0 && source.length <= 24 && translated.length > Math.max(80, source.length * 20)) {
      return "suspicious_translation_length";
    }
    return "";
  }

  function markInvalidTranslationSegment(segment, reason, translatedText) {
    segment.status = "failed";
    segment.translatedText = "";
    segment.error = reason || "invalid_translation";
    segment.invalidTranslationReason = reason || "invalid_translation";
    segment.invalidTranslationDetected = true;
    segment.promptLeakDetected = reason === "invalid_translation_prompt_leak" || isPromptLeakTranslation(translatedText);
  }

  function buildPdfExportResultMessage(result) {
    var summary = result && result.pipelineDebugSummary ? result.pipelineDebugSummary : {};
    var totalPages = Number(summary.totalPages || 0);
    var pagesWithSegments = Number(summary.pagesWithSegments || 0);
    var missingLayouts = Array.isArray(summary.missingPageLayouts) ? summary.missingPageLayouts : [];
    var warningCount = Number(summary.crossPageSegmentCount || 0) +
      Number(summary.oversizedSegmentCount || 0) +
      Number(summary.failedSegmentCount || 0) +
      missingLayouts.length;
    var progressMode = result && result.pipelineConfigSummary && result.pipelineConfigSummary.progressMode ||
      summary.pipelineConfigSummary && summary.pipelineConfigSummary.progressMode ||
      (result && result.pdfTranslationMode === "paper_pdf" || summary.pdfTranslationMode === "paper_pdf" ? "paper" : "simple");
    var progressText = progressMode === "paper"
      ? buildPaperPdfProgress(Object.assign({}, summary, result, { warningCount: warningCount }))
      : buildSimplePdfProgress(Object.assign({}, summary, result));
    var parts = [
      "导出成功：" + result.filePath,
      "模式 " + (result.pipelineLabel || summary.pipelineLabel || (getPdfTranslationModeDef(state.pdfTranslationMode) || {}).label || "未指定"),
      progressText,
      "待翻译正文 " + Number(result.pendingTranslatableSegments || summary.pendingTranslatableSegments || 0),
      "页覆盖 " + pagesWithSegments + "/" + totalPages,
      "警告 " + warningCount,
    ];
    if (result.partialRegressionMode) {
      parts.push("40%回归模式，pending不计失败");
    }
    if (Number(result.promptLeakCount || summary.promptLeakCount || 0) > 0) {
      parts.push("已拦截疑似提示词泄漏 " + Number(result.promptLeakCount || summary.promptLeakCount || 0));
    }
    if (result.segmentReportsPath) parts.push("分析报告 " + result.segmentReportsPath);
    if (result.pipelineDebugPath) parts.push("调试 " + result.pipelineDebugPath);
    if (result.sidecarWriteStatus === 'fail') parts.push("⚠ JSON调试文件写入失败：" + (result.sidecarWriteError || '未知错误'));
    if (warningCount > 0 || (totalPages && pagesWithSegments < totalPages) || missingLayouts.length) {
      parts.push("导出完成但存在结构识别警告，请查看 pipelineDebug.json");
    }
    return parts.join(" · ");
  }

  function updatePdfExportButton() {
    var exportBtn = document.getElementById("btnExportPdfTranslation");
    if (!exportBtn) return;
    exportBtn.disabled = !state.pdfTranslationMode || (!hasTranslatedPdfSegments() && !state.segments.length) || state.pdfTranslating;
    updatePdfModeStepLabels();
  }

  function ensurePdfModeSelector() {
    return document.getElementById("pdfEntryView");
  }

  function renderPdfModeSelector() {
    var mode = state.pdfTranslationMode;
    var def = getPdfTranslationModeDef(mode);
    var entry = document.getElementById("pdfEntryView");
    var work = document.getElementById("pdfWorkView");
    if (entry) entry.classList.toggle("hidden", Boolean(def));
    if (work) {
      work.classList.toggle("hidden", !def);
      work.setAttribute("aria-hidden", def ? "false" : "true");
    }
    var title = document.getElementById("pdfWorkTitle");
    var subtitle = document.getElementById("pdfWorkSubtitle");
    if (title) title.textContent = def ? def.title : "PDF 翻译";
    if (subtitle) subtitle.textContent = def ? def.summary : "按步骤完成翻译与导出。";
    renderPdfRecentJobs();
    updatePdfModeStepLabels();
  }

  function readPdfRecentJobs() {
    try {
      var parsed = JSON.parse(localStorage.getItem("lingoflow.pdfRecentJobs") || "[]");
      return Array.isArray(parsed) ? parsed.slice(0, 3) : [];
    } catch (_err) { return []; }
  }

  function writePdfRecentJob(status, outputPath) {
    var fileName = state.pdfExtract && state.pdfExtract.fileName || state.selectedFile && state.selectedFile.fileName;
    if (!fileName) return;
    var jobs = readPdfRecentJobs();
    var id = String(state.pdfCurrentFileId || fileName);
    var next = { id: id, date: new Date().toISOString(), fileName: fileName, status: status || "处理中" };
    var existing = jobs.findIndex(function (job) { return String(job.id || "") === id; });
    if (existing >= 0) jobs.splice(existing, 1);
    jobs.unshift(next);
    localStorage.setItem("lingoflow.pdfRecentJobs", JSON.stringify(jobs.slice(0, 3)));
    if (outputPath) state.lastPdfOutputPath = outputPath;
    renderPdfRecentJobs();
  }

  function renderPdfRecentJobs() {
    var list = document.getElementById("pdfRecentList");
    if (!list) return;
    var jobs = readPdfRecentJobs();
    if (!jobs.length) {
      list.innerHTML = '<div class="pdf-recent-empty">尚无工作记录</div>';
      return;
    }
    list.innerHTML = jobs.map(function (job) {
      var date = new Date(job.date);
      var label = Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
      return '<div class="pdf-recent-row"><time>' + escapePdfHistoryHtml(label) + '</time><span title="' + escapePdfHistoryHtml(job.fileName) + '">' + escapePdfHistoryHtml(job.fileName) + '</span><strong>' + escapePdfHistoryHtml(job.status) + '</strong></div>';
    }).join("");
  }

  function escapePdfHistoryHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  function getPdfModeFileMetaText(def) {
    if (state.pdfTranslating) return "正在翻译：" + getPdfTranslateProgressText(state.progress && state.progress.current);
    if (state.pdfExtract && state.pdfExtract.fileName) {
      return state.pdfExtract.fileName + " · " + formatPdfCountSummary(getPdfTextCounts(state.pdfExtract, state.segments));
    }
    if (state.selectedFile && state.selectedFile.fileName) {
      var size = formatFileSize(state.selectedFile.fileSize || state.selectedFile.size);
      return state.selectedFile.fileName + (size ? " · " + size : "") + " · 尚未提取";
    }
    return (def && def.selectedHint ? def.selectedHint : "请选择 PDF 文件。");
  }

  function selectPdfTranslationMode(mode) {
    if (!isValidPdfTranslationMode(mode)) return;
    state.pdfTranslationMode = mode;
    state.modeLockedByUser = true;
    state.lastPdfOutputPath = "";
    renderPdfModeSelector();
    setPdfWorkflowState(state.extractedText ? "extracted" : "idle", state.pdfExtract || state.selectedFile);
  }

  function resetPdfTranslationMode() {
    var hasActivePdf = Boolean(state.pdfExtract || state.selectedFile || state.extractedText || state.segments.length || state.pdfTranslating);
    if (hasActivePdf && !window.confirm("重新选择模式会清空当前 PDF 处理状态，是否继续？")) return;
    state.pdfTranslationMode = null;
    state.modeLockedByUser = false;
    resetPdfDocumentState(null);
    setPdfWorkflowState("idle");
    renderPdfModeSelector();
  }

  function buildTranslatedTxtContent() {
    var fileName = state.pdfExtract && state.pdfExtract.fileName ? state.pdfExtract.fileName : state.selectedFile && state.selectedFile.fileName ? state.selectedFile.fileName : "unknown.pdf";
    var translatedSegments = getTranslatedPdfSegmentEntries();
    var failedCount = state.segments.filter(function (segment) {
      return segment.status === "failed";
    }).length;
    var lines = [
      "文件名：" + fileName,
      "目标语言：" + getPdfLangLabel(state.pdfTargetLang),
      "总段落：" + state.segments.length,
      "已翻译：" + translatedSegments.length,
      "失败：" + failedCount,
      "",
    ];
    translatedSegments.forEach(function (entry) {
      lines.push("【段落 " + (entry.index + 1) + "】");
      lines.push(String(entry.segment.translatedText || "").trim());
      lines.push("");
    });
    return lines.join("\r\n");
  }

  function buildTranslatedDocxPayload() {
    return Object.assign({
      fileName: state.pdfExtract && state.pdfExtract.fileName ? state.pdfExtract.fileName : state.selectedFile && state.selectedFile.fileName ? state.selectedFile.fileName : "pdf.pdf",
      paragraphs: getTranslatedPdfSegmentEntries().map(function (entry) {
        return String(entry.segment.translatedText || "").trim();
      }),
    }, getPdfTranslationModePayload());
  }

  function buildTranslatedPdfPayload(options) {
    function serializeSimplePdfSegment(segment) {
      return assertSerializedSimplePdfSegmentClean({
        id: segment.id,
        segmentIdentity: segment.segmentIdentity && typeof segment.segmentIdentity === "object"
          ? JSON.parse(JSON.stringify(segment.segmentIdentity))
          : null,
        pageNumber: segment.pageNumber,
        type: segment.type,
        sourceText: String(segment.sourceText || ""),
        targetLanguage: state.pdfTargetLang,
        sourcePageRange: Array.isArray(segment.sourcePageRange) ? segment.sourcePageRange : [segment.firstLinePageNumber || segment.pageNumber || 0, segment.lastLinePageNumber || segment.pageNumber || 0],
        sourceLineRange: Array.isArray(segment.sourceLineRange) ? segment.sourceLineRange : [],
        firstLinePageNumber: segment.firstLinePageNumber || segment.pageNumber,
        lastLinePageNumber: segment.lastLinePageNumber || segment.pageNumber,
        crossedPageBoundary: Boolean(segment.crossedPageBoundary),
        mergeReason: segment.mergeReason || "",
        status: segment.status,
        translatedText: String(segment.translatedText || "").trim(),
        pdfTranslationMode: state.pdfTranslationMode,
      });
    }
    function serializePdfSegment(segment) {
      return {
        id: segment.id,
        segmentIdentity: segment.segmentIdentity && typeof segment.segmentIdentity === "object"
          ? JSON.parse(JSON.stringify(segment.segmentIdentity))
          : null,
        pageNumber: segment.pageNumber,
        type: segment.type,
        bbox: segment.bbox,
        sourceText: String(segment.sourceText || ""),
        column: segment.column || "single",
        layoutType: segment.layoutType || "single_column",
        sourceLanguageHint: segment.sourceLanguageHint || "",
        targetLanguage: state.pdfTargetLang,
        lines: Array.isArray(segment.lines) ? segment.lines : [],
        lineBoxes: Array.isArray(segment.lineBoxes) ? segment.lineBoxes : [],
        sourceLineNumbers: Array.isArray(segment.sourceLineNumbers) ? segment.sourceLineNumbers : [],
        firstLinePageNumber: segment.firstLinePageNumber || segment.pageNumber,
        lastLinePageNumber: segment.lastLinePageNumber || segment.pageNumber,
        crossedPageBoundary: Boolean(segment.crossedPageBoundary),
        crossedColumnBoundary: Boolean(segment.crossedColumnBoundary),
        mergeReason: segment.mergeReason || segment.splitReason || "",
        classificationReason: segment.classificationReason || requireCanonicalSemanticType(segment, "PDF export payload classification evidence"),
        previousSegmentId: segment.previousSegmentId || "",
        nextSegmentId: segment.nextSegmentId || "",
        partialRegressionNotTranslated: Boolean(segment.partialRegressionNotTranslated),
        promptLeakDetected: Boolean(segment.promptLeakDetected),
        invalidTranslationDetected: Boolean(segment.invalidTranslationDetected),
        invalidTranslationReason: segment.invalidTranslationReason || "",
        citationTokenProtectedCount: Number(segment.citationTokenProtectedCount || 0),
        citationTokenRestoreFailedCount: Number(segment.citationTokenRestoreFailedCount || 0),
        citationNameMutationRiskCount: Number(segment.citationNameMutationRiskCount || 0),
        citationTokenRestoreFailedExamples: Array.isArray(segment.citationTokenRestoreFailedExamples) ? segment.citationTokenRestoreFailedExamples : [],
        error: segment.error || "",
        skipReason: segment.skipReason || segment.reportSkipReason || "",
        status: segment.status,
        pdfTranslationMode: state.pdfTranslationMode,
        translatedText: String(segment.translatedText || "").trim(),
        captionBodyOwnershipArtifact: segment.captionBodyOwnershipArtifact && typeof segment.captionBodyOwnershipArtifact === "object"
          ? JSON.parse(JSON.stringify(segment.captionBodyOwnershipArtifact))
          : null,
        captionRegionArtifact: segment.captionRegionArtifact && typeof segment.captionRegionArtifact === "object"
          ? JSON.parse(JSON.stringify(segment.captionRegionArtifact))
          : null,
        captionGroupArtifact: segment.captionGroupArtifact && typeof segment.captionGroupArtifact === "object"
          ? JSON.parse(JSON.stringify(segment.captionGroupArtifact))
          : null,
        finalCaptionSource: segment.finalCaptionSource && typeof segment.finalCaptionSource === "object"
          ? JSON.parse(JSON.stringify(segment.finalCaptionSource))
          : null,
        captionGroupTranslationArtifact: segment.captionGroupTranslationArtifact && typeof segment.captionGroupTranslationArtifact === "object"
          ? JSON.parse(JSON.stringify(segment.captionGroupTranslationArtifact))
          : null,
        captionDisplayArtifact: segment.captionDisplayArtifact && typeof segment.captionDisplayArtifact === "object"
          ? JSON.parse(JSON.stringify(segment.captionDisplayArtifact))
          : null,
        captionGroupRole: segment.captionGroupRole || "",
        captionGroupId: segment.captionGroupId || "",
        captionGroupCanonicalOwnerId: segment.captionGroupCanonicalOwnerId || "",
        translationLifecycleEvents: Array.isArray(segment.translationLifecycleEvents)
          ? segment.translationLifecycleEvents.map(function (event) { return Object.assign({}, event); })
          : [],
      };
    }
   var isSimple = state.pdfTranslationMode === "simple_pdf";
   var payload = Object.assign({
     fileName: state.pdfExtract && state.pdfExtract.fileName ? state.pdfExtract.fileName : state.selectedFile && state.selectedFile.fileName ? state.selectedFile.fileName : "pdf.pdf",
     filePath: state.pdfExtract && state.pdfExtract.filePath ? state.pdfExtract.filePath : "",
     targetLanguage: state.pdfTargetLang,
     partialRegressionMode: Boolean(state.pdfPartialRegressionMode),
     partialTranslateRatio: Number(state.pdfPartialTranslateRatio || 0),
     pipelineDebug: state.pdfExtract && state.pdfExtract.pipelineDebug ? state.pdfExtract.pipelineDebug : null,
     semanticStructureArtifact: state.semanticStructureArtifact,
     semanticStructureConsumerReports: state.semanticStructureConsumerReports.slice(),
     exportStrategy: isSimple ? "document_flow" : "overlay",
     simpleBlocks: isSimple ? getSimplePdfTranslatedEntries().map(function (entry) {
       return serializeSimplePdfSegment(entry.segment);
     }) : [],
     segments: isSimple ? getSimplePdfTranslatedEntries().map(function (entry) {
       return serializeSimplePdfSegment(entry.segment);
     }) : getPaperOverlaySegmentEntriesStrict().map(function (entry) {
       return serializePdfSegment(entry.segment);
     }),
     allSegments: state.segments.map(isSimple ? serializeSimplePdfSegment : serializePdfSegment),
   }, getPdfTranslationModePayload());
   // debugFailExport is a paper_pdf-only dev inspection flag — never attach it (or its
   // allowLayoutPlanDebugFailExport companion) to a simple_pdf payload, which has its own strict
   // field whitelist enforced by assertSimplePdfPayloadClean below.
   if (!isSimple && options && options.debugFailExport) {
     payload.debugFailExport = true;
     payload.allowLayoutPlanDebugFailExport = true;
   }
   return isSimple ? assertSimplePdfPayloadClean(payload) : payload;
 }

  function buildPdfDiagnosticPayload() {
    var diagnosticSegments = state.segments.map(function (segment) {
      return {
        id: segment.id,
        segmentIdentity: segment.segmentIdentity && typeof segment.segmentIdentity === "object"
          ? JSON.parse(JSON.stringify(segment.segmentIdentity))
          : null,
        pageNumber: segment.pageNumber,
        type: segment.type,
        sourceText: String(segment.sourceText || ""),
        sourcePageRange: Array.isArray(segment.sourcePageRange) ? segment.sourcePageRange : [segment.firstLinePageNumber || segment.pageNumber || 0, segment.lastLinePageNumber || segment.pageNumber || 0],
        sourceLineRange: Array.isArray(segment.sourceLineRange) ? segment.sourceLineRange : [],
        bbox: segment.bbox,
        lines: Array.isArray(segment.lines) ? segment.lines : [],
        lineBoxes: Array.isArray(segment.lineBoxes) ? segment.lineBoxes : [],
        status: segment.status,
        pdfTranslationMode: state.pdfTranslationMode,
        translatedText: String(segment.translatedText || "").trim(),
      };
    });
    return Object.assign({
      fileName: state.pdfExtract && state.pdfExtract.fileName ? state.pdfExtract.fileName : state.selectedFile && state.selectedFile.fileName ? state.selectedFile.fileName : "pdf.pdf",
      filePath: state.pdfExtract && state.pdfExtract.filePath ? state.pdfExtract.filePath : "",
      segments: diagnosticSegments,
      allSegments: diagnosticSegments.map(function (segment) { return Object.assign({}, segment); }),
      semanticStructureArtifact: state.semanticStructureArtifact,
      semanticStructureConsumerReports: state.semanticStructureConsumerReports.slice(),
    }, getPdfTranslationModePayload());
  }

  function getPdfExportIncompleteCount() {
    return state.segments.filter(function (segment) {
      return isPaperOverlayCandidateStrict(segment) &&
        !(segment.status === "done" && segment.translatedText && String(segment.translatedText).trim());
    }).length;
  }

  // Single cleanup point for every PDF-export overlay: removes any dynamically created
  // .pdf-export-modal (e.g. the one chooseIncompletePdfExportAction() builds) and hides the
  // static #pdfExportModal in place (never removes it from the DOM — it's reused on every export
  // click). Also clears any body-level lock styles a stuck modal could leave behind. A residual
  // full-viewport modal (position:fixed; inset:0) sits on top of .electron-titlebar-drag without
  // its own app-region:drag, which is exactly what makes the frameless window stop being
  // draggable — so this must run on every export exit path, not just the happy path.
  function cleanupPdfExportTransientModals() {
    document.querySelectorAll(".pdf-export-modal").forEach(function (node) {
      if (node.id === "pdfExportModal") {
        node.classList.add("hidden");
        node.setAttribute("aria-hidden", "true");
        return;
      }
      if (node.parentNode) node.parentNode.removeChild(node);
    });
    document.body.classList.remove("modal-open", "pdf-export-modal-open");
    document.body.style.pointerEvents = "";
    document.body.style.overflow = "";
  }

  function chooseIncompletePdfExportAction(counts) {
    cleanupPdfExportTransientModals();
    return new Promise(function (resolve) {
      var modal = document.createElement("div");
      modal.className = "pdf-export-modal";
      modal.setAttribute("aria-hidden", "false");
      modal.innerHTML = [
        '<div class="pdf-export-dialog pdf-incomplete-dialog" role="dialog" aria-modal="true">',
        '<div class="pdf-export-dialog-head">',
        '<div><h3>PDF 尚未全部翻译</h3>',
        '<p>请选择导出前的处理方式。</p></div>',
        '<button type="button" class="icon-button" data-action="cancel" aria-label="关闭">×</button>',
        '</div>',
        '<div class="pdf-export-warning">',
        '<div>总段落：' + counts.totalSegments + '</div>',
        '<div>已翻译：' + counts.doneSegments + '</div>',
        '<div>未翻译：' + counts.pendingSegments + '</div>',
        '<div>失败：' + counts.failedSegments + '</div>',
        '</div>',
        '<div class="pdf-export-options">',
        '<button type="button" class="pdf-export-option" data-action="continue"><span>继续翻译剩余段落</span></button>',
        '<button type="button" class="pdf-export-option" data-action="partial"><span>仅导出已翻译部分</span></button>',
        '<button type="button" class="pdf-export-option" data-action="cancel"><span>取消</span></button>',
        '</div>',
        '</div>',
      ].join("");

      function finish(action) {
        if (modal.parentNode) modal.parentNode.removeChild(modal);
        cleanupPdfExportTransientModals();
        resolve(action || "cancel");
      }

      modal.addEventListener("click", function (event) {
        if (event.target === modal) {
          finish("cancel");
          return;
        }
        var button = event.target.closest && event.target.closest("[data-action]");
        if (button) finish(button.getAttribute("data-action"));
      });
      document.body.appendChild(modal);
    });
  }

  function closePdfExportModal() {
    cleanupPdfExportTransientModals();
  }

  function openPdfExportModal() {
    if (!state.segments.length) {
      var emptyMessage = "暂无可导出的 PDF 分段，请先提取 PDF。";
      var emptyMetaEl = document.getElementById("pdfFileMeta");
      if (emptyMetaEl) emptyMetaEl.textContent = emptyMessage;
      window.alert(emptyMessage);
      return;
    }
    var modal = document.getElementById("pdfExportModal");
    var warning = document.getElementById("pdfExportModalWarning");
    var meta = document.getElementById("pdfExportModalMeta");
    if (state.pdfTranslationMode === "simple_pdf") {
      var simpleCounts = getSimplePdfTranslationCompleteness();
      if (warning) warning.classList.toggle("hidden", hasTranslatedSimplePdfSegments() && simpleCounts.doneSegments >= simpleCounts.totalSegments);
      if (meta) meta.textContent = hasTranslatedSimplePdfSegments()
        ? "将导出已翻译完成的 " + getSimplePdfTranslatedEntries().length + " 个普通文档段落。"
        : "暂无可导出的已翻译普通文档段落，请先完成至少一段翻译。";
    } else {
      if (warning) warning.classList.toggle("hidden", hasTranslatedPdfOverlaySegments() && getPaperExportCompletenessStrict().doneSegments >= getPaperExportCompletenessStrict().totalSegments);
      if (meta) meta.textContent = hasTranslatedPdfOverlaySegments()
        ? "只导出已翻译完成的 " + getPaperOverlaySegmentEntriesStrict().length + " 个 PDF 回填段落。"
        : "暂无可导出的已翻译 PDF 段落，请先完成至少一段翻译。";
    }
    var debugFailBtn = document.getElementById("btnExportPdfDebugFail");
    if (debugFailBtn) debugFailBtn.classList.toggle("hidden", state.pdfTranslationMode === "simple_pdf");
    if (!modal) return;
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
  }

  async function exportPdfTranslationByFormat(format) {
    cleanupPdfExportTransientModals();
    try {
      var isDebugFailFormat = format === "pdf_debug_fail";
      var modeMessage = requirePdfTranslationModeMessage();
      if (modeMessage) {
        var modeMetaEl = document.getElementById("pdfFileMeta");
        if (modeMetaEl) modeMetaEl.textContent = modeMessage;
        window.alert(modeMessage);
        return;
      }
      var isDiagnosticFormat = format === "debug_linebox" || format === "debug_mask_area" || format === "mask_linebox_test";
      if (!isDiagnosticFormat && !isDebugFailFormat && format !== "pdf" && !hasTranslatedPdfSegments()) {
        var emptyMessage = "暂无已翻译内容，请先完成至少一段翻译。";
        var emptyMetaEl = document.getElementById("pdfFileMeta");
        if (emptyMetaEl) emptyMetaEl.textContent = emptyMessage;
        window.alert(emptyMessage);
        return;
      }
      if (isDiagnosticFormat && !state.segments.length) {
        var noSegmentMessage = "暂无可导出的 PDF 分段，请先提取 PDF。";
        var noSegmentMetaEl = document.getElementById("pdfFileMeta");
        if (noSegmentMetaEl) noSegmentMetaEl.textContent = noSegmentMessage;
        window.alert(noSegmentMessage);
        return;
      }
      if (isDebugFailFormat) {
        // debugFail is a paper_pdf-only dev inspection path: it must never pop the normal
        // "继续翻译 / 仅导出已翻译部分 / 取消" incomplete-translation dialog, and it must not
        // require every translatable segment to already be done — that's exactly the gate that
        // blocks debugging an in-progress or layoutPlan-failing export. It only needs *something*
        // (a translated overlay segment, or at least extracted segments) to build a report from.
        if (state.pdfTranslationMode === "simple_pdf") {
          var noDebugSimpleMessage = "调试失败样本导出仅适用于论文版（paper_pdf）。";
          var noDebugSimpleMetaEl = document.getElementById("pdfFileMeta");
          if (noDebugSimpleMetaEl) noDebugSimpleMetaEl.textContent = noDebugSimpleMessage;
          window.alert(noDebugSimpleMessage);
          return;
        }
        if (!hasTranslatedPdfOverlaySegments() && !state.segments.length) {
          var noDebugSegMessage = "暂无可用于调试导出的 PDF 段落，请先提取 PDF。";
          var noDebugSegMetaEl = document.getElementById("pdfFileMeta");
          if (noDebugSegMetaEl) noDebugSegMetaEl.textContent = noDebugSegMessage;
          window.alert(noDebugSegMessage);
          return;
        }
      } else if (format === "pdf") {
        if (state.pdfTranslationMode === "simple_pdf") {
          if (!hasTranslatedSimplePdfSegments()) {
            var noSimpleTranslatedMessage = "暂无可导出的已翻译普通文档段落，请先完成至少一段翻译。";
            var noSimpleTranslatedMetaEl = document.getElementById("pdfFileMeta");
            if (noSimpleTranslatedMetaEl) noSimpleTranslatedMetaEl.textContent = noSimpleTranslatedMessage;
            window.alert(noSimpleTranslatedMessage);
            return;
          }
          var simpleCounts = getSimplePdfTranslationCompleteness();
          if (simpleCounts.doneSegments < simpleCounts.totalSegments) {
            var simpleAction = await chooseIncompletePdfExportAction(simpleCounts);
            if (simpleAction === "cancel") return;
            if (simpleAction === "continue") {
              closePdfExportModal();
              var simpleFinished = await startPdfSegmentTranslation({ onlyRemaining: true });
              if (!simpleFinished || !hasTranslatedSimplePdfSegments()) {
                var simpleTranslateFailMessage = "暂无可导出的已翻译普通文档段落，请先完成至少一段翻译。";
                var simpleTranslateFailMetaEl = document.getElementById("pdfFileMeta");
                if (simpleTranslateFailMetaEl) simpleTranslateFailMetaEl.textContent = simpleTranslateFailMessage;
                window.alert(simpleTranslateFailMessage);
                return;
              }
            }
          }
        } else {
        if (!hasTranslatedPdfOverlaySegments()) {
          var noPdfTranslatedMessage = "暂无可导出的已翻译 PDF 段落，请先完成至少一段翻译。";
          var noPdfTranslatedMetaEl = document.getElementById("pdfFileMeta");
          if (noPdfTranslatedMetaEl) noPdfTranslatedMetaEl.textContent = noPdfTranslatedMessage;
          window.alert(noPdfTranslatedMessage);
          return;
        }
        var counts = getPaperExportCompletenessStrict();
        if (counts.doneSegments < counts.totalSegments) {
          var action = await chooseIncompletePdfExportAction(counts);
          if (action === "cancel") return;
          if (action === "continue") {
            closePdfExportModal();
            var finished = await startPdfSegmentTranslation({ onlyRemaining: true });
            if (!finished || !hasTranslatedPdfSegments()) {
              var translateFailMessage = "暂无可导出的已翻译段落，请先完成至少一段翻译。";
              var translateFailMetaEl = document.getElementById("pdfFileMeta");
              if (translateFailMetaEl) translateFailMetaEl.textContent = translateFailMessage;
              window.alert(translateFailMessage);
              return;
            }
          } else if (action === "partial" && counts.bodyHeadingNotDone > 0) {
            var confirmed = window.confirm(
              "论文正文尚有 " + counts.bodyHeadingNotDone + " 段（正文段落 / 小节标题）未翻译。\n" +
              "选择「仅导出已翻译部分」后，这些段落将在输出 PDF 中保留原始英文，不会被遮盖或替换。\n\n" +
              "确认继续导出吗？"
            );
            if (!confirmed) return;
          }
        }
        }
      }
      closePdfExportModal();
      var ipc = getElectronIpc();
      var fileMetaEl = document.getElementById("pdfFileMeta");
      var content = buildTranslatedTxtContent();
      var fileName = state.pdfExtract && state.pdfExtract.fileName ? state.pdfExtract.fileName : state.selectedFile && state.selectedFile.fileName ? state.selectedFile.fileName : "pdf.pdf";
      try {
        if (!ipc) {
          if (fileMetaEl) fileMetaEl.textContent = "当前环境不支持保存文件，请在 Electron 中运行。";
          return;
        }
        var result;
        if (format === "docx") {
          result = await ipc.invoke("pdf:export-translated-docx", buildTranslatedDocxPayload());
        } else if (format === "pdf" || isDebugFailFormat) {
          // Same IPC channel as the normal export — main.js distinguishes the request via the
          // debugFailExport/allowLayoutPlanDebugFailExport payload flags, not a separate channel.
          var pdfPayload = buildTranslatedPdfPayload({ debugFailExport: isDebugFailFormat });
          result = await ipc.invoke("pdf:export-translated-pdf", pdfPayload);
        } else if (format === "debug_bbox") {
          result = await ipc.invoke("pdf:export-debug-bbox", buildPdfDiagnosticPayload());
        } else if (format === "mask_test") {
          result = await ipc.invoke("pdf:export-mask-test", buildPdfDiagnosticPayload());
        } else if (format === "debug_linebox") {
          result = await ipc.invoke("pdf:export-debug-linebox", buildPdfDiagnosticPayload());
        } else if (format === "debug_mask_area") {
          result = await ipc.invoke("pdf:export-debug-mask-area", buildPdfDiagnosticPayload());
        } else if (format === "mask_linebox_test") {
          result = await ipc.invoke("pdf:export-mask-linebox-test", buildPdfDiagnosticPayload());
        } else {
          result = await ipc.invoke("pdf:export-translated-txt", Object.assign({ fileName: fileName, content: content }, getPdfTranslationModePayload()));
        }
        if (isDebugFailFormat && result && result.ok) {
          // Explicit debugFail request that completed: main.js returns ok:true + debugFailExport:true.
          // Two sub-cases:
          //   manualOrPartialExportDebug=true → partial visual debug (translation incomplete, ops
          //     were executed for done segments, [PENDING] markers drawn for the rest)
          //   manualOrPartialExportDebug falsy → formal blocked debug (translation complete but
          //     layoutPlan failed, no masks/writes applied, original PDF content preserved)
          if (fileMetaEl) {
            var _paths = result.filePath +
              (result.segmentReportsPath ? " · 分析报告：" + result.segmentReportsPath : "") +
              (result.pipelineDebugPath ? " · 调试：" + result.pipelineDebugPath : "");
            var _sidecarNote = result.sidecarWriteStatus === 'fail' ? "（⚠ JSON写入失败：" + (result.sidecarWriteError || '未知') + "）" : "";
            if (result.manualOrPartialExportDebug) {
              var _written = result.debugFailVisualWriteAppliedCount || 0;
              var _pending = result.debugFailVisualPendingMarkedCount || 0;
              var _translated = result.translatedSegments || 0;
              var _total = result.translatableSegments || 0;
              fileMetaEl.textContent = "翻译未完成（已翻译 " + _translated + "/" + _total + " 段）—— 已生成可视化调试 PDF：" +
                _paths + _sidecarNote + "（执行了 " + _written + " 段写入，标注了 " + _pending + " 个 [PENDING] 段落，未生成正式译文 PDF）";
            } else {
              fileMetaEl.textContent = "论文版 layoutPlan 未通过校验，未执行遮罩写入。已生成调试失败样本：" +
                _paths + _sidecarNote + "（内容不完整，仅供调试查看，未生成正式译文 PDF）";
            }
          }
        } else if (result && result.ok) {
          if (format === "pdf") {
            if (fileMetaEl) fileMetaEl.textContent = buildPdfExportResultMessage(result);
            state.lastPdfOutputPath = String(result.filePath || "");
            writePdfRecentJob("已导出", state.lastPdfOutputPath);
            var openOutputBtn = document.getElementById("btnOpenPdfOutput");
            if (openOutputBtn) openOutputBtn.disabled = !state.lastPdfOutputPath;
          } else if (format === "debug_bbox") {
            if (fileMetaEl) fileMetaEl.textContent = "BBox 调试 PDF：" + result.filePath + " · 标注 " + (result.boxedCount || 0) + " 段";
          } else if (format === "mask_test") {
            if (fileMetaEl) fileMetaEl.textContent = "遮罩测试 PDF：" + result.filePath + " · 覆盖 " + (result.maskedCount || 0) + " 段 / " + (result.lineCount || 0) + " 行";
          } else if (format === "debug_linebox") {
            if (fileMetaEl) fileMetaEl.textContent = "LineBox 调试 PDF：" + result.filePath + " · 标注 " + (result.lineCount || 0) + " 行";
          } else if (format === "debug_mask_area") {
            if (fileMetaEl) fileMetaEl.textContent = "遮罩区域调试 PDF：" + result.filePath + " · 总 " + (result.totalLineBoxes || 0) + " 行 · 遮罩 " + (result.maskedLineBoxes || 0) + " 行 · 跳过 " + (result.skippedLineBoxes || 0) + " 行 · 公式 " + (result.formulaLikeLineBoxes || 0) + " 行 · 均值 " + (result.averageFontSize || 0);
          } else if (format === "mask_linebox_test") {
            if (fileMetaEl) fileMetaEl.textContent = "LineBox 遮罩测试 PDF：" + result.filePath + " · 总 " + (result.totalLineBoxes || 0) + " 行 · 遮罩 " + (result.maskedLineBoxes || 0) + " 行 · 跳过 " + (result.skippedLineBoxes || 0) + " 行 · 公式 " + (result.formulaLikeLineBoxes || 0) + " 行 · 均值 " + (result.averageFontSize || 0);
          } else if (fileMetaEl) {
            fileMetaEl.textContent = "导出成功：" + result.filePath;
          }
        } else if (result && result.canceled) {
          if (fileMetaEl) fileMetaEl.textContent = "已取消导出。";
        } else if (format === "pdf" && result && result.layoutPlanDebugFail) {
          // The normal xxx_translated.pdf is intentionally withheld when the paper layoutPlan gate
          // fails on the *unflagged* "pdf" request (result.ok === false here) — but the export
          // pipeline still wrote a debugFail PDF plus its two JSON sidecars to disk under the same
          // path with a _debugFail suffix. Without this branch the generic "导出失败" message below
          // hid that real output, making it look like nothing was produced at all.
          if (fileMetaEl) {
            var _failPaths = result.filePath +
              (result.segmentReportsPath ? " · 分析报告：" + result.segmentReportsPath : "") +
              (result.pipelineDebugPath ? " · 调试：" + result.pipelineDebugPath : "");
            var _failSidecarNote = result.sidecarWriteStatus === 'fail' ? "（⚠ JSON写入失败：" + (result.sidecarWriteError || '未知') + "）" : "";
            fileMetaEl.textContent = "论文版 layoutPlan 未通过校验，未生成正式 xxx_translated.pdf。" +
              "已生成调试失败样本：" + _failPaths + _failSidecarNote + "（内容不完整，仅供调试查看）";
          }
        } else if (result && result.filePath) {
          // Export failed but a PDF (or debugFail PDF) was written — show all available paths
          // so the user can find the output and JSON sidecars.
          var _errPaths = result.filePath +
            (result.segmentReportsPath ? " · 分析报告：" + result.segmentReportsPath : "") +
            (result.pipelineDebugPath ? " · 调试：" + result.pipelineDebugPath : "");
          var _errSidecarNote = (result.sidecarWriteStatus && result.sidecarWriteStatus !== 'pass' && result.sidecarWriteStatus !== 'fallback_pass')
            ? "（⚠ JSON:" + (result.sidecarWriteError || result.sidecarWriteStatus) + "）" : "";
          if (fileMetaEl) fileMetaEl.textContent = "导出不完整：" + (result.error || "unknown") +
            " · " + _errPaths + _errSidecarNote;
        } else {
          if (fileMetaEl) fileMetaEl.textContent = "导出失败：" + ((result && result.error) || "unknown");
        }
      } catch (err) {
        cleanupPdfExportTransientModals();
        if (fileMetaEl) fileMetaEl.textContent = "导出失败：" + String(err && err.message ? err.message : err);
      }
    } finally {
      cleanupPdfExportTransientModals();
      updatePdfExportButton();
    }
  }

  function getPdfTranslateProgressText(currentIndex) {
    if (state.pdfTranslationMode === "simple_pdf") {
      var simpleCounts = getSimplePdfTranslationCompleteness();
      var simpleTotal = simpleCounts.totalSegments || 0;
      var simpleCurrent = Math.min(simpleTotal, Math.max(0, Number(currentIndex || 0)));
      var simpleCompleted = Math.min(simpleTotal, simpleCounts.doneSegments + simpleCounts.failedSegments);
      var simplePercent = simpleTotal ? Math.round((simpleCompleted / simpleTotal) * 100) : 0;
      return "正文翻译 " + simpleCurrent + " / " + simpleTotal + " · " + simplePercent + "% · 失败 " + simpleCounts.failedSegments;
    }
    var counts = getSegmentStatusCounts();
    var exportCounts = getPaperExportCompletenessStrict();
    var total = exportCounts.totalSegments || counts.total || 0;
    var current = Math.min(total, Math.max(0, Number(currentIndex || 0)));
    var completed = Math.min(total, exportCounts.doneSegments + exportCounts.failedSegments);
    var percentValue = total ? Math.round((completed / total) * 100) : 0;
    if (state.pdfTranslationMode === "paper_pdf") {
      return "正文翻译 " + current + " / " + total + " · " + percentValue + "% · 保留原文 " + state.segments.filter(isPaperPreserveSegmentStrict).length;
    }
    return "正在翻译正文 " + current + " / " + total + " · " + percentValue + "%";
  }

  function extractTranslatedText(data) {
    if (!data) return "";
    if (typeof data === "string") return data;
    if (data.translation) return String(data.translation);
    if (data.translatedText) return String(data.translatedText);
    if (data.trans) return String(data.trans);
    if (data.data) return String(data.data);
    if (data.result) return String(data.result);
    try {
      var choice = data.choices && data.choices[0];
      var content = choice && choice.message && choice.message.content;
      if (content) return String(content);
    } catch (_err) {
      return "";
    }
    return "";
  }

  function normalizeFormulaPlaceholderToken(token) {
    return String(token || "")
      .replace(/\s+/g, " ")
      .replace(/\s*x\s*10\s*\^\s*/gi, "x10^")
      .replace(/\s*\+\/-\s*/g, "+/-")
      .replace(/erg\s*s\s*\^\s*-?\s*1/gi, "erg s^-1")
      .replace(/cm\s*\^\s*-?\s*2/gi, "cm^-2")
      .trim();
  }

  function protectPdfFormulaTokensForTranslation(sourceText) {
    var text = String(sourceText || "");
    var tokens = [];
    [
      /\b\d+(?:\.\d+)?(?:\+\/-\d+(?:\.\d+)?)?\s*x\s*10\s*(?:\^?\s*[-+]?\d+)?(?:\s*erg\s*s(?:\^-?1)?(?:\s*cm(?:\^-?2)?)?)?/gi,
      /\b(?:0\.2-6|2-10)\s*keV\b/g,
      /\berg\s*s\^-1(?:\s*cm\^-2)?\b/g,
      /\b(?:Lbol|kbol|LEdd|MBH|LX|Gamma|M_sun|lambdaEdd|lambda5007)\b/gi,
      /\[O\s*III\]/g,
      /log\s*\([^)]+\)/g,
    ].forEach(function (pattern) {
      text = text.replace(pattern, function (match) {
        var normalized = normalizeFormulaPlaceholderToken(match);
        if (!normalized || normalized.length < 2) return match;
        var existing = tokens.indexOf(normalized);
        var index = existing >= 0 ? existing : tokens.push(normalized) - 1;
        return "__FORMULA_" + index + "__";
      });
    });
    return { text: text, tokens: tokens };
  }

  function restorePdfFormulaPlaceholders(translatedText, tokens) {
    var text = String(translatedText || "");
    tokens.forEach(function (token, index) {
      var pattern = new RegExp("__\\s*FORMULA\\s*_" + index + "\\s*__", "gi");
      text = text.replace(pattern, token);
    });
    return text;
  }

  function normalizeFormulaToken(token) {
    return String(token || "")
      .normalize("NFC")
      .replace(/[\u2212\u2010-\u2015]/g, "-")
      .replace(/\s+/g, " ")
      .replace(/\s*([×x])\s*10\s*\^\s*/g, function (_match, sign) {
        return (sign === "x" ? "x" : "×") + "10^";
      })
      .replace(/\s*([×x])\s*10\s+/g, function (_match, sign) {
        return (sign === "x" ? "x" : "×") + "10";
      })
      .replace(/\s*\^\s*/g, "^")
      .replace(/\s*±\s*/g, "±")
      .replace(/\s*≈\s*/g, "≈")
      .replace(/\s*-\s*/g, "-")
      .replace(/erg\s*s\s*\^\s*-?\s*1/gi, "erg s^-1")
      .replace(/cm\s*\^\s*-?\s*2/gi, "cm^-2")
      .replace(/erg\s*\/\s*s/gi, "erg s^-1")
      .replace(/L\s*bol/gi, "Lbol")
      .replace(/L\s*Edd/gi, "LEdd")
      .replace(/M\s*BH/gi, "MBH")
      .replace(/L\s*X/gi, "LX")
      .replace(/\[\s*O\s*III\s*\]/gi, "[O III]")
      .replace(/M\s*⊙/g, "M⊙")
      .trim();
  }

  function addFormulaToken(tokens, match) {
    var normalized = normalizeFormulaToken(match);
    if (!normalized || normalized.length < 2) return;
    if (tokens.some(function (token) { return token.normalized === normalized; })) return;
    tokens.push({ raw: String(match || ""), normalized: normalized });
  }

  function buildProtectedFormulaTokens(segmentOrText) {
    var source = typeof segmentOrText === "string"
      ? segmentOrText
      : String(segmentOrText && (segmentOrText.sourceText || segmentOrText.text) || "");
    var tokens = [];
    [
      /\b\d+(?:\.\d+)?(?:\+\/-\d+(?:\.\d+)?)?\s*x\s*10\s*\^-?\d+(?:\s*erg\s*s\^-1(?:\s*cm\^-2)?)?/gi,
      /\b\d+(?:\.\d+)?(?:\+\/-\d+(?:\.\d+)?)?\s*x\s*10\^-?\d+/gi,
      /\berg\s*s\^-1(?:\s*cm\^-2)?\b/gi,
      /\b(?:0\.2-6|2-10)\s*keV\b/gi,
      /\b(?:Lbol|kbol|LEdd|MBH|LX|Gamma|M_sun|lambdaEdd|lambda5007)\b/gi,
      /\[O\s*III\]/gi,
      /log\s*\([^)]+\)/gi,
      /Lbol\s*(?:approx|~|=)\s*3500\s*L\s*\[O\s*III\]/gi,
      /LEdd\s*(?:approx|=)\s*1\.26\s*x\s*10\^38\s*\(\s*MBH\s*\/\s*M_sun\s*\)/gi,
    ].forEach(function (pattern) {
      var matches = source.match(pattern) || [];
      matches.forEach(function (match) { addFormulaToken(tokens, match); });
    });
    return tokens;
  }

  function replaceFormulaTokensBeforeTranslate(text, tokens) {
    var protectedText = String(text || "");
    tokens.forEach(function (token, index) {
      var raw = token.raw || token.normalized;
      if (!raw) return;
      protectedText = protectedText.split(raw).join("__FORMULA_" + index + "__");
      if (raw !== token.normalized) {
        protectedText = protectedText.split(token.normalized).join("__FORMULA_" + index + "__");
      }
    });
    return protectedText;
  }

  function restoreFormulaTokensAfterTranslate(translatedText, tokens) {
    var text = String(translatedText || "");
    var failed = [];
    tokens.forEach(function (token, index) {
      var pattern = new RegExp("__\\s*FORMULA\\s*_" + index + "\\s*__", "gi");
      var before = text;
      text = text.replace(pattern, token.normalized);
      if (before === text && text.indexOf(token.normalized) < 0) failed.push(token.normalized);
    });
    if (failed.length) {
      console.warn("[LINGOFLOW][FORMULA TOKEN RESTORE FAILED]", failed);
    }
    return text;
  }

  function protectPdfFormulaTokensForTranslation(sourceText) {
    var tokens = buildProtectedFormulaTokens(sourceText);
    return { text: replaceFormulaTokensBeforeTranslate(sourceText, tokens), tokens: tokens };
  }

  function restorePdfFormulaPlaceholders(translatedText, tokens) {
    return restoreFormulaTokensAfterTranslate(translatedText, tokens || []);
  }

  function addProtectedCitationToken(tokens, raw) {
    var token = String(raw || "").normalize("NFC").replace(/\s+/g, " ").trim();
    if (!token || token.length < 4) return;
    if (tokens.some(function (entry) { return entry.raw === token; })) return;
    tokens.push({ raw: token });
  }

  function buildProtectedCitationTokens(sourceText) {
    var source = String(sourceText || "").normalize("NFC");
    var tokens = [];
    [
      /\((?=[^)]*\b(?:19|20)\d{2}[a-z]?\b)[^)]{3,260}\)/gi,
      /\b(?:[A-Z]\.\s*){1,4}[A-Z][A-Za-zÀ-ÖØ-öø-ÿ\u0300-\u036f'`´~.-]+(?:\s+&\s+(?:[A-Z]\.\s*){0,4}[A-Z][A-Za-zÀ-ÖØ-öø-ÿ\u0300-\u036f'`´~.-]+)?\s+(?:19|20)\d{2}[a-z]?\b/g,
      /\b[A-Z][A-Za-zÀ-ÖØ-öø-ÿ\u0300-\u036f'`´~.-]+(?:\s+[A-Z][A-Za-zÀ-ÖØ-öø-ÿ\u0300-\u036f'`´~.-]+){0,3}\s+et\s+al\./gi,
      /\bet\s+al\./gi,
    ].forEach(function (pattern) {
      var matches = source.match(pattern) || [];
      matches.forEach(function (match) { addProtectedCitationToken(tokens, match); });
    });
    tokens.sort(function (a, b) { return b.raw.length - a.raw.length; });
    return tokens;
  }

  function replaceCitationTokensBeforeTranslate(text, tokens) {
    var protectedText = String(text || "");
    tokens.forEach(function (token, index) {
      var raw = token.raw || "";
      if (!raw) return;
      protectedText = protectedText.split(raw).join("__CITATION_" + index + "__");
    });
    return protectedText;
  }

  function restoreCitationTokensAfterTranslate(translatedText, tokens) {
    var text = String(translatedText || "");
    var failed = [];
    (tokens || []).forEach(function (token, index) {
      var pattern = new RegExp("__\\s*CITATION\\s*_" + index + "\\s*__", "gi");
      var before = text;
      text = text.replace(pattern, token.raw);
      if (before === text && text.indexOf(token.raw) < 0) failed.push(token.raw);
    });
    return { text: text, failed: failed };
  }

  async function translateSegmentSourceText(sourceText, signal) {
    var sourceLang = normalizePdfLang(state.pdfSourceLang) || "auto";
    var targetLang = normalizePdfLang(state.pdfTargetLang) || "zh-CN";
    if (sameConcreteLanguage(sourceLang, targetLang)) {
      throw new Error("源语言和目标语言相同，请修改目标语言。");
    }
    var usePaperFormulaProtection = state.pdfTranslationMode === "paper_pdf";
    var protectedSource = usePaperFormulaProtection
      ? protectPdfFormulaTokensForTranslation(sourceText)
      : { text: String(sourceText || ""), tokens: [] };
    var citationProtection = usePaperFormulaProtection
      ? { tokens: buildProtectedCitationTokens(protectedSource.text) }
      : { tokens: [] };
    protectedSource.text = citationProtection.tokens.length
      ? replaceCitationTokensBeforeTranslate(protectedSource.text, citationProtection.tokens)
      : protectedSource.text;
    translateSegmentSourceText.lastProtectionReport = {
      citationTokenProtectedCount: citationProtection.tokens.length,
      citationTokenRestoreFailedCount: 0,
      citationNameMutationRiskCount: 0,
      citationTokenRestoreFailedExamples: [],
    };
    var payload = {
      text: protectedSource.text,
      sourceLanguage: toLegacyTranslateLang(sourceLang),
      targetLanguage: toLegacyTranslateLang(targetLang),
      source_lang: toLegacyTranslateLang(sourceLang),
      target_lang: toLegacyTranslateLang(targetLang),
      provider: PDF_TRANSLATION_PROVIDER,
      force_retry: true,
     context: buildPdfTranslationPromptByMode(state.pdfTranslationMode || "").context,
    };
    debugPdfLog("[pdf] translate segment source100=", String(sourceText || "").slice(0, 100), "sourceLang=", sourceLang, "targetLang=", targetLang);
    if (signal && signal.aborted) {
      var abortedBeforeProvider = new Error("translation aborted");
      abortedBeforeProvider.name = "AbortError";
      throw abortedBeforeProvider;
    }
    var providerIpc = getElectronIpc();
    if (!providerIpc) throw new Error("统一 Provider 仅可在桌面应用中使用");
    var data = await providerIpc.invoke("lingoflow-provider:translate", payload);
    if (signal && signal.aborted) {
      var abortedAfterProvider = new Error("translation aborted");
      abortedAfterProvider.name = "AbortError";
      throw abortedAfterProvider;
    }
    if (data && data.status && ["ok", "fallback", "timeout"].indexOf(String(data.status)) < 0) {
      throw new Error(String(data.status));
    }
    var translated = extractTranslatedText(data);
    if (!translated) throw new Error("empty translation");
    if (usePaperFormulaProtection) translated = restorePdfFormulaPlaceholders(translated, protectedSource.tokens);
    if (citationProtection.tokens.length) {
      var citationRestored = restoreCitationTokensAfterTranslate(translated, citationProtection.tokens);
      translated = citationRestored.text;
      translateSegmentSourceText.lastProtectionReport = {
        citationTokenProtectedCount: citationProtection.tokens.length,
        citationTokenRestoreFailedCount: citationRestored.failed.length,
        citationNameMutationRiskCount: citationRestored.failed.length,
        citationTokenRestoreFailedExamples: citationRestored.failed.slice(0, 5),
      };
    }
    debugPdfLog("[pdf] translated segment target100=", translated.slice(0, 100), "sourceLang=", sourceLang, "targetLang=", targetLang);
    return translated;
  }

  function isRetryablePdfTranslationError(err) {
    if (!err || err.name === "AbortError") return false;
    var status = Number(err.httpStatus || 0);
    if ([408, 425, 429, 500, 502, 503, 504].indexOf(status) >= 0) return true;
    if (status >= 400 && status < 500) return false;
    var message = String(err.message || err || "").toLowerCase();
    if (/quota|insufficient|unauthorized|forbidden|invalid token|same language/.test(message)) return false;
    return !status && /network|fetch|timeout|timed out|socket|connection|temporar|empty translation|server endpoint unavailable/.test(message);
  }

  function waitForPdfTranslationRetry(delayMs, signal) {
    return new Promise(function (resolve, reject) {
      if (signal && signal.aborted) {
        var abortedBeforeWait = new Error("translation aborted");
        abortedBeforeWait.name = "AbortError";
        reject(abortedBeforeWait);
        return;
      }
      var timer = setTimeout(function () {
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve();
      }, delayMs);
      function onAbort() {
        clearTimeout(timer);
        var aborted = new Error("translation aborted");
        aborted.name = "AbortError";
        reject(aborted);
      }
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  async function translatePaperSegmentWithRetry(sourceText, signal) {
    var maxAttempts = 3;
    var retryReasons = [];
    var lastInvalidTranslation = "";
    for (var attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        var translated = await translateSegmentSourceText(sourceText, signal);
        var invalidReason = getInvalidTranslationReason(sourceText, translated);
        if (!invalidReason || attempt === maxAttempts) {
          return { translated: translated, retryCount: attempt - 1, retryReasons: retryReasons, invalidReason: invalidReason };
        }
        lastInvalidTranslation = translated;
        retryReasons.push(invalidReason);
      } catch (err) {
        if (!isRetryablePdfTranslationError(err) || attempt === maxAttempts) {
          err.pdfTranslationRetryCount = attempt - 1;
          err.pdfTranslationRetryReasons = retryReasons.slice();
          throw err;
        }
        retryReasons.push(String(err && err.message ? err.message : err || "translation_failed"));
      }
      await waitForPdfTranslationRetry(300 * attempt, signal);
    }
    return { translated: lastInvalidTranslation, retryCount: maxAttempts - 1, retryReasons: retryReasons, invalidReason: "invalid_translation" };
  }

  

function buildSimplePdfTranslationPrompt() {
  return [
    "Translate this document paragraph naturally and accurately.",
    "Preserve meaning and tone. Do not summarize, omit, expand, or add information.",
    "Keep numbers, dates, names, and punctuation accurate.",
    "Use readable target-language prose.",
    "If the source is a title, translate as a title.",
    "If the source is a paragraph, translate as a paragraph.",
    "Return only the translated text. Do not include explanations, labels, or markdown.",
  ].join(" ");
}

function buildPaperPdfTranslationPrompt() {
  return [
    "Translate this PDF paragraph naturally and accurately for formal document reading.",
    "Preserve professional terms, numbers, formulas, citations, units, symbols, and proper nouns.",
    "Do not summarize, expand, omit, rewrite, or add information that is not present in the source.",
    "For academic papers, translate titles, abstracts, keywords, and body text in a formal academic Chinese style when the target language is Chinese.",
    "Keep untranslatable proper nouns in English.",
    "Return only the translated paragraph. Do not include explanations, labels, markdown, or phrases such as translated.",
  ].join(" ");
}

function buildPdfTranslationPromptByMode(mode) {
  if (mode === "paper_pdf") {
    return {
      context: buildPaperPdfTranslationPrompt(),
      translationPromptMode: "paper_academic",
      translationPromptAcademicInstructionApplied: true,
    };
  }
  return {
    context: buildSimplePdfTranslationPrompt(),
    translationPromptMode: "simple_general",
    translationPromptAcademicInstructionApplied: false,
  };
}

function resetPdfDocumentState(fileId) {
    if (state.pdfTranslateAbortController) {
      try { state.pdfTranslateAbortController.abort(); } catch (_err) {}
    }
    state.pdfTranslateAbortController = null;
    state.pdfTranslateTaskSeq += 1;
    state.pdfTranslating = false;
    state.pdfTranslateCancelRequested = false;
    state.pdfTranslatePaused = false;
    state.lastPdfOutputPath = "";
    state.pdfCurrentFileId = fileId || null;
    state.selectedFile = null;
    state.pdfExtract = null;
    state.extractedText = "";
    state.segments = [];
    state.semanticStructureArtifact = null;
    state.semanticStructureConsumerReports = [];
    state.translatedSegments = [];
    state.previewText = "";
    state.outputText = "";
    state.textItems = [];
    state.lines = [];
    state.rawLines = [];
    state.rawTextByPage = [];
    state.paragraphs = [];
    state.error = null;
    state.progress = 0;
    state.activeSegment = null;
    updatePdfExportButton();
  }

  function buildPdfFileId(result) {
    return [
      result && result.fileName ? result.fileName : "unknown",
      result && result.fileSize ? result.fileSize : 0,
      Date.now(),
      Math.random().toString(36).slice(2),
    ].join(":");
  }

  function normalizePdfSegments(result) {
    var rawSegments = result && Array.isArray(result.segments) ? result.segments : [];
    if (state.pdfTranslationMode === "simple_pdf") {
      if (rawSegments.length) {
        return rawSegments.map(function (segment, index) {
          return {
            id: segment.id || "simple-" + (index + 1),
            segmentIdentity: segment.segmentIdentity && typeof segment.segmentIdentity === "object"
              ? JSON.parse(JSON.stringify(segment.segmentIdentity))
              : null,
            pageNumber: Number(segment.pageNumber || segment.firstLinePageNumber || 0),
            type: segment.type,
            sourceText: String(segment.sourceText || ""),
            previewText: segment.previewText || makeSegmentPreview(segment.sourceText || ""),
            translatedText: String(segment.translatedText || ""),
            status: segment.status || "pending",
            firstLinePageNumber: segment.firstLinePageNumber || segment.pageNumber || 0,
            lastLinePageNumber: segment.lastLinePageNumber || segment.pageNumber || 0,
            sourcePageRange: Array.isArray(segment.sourcePageRange) ? segment.sourcePageRange.slice() : [segment.firstLinePageNumber || segment.pageNumber || 0, segment.lastLinePageNumber || segment.pageNumber || 0],
            sourceLineRange: Array.isArray(segment.sourceLineRange) ? segment.sourceLineRange.slice() : [],
            crossedPageBoundary: Boolean(segment.crossedPageBoundary),
            mergeReason: segment.mergeReason || "",
            error: segment.error || "",
          };
        }).filter(function (segment) { return segment.sourceText.trim(); });
      }
      if (String(result && result.text || "").trim()) {
        var missingSimpleSegmentsError = new Error("Canonical simple PDF segments are required after semantic freeze");
        missingSimpleSegmentsError.code = "SEMANTIC_CONSUMER_SEGMENTS_REQUIRED";
        throw missingSimpleSegmentsError;
      }
      return [];
    }
    if (rawSegments.length) {
      return rawSegments.map(function (segment, index) {
        var normalizedType = segment.type;
        var normalizedStatus = segment.status || "pending";
        return {
          id: segment.id || "seg-" + (index + 1),
          segmentIdentity: segment.segmentIdentity && typeof segment.segmentIdentity === "object"
            ? JSON.parse(JSON.stringify(segment.segmentIdentity))
            : null,
          pageNumber: Number(segment.pageNumber || 0),
          column: segment.column || "single",
          type: normalizedType,
          sourceText: String(segment.sourceText || ""),
          previewText: segment.previewText || makeSegmentPreview(segment.sourceText || ""),
          translatedText: String(segment.translatedText || ""),
          bbox: segment.bbox || { x: 0, y: 0, width: 0, height: 0 },
          lines: Array.isArray(segment.lines) ? segment.lines : [],
          lineBoxes: Array.isArray(segment.lineBoxes) ? segment.lineBoxes : [],
          items: Array.isArray(segment.items) ? segment.items : [],
          status: normalizedStatus,
          skipReason: segment.skipReason || segment.reportSkipReason || "",
          reportSkipReason: segment.reportSkipReason || segment.skipReason || "",
          suspicious: Boolean(segment.suspicious),
          suspiciousReasons: Array.isArray(segment.suspiciousReasons) ? segment.suspiciousReasons : [],
          classificationReason: segment.classificationReason || "",
          mergeReason: segment.mergeReason || "",
          headingDemotedToBody: Boolean(segment.headingDemotedToBody),
          headingContinuationMerged: Boolean(segment.headingContinuationMerged),
          continuationMergeReasons: Array.isArray(segment.continuationMergeReasons) ? segment.continuationMergeReasons : [],
          captionBodyOwnershipArtifact: segment.captionBodyOwnershipArtifact && typeof segment.captionBodyOwnershipArtifact === "object"
            ? JSON.parse(JSON.stringify(segment.captionBodyOwnershipArtifact))
            : null,
          captionRegionArtifact: segment.captionRegionArtifact && typeof segment.captionRegionArtifact === "object"
            ? JSON.parse(JSON.stringify(segment.captionRegionArtifact))
            : null,
          captionGroupArtifact: segment.captionGroupArtifact && typeof segment.captionGroupArtifact === "object"
            ? JSON.parse(JSON.stringify(segment.captionGroupArtifact))
            : null,
          finalCaptionSource: segment.finalCaptionSource && typeof segment.finalCaptionSource === "object"
            ? JSON.parse(JSON.stringify(segment.finalCaptionSource))
            : null,
          captionGroupTranslationArtifact: segment.captionGroupTranslationArtifact && typeof segment.captionGroupTranslationArtifact === "object"
            ? JSON.parse(JSON.stringify(segment.captionGroupTranslationArtifact))
            : null,
          captionDisplayArtifact: segment.captionDisplayArtifact && typeof segment.captionDisplayArtifact === "object"
            ? JSON.parse(JSON.stringify(segment.captionDisplayArtifact))
            : null,
          captionGroupRole: segment.captionGroupRole || "",
          captionGroupId: segment.captionGroupId || "",
          captionGroupCanonicalOwnerId: segment.captionGroupCanonicalOwnerId || "",
        };
      }).filter(function (segment) { return segment.sourceText.trim(); });
    }
    if (String(result && result.text || "").trim()) {
      var missingPaperSegmentsError = new Error("Canonical paper PDF segments are required after semantic freeze");
      missingPaperSegmentsError.code = "SEMANTIC_CONSUMER_SEGMENTS_REQUIRED";
      throw missingPaperSegmentsError;
    }
    return [];
  }

  function segmentSourceTotal(segments) {
    return (segments || []).reduce(function (sum, segment) {
      return sum + String(segment.sourceText || "").length;
    }, 0);
  }

  function logPdfCompleteness(result, segments) {
    var rawPages = Array.isArray(result && result.rawTextByPage) ? result.rawTextByPage : [];
    var rawTotal = rawPages.reduce(function (sum, page) {
      var count = Number(page.charCount || String(page.text || "").length || 0);
      debugPdfLog("[pdf] rawText page", page.pageNumber, "chars=", count);
      return sum + count;
    }, 0);
    var segmentTotal = segmentSourceTotal(segments);
    var diff = rawTotal - segmentTotal;
    debugPdfLog("[pdf] rawText total chars=", rawTotal);
    debugPdfLog("[pdf] segment.sourceText total chars=", segmentTotal);
    debugPdfLog("[pdf] raw-vs-segment diff=", diff);
    if (rawTotal > 0 && segmentTotal < rawTotal * 0.9) {
      console.warn("分段结果可能丢失部分文本，请检查提取规则。");
    }
  }

  function segmentSourceTotal(segments) {
    return getSegmentTextCount(segments);
  }

  function logPdfCompleteness(result, segments) {
    var rawPages = Array.isArray(result && result.rawTextByPage) ? result.rawTextByPage : [];
    var rawTotal = rawPages.reduce(function (sum, page) {
      var count = countTextChars(page && page.text ? page.text : "");
      debugPdfLog("[pdf] rawText page", page.pageNumber, "chars=", count);
      return sum + count;
    }, 0);
    var segmentTotal = segmentSourceTotal(segments);
    var diff = rawTotal - segmentTotal;
    var diffRatio = getPdfCountDiffRatio(rawTotal, segmentTotal);
    debugPdfLog("[pdf] rawText total chars=", rawTotal);
    debugPdfLog("[pdf] segment.sourceText total chars=", segmentTotal);
    debugPdfLog("[pdf] raw-vs-segment diff=", diff);
    debugPdfLog("[pdf] raw-vs-segment diff ratio=", Math.round(diffRatio * 10000) / 100 + "%");
    if (rawTotal > 0 && diffRatio < 0.05) {
      debugPdfLog("[pdf] 字数差距小于 5%，统计正常。");
    } else if (rawTotal > 0 && diffRatio > 0.1) {
      console.warn("分段可能丢失文本");
    }
  }

  function makeSegmentPreview(text) {
    var value = String(text || "").replace(/\s+/g, " ").trim();
    return value.length > 50 ? value.slice(0, 50) + "..." : value;
  }

  function setPdfPreviewMode(mode) {
    state.pdfPreviewMode = mode === "segments" ? "segments" : "raw";
    var rawBtn = document.getElementById("btnPdfRawMode");
    var segmentBtn = document.getElementById("btnPdfSegmentMode");
    if (rawBtn) rawBtn.classList.toggle("is-active", state.pdfPreviewMode === "raw");
    if (segmentBtn) segmentBtn.classList.toggle("is-active", state.pdfPreviewMode === "segments");
    if (state.pdfPreviewMode === "segments") renderPdfSegmentsPreview();
    else renderPdfRawLinesPreview();
  }

  function renderPdfPreview(extract) {
    var statsEl = document.getElementById("pdfExtractStats");
    var previewEl = document.getElementById("pdfExtractPreview");
    if (!statsEl || !previewEl) return;

    if (!extract || !extract.text) {
      statsEl.textContent = extract && extract.fileName ? "未提取到文字" : "尚未提取";
      previewEl.textContent = extract && extract.fileName ? "这个 PDF 可能是扫描版，或文字被特殊编码。下一步可接 OCR/更强解析库。" : "选择 PDF 后，这里会显示提取出的文字预览。";
      previewEl.setAttribute("data-state", "empty");
      return;
    }

    var pages = Number(extract.pages || 0);
    var chars = Number(extract.charCount || extract.text.length || 0);
    var paragraphs = Number(extract.paragraphCount || 0);
    statsEl.textContent = (pages ? pages + " 页 · " : "") + chars + " 字 · " + paragraphs + " 段";
    var counts = getPdfTextCounts(extract, state.segments);
    var diffRatio = getPdfCountDiffRatio(counts.rawTextCount, counts.segmentTextCount);
    statsEl.textContent = formatPdfCountSummary(counts) + (diffRatio > 0.1 ? " · 分段可能丢失文本" : "");
    renderPdfRawLinesPreview();
    previewEl.removeAttribute("data-state");
  }

  function renderPdfRawLinesPreview() {
    var statsEl = document.getElementById("pdfExtractStats");
    var previewEl = document.getElementById("pdfExtractPreview");
    if (!statsEl || !previewEl) return;
    var rawPages = state.rawTextByPage || [];
    var counts = getPdfTextCounts(null, state.segments);
    var diffRatio = getPdfCountDiffRatio(counts.rawTextCount, counts.segmentTextCount);
    statsEl.textContent = rawPages.length ? "原始页 " + rawPages.length + " 页" : "尚未提取";
    statsEl.textContent = rawPages.length ? formatPdfCountSummary(counts) + (diffRatio > 0.1 ? " · 分段可能丢失文本" : "") : "尚未提取";
    if (!rawPages.length) {
      previewEl.textContent = "选择 PDF 后，这里会显示提取出的文字预览。";
      previewEl.setAttribute("data-state", "empty");
      return;
    }
    previewEl.innerHTML = "";
    rawPages.forEach(function (page) {
      var pageTitle = document.createElement("div");
      var body = document.createElement("div");
      pageTitle.className = "pdf-raw-page-title";
      pageTitle.textContent = "Page " + page.pageNumber + " · " + String(page.text || "").length + " 字";
      pageTitle.textContent = "Page " + page.pageNumber + " · " + countTextChars(page.text || "") + " 字";
      body.className = "pdf-raw-page-text";
      body.textContent = page.text || "";
      previewEl.appendChild(pageTitle);
      previewEl.appendChild(body);
    });
    previewEl.removeAttribute("data-state");
  }

  function renderPdfSegmentsPreview() {
    var statsEl = document.getElementById("pdfExtractStats");
    var previewEl = document.getElementById("pdfExtractPreview");
    if (!statsEl || !previewEl) return;
    var segments = state.segments || [];
    var counts = getPdfTextCounts(null, segments);
    var diffRatio = getPdfCountDiffRatio(counts.rawTextCount, counts.segmentTextCount);
    statsEl.textContent = segments.length ? "已拆到 " + segments.length + " 段" : "尚未分段";
    statsEl.textContent = segments.length ? formatPdfCountSummary(counts) + (diffRatio > 0.1 ? " · 分段可能丢失文本" : "") : "尚未分段";
    if (!segments.length) {
      previewEl.textContent = "暂无分段结果。";
      previewEl.removeAttribute("data-state");
      return;
    }

    previewEl.innerHTML = "";
    segments.forEach(function (segment, index) {
      var item = document.createElement("details");
      var summary = document.createElement("summary");
      var body = document.createElement("div");
      var title = document.createElement("span");
      var meta = document.createElement("span");
      var excerpt = document.createElement("span");
      var translatedExcerpt = document.createElement("span");

      item.className = "pdf-segment-item";
      if (isPaperPreserveSegment(segment)) item.className += " is-preserved";
      summary.className = "pdf-segment-summary";
      body.className = "pdf-segment-body";
      title.className = "pdf-segment-title";
      meta.className = "pdf-segment-meta";
      excerpt.className = "pdf-segment-excerpt";
      translatedExcerpt.className = "pdf-segment-translated-excerpt";

      title.textContent = "段落 " + (index + 1) +
        " · page " + (segment.pageNumber || "-") +
        " · " + (segment.type && segment.type !== "body" ? segment.type : (segment.column || "single")) +
        (segment.suspicious ? " · 疑似异常" : "") +
        " · 展开";
      var statusLabel = getSegmentStatusLabel(segment);
      var skipReason = getSegmentSkipReason(segment);
      meta.textContent = "page " + (segment.pageNumber || "-") +
        " · " + (segment.column || "single") +
        " · " + statusLabel +
        " · " + String(segment.sourceText || "").length + " 字";
      meta.textContent = "page " + (segment.pageNumber || "-") +
        " · " + (segment.column || "single") +
        " · " + statusLabel +
        " · " + countTextChars(segment.sourceText || "") + " 字" +
        (skipReason ? " · " + skipReason : "");
      excerpt.textContent = "原文：" + makeUiPreview(segment.sourceText || "");
      translatedExcerpt.textContent = isPaperPreserveSegment(segment)
        ? "译文：" + statusLabel + (skipReason ? " · " + skipReason : "")
        : "译文：" + (segment.translatedText ? makeUiPreview(segment.translatedText) : "未翻译");
      if (segment.type === "reference") item.open = false;
      body.textContent = "";
      summary.addEventListener("click", function (event) {
        event.preventDefault();
        openPdfSegmentModal(segment, index);
      });

      summary.appendChild(title);
      summary.appendChild(meta);
      summary.appendChild(excerpt);
      summary.appendChild(translatedExcerpt);
      item.appendChild(summary);
      item.appendChild(body);
      previewEl.appendChild(item);
    });
    previewEl.removeAttribute("data-state");
    updatePdfExportButton();
  }

  function openPdfSegmentModal(segment, index) {
    var modal = document.getElementById("pdfSegmentModal");
    var title = document.getElementById("pdfSegmentModalTitle");
    var meta = document.getElementById("pdfSegmentModalMeta");
    var text = document.getElementById("pdfSegmentModalText");
    var translatedText = document.getElementById("pdfSegmentModalTranslatedText");
    if (!modal || !title || !meta || !text || !translatedText) return;
    state.activeSegment = segment;
    title.textContent = "段落 " + (index + 1);
    var statusLabel = getSegmentStatusLabel(segment);
    var skipReason = getSegmentSkipReason(segment);
    meta.textContent = "页码 " + (segment.pageNumber || "-") +
      " · 栏位 " + (segment.column || "single") +
      " · 状态 " + statusLabel +
      " · " + String(segment.sourceText || "").length + " 字";
    meta.textContent = "页码 " + (segment.pageNumber || "-") +
      " · 栏位 " + (segment.column || "single") +
      " · 状态 " + statusLabel +
      " · " + countTextChars(segment.sourceText || "") + " 字" +
      (skipReason ? " · " + skipReason : "");
    text.textContent = segment.sourceText || "";
    translatedText.textContent = isPaperPreserveSegment(segment)
      ? statusLabel + (skipReason ? "\n" + skipReason : "")
      : (segment.translatedText || "未翻译");
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
  }

  function closePdfSegmentModal() {
    var modal = document.getElementById("pdfSegmentModal");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }

  function setPdfWorkflowState(stateName, file) {
    var statusEl = document.getElementById("pdfWorkflowStatus");
    var fileNameEl = document.getElementById("pdfFileName");
    var fileMetaEl = document.getElementById("pdfFileMeta");
    var prepareBtn = document.getElementById("btnPreparePdfTranslation");
    var clearBtn = document.getElementById("btnClearPdfFile");
    var exportBtn = document.getElementById("btnExportPdfTranslation");
    var steps = document.querySelectorAll(".pdf-flow-step");
    var modeDef = getPdfTranslationModeDef(state.pdfTranslationMode);
    var pauseBtn = document.getElementById("btnPausePdfTranslation");
    var progressTitle = document.getElementById("pdfProgressTitle");
    var progressSummary = document.getElementById("pdfProgressSummary");
    var progressBar = document.getElementById("pdfProgressBar");
    var progressTrack = progressBar && progressBar.parentElement;
    var completeStage = document.getElementById("pdfCompleteStage");
    var translationStage = document.getElementById("pdfTranslationStage");
    var workView = document.getElementById("pdfWorkView");
    var percent = Math.max(0, Math.min(100, Number(state.progress && state.progress.percent || 0)));

    renderPdfModeSelector();
    if (workView) workView.setAttribute("data-workflow-state", stateName);

    steps.forEach(function (step) {
      var key = step.getAttribute("data-step");
      var activeKey = stateName === "idle" || stateName === "staged" ? "select"
        : stateName === "translated" ? "complete"
        : ["prepared", "translating", "canceled"].indexOf(stateName) >= 0 ? "translate" : "extract";
      step.classList.toggle("is-active", key === activeKey);
      step.classList.toggle(
        "is-done",
        (stateName === "staged" && key === "select") ||
        (stateName === "extracted" && key === "select") ||
        (["prepared", "translating", "translated", "canceled"].indexOf(stateName) >= 0 && (key === "select" || key === "extract")) ||
        (stateName === "translated" && (key === "translate" || key === "complete")),
      );
      step.classList.toggle("is-disabled", !step.classList.contains("is-active") && !step.classList.contains("is-done"));
    });

    if (progressBar) progressBar.style.width = percent + "%";
    if (progressTrack) progressTrack.setAttribute("aria-valuenow", String(percent));
    if (completeStage) completeStage.hidden = stateName !== "translated";
    if (translationStage) translationStage.hidden = stateName === "translated";
    if (pauseBtn) {
      pauseBtn.disabled = stateName !== "translating";
      pauseBtn.setAttribute("aria-pressed", state.pdfTranslatePaused ? "true" : "false");
      setButtonText(pauseBtn, state.pdfTranslatePaused ? "继续" : "暂停");
    }
    if (clearBtn && stateName !== "translating") setButtonText(clearBtn, "取消");
    if (progressTitle) progressTitle.textContent = state.pdfTranslatePaused ? "翻译已暂停" : stateName === "translating" ? "正在翻译" : stateName === "canceled" ? "翻译已取消" : "准备翻译";
    if (progressSummary) progressSummary.textContent = stateName === "translating" ? getPdfTranslateProgressText(state.progress && state.progress.current) : stateName === "canceled" ? "可以继续翻译剩余内容。" : "完成提取后即可开始。";

    if (!modeDef) {
      if (statusEl) {
        statusEl.textContent = "待选模式";
        statusEl.setAttribute("data-state", "idle");
      }
      if (fileNameEl) fileNameEl.textContent = "选择 PDF 翻译模式";
      if (fileMetaEl) fileMetaEl.textContent = "请先选择 PDF 翻译模式";
      if (prepareBtn) {
        prepareBtn.disabled = true;
        setButtonText(prepareBtn, "请先选择模式");
      }
      if (clearBtn) clearBtn.disabled = true;
      if (exportBtn) exportBtn.disabled = true;
      updatePdfModeStepLabels();
      renderPdfPreview(null);
      return;
    }

    if (stateName === "translating") {
      if (statusEl) {
        statusEl.textContent = "翻译中";
        statusEl.setAttribute("data-state", "ready");
      }
      if (fileNameEl) fileNameEl.textContent = file && file.fileName ? file.fileName : "已选择 PDF";
      if (fileMetaEl) fileMetaEl.textContent = getPdfTranslateProgressText(state.progress && state.progress.current);
      if (prepareBtn) {
        prepareBtn.disabled = true;
        setButtonText(prepareBtn, "翻译中");
      }
      if (clearBtn) clearBtn.disabled = false;
      writePdfRecentJob(state.pdfTranslatePaused ? "已暂停" : "翻译中");
      return;
    }

    if (stateName === "extracted") writePdfRecentJob("已提取");

    if (stateName === "translated") {
      if (statusEl) {
        statusEl.textContent = "已翻译";
        statusEl.setAttribute("data-state", "staged");
      }
      if (fileNameEl) fileNameEl.textContent = file && file.fileName ? file.fileName : "已选择 PDF";
      if (fileMetaEl) {
        var translatedCounts = getSegmentStatusCounts();
        fileMetaEl.textContent = getPdfModeProgressText() + (translatedCounts.failed ? " · 失败 " + translatedCounts.failed : "");
      }
      if (prepareBtn) {
        prepareBtn.disabled = false;
        setButtonText(prepareBtn, getRemainingPaperSegmentEntriesStrict().length ? "继续翻译" : "翻译完成");
      }
      if (clearBtn) clearBtn.disabled = false;
      writePdfRecentJob("已完成");
      return;
    }

    if (stateName === "canceled") {
      if (statusEl) {
        statusEl.textContent = "已取消";
        statusEl.setAttribute("data-state", "idle");
      }
      if (fileNameEl) fileNameEl.textContent = file && file.fileName ? file.fileName : "已选择 PDF";
      if (fileMetaEl) {
        var canceledCounts = getSegmentStatusCounts();
        fileMetaEl.textContent = "已取消 · " + getPdfModeProgressText() + (canceledCounts.failed ? " · 失败 " + canceledCounts.failed : "");
      }
      if (prepareBtn) {
        prepareBtn.disabled = false;
        setButtonText(prepareBtn, "继续翻译");
      }
      if (clearBtn) clearBtn.disabled = false;
      writePdfRecentJob("已取消");
      return;
    }

    if (stateName === "extracting") {
      if (statusEl) {
        statusEl.textContent = "提取中";
        statusEl.setAttribute("data-state", "ready");
      }
      if (fileNameEl) fileNameEl.textContent = "正在读取 PDF";
      if (fileMetaEl) fileMetaEl.textContent = modeDef.selectedHint + " 正在提取文字，请稍候。";
      if (prepareBtn) prepareBtn.disabled = true;
      if (clearBtn) clearBtn.disabled = true;
      return;
    }

    if (stateName === "extracted") {
      var hasText = Boolean((file && file.text) || state.extractedText);
      if (statusEl) {
        statusEl.textContent = hasText ? "已提取" : "无文字";
        statusEl.setAttribute("data-state", hasText ? "staged" : "idle");
      }
      if (fileNameEl) fileNameEl.textContent = file && file.fileName ? file.fileName : "已选择 PDF";
      if (fileMetaEl) {
        var meta = [];
        if (file && file.fileSize) meta.push(formatFileSize(file.fileSize));
        if (file && file.pages) meta.push(file.pages + " 页");
        if (file && file.charCount) meta.push(file.charCount + " 字");
        if (state.segments.length) meta.push(state.segments.length + " 段");
        fileMetaEl.textContent = meta.length ? meta.join(" · ") : "已完成第一阶段文字提取。";
      }
      if (fileMetaEl) fileMetaEl.textContent = modeDef.selectedHint + " · " + formatPdfCountSummary(getPdfTextCounts(file, state.segments));
      if (fileMetaEl) fileMetaEl.textContent = modeDef.selectedHint + " · " + formatPdfCountSummary(getPdfTextCounts(file, state.segments));
      if (fileMetaEl && stateName === "prepared") fileMetaEl.textContent = modeDef.selectedHint + " · " + formatPdfCountSummary(getPdfTextCounts(file, state.segments));
      if (prepareBtn) {
        prepareBtn.disabled = !hasText;
        setButtonText(prepareBtn, modeDef.startText);
      }
      if (clearBtn) clearBtn.disabled = false;
      return;
    }

    if (stateName === "prepared") {
      if (statusEl) {
        statusEl.textContent = "已准备";
        statusEl.setAttribute("data-state", "staged");
      }
      if (fileNameEl) fileNameEl.textContent = file && file.fileName ? file.fileName : "已选择 PDF";
      if (fileMetaEl) {
        var segmentCount = state.segments.length;
        fileMetaEl.textContent = formatPdfCountSummary(getPdfTextCounts(file, state.segments));
        fileMetaEl.textContent = segmentCount ? "已提取文字 · 已拆到 " + segmentCount + " 段 · 下一步接入翻译。" : "已提取文字 · 等待分块。";
      }
      if (prepareBtn) {
        prepareBtn.disabled = false;
        setButtonText(prepareBtn, "准备完成");
      }
      if (clearBtn) clearBtn.disabled = false;
      if (fileMetaEl) fileMetaEl.textContent = modeDef.selectedHint + " · " + formatPdfCountSummary(getPdfTextCounts(file, state.segments));
      return;
    }

    if (stateName === "staged") {
      var fileSize = formatFileSize(file && file.size);
      if (statusEl) {
        statusEl.textContent = "已选择";
        statusEl.setAttribute("data-state", "staged");
      }
      if (fileNameEl) fileNameEl.textContent = file && file.name ? file.name : "已选择 PDF";
      if (fileMetaEl) fileMetaEl.textContent = fileSize ? modeDef.selectedHint + " · " + fileSize : modeDef.selectedHint;
      if (prepareBtn) prepareBtn.disabled = false;
      if (clearBtn) clearBtn.disabled = false;
      return;
    }

    if (statusEl) {
      statusEl.textContent = "待选择";
      statusEl.setAttribute("data-state", "idle");
    }
    if (fileNameEl) fileNameEl.textContent = modeDef.title;
    if (fileMetaEl) fileMetaEl.textContent = modeDef.summary;
    if (prepareBtn) prepareBtn.disabled = true;
    if (prepareBtn) setButtonText(prepareBtn, modeDef.startText);
    if (clearBtn) clearBtn.disabled = true;
    renderPdfPreview(null);
  }

  async function startPdfSegmentTranslation(options) {
  options = options || {};
  var mode = state.pdfTranslationMode;
  if (mode === "simple_pdf") return startSimplePdfSegmentTranslation(options);
  if (mode === "paper_pdf") return startPaperPdfSegmentTranslation(options);
  throw new Error("请选择PDF翻译模式。");
  }

  function sha256HexForPaperTranslationAudit(value) {
    var text = String(value === undefined || value === null ? "" : value);
    if (!window.crypto || !window.crypto.subtle || typeof TextEncoder === "undefined") {
      return Promise.resolve({ sha256: "", error: "web_crypto_sha256_unavailable" });
    }
    return window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (digest) {
      var bytes = Array.from(new Uint8Array(digest));
      return {
        sha256: bytes.map(function (byte) { return byte.toString(16).padStart(2, "0"); }).join(""),
        error: "",
      };
    }).catch(function (err) {
      return { sha256: "", error: String(err && err.message ? err.message : err || "sha256_failed") };
    });
  }

  async function makePaperTranslationLifecycleEvent(input) {
    var segment = input && input.segment || {};
    var text = String(input && input.text !== undefined && input.text !== null ? input.text : "");
    var digest = await sha256HexForPaperTranslationAudit(text);
    var finalCaptionSource = segment.finalCaptionSource && segment.finalCaptionSource.finalizedBeforeTranslation
      ? segment.finalCaptionSource : null;
    var sourceHash = String(input && input.sourceHash || (finalCaptionSource && finalCaptionSource.sourceHash) || (input && input.stage === "translationInput" ? digest.sha256 : ""));
    var sourceVersion = String(input && input.sourceVersion || (finalCaptionSource && finalCaptionSource.sourceVersion) || (sourceHash ? "segment-source-sha256:" + sourceHash : "segment-source-unhashed"));
    var captionGroupId = String(segment.captionGroupId || finalCaptionSource && finalCaptionSource.groupId || "");
    return {
      schemaVersion: 1,
      eventId: String(input && input.attemptId || "missing-attempt") + ":" + String(input && input.stage || "unknown"),
      attemptId: String(input && input.attemptId || ""),
      taskId: Number(input && input.taskId || 0),
      fileId: String(input && input.fileId || ""),
      stage: String(input && input.stage || ""),
      outcome: String(input && input.outcome || ""),
      producer: "renderer.startPaperPdfSegmentTranslation",
      observedAt: new Date().toISOString(),
      segmentId: String(segment.id || ""),
      segmentType: requireCanonicalSemanticType(segment, "paper translation lifecycle event"),
      pageNumber: Number(segment.pageNumber || 0),
      groupIdentityAtEvent: {
        known: Boolean(captionGroupId),
        captionGroupId: captionGroupId,
        canonicalSegmentId: String(segment.captionGroupCanonicalOwnerId || segment.id || ""),
        role: String(segment.captionGroupRole || ""),
        reason: captionGroupId ? "caption_group_finalized_before_translation" : "not_a_pretranslation_caption_group",
      },
      sourceIdentity: {
        segmentId: String(segment.id || ""),
        captionGroupId: captionGroupId,
        sourceVersion: sourceVersion,
        sourceHash: sourceHash,
        hashAlgorithm: "sha256",
      },
      textSnapshot: {
        present: input && input.text !== undefined && input.text !== null,
        length: text.length,
        characterCount: Array.from(text).length,
        sha256: digest.sha256,
        hashError: digest.error,
        preview200: text.slice(0, 200),
        text: text,
      },
      error: String(input && input.error || ""),
    };
  }

  function appendPaperTranslationLifecycleEvent(segment, event) {
    if (!segment || !event) return;
    if (!Array.isArray(segment.translationLifecycleEvents)) segment.translationLifecycleEvents = [];
    segment.translationLifecycleEvents.push(event);
    if (typeof debugPdfLog === "function") {
      debugPdfLog("[LINGOFLOW][PAPER_TRANSLATION_LIFECYCLE]", event);
    }
  }

  function isPretranslationCaptionGroupMember(segment) {
    return Boolean(segment && segment.captionGroupId && segment.captionGroupRole === "member");
  }

  function isPaperTranslationAuthoritySegment(segment) {
    return isPaperOverlayCandidateStrict(segment) && !isPretranslationCaptionGroupMember(segment);
  }

  function getPaperTranslationRequestText(segment) {
    var finalSource = segment && segment.finalCaptionSource;
    if (finalSource && finalSource.finalizedBeforeTranslation && finalSource.value) {
      return String(finalSource.value.fullText || "");
    }
    return String(segment && segment.sourceText || "");
  }

  function applyCaptionGroupTranslationResult(canonicalSegment, translated, translationResponseEvent) {
    if (!canonicalSegment || !canonicalSegment.captionGroupId || canonicalSegment.captionGroupRole !== "canonical") return;
    var finalSource = canonicalSegment.finalCaptionSource || {};
    var artifact = {
      schemaVersion: 1,
      producerStage: "renderer.caption_group_translation",
      captionGroupId: String(canonicalSegment.captionGroupId || ""),
      canonicalSegmentId: String(canonicalSegment.id || ""),
      sourceVersion: String(finalSource.sourceVersion || ""),
      sourceHash: String(finalSource.sourceHash || ""),
      translationText: String(translated || ""),
      translationHash: String(translationResponseEvent && translationResponseEvent.textSnapshot && translationResponseEvent.textSnapshot.sha256 || ""),
      accepted: true,
    };
    var displayText = String(artifact.translationText || "");
    var displayHash = String(artifact.translationHash || "");
    var displayArtifact = {
      schemaVersion: 1,
      producerStage: "renderer.caption_display",
      captionGroupId: artifact.captionGroupId,
      canonicalSegmentId: artifact.canonicalSegmentId,
      sourceVersion: artifact.sourceVersion,
      sourceHash: artifact.sourceHash,
      translationHash: artifact.translationHash,
      displayId: "caption-display:" + artifact.captionGroupId + ":" + displayHash,
      displayVersion: "caption-display-sha256:" + displayHash,
      displayText: displayText,
      displayHash: displayHash,
      normalization: [{ operation: "identity_from_accepted_group_translation", changed: false }],
      accepted: true,
    };
    var group = canonicalSegment.captionGroupArtifact && canonicalSegment.captionGroupArtifact.value || {};
    var memberIds = new Set((group.memberSegmentIds || []).map(String));
    state.segments.forEach(function (entry) {
      if (!entry || (String(entry.id || "") !== String(canonicalSegment.id || "") && !memberIds.has(String(entry.id || "")))) return;
      entry.captionGroupTranslationArtifact = JSON.parse(JSON.stringify(artifact));
      entry.captionDisplayArtifact = JSON.parse(JSON.stringify(displayArtifact));
      entry.translatedText = String(translated || "");
      entry.status = "done";
      entry.error = "";
    });
  }

  async function waitWhilePdfTranslationPaused(taskId, fileId) {
    while (state.pdfTranslatePaused && !state.pdfTranslateCancelRequested) {
      if (taskId !== state.pdfTranslateTaskSeq || fileId !== state.pdfCurrentFileId) return false;
      await new Promise(function (resolve) { setTimeout(resolve, 120); });
    }
    return !state.pdfTranslateCancelRequested;
  }

  async function startPaperPdfSegmentTranslation(options) {
    options = options || {};
    var onlyRemaining = Boolean(options.onlyRemaining);
    var modeMessage = requirePdfTranslationModeMessage();
    if (modeMessage) {
      var modeMetaEl = document.getElementById("pdfFileMeta");
      if (modeMetaEl) modeMetaEl.textContent = modeMessage;
      return false;
    }
    if (state.pdfTranslating) {
      state.pdfTranslateCancelRequested = true;
      if (state.pdfTranslateAbortController) {
        try { state.pdfTranslateAbortController.abort(); } catch (_err) {}
      }
      return false;
    }
    if (sameConcreteLanguage(state.pdfSourceLang, state.pdfTargetLang)) {
      state.error = "源语言和目标语言相同，请修改目标语言。";
      var fileMetaEl = document.getElementById("pdfFileMeta");
      if (fileMetaEl) fileMetaEl.textContent = state.error;
      debugPdfWarn("[pdf]", state.error, "sourceLang=", state.pdfSourceLang, "targetLang=", state.pdfTargetLang);
      return false;
    }
    if (!state.extractedText) return false;
    if (!state.segments.length) {
      var missingPaperSegmentsError = new Error("Canonical paper PDF segments are required before translation");
      missingPaperSegmentsError.code = "SEMANTIC_CONSUMER_SEGMENTS_REQUIRED";
      throw missingPaperSegmentsError;
    }
    if (!state.segments.length) return false;

    var taskId = state.pdfTranslateTaskSeq + 1;
    var fileId = state.pdfCurrentFileId;
    state.pdfTranslateTaskSeq = taskId;
    state.pdfTranslateCancelRequested = false;
    state.pdfTranslatePaused = false;
    state.pdfTranslating = true;
    var partialRatio = getPdfPartialTranslateRatio();
    state.pdfPartialRegressionMode = partialRatio > 0;
    state.pdfPartialTranslateRatio = partialRatio;
    state.progress = { current: 0, total: state.segments.length, percent: 0 };
    state.translatedSegments = state.segments.filter(function (segment) {
      return segment.status === "done" && segment.translatedText;
    });
    var translatableCount = state.segments.filter(isPaperTranslationAuthoritySegment).length;
    var allAlreadyDone = state.translatedSegments.filter(function (segment) { return isPaperTranslationAuthoritySegment(segment); }).length === translatableCount;
    state.segments.forEach(function (segment) {
      if (isPaperPreserveSegmentStrict(segment)) {
        segment.status = "preserved";
        segment.translatedText = "";
        return;
      }
      if (!onlyRemaining && allAlreadyDone) {
        segment.status = "pending";
        segment.translatedText = "";
        return;
      }
      if (segment.status !== "done") {
        segment.status = "pending";
      }
      segment.partialRegressionNotTranslated = false;
      segment.promptLeakDetected = false;
      segment.invalidTranslationDetected = false;
      segment.invalidTranslationReason = "";
    });
    var targetIndexes = [];
    var allowedCandidateIndexes = state.segments
      .map(function (segment, index) { return { segment: segment, index: index }; })
      .filter(function (entry) { return isPaperTranslationAuthoritySegment(entry.segment); })
      .map(function (entry) { return entry.index; });
    var partialAllowedLimit = state.pdfPartialRegressionMode
      ? Math.max(1, Math.ceil(allowedCandidateIndexes.length * state.pdfPartialTranslateRatio))
      : allowedCandidateIndexes.length;
    var partialAllowedSet = new Set(allowedCandidateIndexes.slice(0, partialAllowedLimit));
    state.segments.forEach(function (segment, index) {
      if (state.pdfPartialRegressionMode && isPaperTranslationAuthoritySegment(segment) && !partialAllowedSet.has(index)) {
        segment.status = "pending";
        segment.translatedText = "";
        segment.partialRegressionNotTranslated = true;
        return;
      }
      if (isPaperTranslationAuthoritySegment(segment) && !(segment.status === "done" && segment.translatedText && String(segment.translatedText).trim())) {
        targetIndexes.push(index);
      }
    });
    if (!targetIndexes.length) {
      state.pdfTranslating = false;
      state.progress = { current: state.segments.length, total: state.segments.length, percent: 100 };
      setPdfWorkflowState("translated", state.pdfExtract);
      return true;
    }
    setPdfWorkflowState("translating", state.pdfExtract);
    setPdfPreviewMode("segments");
    var _consecutiveFailCount = 0;
    var _translationAttemptSequence = 0;

    for (var i = 0; i < state.segments.length; i += 1) {
      if (taskId !== state.pdfTranslateTaskSeq || fileId !== state.pdfCurrentFileId) return false;
      if (state.pdfTranslateCancelRequested) break;
      if (!(await waitWhilePdfTranslationPaused(taskId, fileId))) break;

      var segment = state.segments[i];
      if (segment.status === "done" && segment.translatedText) {
        continue;
      }
      if (onlyRemaining && targetIndexes.indexOf(i) < 0) {
        continue;
      }
      if (targetIndexes.indexOf(i) < 0) {
        continue;
      }
      segment.status = "translating";
      var beforeCounts = getSegmentStatusCounts();
      state.progress = {
        current: Math.min(state.segments.length, beforeCounts.done + beforeCounts.failed + 1),
        total: state.segments.length,
        percent: Math.round(((beforeCounts.done + beforeCounts.failed) / state.segments.length) * 100),
      };
      setPdfWorkflowState("translating", state.pdfExtract);
      renderPdfSegmentsPreview();

      try {
        state.pdfTranslateAbortController = new AbortController();
        segment.error = "";
        var translationRequestText = getPaperTranslationRequestText(segment);
        _translationAttemptSequence += 1;
        var translationAttemptId = ["paper", String(fileId || "file"), String(taskId), String(_translationAttemptSequence), String(segment.id || i)].join(":");
        var translationRequestEvent = await makePaperTranslationLifecycleEvent({
          stage: "translationInput",
          outcome: "submitted",
          attemptId: translationAttemptId,
          taskId: taskId,
          fileId: fileId,
          segment: segment,
          text: translationRequestText,
        });
        appendPaperTranslationLifecycleEvent(segment, translationRequestEvent);
        if (segment.finalCaptionSource && segment.finalCaptionSource.finalizedBeforeTranslation &&
            String(segment.finalCaptionSource.sourceHash || "") !== String(translationRequestEvent.textSnapshot.sha256 || "")) {
          throw new Error("final_caption_source_hash_mismatch_before_translation");
        }
        var translationRetryResult = await translatePaperSegmentWithRetry(translationRequestText, state.pdfTranslateAbortController.signal);
        var translated = translationRetryResult.translated;
        var invalidReason = translationRetryResult.invalidReason || getInvalidTranslationReason(translationRequestText, translated);
        segment.translationAutomaticRetryCount = Number(translationRetryResult.retryCount || 0);
        segment.translationAutomaticRetryReasons = translationRetryResult.retryReasons || [];
        var translationResponseEvent = await makePaperTranslationLifecycleEvent({
          stage: "translationOutput",
          outcome: invalidReason ? "rejected_invalid_translation" : "accepted",
          attemptId: translationAttemptId,
          taskId: taskId,
          fileId: fileId,
          segment: segment,
          text: translated,
          sourceHash: translationRequestEvent.textSnapshot.sha256,
          sourceVersion: translationRequestEvent.sourceIdentity.sourceVersion,
          error: invalidReason || "",
        });
        appendPaperTranslationLifecycleEvent(segment, translationResponseEvent);
        if (invalidReason) {
          markInvalidTranslationSegment(segment, invalidReason, translated);
          throw Object.assign(new Error(invalidReason), { handledInvalidTranslation: true });
        }
        state.pdfTranslateAbortController = null;
        if (taskId !== state.pdfTranslateTaskSeq || fileId !== state.pdfCurrentFileId) return false;
        segment.translatedText = translated;
        applyCaptionGroupTranslationResult(segment, translated, translationResponseEvent);
        var protectionReport = translateSegmentSourceText.lastProtectionReport || {};
        segment.citationTokenProtectedCount = Number(protectionReport.citationTokenProtectedCount || 0);
        segment.citationTokenRestoreFailedCount = Number(protectionReport.citationTokenRestoreFailedCount || 0);
        segment.citationNameMutationRiskCount = Number(protectionReport.citationNameMutationRiskCount || 0);
        segment.citationTokenRestoreFailedExamples = protectionReport.citationTokenRestoreFailedExamples || [];
        segment.status = "done";
        _consecutiveFailCount = 0;
      } catch (err) {
        segment.translationAutomaticRetryCount = Number(err && err.pdfTranslationRetryCount || segment.translationAutomaticRetryCount || 0);
        segment.translationAutomaticRetryReasons = err && err.pdfTranslationRetryReasons || segment.translationAutomaticRetryReasons || [];
        if (typeof translationAttemptId !== "undefined") {
          var hasObservedOutput = Array.isArray(segment.translationLifecycleEvents) && segment.translationLifecycleEvents.some(function (event) {
            return event && event.attemptId === translationAttemptId && event.stage === "translationOutput";
          });
          if (!hasObservedOutput) {
            var translationFailureEvent = await makePaperTranslationLifecycleEvent({
              stage: "translationFailure",
              outcome: state.pdfTranslateCancelRequested || (err && err.name === "AbortError") ? "aborted" : "failed",
              attemptId: translationAttemptId,
              taskId: taskId,
              fileId: fileId,
              segment: segment,
              text: "",
              sourceHash: translationRequestEvent && translationRequestEvent.textSnapshot ? translationRequestEvent.textSnapshot.sha256 : "",
              sourceVersion: translationRequestEvent && translationRequestEvent.sourceIdentity ? translationRequestEvent.sourceIdentity.sourceVersion : "",
              error: String(err && err.message ? err.message : err || "translation_failed"),
            });
            appendPaperTranslationLifecycleEvent(segment, translationFailureEvent);
          }
        }
        if (taskId !== state.pdfTranslateTaskSeq || fileId !== state.pdfCurrentFileId) return false;
        state.pdfTranslateAbortController = null;
        if (state.pdfTranslateCancelRequested || (err && err.name === "AbortError")) {
          segment.status = "pending";
          break;
        }
        if (!err || !err.handledInvalidTranslation) {
          var _is404NotFound = err && err.message === '"Not Found"';
          if (_is404NotFound) {
            _consecutiveFailCount += 1;
            console.error("[LINGOFLOW][PDF 404]", {
              segmentId: segment.id, segmentType: segment.type, pageNum: segment.pageNumber,
              provider: PDF_TRANSLATION_PROVIDER, endpointsTried: "/v1/translate → /translate",
              consecutiveFailCount: _consecutiveFailCount,
            });
            segment.status = "pending";
            segment.translatedText = "";
            segment.error = '"Not Found"';
            if (_consecutiveFailCount >= 5) {
              console.error("[LINGOFLOW][PDF 翻译接口不可用] 连续 " + _consecutiveFailCount + " 次 404 Not Found，已停止本轮翻译。provider=" + PDF_TRANSLATION_PROVIDER + "，请检查 token 或 provider 配置后重试。");
              state.pdfTranslateCancelRequested = true;
              break;
            }
          } else {
            _consecutiveFailCount = 0;
            segment.status = "failed";
            segment.translatedText = "";
            segment.error = String(err && err.message ? err.message : err);
            debugPdfWarn("[pdf] segment translate failed", segment.id, err && err.message ? err.message : err);
          }
        } else {
          _consecutiveFailCount = 0;
        }
      }
      var afterCounts = getSegmentStatusCounts();
      state.progress = {
        current: afterCounts.done + afterCounts.failed,
        total: state.segments.length,
        percent: Math.round(((afterCounts.done + afterCounts.failed) / state.segments.length) * 100),
      };
      setPdfWorkflowState("translating", state.pdfExtract);
      renderPdfSegmentsPreview();
    }

    if (taskId !== state.pdfTranslateTaskSeq || fileId !== state.pdfCurrentFileId) return false;
    state.pdfTranslateAbortController = null;
    state.pdfTranslating = false;
    state.translatedSegments = state.segments.filter(function (segment) {
      return segment.status === "done";
    });
    renderPdfSegmentsPreview();
    setPdfWorkflowState(state.pdfTranslateCancelRequested ? "canceled" : "translated", state.pdfExtract);
    return !state.pdfTranslateCancelRequested;
  }

  function setupPdfLanguageControls() {
    var sourceSelect = document.getElementById("pdfSourceLangSelect");
    var targetSelect = document.getElementById("pdfTargetLangSelect");
    if (sourceSelect) {
      sourceSelect.value = state.pdfSourceLang;
      sourceSelect.addEventListener("change", function () {
        state.pdfSourceLang = normalizePdfLang(sourceSelect.value) || "auto";
      });
    }
    if (targetSelect) {
      targetSelect.value = state.pdfTargetLang;
      targetSelect.addEventListener("change", function () {
        state.pdfTargetLang = normalizePdfLang(targetSelect.value) || "zh-CN";
      });
    }
  }

  function setupPdfModule() {
    var input = document.getElementById("pdfFileInput");
    var dropZone = document.querySelector(".pdf-drop-zone");
    var prepareBtn = document.getElementById("btnPreparePdfTranslation");
    var clearBtn = document.getElementById("btnClearPdfFile");
    var exportBtn = document.getElementById("btnExportPdfTranslation");
    var pauseBtn = document.getElementById("btnPausePdfTranslation");
    var backBtn = document.getElementById("btnBackPdfModes");
    var openOutputBtn = document.getElementById("btnOpenPdfOutput");
    if (!input && !dropZone) return;
    setupPdfLanguageControls();
    renderPdfRecentJobs();

    document.querySelectorAll("#pdfEntryView [data-pdf-mode]").forEach(function (button) {
      button.addEventListener("click", function () { selectPdfTranslationMode(button.getAttribute("data-pdf-mode")); });
    });
    if (backBtn) backBtn.addEventListener("click", resetPdfTranslationMode);
    if (pauseBtn) pauseBtn.addEventListener("click", function () {
      if (!state.pdfTranslating) return;
      state.pdfTranslatePaused = !state.pdfTranslatePaused;
      setPdfWorkflowState("translating", state.pdfExtract);
    });
    if (openOutputBtn) openOutputBtn.addEventListener("click", async function () {
      if (!state.lastPdfOutputPath) return;
      var ipc = getElectronIpc();
      if (!ipc) return;
      var result = await ipc.invoke("shell:open-path", state.lastPdfOutputPath);
      if (result && !result.ok) window.alert("无法打开文件：" + (result.error || "unknown"));
    });

    async function selectAndExtractFromElectron() {
      var ipc = getElectronIpc();
      if (!ipc) return false;
      var modeMessage = requirePdfTranslationModeMessage();
      if (modeMessage) {
        var modeMetaEl = document.getElementById("pdfFileMeta");
        if (modeMetaEl) modeMetaEl.textContent = modeMessage;
        return true;
      }
      var taskId = state.pdfTaskSeq + 1;
      state.pdfTaskSeq = taskId;
      resetPdfDocumentState("selecting:" + taskId);
      setPdfWorkflowState("extracting");
      renderPdfRawLinesPreview();
      try {
        var result = await ipc.invoke("pdf:select-and-extract", getPdfTranslationModePayload());
        if (taskId !== state.pdfTaskSeq) return true;
        if (!result || result.canceled) {
          resetPdfDocumentState(null);
          setPdfWorkflowState("idle");
          return true;
        }
        var fileId = buildPdfFileId(result);
        resetPdfDocumentState(fileId);
        result.fileId = fileId;
        state.selectedFile = {
          fileName: result.fileName || "",
          fileSize: result.fileSize || 0,
          fileId: fileId,
        };
        state.pdfExtract = result;
        state.extractedText = result.text || "";
        autoSwitchPdfTargetLanguage(state.extractedText);
        state.previewText = state.extractedText.slice(0, 1200);
        state.textItems = Array.isArray(result.textItems) ? result.textItems : [];
        state.lines = Array.isArray(result.lines) ? result.lines : [];
        state.rawLines = Array.isArray(result.rawLines) ? result.rawLines : [];
        state.rawTextByPage = Array.isArray(result.rawTextByPage) ? result.rawTextByPage : [];
        state.paragraphs = Array.isArray(result.paragraphs) ? result.paragraphs : [];
        var normalizedSegments = normalizePdfSegments(result);
        if (!semanticStructureConsumerAuthority) {
          throw new Error("Semantic Structure Consumer Authority is unavailable");
        }
        var rendererConsumerBinding = semanticStructureConsumerAuthority.bindSemanticStructureConsumerSegments(
          normalizedSegments,
          result.semanticStructureArtifact,
          { stage: "renderer.extraction", mode: state.pdfTranslationMode }
        );
        state.semanticStructureArtifact = rendererConsumerBinding.artifact;
        state.semanticStructureConsumerReports = [rendererConsumerBinding.report];
        state.segments = rendererConsumerBinding.segments;
        if (state.pdfTranslationMode === "paper_pdf") {
          state.segments.forEach(function (segment) {
            if (requireSemanticTranslationDisposition(segment, "renderer.extraction.status") === "preserve") {
              segment.status = "preserved";
            }
          });
        }
        logPdfCompleteness(result, state.segments);
        debugPdfLog("[pdf] extracted file=", result.fileName, "chars=", state.extractedText.length, "items=", state.textItems.length, "segments=", state.segments.length, "preview=", state.extractedText.slice(0, 500));
        setPdfWorkflowState("extracted", result);
        setPdfPreviewMode("raw");
      } catch (err) {
        if (taskId !== state.pdfTaskSeq) return true;
        state.error = String(err && err.message ? err.message : err);
        state.pdfExtract = { fileName: "PDF 提取失败", text: "" };
        state.extractedText = "";
        state.segments = [];
        state.translatedSegments = [];
        state.previewText = "";
        state.outputText = "";
        state.textItems = [];
        state.lines = [];
        state.rawLines = [];
        state.rawTextByPage = [];
        state.paragraphs = [];
        setPdfWorkflowState("extracted", state.pdfExtract);
        renderPdfPreview(state.pdfExtract);
        var previewEl = document.getElementById("pdfExtractPreview");
        if (previewEl) previewEl.textContent = "提取失败：" + String(err && err.message ? err.message : err);
      }
      return true;
    }

    if (dropZone) {
      dropZone.addEventListener("click", async function (event) {
        event.preventDefault();
        var modeMessage = requirePdfTranslationModeMessage();
        if (modeMessage) {
          var modeMetaEl = document.getElementById("pdfFileMeta");
          if (modeMetaEl) modeMetaEl.textContent = modeMessage;
          return;
        }
        if (!(await selectAndExtractFromElectron()) && input) {
          input.click();
        }
      });
    }

    if (input) input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!state.pdfTranslationMode) {
        input.value = "";
        setPdfWorkflowState("idle");
        return;
      }
      if (!file) {
        resetPdfDocumentState(null);
        setPdfWorkflowState("idle");
        return;
      }
      resetPdfDocumentState("browser-file:" + file.name + ":" + file.size + ":" + Date.now());
      state.selectedFile = { fileName: file.name, fileSize: file.size, fileId: state.pdfCurrentFileId };
      setPdfWorkflowState("staged", file);
    });

    if (prepareBtn) {
      prepareBtn.addEventListener("click", function () {
        if (state.pdfTranslating) {
          state.pdfTranslateCancelRequested = true;
          if (state.pdfTranslateAbortController) {
            try { state.pdfTranslateAbortController.abort(); } catch (_err) {}
          }
          setButtonText(prepareBtn, "取消中");
          return;
        }
        if (!state.extractedText) return;
        debugPdfLog("[pdf] translate text first500=", state.extractedText.slice(0, 500));
        startPdfSegmentTranslation();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        if (state.pdfTranslating) {
          state.pdfTranslateCancelRequested = true;
          state.pdfTranslatePaused = false;
          if (state.pdfTranslateAbortController) {
            try { state.pdfTranslateAbortController.abort(); } catch (_err) {}
          }
          setButtonText(clearBtn, "取消中");
          return;
        }
        if (input) input.value = "";
        state.pdfTaskSeq += 1;
        resetPdfDocumentState(null);
        setPdfWorkflowState("idle");
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener("click", openPdfExportModal);
      updatePdfExportButton();
    }

    setPdfWorkflowState("idle");

    var rawBtn = document.getElementById("btnPdfRawMode");
    var segmentBtn = document.getElementById("btnPdfSegmentMode");
    var closeModalBtn = document.getElementById("btnClosePdfSegmentModal");
    var copySourceBtn = document.getElementById("btnCopyPdfSource");
    var copyTranslationBtn = document.getElementById("btnCopyPdfTranslation");
    var modal = document.getElementById("pdfSegmentModal");
    var exportModal = document.getElementById("pdfExportModal");
    var closeExportModalBtn = document.getElementById("btnClosePdfExportModal");
    var cancelExportBtn = document.getElementById("btnCancelPdfExport");
    var exportPdfBtn = document.getElementById("btnExportPdfOnly");
    var exportPdfDebugFailBtn = document.getElementById("btnExportPdfDebugFail");
    var exportDebugLineBoxBtn = document.getElementById("btnExportDebugLineBox");
    var exportDebugMaskAreaBtn = document.getElementById("btnExportDebugMaskArea");
    var exportMaskLineBoxBtn = document.getElementById("btnExportMaskLineBox");
    if (rawBtn) rawBtn.addEventListener("click", function () { setPdfPreviewMode("raw"); });
    if (segmentBtn) segmentBtn.addEventListener("click", function () { setPdfPreviewMode("segments"); });
    if (closeModalBtn) closeModalBtn.addEventListener("click", closePdfSegmentModal);
    if (modal) modal.addEventListener("click", function (event) {
      if (event.target === modal) closePdfSegmentModal();
    });
    if (exportModal) exportModal.addEventListener("click", function (event) {
      if (event.target === exportModal) closePdfExportModal();
    });
    if (closeExportModalBtn) closeExportModalBtn.addEventListener("click", closePdfExportModal);
    if (cancelExportBtn) cancelExportBtn.addEventListener("click", closePdfExportModal);
    if (exportPdfBtn) exportPdfBtn.addEventListener("click", function () { exportPdfTranslationByFormat("pdf"); });
    if (exportPdfDebugFailBtn) exportPdfDebugFailBtn.addEventListener("click", function () { exportPdfTranslationByFormat("pdf_debug_fail"); });
    if (exportDebugLineBoxBtn) exportDebugLineBoxBtn.addEventListener("click", function () { exportPdfTranslationByFormat("debug_linebox"); });
    if (exportDebugMaskAreaBtn) exportDebugMaskAreaBtn.addEventListener("click", function () { exportPdfTranslationByFormat("debug_mask_area"); });
    if (exportMaskLineBoxBtn) exportMaskLineBoxBtn.addEventListener("click", function () { exportPdfTranslationByFormat("mask_linebox_test"); });
    try {
      if (typeof process !== "undefined" && process.env && process.env.PDF_AUTO_RUN === "1") {
        setTimeout(async function () {
          if (state.__pdfAutoRunStarted) return;
          state.__pdfAutoRunStarted = true;
          var ok = await selectAndExtractFromElectron();
          if (!ok || !state.pdfExtract || !state.extractedText) return;
          var translated = await startPdfSegmentTranslation();
          if (!translated) return;
          await exportPdfTranslationByFormat("pdf");
        }, 800);
      }
    } catch (_autoRunErr) {
      // Development-only automation should never affect the default UI flow.
    }
    if (copySourceBtn) copySourceBtn.addEventListener("click", function () {
      var text = state.activeSegment && state.activeSegment.sourceText ? state.activeSegment.sourceText : "";
      if (!text) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      }
    });
    if (copyTranslationBtn) copyTranslationBtn.addEventListener("click", function () {
      var text = state.activeSegment && state.activeSegment.translatedText ? state.activeSegment.translatedText : "";
      if (!text) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      }
    });
  }

  function getElectronIpc() {
    try {
      if (typeof require !== "function") return null;
      return require("electron").ipcRenderer;
    } catch (_err) {
      return null;
    }
  }

  async function refreshDesktopFeatureStatus() {
    var desktopBtn = document.getElementById("btnLaunchDesktopTranslate");
    var showLauncherBtn = document.getElementById("btnShowDesktopLauncher");
    var statusEl = document.getElementById("desktopFeatureStatus");
    var ipc = getElectronIpc();
    if (!desktopBtn || !ipc) return;

    try {
      var status = await ipc.invoke("desktop-feature:status");
      if (status && status.running) {
        state.desktopFeatureRunning = true;
        desktopBtn.disabled = false;
        setButtonText(desktopBtn, "桌面翻译已启动");
        desktopBtn.setAttribute("data-state", "running");
        desktopBtn.title = "桌面翻译已在运行";
        if (showLauncherBtn) {
          showLauncherBtn.classList.remove("hidden");
          showLauncherBtn.disabled = false;
          showLauncherBtn.title = "显示悬浮球";
        }
        if (statusEl) {
          statusEl.textContent = "运行中";
          statusEl.setAttribute("data-state", "running");
        }
      } else {
        state.desktopFeatureRunning = false;
        desktopBtn.disabled = false;
        setButtonText(desktopBtn, "启动桌面翻译");
        desktopBtn.setAttribute("data-state", "idle");
        desktopBtn.title = "启动桌面翻译";
        if (showLauncherBtn) {
          showLauncherBtn.classList.add("hidden");
          showLauncherBtn.disabled = false;
        }
        if (statusEl) {
          statusEl.textContent = "未启动";
          statusEl.setAttribute("data-state", "idle");
        }
      }
    } catch (_err) {
      state.desktopFeatureRunning = false;
      desktopBtn.disabled = false;
      setButtonText(desktopBtn, "启动桌面翻译");
      desktopBtn.setAttribute("data-state", "unknown");
      if (showLauncherBtn) {
        showLauncherBtn.classList.add("hidden");
        showLauncherBtn.disabled = false;
      }
      if (statusEl) {
        statusEl.textContent = "未知";
        statusEl.setAttribute("data-state", "unknown");
      }
    }
  }

  async function showDesktopLauncher() {
    var showLauncherBtn = document.getElementById("btnShowDesktopLauncher");
    var ipc = getElectronIpc();
    if (!ipc) return;
    if (showLauncherBtn) {
      showLauncherBtn.disabled = true;
      showLauncherBtn.title = "正在显示悬浮球";
    }
    try {
      var result = await ipc.invoke("desktop-feature:show");
      if (showLauncherBtn) {
        showLauncherBtn.title = result && result.ok ? "悬浮球已显示" : "显示悬浮球失败";
      }
    } catch (err) {
      if (showLauncherBtn) showLauncherBtn.title = "显示悬浮球失败：" + String(err.message || err);
    } finally {
      if (showLauncherBtn) showLauncherBtn.disabled = false;
      await refreshDesktopFeatureStatus();
    }
  }

  async function launchDesktopTranslate() {
    var desktopBtn = document.getElementById("btnLaunchDesktopTranslate");
    var ipc = getElectronIpc();

    if (!ipc) {
      if (desktopBtn) desktopBtn.title = "当前不是 Electron 环境，无法启动桌面翻译";
      return;
    }

    if (desktopBtn) {
      desktopBtn.disabled = true;
      setButtonText(desktopBtn, "正在启动");
    }

    try {
      var result = await ipc.invoke("desktop-feature:start");
      if (result && result.ok) {
        if (desktopBtn) {
          desktopBtn.title = result.alreadyRunning ? "桌面翻译已经在运行" : "桌面翻译已启动";
        }
      } else {
        if (desktopBtn) desktopBtn.title = "桌面翻译启动失败：" + (result && result.error ? result.error : "unknown_error");
      }
    } catch (err) {
      if (desktopBtn) desktopBtn.title = "桌面翻译启动失败：" + String(err.message || err);
    } finally {
      await refreshDesktopFeatureStatus();
    }
  }


  async function startSimplePdfSegmentTranslation(options) {
    options = options || {};
    var onlyRemaining = Boolean(options.onlyRemaining);
    if (state.pdfTranslating) {
      state.pdfTranslateCancelRequested = true;
      if (state.pdfTranslateAbortController) { try { state.pdfTranslateAbortController.abort(); } catch(_e) {} }
      return false;
    }
    if (sameConcreteLanguage(state.pdfSourceLang, state.pdfTargetLang)) {
      state.error = "源语言和目标语言相同，请修改目标语言。";
      var el = document.getElementById("pdfFileMeta");
      if (el) el.textContent = state.error;
      return false;
    }
    if (!state.extractedText) return false;
    if (!state.segments.length) {
      var missingSimpleSegmentsError = new Error("Canonical simple PDF segments are required before translation");
      missingSimpleSegmentsError.code = "SEMANTIC_CONSUMER_SEGMENTS_REQUIRED";
      throw missingSimpleSegmentsError;
    }
    if (!state.segments.length) return false;
    var translatable = getSimplePdfTranslatableEntries();
    if (!translatable.length) { state.error = "普通版PDF未找到可翻译正文段。"; return false; }
    var taskId = state.pdfTranslateTaskSeq + 1;
    var fileId = state.pdfCurrentFileId;
    state.pdfTranslateTaskSeq = taskId;
    state.pdfTranslateCancelRequested = false;
    state.pdfTranslatePaused = false;
    state.pdfTranslating = true;
    state.pdfPartialRegressionMode = false;
    state.pdfPartialTranslateRatio = 0;
    state.progress = { current: 0, total: state.segments.length, percent: 0 };
    state.translatedSegments = state.segments.filter(function(s){return s.status==="done"&&s.translatedText;});
    state.segments.forEach(function(segment){
      if (!isSimplePdfTranslatableSegment(segment)) { segment.status = "preserved"; segment.translatedText = ""; return; }
      if (!onlyRemaining && state.translatedSegments.filter(function(s){return isSimplePdfTranslatableSegment(s);}).length===translatable.length) {
        segment.status = "pending"; segment.translatedText = ""; return;
      }
      if (segment.status!=="done") segment.status = "pending";
      segment.partialRegressionNotTranslated = false;
      segment.promptLeakDetected = false;
      segment.invalidTranslationDetected = false;
      segment.invalidTranslationReason = "";
    });
    var targetIndexes = translatable.filter(function(e){return e.segment.status!=="done"||!e.segment.translatedText||!String(e.segment.translatedText).trim();}).map(function(e){return e.index;});
    if (!targetIndexes.length) {
      state.pdfTranslating = false;
      state.progress = { current: state.segments.length, total: state.segments.length, percent: 100 };
      setPdfWorkflowState("translated", state.pdfExtract);
      return true;
    }
    setPdfWorkflowState("translating", state.pdfExtract);
    setPdfPreviewMode("segments");
    for (var i=0;i<state.segments.length;i+=1) {
      if (taskId!==state.pdfTranslateTaskSeq||fileId!==state.pdfCurrentFileId) return false;
      if (state.pdfTranslateCancelRequested) break;
      if (!(await waitWhilePdfTranslationPaused(taskId, fileId))) break;
      var segment = state.segments[i];
      if (segment.status==="done"&&segment.translatedText) continue;
      if (onlyRemaining&&targetIndexes.indexOf(i)<0) continue;
      if (targetIndexes.indexOf(i)<0) continue;
      segment.status = "translating";
      var before = getSimplePdfTranslationCompleteness();
      state.progress = { current: Math.min(before.totalSegments,before.doneSegments+before.failedSegments+1), total: before.totalSegments, percent: before.totalSegments ? Math.round(((before.doneSegments+before.failedSegments)/before.totalSegments)*100) : 0 };
      setPdfWorkflowState("translating", state.pdfExtract);
      renderPdfSegmentsPreview();
      try {
        state.pdfTranslateAbortController = new AbortController();
        segment.error = "";
        var translated = await translateSegmentSourceText(segment.sourceText||"", state.pdfTranslateAbortController.signal);
        var invalidReason = getInvalidTranslationReason(segment.sourceText||"", translated);
        if (invalidReason) { markInvalidTranslationSegment(segment, invalidReason, translated); throw Object.assign(new Error(invalidReason), {handledInvalidTranslation:true}); }
        state.pdfTranslateAbortController = null;
        if (taskId!==state.pdfTranslateTaskSeq||fileId!==state.pdfCurrentFileId) return false;
        segment.translatedText = translated;
        var protectionReport = translateSegmentSourceText.lastProtectionReport || {};
        segment.citationTokenProtectedCount = Number(protectionReport.citationTokenProtectedCount || 0);
        segment.citationTokenRestoreFailedCount = Number(protectionReport.citationTokenRestoreFailedCount || 0);
        segment.citationNameMutationRiskCount = Number(protectionReport.citationNameMutationRiskCount || 0);
        segment.citationTokenRestoreFailedExamples = protectionReport.citationTokenRestoreFailedExamples || [];
        segment.status = "done";
      } catch(err) {
        if (taskId!==state.pdfTranslateTaskSeq||fileId!==state.pdfCurrentFileId) return false;
        state.pdfTranslateAbortController = null;
        if (state.pdfTranslateCancelRequested||(err&&err.name==="AbortError")) { segment.status = "pending"; break; }
        if (!err||!err.handledInvalidTranslation) { segment.status = "failed"; segment.translatedText = ""; segment.error = String(err&&err.message?err.message:err); }
      }
      var after = getSimplePdfTranslationCompleteness();
      state.progress = { current: after.doneSegments+after.failedSegments, total: after.totalSegments, percent: after.totalSegments ? Math.round(((after.doneSegments+after.failedSegments)/after.totalSegments)*100) : 0 };
      setPdfWorkflowState("translating", state.pdfExtract);
      renderPdfSegmentsPreview();
    }
    if (taskId!==state.pdfTranslateTaskSeq||fileId!==state.pdfCurrentFileId) return false;
    state.pdfTranslateAbortController = null;
    state.pdfTranslating = false;
    state.translatedSegments = state.segments.filter(function(s){return s.status==="done";});
    renderPdfSegmentsPreview();
    setPdfWorkflowState(state.pdfTranslateCancelRequested?"canceled":"translated", state.pdfExtract);
    return !state.pdfTranslateCancelRequested;
  }


async function startSimplePdfTranslation(fileId) {
  return startPdfTranslationForMode(fileId, "simple_pdf");
}

function startPaperPdfTranslation(fileId) {
  return startPdfTranslationForMode(fileId, "paper_pdf");
}

function startPdfTranslationForMode(fileId, mode) {
  if (mode !== "simple_pdf" && mode !== "paper_pdf") {
    throw new Error("Invalid PDF translation mode: " + mode);
  }
  state.pdfTranslationMode = mode;
  state.modeLockedByUser = true;
  renderPdfModeSelector();
  document.getElementById("btnSelectPdfFile").click();
}

async function boot() {
    setupMaterialIconReadiness();
    setupWindowControls();
    setupAppNav();
    await loadSharedConfig();
    await setupTranslatePage();
    await setupProviderSettingsPage();
    setupPdfModule();
    window.setInterval(refreshDesktopFeatureStatus, DESKTOP_STATUS_INTERVAL_MS);
    window.addEventListener("focus", function () {
      refreshDesktopFeatureStatus();
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        refreshDesktopFeatureStatus();
      }
    });
  }

  boot();
})();
