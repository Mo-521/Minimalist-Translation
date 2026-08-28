const path = require("path");

const AUTHORITY_VERSION = "paper-layout-authority/v1";

const GLOBAL_LAYOUT_POLICY = Object.freeze({
  layoutPlanPushDownGap: 2,
  layoutPlanPushDownMaxShift: 500,
  visualGroupMaxSegmentCount: 5,
  visualGroupMaxPageHeightRatio: 0.42,
  visualGroupMinHeightPerMember: 29,
  defaultPageWidth: 612,
  defaultPageHeight: 792,
  columnMarginMinimum: 32,
  columnMarginWidthRatio: 0.06,
  columnGutterMinimum: 18,
  columnGutterWidthRatio: 0.035,
  writeBoxTooNarrowWidth: 8,
  existingPlanPushDownGap: 6,
  pageBottomMarginMinimum: 36,
  pageBottomMarginHeightRatio: 0.055,
  writeBoxMaxBorrowRatio: 0.2,
  writeBoxMaxBorrowHeight: 12,
  exactWriteSafetyPaddingMinimum: 2,
  exactWriteSafetyPaddingLineHeightFactor: 0.25,
  overflowExtraHeightLineFactor: 1.1,
  overflowExtraHeightPadding: 4,
  renderedBackgroundShrinkThreshold: 0.85,
  renderedBackgroundMinimumHeight: 4,
  renderedBackgroundExtraHeight: 2,
});

const DEFAULT_ZH_FONT_SIZE_SCALE = Object.freeze({
  title: 13.5,
  heading: 11.5,
  body: 10.5,
  abstract: 10.5,
  keywords: 10.5,
  caption: 8.5,
  affiliation: 8,
  funding: 8,
  receivedDate: 8,
  correspondence: 8,
  metadata: 8,
  fallback: 10.5,
});

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function roundToHalf(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Number((Math.round(number * 2) / 2).toFixed(1));
}

