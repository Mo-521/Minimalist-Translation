const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');
const mainSource = fs.readFileSync(path.join(root, 'electron-app/main.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const paramsEnd = source.indexOf(')', start);
  const bodyStart = source.indexOf('{', paramsEnd);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unable to extract ${name}`);
}

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

test('caption ownership accepts caption syntax but rejects ordinary scientific prose', () => {
  const context = vm.createContext({
    normalizeExtractedPdfText: normalize,
    isBodyStartText: (value) => /^(?:The|We|This|Since|Estimating|Spectral)\b/.test(normalize(value)),
  });
  vm.runInContext(extractFunction(mainSource, 'isPaperCaptionOwnershipContinuationText'), context);

  assert.equal(context.isPaperCaptionOwnershipContinuationText('Right: telescope image'), true);
  assert.equal(context.isPaperCaptionOwnershipContinuationText('the primary and secondary galaxy.'), true);
  assert.equal(context.isPaperCaptionOwnershipContinuationText('local 1σ error envelope.'), true);
  assert.equal(context.isPaperCaptionOwnershipContinuationText('represent 100 iterations of the least-squares fit, and the solid'), true);
  assert.equal(context.isPaperCaptionOwnershipContinuationText('denotes the source extraction aperture.'), true);
  assert.equal(context.isPaperCaptionOwnershipContinuationText('fixed to the galactic column density. The best-fit model'), false);
  assert.equal(context.isPaperCaptionOwnershipContinuationText('from the best-fit Gaussian amplitude and width'), false);
  assert.equal(context.isPaperCaptionOwnershipContinuationText('The total integrated flux was derived'), false);
});

test('coverage recovery recognizes true caption source lines without claiming adjacent body prose', () => {
  const context = vm.createContext({
    normalizeExtractedPdfText: normalize,
    isBodyStartText: (value) => /^The\b/.test(normalize(value)),
    getRecoveryTextOverlapRatio: () => 0,
    bboxOverlapRatio: () => 0,
    bboxHorizontalOverlapRatio: () => 0.8,
    getPaperSegmentAverageFontSize: () => 9,
  });
  vm.runInContext([
    extractFunction(mainSource, 'isPaperCaptionOwnershipContinuationText'),
    extractFunction(mainSource, 'isPaperRawLineOwnedByCaptionSource'),
  ].join('\n'), context);
  const caption = { type: 'caption', sourceText: 'Figure 7. Left: image', bbox: { x: 40, y: 250, width: 510, height: 42 }, lineBoxes: [] };

  assert.equal(context.isPaperRawLineOwnedByCaptionSource({ text: 'the primary and secondary galaxy.', bbox: { x: 45, y: 286, width: 220, height: 9 } }, [caption]), true);
  assert.equal(context.isPaperRawLineOwnedByCaptionSource({ text: 'fixed to the galactic column density.', bbox: { x: 320, y: 286, width: 220, height: 9 } }, [caption]), false);
});

test('caption group source and region authority retain only owned raw lines', () => {
  const grouping = extractFunction(mainSource, 'buildPretranslationCaptionGroupPlan');
  const regions = extractFunction(mainSource, 'buildFinalCaptionRegionsByPage');

  assert.match(grouping, /isPaperCaptionOwnershipContinuationText/);
  assert.doesNotMatch(grouping, /words\.length <= 18/);
  assert.match(grouping, /captionBandRawLines\.filter/);
  assert.match(grouping, /isRawLineAlreadyClaimed\(line, cap, members\)/);
  assert.match(grouping, /findExplicitNonCaptionOwner/);
  assert.match(grouping, /raw_line_explicitly_owned_by_non_caption_segment/);
  assert.match(grouping, /removeExplicitlyOwnedBodyText/);
  assert.match(grouping, /ownedCanonicalLineBoxes/);
  assert.match(regions, /blockingBoxes/);
  assert.match(regions, /caption_group_raw_line/);
});

test('canonical caption finalization gives explicit body ownership priority over geometry overlap', () => {
  const grouping = extractFunction(mainSource, 'buildPretranslationCaptionGroupPlan');
  const finalization = extractFunction(mainSource, 'finalizePretranslationCaptionGroups');

  assert.match(grouping, /String\(candidate\.type \|\| ''\) === 'caption'/);
  assert.match(grouping, /candidateText\.toLowerCase\(\) === lineText\.toLowerCase\(\)/);
  assert.ok(
    grouping.indexOf('if (isExplicitBodyOwnedLine(line)) return false') < grouping.indexOf('if (isRawLineAlreadyClaimed(line, cap, members)) return true'),
    'explicit non-caption source ownership must be resolved before caption geometry claims the raw line'
  );
  assert.match(finalization, /canonicalSegment\.lineBoxes = role\.ownedCanonicalLineBoxes/);
  assert.match(finalization, /canonicalSegment\.sourceText = sourceValue\.fullText/);
});

test('layout blocking consumes exact caption-owned boxes instead of the union region', () => {
  const blocking = extractFunction(mainSource, 'buildPaperLayoutBlockingZones');
  assert.match(blocking, /Array\.isArray\(r\.blockingBoxes\)/);
  assert.match(blocking, /ownedBoxes\.forEach/);
  assert.match(blocking, /bbox: owned/);
});

test('coverage audit excludes caption-owned raw lines before building body recovery segments', () => {
  const coverageStart = mainSource.indexOf('// === paper_pdf source-line coverage audit & segment recovery ===');
  const coverageEnd = mainSource.indexOf('// === P0: post-recovery global ID uniqueness audit ===', coverageStart);
  const coverage = mainSource.slice(coverageStart, coverageEnd);
  assert.match(coverage, /captionSourceOwners/);
  assert.match(coverage, /isPaperRawLineOwnedByCaptionSource\(line, captionSourceOwners\)/);
  assert.ok(
    coverage.indexOf('isPaperRawLineOwnedByCaptionSource(line, captionSourceOwners)') < coverage.indexOf('uncoveredLines.push(line)'),
    'caption ownership must be checked before a body recovery candidate is created'
  );
});
