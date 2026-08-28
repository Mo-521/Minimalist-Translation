#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const pdfjsLib = require("../electron-app/node_modules/pdfjs-dist/legacy/build/pdf.js");

const ALLOWED_WRITE_TYPES = new Set([
  "title",
  "author",
  "affiliation",
  "abstract",
  "keywords",
  "heading",
  "body",
  "caption",
  "abstract-title",
]);

const PRESERVE_TYPES = new Set([
  "reference",
  "formula",
  "imageText",
  "pageNumber",
  "footer",
  "margin",
  "noise",
  "header",
]);

const FORMULA_TOKENS = [
  "Lbol",
  "kbol",
  "λEdd",
  "LEdd",
  "MBH",
  "LX",
  "Γ",
  "M⊙",
  "[O III]",
  "log(",
  "10^",
  "×10",
  "erg s",
  "keV",
  "cm−2",
  "cm-2",
  "≈",
  "±",
];

const GLYPH_RE = /[□▯�￾\u{100000}-\u{10ffff}\uE000-\uF8FF]/u;

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : "true";
    args[key] = value;
  }
  return args;
}

function requireArg(args, name) {
  if (!args[name]) throw new Error(`Missing --${name}`);
  return args[name];
}

function normalizeText(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactForMatch(text) {
  return normalizeText(text).toLowerCase().replace(/\s+/g, "");
}

function preview(text, limit = 120) {
  const value = normalizeText(text);
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function safeJsonRead(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function extractPdfTextByPage(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const loadingTask = pdfjsLib.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const items = textContent.items || [];
    const text = items.map((item) => item.str || "").join(" ");
    pages.push({
      pageNumber,
      text: normalizeText(text),
      compactText: compactForMatch(text),
      itemCount: items.length,
    });
  }
  return pages;
}

function findImportantTerms(text) {
  const value = String(text || "");
  return FORMULA_TOKENS.filter((token) => value.includes(token));
}

function textAppearsOnPage(needle, pageText) {
  const compactNeedle = compactForMatch(needle);
  if (compactNeedle.length < 8) return false;
  const probe = compactNeedle.slice(0, Math.min(42, compactNeedle.length));
  return pageText.includes(probe);
}

function translatedKeywordsAppear(translatedPreview, pageText) {
  const normalized = normalizeText(translatedPreview);
  const parts = normalized
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}\p{N}\u3400-\u9fff]/gu, ""))
    .filter((part) => part.length >= 3)
    .slice(0, 8);
  if (!parts.length) return false;
  const compactPage = pageText;
  return parts.some((part) => compactPage.includes(compactForMatch(part)));
}

function boxArea(box) {
  return box && Number(box.width) > 0 && Number(box.height) > 0
    ? Number(box.width) * Number(box.height)
    : 0;
}

