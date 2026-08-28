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
  const bodyStart = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unable to extract ${name}`);
}

function loadResolver(strictPredicate) {
  const context = vm.createContext({
    String,
    PDF_EXPORT_TRANSLATABLE_TYPES: new Set(['body', 'abstract']),
    isPaperPdfConfig: (config) => Boolean(config && config.mode === 'paper_pdf'),
    isStrictPureEquationBlock: strictPredicate,
  });
  vm.runInContext(extractFunction(mainSource, 'resolvePaperParagraphFlowType'), context);
  return context.resolvePaperParagraphFlowType;
}

test('strict equation blocks use the same protected type before paragraph flow grouping', () => {
  const resolveType = loadResolver((segment) => Boolean(segment.strictEquation));
  assert.equal(resolveType({ type: 'body', strictEquation: true }, { mode: 'paper_pdf' }), 'formula');
  assert.equal(resolveType({ type: 'body', strictEquation: false }, { mode: 'paper_pdf' }), 'body');
});

test('non-strict formula-like prose stays eligible for body flow', () => {
  const resolveType = loadResolver(() => false);
  assert.equal(resolveType({ type: 'formula' }, { mode: 'paper_pdf' }), 'body');
});

test('ordinary PDF flow types are unchanged', () => {
  const resolveType = loadResolver(() => true);
  assert.equal(resolveType({ type: 'body' }, { mode: 'simple_pdf' }), 'body');
  assert.equal(resolveType({ type: 'formula' }, { mode: 'simple_pdf' }), 'formula');
});

test('paragraph reconstruction consumes the canonical flow type before forming runs', () => {
  const builder = extractFunction(mainSource, 'buildPaperParagraphRuns');
  assert.match(builder, /resolvePaperParagraphFlowType\(segment, pipelineConfig\)/);
  assert.match(mainSource, /buildPaperParagraphRuns\(allSegments, paperPageBodyFontStats, pipelineConfig\)/);
});

test('paragraph reconstruction preserves finalized caption authority before text heuristics', () => {
  const context = vm.createContext({
    normalizeExtractedPdfText: (value) => String(value || '').replace(/\s+/g, ' ').trim(),
    isPaperInlineFigureReferenceText: (value) => /Figure\s+2/i.test(String(value || '')),
  });
  vm.runInContext([
    extractFunction(mainSource, 'hasFinalizedCaptionOwnershipAuthority'),
    extractFunction(mainSource, 'isPaperCaptionReclassifiedAsBodyInReconstruction'),
  ].join('\n'), context);
  const finalizedCaption = {
    id: 'caption-generic', type: 'caption',
    sourceText: 'local 1σ error envelope. Figure 2. Top: spectrum.',
    captionBodyOwnershipArtifact: {
      finalizedBeforeTranslation: true,
      value: { segmentId: 'caption-generic', type: 'caption' },
    },
  };

  assert.equal(context.hasFinalizedCaptionOwnershipAuthority(finalizedCaption), true);
  assert.equal(context.isPaperCaptionReclassifiedAsBodyInReconstruction(finalizedCaption), false);
  assert.equal(context.isPaperCaptionReclassifiedAsBodyInReconstruction({
    ...finalizedCaption,
    captionBodyOwnershipArtifact: null,
  }), true);
  assert.equal(context.isPaperCaptionReclassifiedAsBodyInReconstruction({
    ...finalizedCaption,
    captionBodyOwnershipArtifact: {
      finalizedBeforeTranslation: true,
      value: { segmentId: 'different-object', type: 'caption' },
    },
  }), true);
});

test('paragraph run audit records preserved finalized caption identities', () => {
  const builder = extractFunction(mainSource, 'buildPaperParagraphRuns');
  assert.ok(
    builder.indexOf('hasFinalizedCaptionOwnershipAuthority(segment)') < builder.indexOf('const normalizedFlowType'),
    'finalized Caption authority must be observed before paragraph flow type is formed'
  );
  assert.match(builder, /paperFinalizedCaptionAuthorityPreservedCount/);
  assert.match(builder, /paperFinalizedCaptionAuthorityPreservedIds/);
});

function loadParagraphBoundaryResolver() {
  const context = vm.createContext({
    String,
    Number,
    Math,
    Array,
    normalizeExtractedPdfText: (value) => String(value || '').replace(/\s+/g, ' ').trim(),
  });
  vm.runInContext([
    extractFunction(mainSource, 'getSegmentFirstLineBox'),
    extractFunction(mainSource, 'resolvePaperParagraphBoundaryEvidence'),
  ].join('\n'), context);
  return context.resolvePaperParagraphBoundaryEvidence;
}

function loadParagraphOverlapContinuationResolver() {
  const context = vm.createContext({
    String,
    Number,
    Math,
    normalizeExtractedPdfText: (value) => String(value || '').replace(/\s+/g, ' ').trim(),
    paperBoxHorizontalOverlapRatio: () => 1,
  });
  vm.runInContext([
    extractFunction(mainSource, 'getSegmentFirstLineBox'),
    extractFunction(mainSource, 'resolvePaperParagraphOverlapContinuationEvidence'),
  ].join('\n'), context);
  return context.resolvePaperParagraphOverlapContinuationEvidence;
}

function loadParagraphBoundaryArbitration() {
  const context = vm.createContext({
    String,
    Number,
    Math,
    Array,
    normalizeExtractedPdfText: (value) => String(value || '').replace(/\s+/g, ' ').trim(),
    paperBoxHorizontalOverlapRatio: () => 1,
  });
  vm.runInContext([
    extractFunction(mainSource, 'getSegmentFirstLineBox'),
    extractFunction(mainSource, 'resolvePaperParagraphBoundaryEvidence'),
    extractFunction(mainSource, 'resolvePaperParagraphOverlapContinuationEvidence'),
    extractFunction(mainSource, 'resolvePaperParagraphBoundaryArbitration'),
  ].join('\n'), context);
  return context.resolvePaperParagraphBoundaryArbitration;
}

test('paragraph boundary uses the source first-line box when the union bbox hides indentation', () => {
  const resolveBoundary = loadParagraphBoundaryResolver();
  const previous = {
    id: 'previous-fragment',
    sourceText: 'The previous source paragraph ends here.',
    bbox: { x: 50, y: 100, width: 240, height: 40 },
    lineBoxes: [
      { x: 50, y: 100, width: 240, height: 10 },
      { x: 50, y: 130, width: 120, height: 10 },
    ],
  };
  const current = {
    id: 'new-paragraph',
    sourceText: 'A new source paragraph begins here and wraps.',
    // The union bbox starts at the column edge because the second line is not indented.
    bbox: { x: 50, y: 137.5, width: 240, height: 30 },
    lineBoxes: [
      { x: 60, y: 137.5, width: 220, height: 10 },
      { x: 50, y: 150, width: 240, height: 10 },
    ],
  };

  const evidence = resolveBoundary(previous, current, 9);
  assert.equal(evidence.shouldBreak, true);
  assert.equal(evidence.reason, 'first_line_indent_after_sentence');
  assert.equal(evidence.source, 'line_box_geometry');
  assert.equal(evidence.firstLineIndent, 10);
});

test('paragraph boundary does not split an unindented continuation after a sentence', () => {
  const resolveBoundary = loadParagraphBoundaryResolver();
  const evidence = resolveBoundary({
    sourceText: 'A sentence ends inside the same paragraph.',
    bbox: { x: 50, y: 100, width: 240, height: 40 },
    lineBoxes: [{ x: 50, y: 130, width: 200, height: 10 }],
  }, {
    sourceText: 'The paragraph continues without a source first-line indent.',
    bbox: { x: 50, y: 137.5, width: 240, height: 30 },
    lineBoxes: [{ x: 50, y: 137.5, width: 240, height: 10 }],
  }, 9);

  assert.equal(evidence.shouldBreak, false);
  assert.equal(evidence.source, 'line_box_geometry');
});

test('explicit source paragraph identity is stronger than geometry heuristics', () => {
  const resolveBoundary = loadParagraphBoundaryResolver();
  const shared = { bbox: { x: 50, y: 100, width: 240, height: 30 }, lineBoxes: [{ x: 50, y: 100, width: 240, height: 10 }] };
  assert.equal(resolveBoundary({ ...shared, sourceParagraphId: 'source-p1' }, { ...shared, sourceParagraphId: 'source-p2' }, 9).shouldBreak, true);
  assert.equal(resolveBoundary({ ...shared, sourceParagraphId: 'source-p1' }, { ...shared, sourceParagraphId: 'source-p1' }, 9).shouldBreak, false);
});

test('forward source-line progress preserves one paragraph despite overlapping union bboxes', () => {
  const resolveContinuation = loadParagraphOverlapContinuationResolver();
  const evidence = resolveContinuation({
    pageNumber: 3,
    column: 'left',
    sourceText: 'Spectral products were generated and then combined using',
    bbox: { x: 50, y: 630, width: 240, height: 45 },
    lineBoxes: [{ x: 60, y: 630, width: 220, height: 10 }],
  }, {
    pageNumber: 3,
    column: 'left',
    sourceText: 'CIAO procedures. Spectral fitting continued.',
    bbox: { x: 50, y: 645, width: 240, height: 75 },
    lineBoxes: [{ x: 50, y: 645, width: 240, height: 10 }],
  }, 9);

  assert.equal(evidence.isContinuation, true);
  assert.equal(evidence.source, 'line_box_forward_progress');
});

test('source-line overlap continuation remains authoritative across a sentence boundary', () => {
  const resolveContinuation = loadParagraphOverlapContinuationResolver();
  const evidence = resolveContinuation({
    pageNumber: 1,
    column: 'left',
    sourceText: 'A sentence inside the same source paragraph ends here.',
    bbox: { x: 50, y: 100, width: 240, height: 45 },
    lineBoxes: [{ x: 50, y: 100, width: 240, height: 10 }],
  }, {
    pageNumber: 1,
    column: 'left',
    sourceText: 'The extractor materializes the next source-line fragment separately.',
    bbox: { x: 50, y: 115, width: 240, height: 45 },
    lineBoxes: [{ x: 50, y: 115, width: 240, height: 10 }],
  }, 9);

  assert.equal(evidence.isContinuation, true);
  assert.equal(evidence.source, 'line_box_forward_progress');
  assert.equal(evidence.previousSentenceEnded, true);
});

test('distinct finalized source paragraph identities cannot be merged by overlap geometry', () => {
  const resolveContinuation = loadParagraphOverlapContinuationResolver();
  const evidence = resolveContinuation({
    pageNumber: 1,
    column: 'left',
    sourceParagraphId: 'source-paragraph-a',
    sourceText: 'The first source paragraph ends here.',
    bbox: { x: 50, y: 100, width: 240, height: 45 },
    lineBoxes: [{ x: 50, y: 100, width: 240, height: 10 }],
  }, {
    pageNumber: 1,
    column: 'left',
    sourceParagraphId: 'source-paragraph-b',
    sourceText: 'A distinct source paragraph begins here.',
    bbox: { x: 50, y: 115, width: 240, height: 45 },
    lineBoxes: [{ x: 50, y: 115, width: 240, height: 10 }],
  }, 9);

  assert.equal(evidence.isContinuation, false);
  assert.equal(evidence.source, 'distinct_source_paragraph_identity');
});

test('boundary arbitration lets a real first-line indent override mild bbox overlap', () => {
  const arbitrate = loadParagraphBoundaryArbitration();
  const result = arbitrate({
    pageNumber: 2,
    column: 'left',
    sourceText: 'The previous source paragraph ends here.',
    bbox: { x: 50, y: 100, width: 240, height: 40 },
    lineBoxes: [
      { x: 50, y: 100, width: 240, height: 10, pageNumber: 2 },
      { x: 50, y: 130, width: 120, height: 10, pageNumber: 2 },
    ],
  }, {
    pageNumber: 2,
    column: 'left',
    sourceText: 'A distinct source paragraph begins here and wraps.',
    bbox: { x: 50, y: 137.5, width: 240, height: 30 },
    lineBoxes: [
      { x: 60, y: 137.5, width: 220, height: 10, pageNumber: 2 },
      { x: 50, y: 150, width: 240, height: 10, pageNumber: 2 },
    ],
  }, 9, -2.5, -18);

  assert.equal(result.overlapContinuationEvidence.isContinuation, true);
  assert.equal(result.strongNegativeOverlapContinuation, false);
  assert.equal(result.boundaryEvidence.shouldBreak, true);
  assert.equal(result.boundaryEvidence.reason, 'first_line_indent_after_sentence');
});

test('boundary arbitration reserves continuation veto for strong negative overlap', () => {
  const arbitrate = loadParagraphBoundaryArbitration();
  const result = arbitrate({
    pageNumber: 3,
    column: 'left',
    sourceText: 'A sentence inside one source paragraph ends here.',
    bbox: { x: 50, y: 100, width: 240, height: 45 },
    lineBoxes: [{ x: 50, y: 100, width: 240, height: 10, pageNumber: 3 }],
  }, {
    pageNumber: 3,
    column: 'left',
    sourceText: 'The overlapping source fragment continues the same paragraph.',
    bbox: { x: 50, y: 115, width: 240, height: 45 },
    lineBoxes: [{ x: 60, y: 115, width: 230, height: 10, pageNumber: 3 }],
  }, 9, -30, -18);

  assert.equal(result.overlapContinuationEvidence.isContinuation, true);
  assert.equal(result.strongNegativeOverlapContinuation, true);
  assert.equal(result.boundaryEvidence.shouldBreak, false);
  assert.equal(result.boundaryEvidence.source, 'strong_negative_overlap_continuation');
});

test('paragraph reconstruction calls boundary finalization before appending a run member', () => {
  const builder = extractFunction(mainSource, 'buildPaperParagraphRuns');
  assert.match(builder, /resolvePaperParagraphBoundaryArbitration\(lastSeg, segment, font, vGap, negFloor\)/);
  assert.match(
    builder,
    /if \(!breakReason && !strongNegativeOverlapContinuation\)[\s\S]*boundaryArbitration\.boundaryEvidence/,
    'only strong negative-overlap continuation may suppress ordinary paragraph boundary evidence'
  );
  assert.match(
    builder,
    /boundaryArbitration\.boundaryEvidence[\s\S]*if \(breakReason\)[\s\S]*else \{ currentSegments\.push\(segment\)/,
    'paragraph identity must be finalized before the normal incoming segment append'
  );
});

test('paragraph reconstruction treats protected formula rows as run boundaries and anchors following prose', () => {
  const builder = extractFunction(mainSource, 'buildPaperParagraphRuns');
  assert.match(
    builder,
    /getFormulaProtectedLineBoxes\(lastSeg, pipelineConfig\)[\s\S]*getFormulaProtectedLineBoxes\(segment, pipelineConfig\)[\s\S]*breakReason = "formula_prose_block"/,
    'raw formula-line authority must split Paragraph Runs before a background can span the object'
  );
  assert.match(
    builder,
    /firstFormulaGroups\.formulaLines\.length > 0[\s\S]*firstFormulaGroups\.proseLines\.find[\s\S]*const paragraphAnchorLine = leadingFormulaProseLine \|\| firstLineBox/,
    'mixed formula/prose runs must begin at the first prose line after a leading protected formula'
  );
  assert.match(
    builder,
    /leadingFormulaGlyphBottom[\s\S]*Math\.max\(rawParagraphAnchorY, leadingFormulaGlyphBottom \+ 0\.5\)/,
    'the translated background must start below the complete protected formula glyph box, not merely at a prose baseline'
  );
});

test('leading-formula prose capacity is synchronized after its anchor moves below the formula', () => {
  const planner = extractFunction(mainSource, 'buildPaperParagraphTopAnchorFlowPlan');
  assert.match(
    planner,
    /const structureGap = run\.leadingFormulaBoundaryApplied \? 0 : flowPolicy\.structureGap/,
    'the ordinary paragraph gap must not be subtracted twice after the formula row moved the prose anchor'
  );
  assert.match(planner, /leadingFormulaCapacitySynchronized: Boolean\(run\.leadingFormulaBoundaryApplied\)/);
});

test('continuation-only paragraph writes use the drawable continuation box for reading order', () => {
  assert.match(
    mainSource,
    /const fwb = \(pm && \(pm\.finalWriteBox \|\| pm\.writeBox\)\) \|\| \(cm && \(cm\.finalWriteBox \|\| cm\.writeBox\)\)/,
    'a continuation with no drawable primary must not fall back to y=0 and execute before earlier paragraph runs'
  );
});