function medianNumber(values, fallback = 0) {
  const numbers = (values || [])
    .map((value) => Number(value || 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!numbers.length) return fallback;
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
}

function normalizeZhFontSizeType(type) {
  const value = String(type || "fallback");
  if (value === "abstract-title") return "heading";
  if (value === "abstract" || value === "keywords" || value === "paragraph") return "body";
  if (["affiliation", "funding", "receivedDate", "correspondence", "metadata"].includes(value)) return "metadata";
  if (Object.prototype.hasOwnProperty.call(DEFAULT_ZH_FONT_SIZE_SCALE, value)) return value;
  return "fallback";
}

function getZhFontFamilyFromPath(fontPath) {
  const name = path.basename(String(fontPath || "")).toLowerCase();
  if (/simhei|黑体|heiti/.test(name)) return "SimHei";
  if (/simsun|宋体|songti/.test(name)) return "SimSun";
  if (/source\s*han.*serif|noto.*serif/.test(name)) return "SourceHanSerif";
  if (/source\s*han.*sans|noto.*sans/.test(name)) return "SourceHanSans";
  if (/msyh|yahei|雅黑/.test(name)) return "MicrosoftYaHei";
  if (/deng/.test(name)) return "DengXian";
  return "unknown_cjk";
}

function getZhFontVisualScale(fontFamily) {
  const family = String(fontFamily || "").toLowerCase();
  if (family.includes("simhei")) return 0.85;
  if (family.includes("simsun")) return 0.9;
  if (family.includes("sourcehanserif") || family.includes("notoserif")) return 0.9;
  if (family.includes("sourcehansans") || family.includes("notosans")) return 0.87;
  if (family.includes("microsoftyahei") || family.includes("dengxian")) return 0.87;
  return 0.86;
}

function getReadableFontSizeRange(segmentType) {
  const type = String(segmentType || "body");
  if (type === "title") return { min: 10.5, max: 14 };
  if (type === "abstract" || type === "abstract-title" || type === "keywords") return { min: 8.5, max: 11 };
  if (type === "caption") return { min: 7.5, max: 9.5 };
  if (type === "heading") return { min: 9, max: 12 };
  if (["metadata", "correspondence", "funding", "receivedDate", "affiliation"].includes(type)) return { min: 6.8, max: 8.5 };
  return { min: 8.5, max: 11 };
}

function getReadableFontSizeRangeByVisualRole(role) {
  const value = String(role || "body_normal");
  if (value === "title_large") return { min: 10.5, max: 14 };
  if (value === "title_normal") return { min: 10, max: 13 };
  if (value === "heading_large") return { min: 9, max: 12 };
  if (value === "heading_normal") return { min: 8.2, max: 11 };
  if (value === "abstract_normal") return { min: 7.5, max: 9.5 };
  if (value === "caption_small") return { min: 6.5, max: 8.2 };
  if (value === "metadata_small") return { min: 6.2, max: 8 };
  if (value === "footer_small") return { min: 6, max: 7.5 };
  return { min: 7.5, max: 9.5 };
}

function getSourceVisualRole(segment, fontStats) {
  const type = String(segment && segment.type || "body");
  const ratio = Number(fontStats && fontStats.sourceFontSizeRatioToPageBody || 1);
  const bold = Boolean(fontStats && fontStats.sourceBoldLike);
  if (type === "title") return ratio >= 1.25 || bold ? "title_large" : "title_normal";
  if (type === "heading") return ratio >= 1.18 || bold ? "heading_large" : "heading_normal";
  if (type === "abstract" || type === "abstract-title") return "abstract_normal";
  if (type === "caption") return "caption_small";
  if (["affiliation", "correspondence", "receivedDate", "funding", "keywords"].includes(type)) return "metadata_small";
  if (["footer", "header", "pageNumber", "licenseText"].includes(type)) return "footer_small";
  return "body_normal";
}

function getVisualEquivalentZhFontSize(segment, effectiveEnglishBodyFontSize, visualRole) {
  const type = String(segment && segment.type || "body");
  const role = String(visualRole || "body_normal");
  const base = Math.max(6, Number(effectiveEnglishBodyFontSize || 0) || 9.5);
  let spec;
  if (role === "title_large") spec = { factor: 1.55, minFactor: 1.25, maxFactor: 1.75, hardMin: 11, hardMax: 14 };
  else if (role === "title_normal") spec = { factor: 1.35, minFactor: 1.25, maxFactor: 1.75, hardMin: 11, hardMax: 14 };
  else if (role === "heading_large" || role === "heading_normal" || type === "heading") spec = { factor: 1.18, minFactor: 1.1, maxFactor: 1.32, hardMin: 9, hardMax: 12 };
  else if (role === "abstract_normal" || type === "abstract") spec = { factor: 1.03, minFactor: 0.95, maxFactor: 1.1, hardMin: 8, hardMax: 10.8 };
  else if (type === "abstract-title") spec = { factor: 1.12, minFactor: 1.05, maxFactor: 1.25, hardMin: 9, hardMax: 12 };
  else if (role === "caption_small" || type === "caption") spec = { factor: 0.9, minFactor: 0.82, maxFactor: 1, hardMin: 7.2, hardMax: 9 };
  else if (role === "metadata_small" || ["affiliation", "correspondence", "receivedDate", "funding", "keywords"].includes(type)) spec = { factor: 0.88, minFactor: 0.78, maxFactor: 0.98, hardMin: 7, hardMax: 8.8 };
  else if (role === "footer_small") spec = { factor: 0.72, minFactor: 0.64, maxFactor: 0.8, hardMin: 6, hardMax: 7.5 };
  else spec = { factor: 1.03, minFactor: 0.95, maxFactor: 1.1, hardMin: 8, hardMax: 10.8 };
  const min = Math.max(spec.hardMin, base * spec.minFactor);
  const max = Math.min(spec.hardMax, base * spec.maxFactor);
  const fallbackMax = Math.max(spec.hardMin, max);
  const resolvedMin = min > fallbackMax ? spec.hardMin : min;
  const resolvedMax = min > fallbackMax ? fallbackMax : max;
  const preferred = clampNumber(base * spec.factor, resolvedMin, resolvedMax);
  return { default: preferred, min: resolvedMin, max: resolvedMax, effectiveEnglishBodyFontSize: base };
}

function resolveLineHeight(fontSize, segmentType, text = "", visualRole = "", isCjkTextFn = null) {
  const type = String(segmentType || "body");
  const role = String(visualRole || "");
  const roleMultiplier = role === "title_large" || role === "title_normal"
    ? 1.15
    : (role === "heading_large" || role === "heading_normal"
      ? 1.16
      : (role === "abstract_normal"
        ? 1.18
        : (role === "caption_small" ? 1.14 : (role === "metadata_small" || role === "footer_small" ? 1.12 : 0))));
  const typeMultiplier = type === "caption"
    ? 1.16
    : (type === "abstract" || type === "abstract-title" || type === "keywords"
      ? 1.22
      : (type === "title" ? 1.16 : (type === "heading" ? 1.2 : (["metadata", "correspondence", "funding", "receivedDate"].includes(type) ? 1.14 : 1.24))));
  let cjkMinimum = 1.08;
  const cjk = typeof isCjkTextFn === "function" ? Boolean(isCjkTextFn(text)) : /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(String(text || ""));
  if (cjk) {
    if (role === "caption_small") cjkMinimum = 1.1;
    else if (role === "metadata_small" || role === "footer_small") cjkMinimum = 1.08;
    else if (role === "heading_large" || role === "heading_normal") cjkMinimum = 1.12;
    else if (["body", "abstract", "abstract-title", "heading"].includes(type)) cjkMinimum = 1.16;
  }
  return Math.max(Number(fontSize || 0) * cjkMinimum, Number(fontSize || 0) * (roleMultiplier || typeMultiplier));
}

function resolveWriteKind(segment, lineMasks = [], cleanTextFn = null) {
  if (segment && segment.type === "caption") return "caption";
  if (segment && segment.type === "heading") return "heading";
  if (segment && segment.type === "title") return "title";
  if (segment && (segment.type === "abstract" || segment.type === "abstract-title")) return "abstract";
  if (segment && segment.type === "keywords") return "keywords";
  if (segment && ["correspondence", "funding", "receivedDate", "affiliation"].includes(String(segment.type || ""))) return "metadata";
  const clean = typeof cleanTextFn === "function" ? cleanTextFn : (value) => String(value || "").replace(/\s+/g, " ").trim();
  const sourceText = clean(segment && segment.sourceText);
  const translatedText = clean(segment && segment.translatedText);
  const firstSourceLine = sourceText.split(/\n+/)[0] || "";
  const firstTranslatedLine = translatedText.split(/\n+/)[0] || "";
  if (/^(abstract|摘要)\b/i.test(firstSourceLine) || /^摘要/.test(firstTranslatedLine)) return "abstract";
  if (/^(keywords|key words|关键词)\b/i.test(firstSourceLine) || /^关键词/.test(firstTranslatedLine)) return "keywords";
  if ((lineMasks || []).length <= 2 && sourceText.length <= 220 && translatedText.length <= 180) return "title";
  return "body";
}

function resolveWriteStyle(kind, averageFontSize, strategy) {
  const baseSize = Math.max(6, Number(averageFontSize || 0) || 9);
  if (strategy === "single_zh_to_en_paragraph_flow") {
    if (kind === "title" || kind === "heading") {
      return { align: "left", preferredFontSize: Math.min(12, Math.max(10, baseSize + 0.2)), maxSize: 12, minSize: 10, lineHeightMultiplier: 1.18, paragraphSpacingMultiplier: 0.55 };
    }
    return { align: "left", preferredFontSize: Math.min(10.2, Math.max(8.2, baseSize - 0.2)), maxSize: 10.5, minSize: 7.5, lineHeightMultiplier: 1.2, paragraphSpacingMultiplier: 0.45 };
  }
  if (kind === "title") return { align: "center", preferredFontSize: Math.min(14, Math.max(10.5, baseSize + 1.5)), maxSize: 14, minSize: 10.5, lineHeightMultiplier: 1.16, paragraphSpacingMultiplier: 0.35 };
  if (kind === "abstract" || kind === "keywords") return { align: "left", preferredFontSize: Math.min(11, Math.max(8.5, baseSize + 0.2)), maxSize: 11, minSize: 8.5, lineHeightMultiplier: 1.2, paragraphSpacingMultiplier: 0.32 };
  if (kind === "caption") return { align: "left", preferredFontSize: Math.min(9.5, Math.max(7.5, baseSize - 0.8)), maxSize: 9.5, minSize: 7.5, lineHeightMultiplier: 1.16, paragraphSpacingMultiplier: 0.35 };
  if (kind === "heading") return { align: "center", preferredFontSize: Math.min(12, baseSize + 0.8), maxSize: 12, minSize: 9, lineHeightMultiplier: 1.18, paragraphSpacingMultiplier: 0.35 };
  if (kind === "metadata") return { align: "left", preferredFontSize: Math.min(8.5, Math.max(6.8, baseSize - 1)), maxSize: 8.5, minSize: 6.8, lineHeightMultiplier: 1.15, paragraphSpacingMultiplier: 0.3 };
  return { align: "left", preferredFontSize: Math.min(11, Math.max(8.5, baseSize)), maxSize: 11, minSize: 8.5, lineHeightMultiplier: 1.22, paragraphSpacingMultiplier: 0.35 };
}

function getCaptionPaddingCandidates(initialPadding = 2, minimumPadding = 1) {
  const initial = Math.max(0, Number(initialPadding || 0));
  const minimum = Math.max(0.5, Math.min(initial, Number(minimumPadding || 0)));
  const values = [initial];
  for (let value = initial - 0.5; value >= minimum - 0.001; value -= 0.5) values.push(Number(Math.max(minimum, value).toFixed(3)));
  return Array.from(new Set(values));
}

function buildPaperLayoutAuthorityContext(context = {}) {
  const segments = Array.isArray(context.segments) ? context.segments : [];
  const collectSourceFontSizes = typeof context.collectSourceFontSizes === "function" ? context.collectSourceFontSizes : () => [];
  const fontFamily = getZhFontFamilyFromPath(context.zhFontPath || "");
  const visualScale = getZhFontVisualScale(fontFamily);
  const medianByType = (type, fallback) => {
    const sizes = [];
    segments.forEach((segment) => {
      if (segment && normalizeZhFontSizeType(segment.type) === type) sizes.push(...collectSourceFontSizes(segment));
    });
    return medianNumber(sizes, fallback);
  };
  const englishBody = medianByType("body", Number(context.documentEnglishBodyMedianFontSize || 0) || 9.5);
  const englishCaption = medianByType("caption", englishBody * 0.9);
  const englishHeading = medianByType("heading", englishBody * 1.15);
  const englishTitle = medianByType("title", englishBody * 1.45);
  const englishMetadata = medianByType("metadata", englishBody * 0.85);
  const body = clampNumber(roundToHalf(englishBody * visualScale), 7.5, 10);
  const caption = clampNumber(roundToHalf(englishCaption * visualScale), 6.5, Math.min(9, body - 0.5));
  const heading = clampNumber(roundToHalf(englishHeading * visualScale), Math.min(12, body + 0.5), 12);
  const title = clampNumber(roundToHalf(englishTitle * visualScale), Math.min(14, Math.max(11, body + 2)), 14);
  const metadata = clampNumber(roundToHalf(englishMetadata * visualScale), 6.5, Math.min(8.5, caption));
  return Object.freeze({
    authorityVersion: AUTHORITY_VERSION,
    source: "visual_equal_fixed_type_scale",
    scale: Object.freeze({ title, heading, body, abstract: body, keywords: body, caption, affiliation: metadata, funding: metadata, receivedDate: metadata, correspondence: metadata, metadata, fallback: body }),
    zhFontFamily: fontFamily,
    zhEmbeddedFontName: fontFamily,
    zhFontSourcePath: String(context.zhFontPath || ""),
    zhFontVisualScale: visualScale,
    documentEnglishBodyMedianFontSize: Number(englishBody.toFixed(4)),
    documentEnglishCaptionMedianFontSize: Number(englishCaption.toFixed(4)),
    documentEnglishHeadingMedianFontSize: Number(englishHeading.toFixed(4)),
    documentEnglishTitleMedianFontSize: Number(englishTitle.toFixed(4)),
    documentEnglishMetadataMedianFontSize: Number(englishMetadata.toFixed(4)),
    computedZhBodyFontSize: body,
    computedZhCaptionFontSize: caption,
    computedZhHeadingFontSize: heading,
    computedZhTitleFontSize: title,
    computedZhMetadataFontSize: metadata,
  });
}

function resolvePaperLayoutAuthority(input = {}) {
  const segment = input.segment || null;
  const segmentType = String(segment && segment.type || input.segmentType || "body");
  const kind = input.kind || resolveWriteKind(segment, input.lineMasks || [], input.cleanTextFn);
  const style = resolveWriteStyle(kind, input.averageFontSize, input.strategy);
  const targetLanguage = String(input.targetLanguage || "");
  const cjkScaleEligible = /^zh/i.test(targetLanguage) && Boolean(segment);
  const pageBodyMedianFontSize = Number(input.pageBodyMedianFontSize || 0) || 9;
  const fontStats = input.fontStats || null;
  const visualRole = cjkScaleEligible ? getSourceVisualRole(segment, fontStats) : segmentType;
  const visualEquivalent = cjkScaleEligible ? getVisualEquivalentZhFontSize(segment, pageBodyMedianFontSize, visualRole) : null;
  const normalizedType = normalizeZhFontSizeType(segmentType);
  const scaleContext = input.visualEqualZhFontSizeScale || input.authorityContext || null;
  const scale = scaleContext && scaleContext.scale || input.zhFontSizeScale || DEFAULT_ZH_FONT_SIZE_SCALE;
  const fixedFontSize = Number(scale[normalizedType] || scale.fallback || DEFAULT_ZH_FONT_SIZE_SCALE[normalizedType] || DEFAULT_ZH_FONT_SIZE_SCALE.fallback);
  const readableRange = getReadableFontSizeRange(segmentType);
  const initialFontSize = cjkScaleEligible
    ? fixedFontSize
    : Math.min(readableRange.max, Math.max(readableRange.min, Number(style.preferredFontSize || readableRange.max)));
  const minimumFontSize = cjkScaleEligible
    ? (normalizedType === "body" ? Math.max(8, fixedFontSize - 0.5) : fixedFontSize)
    : Math.max(readableRange.min, Number(style.minSize || readableRange.min));
  const maximumFontSize = cjkScaleEligible ? fixedFontSize : Math.min(readableRange.max, Number(style.maxSize || readableRange.max));
  const paragraphSpacingMultiplier = Number(style.paragraphSpacingMultiplier || 0.35);
  const isCjkTextFn = input.isCjkTextFn;
  const metricsForFontSize = (fontSize, text = input.text || "") => Object.freeze({
    fontSize: Number(fontSize || 0),
    lineHeight: cjkScaleEligible
      ? resolveLineHeight(fontSize, segmentType, text, visualRole, isCjkTextFn)
      : Number(fontSize || 0) * Number(style.lineHeightMultiplier || 1.35),
    paragraphSpacing: Number(fontSize || 0) * paragraphSpacingMultiplier,
  });
  return Object.freeze({
    authorityVersion: AUTHORITY_VERSION,
    kind,
    segmentType,
    normalizedType,
    visualRole,
    fontStats,
    visualEquivalentZhFontSize: visualEquivalent,
    cjkScaleEligible,
    style: Object.freeze({ ...style }),
    alignment: style.align,
    typography: Object.freeze({
      initialFontSize,
      minimumFontSize,
      maximumFontSize,
      fixedFontSize: cjkScaleEligible ? fixedFontSize : null,
      fontSizeStep: 0.5,
      lineHeightMultiplier: Number(style.lineHeightMultiplier || 1.35),
      paragraphSpacingMultiplier,
    }),
    padding: Object.freeze({
      initial: Number(input.initialPadding == null ? 2 : input.initialPadding),
      minimum: kind === "caption" ? 1 : Number(input.initialPadding == null ? 2 : input.initialPadding),
      candidates: Object.freeze(kind === "caption" ? getCaptionPaddingCandidates(input.initialPadding == null ? 2 : input.initialPadding, 1) : [Number(input.initialPadding == null ? 2 : input.initialPadding)]),
    }),
    overflow: Object.freeze({
      fontSizeStep: 0.5,
      allowFontShrink: minimumFontSize < initialFontSize,
      minimumFontSize,
      hardFailWhenUnresolved: true,
      captionOwnRegionOnly: kind === "caption",
      writeBoxMaxBorrowRatio: GLOBAL_LAYOUT_POLICY.writeBoxMaxBorrowRatio,
      writeBoxMaxBorrowHeight: GLOBAL_LAYOUT_POLICY.writeBoxMaxBorrowHeight,
      extraHeightLineFactor: GLOBAL_LAYOUT_POLICY.overflowExtraHeightLineFactor,
      extraHeightPadding: GLOBAL_LAYOUT_POLICY.overflowExtraHeightPadding,
    }),
    box: Object.freeze({
      exactWriteSafetyPaddingMinimum: GLOBAL_LAYOUT_POLICY.exactWriteSafetyPaddingMinimum,
      exactWriteSafetyPaddingLineHeightFactor: GLOBAL_LAYOUT_POLICY.exactWriteSafetyPaddingLineHeightFactor,
      renderedBackgroundShrinkThreshold: GLOBAL_LAYOUT_POLICY.renderedBackgroundShrinkThreshold,
      renderedBackgroundMinimumHeight: GLOBAL_LAYOUT_POLICY.renderedBackgroundMinimumHeight,
      renderedBackgroundExtraHeight: GLOBAL_LAYOUT_POLICY.renderedBackgroundExtraHeight,
    }),
    flow: Object.freeze({
      fontShrinkFloor: 8,
      fontSizeStep: 0.5,
      pressureGapOk: -4,
      pressureGapTight: 4,
      pressureGapSoft: 20,
      structureGap: ["abstract", "title", "abstract-title", "keywords"].includes(segmentType) ? 6 : 4,
      estimateParagraphSpacingLineHeightFactor: 0.28,
      safetyPaddingMinimum: 4,
      safetyPaddingLineHeightFactor: 0.45,
    }),
    metricsForFontSize,
  });
}

module.exports = {
  AUTHORITY_VERSION,
  DEFAULT_ZH_FONT_SIZE_SCALE,
  GLOBAL_LAYOUT_POLICY,
  buildPaperLayoutAuthorityContext,
  getCaptionPaddingCandidates,
  getReadableFontSizeRange,
  getReadableFontSizeRangeByVisualRole,
  getSourceVisualRole,
  getVisualEquivalentZhFontSize,
  getZhFontFamilyFromPath,
  getZhFontVisualScale,
  normalizeZhFontSizeType,
  resolveLineHeight,
  resolvePaperLayoutAuthority,
  resolveWriteKind,
  resolveWriteStyle,
};