function overlapArea(a, b) {
  if (!a || !b) return 0;
  const left = Math.max(Number(a.x || 0), Number(b.x || 0));
  const top = Math.max(Number(a.y || 0), Number(b.y || 0));
  const right = Math.min(Number(a.x || 0) + Number(a.width || 0), Number(b.x || 0) + Number(b.width || 0));
  const bottom = Math.min(Number(a.y || 0) + Number(a.height || 0), Number(b.y || 0) + Number(b.height || 0));
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function verticalGap(a, b) {
  if (!a || !b) return null;
  const aBottom = Number(a.y || 0) + Number(a.height || 0);
  const bTop = Number(b.y || 0);
  return Number((bTop - aBottom).toFixed(2));
}

function coverageRatio(maskBbox, bbox) {
  const bboxArea = boxArea(bbox);
  if (!bboxArea) return 0;
  return Number((overlapArea(maskBbox, bbox) / bboxArea).toFixed(3));
}

function maskPadding(maskBbox, bbox) {
  if (!maskBbox || !bbox) return null;
  return {
    left: Number((Number(bbox.x || 0) - Number(maskBbox.x || 0)).toFixed(2)),
    top: Number((Number(bbox.y || 0) - Number(maskBbox.y || 0)).toFixed(2)),
    right: Number(((Number(maskBbox.x || 0) + Number(maskBbox.width || 0)) - (Number(bbox.x || 0) + Number(bbox.width || 0))).toFixed(2)),
    bottom: Number(((Number(maskBbox.y || 0) + Number(maskBbox.height || 0)) - (Number(bbox.y || 0) + Number(bbox.height || 0))).toFixed(2)),
  };
}

function buildNeighborMap(reports) {
  const groups = new Map();
  reports.forEach((report) => {
    const key = `${report.pageNumber}:${report.column || "single"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(report);
  });
  groups.forEach((items) => {
    items.sort((a, b) => {
      const ay = Number(a.bbox && a.bbox.y || 0);
      const by = Number(b.bbox && b.bbox.y || 0);
      if (Math.abs(ay - by) > 1) return ay - by;
      return Number(a.bbox && a.bbox.x || 0) - Number(b.bbox && b.bbox.x || 0);
    });
  });
  const neighbors = new Map();
  groups.forEach((items) => {
    items.forEach((item, index) => {
      neighbors.set(item.id, {
        previous: items[index - 1] || null,
        next: items[index + 1] || null,
      });
    });
  });
  return neighbors;
}

function expectedActionFor(report) {
  const type = String(report.type || "body");
  if (PRESERVE_TYPES.has(type)) return "preserve_original";
  if (
    ALLOWED_WRITE_TYPES.has(type) &&
    report.status === "done" &&
    report.hasTranslatedText &&
    !report.skipReason
  ) {
    return "mask_and_write";
  }
  if (ALLOWED_WRITE_TYPES.has(type)) return "not_ready_or_skipped";
  return "unknown";
}

function classifySegment(report, translatedPage, sourcePage, neighbors) {
  const expectedAction = expectedActionFor(report);
  const sourceText = report.textPreview || "";
  const translatedText = report.translatedPreview || "";
  const hasSourceTextInTranslatedPage = textAppearsOnPage(sourceText, translatedPage && translatedPage.compactText);
  const hasTranslatedTextInTranslatedPage = translatedKeywordsAppear(translatedText, translatedPage && translatedPage.compactText);
  const expectedPreserveOriginal = expectedAction === "preserve_original";
  const ratio = coverageRatio(report.maskBbox, report.bbox);
  const padding = maskPadding(report.maskBbox, report.bbox);
  const risks = [];
  let diagnosis = [];
  let suggestedFix = [];

  let possibleVisualMaskLeak = false;
  let possibleUntranslatedAllowedSegment = false;
  let possibleBBoxProblem = false;
  let possibleLayerOrderProblem = false;
  let possibleFontProblem = false;
  let possibleColumnFlowProblem = false;

  if (expectedAction === "mask_and_write") {
    if (!report.maskApplied || !report.writeApplied) {
      risks.push("failed_mask_write_report");
      diagnosis.push("Report says a writable done segment did not complete both mask and write.");
      suggestedFix.push("Trace exportTranslatedPdf mask/write branch for this segment.");
    }
    if (!report.maskBbox) {
      possibleBBoxProblem = true;
      risks.push("mask_bbox_missing");
      diagnosis.push("Mask bbox is missing for a writable segment.");
    } else {
      if (ratio < 0.95) {
        possibleVisualMaskLeak = true;
        possibleBBoxProblem = true;
        risks.push("likely_partial_mask");
        diagnosis.push(`Mask coverage ratio is ${ratio}, below 0.95.`);
        suggestedFix.push("Inspect segment bbox/lineBoxes union and mask padding.");
      }
      if (report.bbox && report.maskBbox.height < report.bbox.height * 0.95) {
        possibleVisualMaskLeak = true;
        risks.push("likely_mask_too_short");
      }
      if (report.bbox && report.maskBbox.width < report.bbox.width * 0.95) {
        possibleVisualMaskLeak = true;
        risks.push("likely_mask_too_narrow");
      }
      if (padding && (padding.left < -1 || padding.top < -1 || padding.right < -1 || padding.bottom < -1)) {
        possibleVisualMaskLeak = true;
        risks.push("likely_mask_offset");
      }
    }
    if (!translatedText || translatedText.length < 6) {
      possibleUntranslatedAllowedSegment = true;
      risks.push("translated_preview_empty_or_short");
    }
    if (!report.writeBbox) {
      possibleUntranslatedAllowedSegment = true;
      risks.push("write_bbox_missing");
    }
    if (!report.finalFontSize) {
      possibleFontProblem = true;
      risks.push("font_size_missing");
    }
    if (!hasTranslatedTextInTranslatedPage) {
      risks.push("possible_write_missing_text_layer");
      diagnosis.push("Translated preview keywords were not found in translated PDF text layer.");
      suggestedFix.push("Check whether drawText used sanitized/truncated text or text extraction lost glyphs.");
    }
    if (hasSourceTextInTranslatedPage) {
      risks.push("textLayerResidual");
      diagnosis.push("Source preview is still present in translated PDF text layer; this can be normal in overlay-mask mode.");
    }
  }

  if (expectedAction === "preserve_original") {
    if (!String(report.skipReason || "").endsWith("_preserve_original")) {
      risks.push("ambiguous_preserve_skip_reason");
      suggestedFix.push("Use semantic preserve skipReason instead of unsupported_type.");
    }
    if (!hasSourceTextInTranslatedPage && sourceText.length >= 8) {
      risks.push("preserve_original_not_found_in_text_layer");
    }
  }

  const glyphSource = `${translatedText} ${translatedPage ? translatedPage.text : ""}`;
  const possibleGlyphIssue = GLYPH_RE.test(glyphSource);
  if (possibleGlyphIssue) {
    risks.push("glyphIssue");
    possibleFontProblem = true;
    const formulaTerms = findImportantTerms(`${sourceText} ${translatedText}`);
    diagnosis.push(formulaTerms.length
      ? `Glyph risk near formula/special terms: ${formulaTerms.join(", ")}.`
      : "Glyph risk detected in translated preview or page text.");
    suggestedFix.push("Add font fallback/sanitization for unsupported glyphs and formula symbols.");
  }

  const neighbor = neighbors.get(report.id) || {};
  const previous = neighbor.previous;
  const next = neighbor.next;
  const previousSegmentGap = previous ? verticalGap(previous.bbox, report.bbox) : null;
  const nextSegmentGap = next ? verticalGap(report.bbox, next.bbox) : null;
  const overlapsPreviousMask = previous ? overlapArea(report.writeBbox || report.maskBbox, previous.maskBbox || previous.bbox) > 0 : false;
  const overlapsNextMask = next ? overlapArea(report.writeBbox || report.maskBbox, next.maskBbox || next.bbox) > 0 : false;
  const neighborLayoutRisk = [];
  if (overlapsPreviousMask) neighborLayoutRisk.push("overlap_previous");
  if (overlapsNextMask) neighborLayoutRisk.push("overlap_next");
  if (nextSegmentGap !== null && nextSegmentGap < 2 && expectedAction === "mask_and_write") neighborLayoutRisk.push("too_close_to_next");
  if (previousSegmentGap !== null && previousSegmentGap < 2 && expectedAction === "mask_and_write") neighborLayoutRisk.push("too_close_to_previous");
  if (report.column === "left" && report.writeBbox && report.writeBbox.x + report.writeBbox.width > 320) {
    neighborLayoutRisk.push("crosses_column_boundary");
    possibleColumnFlowProblem = true;
  }
  if (report.column === "right" && report.writeBbox && report.writeBbox.x < 285) {
    neighborLayoutRisk.push("crosses_column_boundary");
    possibleColumnFlowProblem = true;
  }
  if (neighborLayoutRisk.length) risks.push(...neighborLayoutRisk);

  const auditStatus = risks.includes("failed_mask_write_report")
    ? "failed_mask_write_report"
    : (risks.length ? "needs_review" : "ok");
  const riskLevel = risks.some((risk) => ["failed_mask_write_report", "likely_partial_mask", "write_bbox_missing"].includes(risk))
    ? "P0"
    : (risks.length ? "P1" : "OK");

  return {
    id: report.id,
    pageNumber: report.pageNumber,
    type: report.type,
    layoutType: report.layoutType,
    column: report.column,
    textPreview: report.textPreview,
    translatedPreview: report.translatedPreview,
    bbox: report.bbox,
    maskBbox: report.maskBbox,
    writeBbox: report.writeBbox,
    maskApplied: report.maskApplied,
    writeApplied: report.writeApplied,
    writeStrategy: report.writeStrategy,
    finalFontSize: report.finalFontSize,
    skipReason: report.skipReason,
    isFormulaLike: report.isFormulaLike,
    isReference: report.isReference,
    formulaPreserveMode: report.formulaPreserveMode,
    formulaLinePreserveCount: report.formulaLinePreserveCount,
    expectedAction,
    auditStatus,
    riskLevel,
    hasSourceTextInTranslatedPage,
    hasTranslatedTextInTranslatedPage,
    expectedPreserveOriginal,
    possibleVisualMaskLeak,
    possibleUntranslatedAllowedSegment,
    possibleGlyphIssue,
    possibleBBoxProblem,
    possibleLayerOrderProblem,
    possibleFontProblem,
    possibleColumnFlowProblem,
    previousSegmentId: previous ? previous.id : "",
    nextSegmentId: next ? next.id : "",
    previousSegmentGap,
    nextSegmentGap,
    overlapsPreviousMask,
    overlapsNextMask,
    overlapsImageRegionIfKnown: false,
    crossesColumnBoundary: possibleColumnFlowProblem,
    bboxMaskCoverageRatio: ratio,
    maskPadding: padding,
    importantFormulaTerms: findImportantTerms(`${sourceText} ${translatedText}`),
    residualRisk: hasSourceTextInTranslatedPage && expectedAction === "mask_and_write" ? "textLayerResidual_possible" : "",
    visualRiskReason: risks.filter((risk) => risk.startsWith("likely_") || risk.includes("mask")),
    glyphRisk: possibleGlyphIssue ? "possible_glyph_issue" : "",
    neighborLayoutRisk,
    diagnosis: diagnosis.join(" "),
    suggestedFix: [...new Set(suggestedFix)].join(" "),
  };
}

function summarizePages(auditSegments, pageLayouts) {
  const byPage = new Map();
  auditSegments.forEach((segment) => {
    if (!byPage.has(segment.pageNumber)) byPage.set(segment.pageNumber, []);
    byPage.get(segment.pageNumber).push(segment);
  });
  const layoutByPage = new Map((pageLayouts || []).map((page) => [page.pageNumber, page.layoutType]));
  return [...byPage.entries()].sort((a, b) => a[0] - b[0]).map(([pageNumber, segments]) => {
    const possibleVisualMaskLeaks = segments.filter((segment) => segment.possibleVisualMaskLeak).length;
    const possibleGlyphIssues = segments.filter((segment) => segment.possibleGlyphIssue).length;
    const possibleUntranslatedSegments = segments.filter((segment) => segment.possibleUntranslatedAllowedSegment).length;
    const possibleColumnFlowIssues = segments.filter((segment) => segment.possibleColumnFlowProblem).length;
    const writtenSegments = segments.filter((segment) => segment.writeApplied).length;
    const preservedSegments = segments.filter((segment) => segment.expectedAction === "preserve_original").length;
    const formulaSegments = segments.filter((segment) => segment.formulaPreserveMode).length;
    const referenceSegments = segments.filter((segment) => segment.type === "reference").length;
    const headerSegments = segments.filter((segment) => segment.type === "header").length;
    const pageDiagnosis = [];
    if (possibleVisualMaskLeaks) pageDiagnosis.push("possible visual mask leaks from bbox coverage/padding.");
    if (possibleGlyphIssues) pageDiagnosis.push("possible glyph/font issues.");
    if (possibleColumnFlowIssues) pageDiagnosis.push("possible column flow boundary issue.");
    if (!pageDiagnosis.length) pageDiagnosis.push("no structural audit warnings.");
    return {
      pageNumber,
      layoutType: layoutByPage.get(pageNumber) || "",
      totalSegments: segments.length,
      writtenSegments,
      preservedSegments,
      formulaSegments,
      referenceSegments,
      headerSegments,
      possibleVisualMaskLeaks,
      possibleGlyphIssues,
      possibleUntranslatedSegments,
      possibleColumnFlowIssues,
      pageDiagnosis: pageDiagnosis.join(" "),
    };
  });
}

function buildHtml(audit) {
  const rows = audit.topSuspiciousSegments.map((segment) => `
    <tr>
      <td>${segment.id}</td>
      <td>${segment.pageNumber}</td>
      <td>${segment.type}</td>
      <td>${segment.riskLevel}</td>
      <td>${segment.auditStatus}</td>
      <td>${escapeHtml(segment.textPreview || "")}</td>
      <td>${escapeHtml(segment.diagnosis || "")}</td>
      <td>${escapeHtml(segment.suggestedFix || "")}</td>
    </tr>
  `).join("\n");
  return `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>Translated PDF Audit</title>
<style>
body{font-family:Arial,"Microsoft YaHei",sans-serif;margin:24px;color:#1f2a44;background:#f7f8ff}
pre,table{background:white;border:1px solid #dbe2ff;border-radius:8px}
pre{padding:14px;white-space:pre-wrap}
table{border-collapse:collapse;width:100%;overflow:hidden}
td,th{border-bottom:1px solid #e6ebff;padding:8px;vertical-align:top;font-size:13px}
th{background:#eef2ff;text-align:left}
</style>
<h1>Translated PDF Audit</h1>
<h2>Summary</h2>
<pre>${escapeHtml(JSON.stringify(audit.summary, null, 2))}</pre>
<h2>Page Audit</h2>
<pre>${escapeHtml(JSON.stringify(audit.pages, null, 2))}</pre>
<h2>Top Suspicious Segments</h2>
<table><thead><tr><th>id</th><th>page</th><th>type</th><th>risk</th><th>status</th><th>preview</th><th>diagnosis</th><th>suggested fix</th></tr></thead><tbody>${rows}</tbody></table>
</html>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function main() {
  const args = parseArgs(process.argv);
  const sourcePdfPath = requireArg(args, "source");
  const translatedPdfPath = requireArg(args, "translated");
  const segmentReportsPath = requireArg(args, "reports");
  const outputAuditJsonPath = requireArg(args, "out-json");
  const outputAuditHtmlPath = args["out-html"];

  [sourcePdfPath, translatedPdfPath, segmentReportsPath].forEach((filePath) => {
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  });

  const reportsJson = safeJsonRead(segmentReportsPath);
  const sourcePages = await extractPdfTextByPage(sourcePdfPath);
  const translatedPages = await extractPdfTextByPage(translatedPdfPath);
  const reports = reportsJson.reports || [];
  const neighbors = buildNeighborMap(reports);
  const auditSegments = reports.map((report) => classifySegment(
    report,
    translatedPages[Number(report.pageNumber || 0) - 1],
    sourcePages[Number(report.pageNumber || 0) - 1],
    neighbors,
  ));
  const pages = summarizePages(auditSegments, reportsJson.pageLayouts || []);

  const counts = {
    textLayerResidual: auditSegments.filter((segment) => segment.residualRisk === "textLayerResidual_possible").length,
    preserveOriginal: auditSegments.filter((segment) => segment.expectedAction === "preserve_original").length,
    possibleVisualMaskLeak: auditSegments.filter((segment) => segment.possibleVisualMaskLeak).length,
    possibleUntranslatedAllowedSegment: auditSegments.filter((segment) => segment.possibleUntranslatedAllowedSegment).length,
    glyphIssue: auditSegments.filter((segment) => segment.possibleGlyphIssue).length,
    formulaWholeSegmentPreserve: auditSegments.filter((segment) => segment.formulaPreserveMode === "whole_segment").length,
    formulaLinePreserve: auditSegments.filter((segment) => segment.formulaPreserveMode === "line").length,
  };

  const topSuspiciousSegments = auditSegments
    .filter((segment) => segment.riskLevel !== "OK")
    .sort((a, b) => {
      const weight = { P0: 0, P1: 1, P2: 2, OK: 3 };
      return (weight[a.riskLevel] || 9) - (weight[b.riskLevel] || 9) || a.pageNumber - b.pageNumber;
    })
    .slice(0, 20);

  const audit = {
    generatedAt: new Date().toISOString(),
    sourcePdfPath,
    translatedPdfPath,
    segmentReportsPath,
    sourcePdf: {
      exists: fs.existsSync(sourcePdfPath),
      size: fs.statSync(sourcePdfPath).size,
      modifiedAt: fs.statSync(sourcePdfPath).mtime.toISOString(),
      pages: sourcePages.length,
    },
    translatedPdf: {
      exists: fs.existsSync(translatedPdfPath),
      size: fs.statSync(translatedPdfPath).size,
      modifiedAt: fs.statSync(translatedPdfPath).mtime.toISOString(),
      pages: translatedPages.length,
    },
    segmentReports: {
      exists: fs.existsSync(segmentReportsPath),
      size: fs.statSync(segmentReportsPath).size,
      modifiedAt: fs.statSync(segmentReportsPath).mtime.toISOString(),
      summary: reportsJson.summary || {},
      pageLayouts: reportsJson.pageLayouts || [],
    },
    summary: {
      ...counts,
      totalSegments: auditSegments.length,
      p0: auditSegments.filter((segment) => segment.riskLevel === "P0").length,
      p1: auditSegments.filter((segment) => segment.riskLevel === "P1").length,
      ok: auditSegments.filter((segment) => segment.riskLevel === "OK").length,
    },
    pages,
    segments: auditSegments,
    topSuspiciousSegments,
    manualReview: {
      status: "pending",
      notes: [],
    },
  };

  fs.mkdirSync(path.dirname(outputAuditJsonPath), { recursive: true });
  fs.writeFileSync(outputAuditJsonPath, JSON.stringify(audit, null, 2), "utf8");
  if (outputAuditHtmlPath) {
    fs.mkdirSync(path.dirname(outputAuditHtmlPath), { recursive: true });
    fs.writeFileSync(outputAuditHtmlPath, buildHtml(audit), "utf8");
  }
  console.log(JSON.stringify({
    ok: true,
    outputAuditJsonPath,
    outputAuditHtmlPath: outputAuditHtmlPath || "",
    summary: audit.summary,
  }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
