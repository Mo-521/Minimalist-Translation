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
    if (paramsDepth === 0) {
      paramsEnd = index;
      break;
    }
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

function makeContext() {
  const context = {
    crypto,
    console,
    resolveSegmentSourcePage(segment) { return { sourcePage: Number(segment.pageNumber || 0) }; },
  };
  vm.createContext(context);
  vm.runInContext([
    extractFunction(mainSource, 'captionSpatialBoxesAreConnected'),
    extractFunction(mainSource, 'buildCaptionSpatiallyIsolatedWriteGeometry'),
    extractFunction(mainSource, 'buildFinalCaptionRegionsByPage'),
    extractFunction(mainSource, 'buildPaperCaptionBodyOwnershipValue'),
    extractFunction(mainSource, 'hashPaperLifecycleValue'),
    extractFunction(mainSource, 'finalizePaperCaptionBodyOwnershipBeforeTranslation'),
    extractFunction(mainSource, 'normalizeCaptionRegionsForConsistency'),
    extractFunction(mainSource, 'auditPaperCaptionBodyAuthorityAtExport'),
  ].join('\n'), context);
  return context;
}

test('ownership and caption regions are finalized before translation and pass export audit', () => {
  const context = makeContext();
  const segments = [
    { id: 'caption-generic', pageNumber: 2, type: 'caption', zoneType: 'captionZone', classificationReason: 'caption', column: 'left', bbox: { x: 10, y: 20, width: 100, height: 30 } },
    { id: 'body-generic', pageNumber: 2, type: 'body', zoneType: 'bodyZone', classificationReason: 'body', column: 'left', bbox: { x: 10, y: 60, width: 100, height: 80 } },
  ];
  const finalized = context.finalizePaperCaptionBodyOwnershipBeforeTranslation(segments);
  const audit = context.auditPaperCaptionBodyAuthorityAtExport(segments, finalized.captionRegionsByPage);

  assert.equal(segments[0].captionBodyOwnershipArtifact.finalizedBeforeTranslation, true);
  assert.equal(segments[1].captionBodyOwnershipArtifact.finalizedBeforeTranslation, true);
  assert.equal(finalized.captionRegionsByPage['2'].length, 1);
  assert.equal(audit.violationCount, 0);
  assert.equal(audit.behaviorMutationApplied, false);
});

test('caption region authority consumes finalized group line geometry instead of partial canonical bbox', () => {
  const context = makeContext();
  const segments = [{
    id: 'caption-wide', pageNumber: 3, type: 'caption', column: 'left',
    zoneType: 'captionZone', classificationReason: 'caption',
    bbox: { x: 50, y: 260, width: 245, height: 47 },
    lineBoxes: [{ x: 50, y: 262, width: 245, height: 9, pageNumber: 3 }],
    captionGroupArtifact: {
      finalizedBeforeTranslation: true,
      value: {
        groupId: 'capgroup-caption-wide', canonicalSegmentId: 'caption-wide', pageNumber: 3,
        rawLines: [
          { pageNumber: 3, bbox: { x: 50, y: 262, width: 510, height: 9 } },
          { pageNumber: 3, bbox: { x: 50, y: 284, width: 510, height: 9 } },
        ],
        recoveredLineBoxes: [{ pageNumber: 3, x: 300, y: 273, width: 260, height: 9 }],
      },
    },
  }];
  const finalized = context.finalizePaperCaptionBodyOwnershipBeforeTranslation(segments);
  const region = finalized.captionRegionsByPage['3'][0];
  assert.equal(region.source, 'caption-group-final-geometry');
  assert.equal(region.column, 'single');
  assert.equal(region.x, 50);
  assert.equal(region.y, 262);
  assert.equal(region.width, 510);
  assert.equal(region.height, 31);
  assert.equal(region.finalizedAfterCaptionGrouping, true);
  assert.deepEqual(segments[0].captionRegionArtifact.value, region);
});

test('caption write region excludes disconnected source geometry without dropping source ownership', () => {
  const context = makeContext();
  const segments = [{
    id: 'caption-isolated', pageNumber: 3, type: 'caption', column: 'left',
    zoneType: 'captionZone', classificationReason: 'caption',
    bbox: { x: 50, y: 540, width: 242, height: 56 },
    lineBoxes: [
      { x: 50, y: 540, width: 242, height: 9, pageNumber: 3 },
      { x: 50, y: 551, width: 220, height: 9, pageNumber: 3 },
    ],
    captionGroupArtifact: {
      finalizedBeforeTranslation: true,
      value: {
        groupId: 'capgroup-caption-isolated', canonicalSegmentId: 'caption-isolated', pageNumber: 3,
        rawLines: [
          { pageNumber: 3, bbox: { x: 50, y: 540, width: 242, height: 9 } },
          { pageNumber: 3, bbox: { x: 50, y: 551, width: 220, height: 9 } },
        ],
        recoveredLineBoxes: [
          { pageNumber: 3, x: 320, y: 525, width: 104, height: 15 },
        ],
      },
    },
  }];
  const finalized = context.finalizePaperCaptionBodyOwnershipBeforeTranslation(segments);
  const region = finalized.captionRegionsByPage['3'][0];

  assert.equal(region.x, 50);
  assert.equal(region.y, 540);
  assert.equal(region.width, 242);
  assert.equal(region.height, 20);
  assert.equal(region.spatialIsolationApplied, true);
  assert.equal(region.disconnectedSourceGeometryCount, 1);
  assert.equal(region.disconnectedSourceBoxes[0].x, 320);
  assert.equal(region.sourceGeometryEnvelope.x, 50);
  assert.equal(region.sourceGeometryEnvelope.width, 374);
  assert.equal(region.blockingBoxes.length, 2);
});

