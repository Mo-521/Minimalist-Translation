const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const mainSource = fs.readFileSync(path.join(projectRoot, 'electron-app', 'main.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(projectRoot, 'electron-app', 'renderer.js'), 'utf8');

function extractFunction(source, name) {
  const asyncStart = source.indexOf(`async function ${name}(`);
  const plainStart = source.indexOf(`function ${name}(`);
  const start = asyncStart !== -1 ? asyncStart : plainStart;
  assert.notEqual(start, -1, `${name} must exist`);
  const paramsStart = source.indexOf('(', start);
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    if (source[index] === '(') paramsDepth += 1;
    if (source[index] === ')') paramsDepth -= 1;
    if (paramsDepth === 0) { paramsEnd = index; break; }
  }
  const bodyStart = source.indexOf('{', paramsEnd);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unable to extract ${name}`);
}

function makeMainContext() {
  const context = {
    crypto, Map, Set, JSON,
    normalizeExtractedPdfText(value) { return String(value || '').replace(/\s+/g, ' ').trim(); },
    cleanPdfText(value) { return String(value || '').trim(); },
    resolveSegmentSourcePage(segment) { return { sourcePage: Number(segment.sourcePage || segment.pageNumber || 0) }; },
    isCaptionMarkerText(value) { return /^(Figure|Fig\.|Table)\s+\d+/i.test(String(value || '')); },
    isBodyStartText() { return false; },
    getRecoveryTextOverlapRatio(a, b) { return String(a || '') === String(b || '') ? 1 : 0; },
    getSegmentLineText(line) { return String(line && (line.sourceLineText || line.text) || '').replace(/\s+/g, ' ').trim(); },
    makeParagraphSourceText(lines) { return (lines || []).map((line) => String(line && line.text || '').trim()).filter(Boolean).join(' '); },
    makePreviewText(value) { return String(value || '').slice(0, 180); },
    makeBBoxFromLineBoxes(boxes) {
      const left = Math.min(...boxes.map((box) => box.x));
      const top = Math.min(...boxes.map((box) => box.y));
      const right = Math.max(...boxes.map((box) => box.x + box.width));
      const bottom = Math.max(...boxes.map((box) => box.y + box.height));
      return { x: left, y: top, width: right - left, height: bottom - top };
    },
    bboxOverlapRatio(a, b) {
      const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
      const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      return (x * y) / Math.max(1, a.width * a.height);
    },
  };
  vm.createContext(context);
  vm.runInContext([
    extractFunction(mainSource, 'hashPaperLifecycleValue'),
    extractFunction(mainSource, 'isPaperCaptionOwnershipContinuationText'),
    extractFunction(mainSource, 'eliminateCaptionOwnedBodySourceLineDuplicates'),
    extractFunction(mainSource, 'buildPretranslationCaptionGroupPlan'),
    extractFunction(mainSource, 'finalizePretranslationCaptionGroups'),
    extractFunction(mainSource, 'readCaptionLifecycleArtifactsForExport'),
    extractFunction(mainSource, 'auditPretranslationCaptionArtifactsForExport'),
  ].join('\n'), context);
  return context;
}

function makeGenericSegments() {
  return [
    {
      id: 'caption-canonical', pageNumber: 3, type: 'caption', column: 'left',
      sourceText: 'Figure 1. Canonical source.', bbox: { x: 10, y: 100, width: 200, height: 45 },
      lineBoxes: [{ x: 10, y: 100, width: 200, height: 8, text: 'Figure 1. Canonical source.' }],
    },
    {
      id: 'caption-member', pageNumber: 3, type: 'body', column: 'left',
      sourceText: 'local 1σ error envelope.', bbox: { x: 10, y: 112, width: 200, height: 8 },
      lineBoxes: [{ x: 10, y: 112, width: 200, height: 8, text: 'local 1σ error envelope.' }],
    },
  ];
}

test('raw recovery, grouping and final source finish before translation', () => {
  const context = makeMainContext();
  const segments = makeGenericSegments();
  const result = context.finalizePretranslationCaptionGroups(segments, {
    3: [{ pageNumber: 3, text: 'right panel continuation.', bbox: { x: 10, y: 128, width: 200, height: 8 } }],
  });
  const canonical = segments[0];
  assert.equal(result.groupArtifacts.length, 1);
  assert.equal(canonical.captionGroupRole, 'canonical');
  assert.equal(segments[1].captionGroupRole, 'member');
  assert.equal(canonical.finalCaptionSource.finalizedBeforeTranslation, true);
  assert.match(canonical.finalCaptionSource.value.fullText, /Canonical source/);
  assert.match(canonical.finalCaptionSource.value.fullText, /local 1σ error envelope/);
  assert.match(canonical.finalCaptionSource.value.fullText, /right panel continuation/);
  assert.equal(canonical.finalCaptionSource.sourceHash, crypto.createHash('sha256').update(canonical.finalCaptionSource.value.fullText, 'utf8').digest('hex'));
});

test('caption group page identity uses resolved source page for region authority', () => {
  const context = makeMainContext();
  const segments = makeGenericSegments();
  segments[0].sourcePage = 3;
  segments[0].pageNumber = 2;
  segments[1].sourcePage = 3;
  const result = context.finalizePretranslationCaptionGroups(segments, {
    3: [{ pageNumber: 3, text: 'right panel continuation.', bbox: { x: 10, y: 128, width: 200, height: 8 } }],
  });
  assert.equal(result.groupArtifacts[0].groupArtifact.value.pageNumber, 3);
  assert.equal(segments[0].captionGroupArtifact.value.pageNumber, 3);
  assert.equal(segments[0].finalCaptionSource.value.pageNumber, 3);
});

test('canonical finalization removes a geometrically overlapping raw line owned by body', () => {
  const context = makeMainContext();
  const captionText = 'Figure 1. Left: telescope image. fixed to the galactic column density.';
  const segments = [
    {
      id: 'caption-canonical', pageNumber: 3, type: 'caption', column: 'single',
      sourceText: captionText, previewText: captionText,
      bbox: { x: 10, y: 100, width: 500, height: 35 },
      lineBoxes: [
        { x: 10, y: 100, width: 220, height: 8, text: 'Figure 1. Left: telescope image.' },
        { x: 280, y: 120, width: 220, height: 8, text: 'fixed to the galactic column density.' },
      ],
    },
    {
      id: 'body-owner', pageNumber: 3, type: 'body', column: 'right',
      sourceText: 'fixed to the galactic column density.',
      bbox: { x: 280, y: 120, width: 220, height: 8 },
      lineBoxes: [{ x: 280, y: 120, width: 220, height: 8, text: 'fixed to the galactic column density.' }],
    },
  ];
  context.finalizePretranslationCaptionGroups(segments, {
    3: [
      { pageNumber: 3, text: 'Figure 1. Left: telescope image.', bbox: { x: 10, y: 100, width: 220, height: 8 } },
      { pageNumber: 3, text: 'fixed to the galactic column density.', bbox: { x: 280, y: 120, width: 220, height: 8 } },
    ],
  });

  assert.equal(segments[0].finalCaptionSource.value.fullText, 'Figure 1. Left: telescope image.');
  assert.equal(segments[0].captionGroupArtifact.value.rawLines.length, 1);
  assert.equal(segments[0].lineBoxes.length, 1);
  assert.equal(segments[0].bbox.width, 220);
  assert.equal(segments[1].sourceText, 'fixed to the galactic column density.');
  assert.equal(segments[1].captionGroupRole, undefined);
});

test('caption-owned source lines are removed from a mixed body segment before identity materialization', () => {
  const context = makeMainContext();
  const ownedLine = { pageNumber: 3, text: 'represent 100 iterations of the fit.', bbox: { x: 20, y: 120, width: 210, height: 8 } };
  const caption = {
    id: 'caption-owner', pageNumber: 3, type: 'caption',
    captionGroupArtifact: { value: { groupId: 'caption-group', canonicalSegmentId: 'caption-owner', rawLines: [ownedLine] } },
  };
  const body = {
    id: 'body-mixed', pageNumber: 3, type: 'body', column: 'left',
    sourceText: 'represent 100 iterations of the fit. The body continues here.',
    lines: [
      { text: 'represent 100 iterations of the fit.' },
      { text: 'The body continues here.' },
    ],
    lineBoxes: [
      { x: 20, y: 120, width: 210, height: 8, text: 'represent 100 iterations of the fit.' },
      { x: 20, y: 132, width: 210, height: 8, text: 'The body continues here.' },
    ],
    bbox: { x: 20, y: 120, width: 210, height: 20 },
  };
  const result = context.eliminateCaptionOwnedBodySourceLineDuplicates([caption, body]);

  assert.equal(result.eliminatedLineCount, 1);
  assert.deepEqual(Array.from(result.eliminatedSegmentIds), []);
  assert.deepEqual(Array.from(result.trimmedSegmentIds), ['body-mixed']);
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[1].sourceText, 'The body continues here.');
  assert.equal(result.segments[1].lineBoxes.length, 1);
  assert.equal(result.segments[1].id, 'body-mixed');
});

test('caption ownership finalizes before duplicate elimination and final identity materialization', () => {
  const extractionStart = mainSource.indexOf('const processedSegments = postProcessPdfSegments');
  const extractionEnd = mainSource.indexOf('// === paper_pdf source-line coverage audit', extractionStart);
  const extraction = mainSource.slice(extractionStart, extractionEnd);
  const finalizationAt = extraction.indexOf('finalizePretranslationCaptionGroups(segments, pretranslationRawLinesByPage)');
  const eliminationAt = extraction.indexOf('eliminateCaptionOwnedBodySourceLineDuplicates(segments)');
  const identityAt = extraction.indexOf('applyImageRegionSegmentationConstraints(segments, pipelineConfig, { enforceSegmentIdentity: true })');

  assert.ok(finalizationAt >= 0 && finalizationAt < eliminationAt);
  assert.ok(eliminationAt < identityAt);
});

test('Export reads artifacts and reports stale translation without repair', () => {
  const context = makeMainContext();
  const segments = makeGenericSegments();
  context.finalizePretranslationCaptionGroups(segments, {});
  const finalSource = segments[0].finalCaptionSource;
  const translation = { accepted: true, sourceHash: finalSource.sourceHash, translationText: 'group translation' };
  segments.forEach((segment) => { segment.captionGroupTranslationArtifact = translation; });
  assert.equal(context.readCaptionLifecycleArtifactsForExport(segments).get('caption-canonical').fullSourceText, finalSource.value.fullText);
  assert.equal(context.auditPretranslationCaptionArtifactsForExport(segments).violationCount, 0);
  segments[0].captionGroupTranslationArtifact = { ...translation, sourceHash: 'stale' };
  const failed = context.auditPretranslationCaptionArtifactsForExport(segments);
  assert.ok(failed.violations.some((entry) => entry.code === 'missing_or_stale_caption_group_translation'));
  assert.equal(failed.behaviorMutationApplied, false);
});

test('Renderer translates one canonical source and propagates one group artifact', () => {
  const segments = makeGenericSegments();
  makeMainContext().finalizePretranslationCaptionGroups(segments, {});
  const context = { state: { segments }, JSON, String, Set };
  vm.createContext(context);
  vm.runInContext([
    extractFunction(rendererSource, 'isPretranslationCaptionGroupMember'),
    'function isPaperOverlayCandidateStrict(){ return true; }',
    extractFunction(rendererSource, 'isPaperTranslationAuthoritySegment'),
    extractFunction(rendererSource, 'getPaperTranslationRequestText'),
    extractFunction(rendererSource, 'applyCaptionGroupTranslationResult'),
  ].join('\n'), context);
  assert.equal(context.isPaperTranslationAuthoritySegment(segments[0]), true);
  assert.equal(context.isPaperTranslationAuthoritySegment(segments[1]), false);
  assert.equal(context.getPaperTranslationRequestText(segments[0]), segments[0].finalCaptionSource.value.fullText);
  context.applyCaptionGroupTranslationResult(segments[0], 'group translation', { textSnapshot: { sha256: 'translation-hash' } });
  assert.equal(segments[0].translatedText, 'group translation');
  assert.equal(segments[1].translatedText, 'group translation');
  assert.equal(segments[1].status, 'done');
  assert.equal(segments[0].captionGroupTranslationArtifact.sourceHash, segments[0].finalCaptionSource.sourceHash);
});

test('cancellation and ordinary PDF compatibility boundaries remain intact', () => {
  const translationSource = extractFunction(rendererSource, 'startPaperPdfSegmentTranslation');
  assert.match(translationSource, /state\.pdfTranslateCancelRequested/);
  assert.match(translationSource, /AbortController/);
  assert.match(translationSource, /stage: "translationFailure"/);
  assert.match(translationSource, /\? "aborted" : "failed"/);
  assert.match(rendererSource, /if \(state\.pdfTranslationMode === "simple_pdf"\)/);
  const exportSource = extractFunction(mainSource, 'exportTranslatedPdf');
  assert.doesNotMatch(exportSource, /buildPretranslationCaptionGroupPlan\s*\(/);
  assert.match(exportSource, /readCaptionLifecycleArtifactsForExport\s*\(/);
});