test('export audit reports ownership drift without repairing it', () => {
  const context = makeContext();
  const segments = [
    { id: 'caption-generic', pageNumber: 1, type: 'caption', zoneType: 'captionZone', classificationReason: 'caption', column: 'single', bbox: { x: 1, y: 2, width: 3, height: 4 } },
  ];
  const finalized = context.finalizePaperCaptionBodyOwnershipBeforeTranslation(segments);
  segments[0].type = 'body';
  const audit = context.auditPaperCaptionBodyAuthorityAtExport(segments, finalized.captionRegionsByPage);

  assert.equal(segments[0].type, 'body');
  assert.ok(audit.violations.some((entry) => entry.code === 'caption_body_ownership_drift'));
  assert.ok(audit.violations.some((entry) => entry.code === 'caption_region_drift'));
});

test('export contains validation only and payload preserves pretranslation authority artifacts', () => {
  const exportSource = extractFunction(mainSource, 'exportTranslatedPdf');
  assert.doesNotMatch(exportSource, /demoteBodyLikeCaptionSegmentsBeforeTranslation\s*\(/);
  assert.doesNotMatch(exportSource, /resolveCaptionBodyConflictsForPaperSegments\s*\(/);
  assert.doesNotMatch(exportSource, /auditPaperImageTextPreserveRisk\s*\([^)]*demote:\s*true/);
  assert.match(exportSource, /auditPaperCaptionBodyAuthorityAtExport\s*\(/);
  assert.match(exportSource, /page\.captionRegions/);
  assert.match(rendererSource, /captionBodyOwnershipArtifact/);
  assert.match(rendererSource, /captionRegionArtifact/);
});

test('renderer normalization preserves pretranslation authority artifacts before translation', () => {
  const context = {
    state: { pdfTranslationMode: 'paper_pdf' },
    PDF_OVERLAY_PRESERVE_TYPES: {},
    makeSegmentPreview(value) { return String(value || '').slice(0, 20); },
  };
  vm.createContext(context);
  vm.runInContext(extractFunction(rendererSource, 'normalizePdfSegments'), context);
  const ownership = { finalizedBeforeTranslation: true, sha256: 'ownership-hash' };
  const region = { finalizedBeforeTranslation: true, sha256: 'region-hash' };
  const group = { finalizedBeforeTranslation: true, groupHash: 'group-hash' };
  const finalSource = { finalizedBeforeTranslation: true, sourceHash: 'source-hash' };
  const normalized = context.normalizePdfSegments({
    segments: [{
      id: 'caption-generic', pageNumber: 1, type: 'caption', sourceText: 'Figure 1.',
      bbox: { x: 1, y: 2, width: 3, height: 4 },
      captionBodyOwnershipArtifact: ownership,
      captionRegionArtifact: region,
      captionGroupArtifact: group,
      finalCaptionSource: finalSource,
      captionGroupRole: 'canonical', captionGroupId: 'caption-group', captionGroupCanonicalOwnerId: 'caption-generic',
    }],
  });

  assert.equal(normalized[0].captionBodyOwnershipArtifact.sha256, 'ownership-hash');
  assert.equal(normalized[0].captionRegionArtifact.sha256, 'region-hash');
  assert.equal(normalized[0].captionGroupArtifact.groupHash, 'group-hash');
  assert.equal(normalized[0].finalCaptionSource.sourceHash, 'source-hash');
  assert.equal(normalized[0].captionGroupRole, 'canonical');
  assert.notEqual(normalized[0].captionBodyOwnershipArtifact, ownership);
  assert.notEqual(normalized[0].captionRegionArtifact, region);
});

test('pretranslation ownership decision precedes authority finalization', () => {
  const extractionSource = extractFunction(mainSource, 'buildStructuredPdfText');
  const demoteAt = extractionSource.indexOf('demoteBodyLikeCaptionSegmentsBeforeTranslation(segments');
  const resolveAt = extractionSource.indexOf('resolveCaptionBodyConflictsForPaperSegments(segments');
  const finalizeAt = extractionSource.indexOf('finalizePaperCaptionBodyOwnershipBeforeTranslation(segments');
  assert.ok(demoteAt >= 0 && resolveAt > demoteAt && finalizeAt > resolveAt);
});

test('caption grouping finalizes complete geometry before caption region authority', () => {
  const extractionSource = extractFunction(mainSource, 'buildStructuredPdfText');
  const groupingAt = extractionSource.indexOf('finalizePretranslationCaptionGroups(segments, pretranslationRawLinesByPage)');
  const duplicateEliminationAt = extractionSource.indexOf('eliminateCaptionOwnedBodySourceLineDuplicates(segments)');
  const regionAt = extractionSource.indexOf('finalizePaperCaptionBodyOwnershipBeforeTranslation(segments)');
  assert.ok(groupingAt >= 0 && duplicateEliminationAt > groupingAt && regionAt > duplicateEliminationAt);
});
