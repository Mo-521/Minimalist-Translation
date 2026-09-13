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

function loadParagraphCorrectionAuthority() {
  const context = vm.createContext({ String, Number, Math, Set, Array });
  context.paperBoxHorizontalOverlapRatio = () => 0.95;
  context.normalizeExtractedPdfText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  vm.runInContext([
    extractFunction(mainSource, 'getSegmentFirstLineBox'),
    extractFunction(mainSource, 'getSegmentLastLineBox'),
    extractFunction(mainSource, 'resolvePaperParagraphSemanticContinuationEvidence'),
    extractFunction(mainSource, 'resolvePaperParagraphIncompleteSentenceLargeGapEvidence'),
    extractFunction(mainSource, 'resolvePaperParagraphCrossBoundaryIdentityEvidence'),
    extractFunction(mainSource, 'createPaperParagraphCorrectionDecision'),
  ].join('\n'), context);
  return context;
}

function loadWrapper() {
  const context = vm.createContext({ String, Array, RegExp });
  context.normalizeFormulaToken = (value) => String(value || '');
  context.isPaperFormulaWrapToken = () => false;
  context.splitLongToken = (token, font, size, maxWidth) => {
    const parts = [];
    let part = '';
    Array.from(token).forEach((character) => {
      if (part && font.widthOfTextAtSize(part + character, size) > maxWidth) { parts.push(part); part = character; }
      else part += character;
    });
    if (part) parts.push(part);
    return parts;
  };
  vm.runInContext(extractFunction(mainSource, 'cleanPdfText'), context);
  vm.runInContext(extractFunction(mainSource, 'tokenizePaperWrapText'), context);
  vm.runInContext(extractFunction(mainSource, 'composePaperWrapTokens'), context);
  vm.runInContext(extractFunction(mainSource, 'updatePaperParagraphCorrectionTailDecision'), context);
  vm.runInContext(extractFunction(mainSource, 'balancePaperParagraphTailLines'), context);
  vm.runInContext(extractFunction(mainSource, 'wrapTranslatedTextForPaperBox'), context);
  return context.wrapTranslatedTextForPaperBox;
}

function segment(overrides = {}) {
  return {
    pageNumber: 1,
    column: 'left',
    bbox: { x: 50, y: 100, width: 240, height: 20 },
    lineBoxes: [{ x: 50, y: 100, width: 240, height: 10, pageNumber: 1 }],
    ...overrides,
  };
}

test('same-grid unindented body fragments recover one semantic continuation', () => {
  const authority = loadParagraphCorrectionAuthority();
  const decision = authority.createPaperParagraphCorrectionDecision({
    previous: segment({ sourceText: 'A complete sentence inside one paragraph.' }),
    current: segment({ sourceText: 'The extractor emitted the next sentence separately.', bbox: { x: 50, y: 126, width: 240, height: 20 }, lineBoxes: [{ x: 50, y: 126, width: 240, height: 10, pageNumber: 1 }] }),
    englishBodyFontSize: 9,
    verticalGap: 6,
    candidateReason: 'sentence_end_gap',
  });
  assert.equal(decision.decision, 'correct');
  assert.equal(decision.boundary.evidence.source, 'same_grid_unindented_body_continuation');
});

test('insufficient evidence is an explicit no-op decision', () => {
  const authority = loadParagraphCorrectionAuthority();
  const decision = authority.createPaperParagraphCorrectionDecision({
    previous: segment({ sourceParagraphId: 'paragraph-a' }),
    current: segment({ sourceParagraphId: 'paragraph-b' }),
    englishBodyFontSize: 9,
    verticalGap: 6,
    candidateReason: 'sentence_end_gap',
  });
  assert.equal(decision.decision, 'no-op');
  assert.equal(decision.boundary.decision, 'no-op');
  assert.equal(decision.candidateGenerated, true);
  assert.deepEqual(Array.from(decision.missingEvidence), ['sharedSourceParagraphIdentity']);
});

test('hard structural evidence is an explicit reject decision', () => {
  const authority = loadParagraphCorrectionAuthority();
  const decision = authority.createPaperParagraphCorrectionDecision({
    previous: segment(), current: segment(), hardBlockReason: 'caption_structure_block',
  });
  assert.equal(decision.decision, 'reject');
  assert.equal(decision.boundary.reason, 'caption_structure_block');
  assert.equal(decision.candidateGenerated, false);
  assert.deepEqual(Array.from(decision.missingEvidence), ['structural_rule:caption_structure_block']);
});

test('unfinished same-grid sentence can recover across one bounded large extraction gap', () => {
  const authority = loadParagraphCorrectionAuthority();
  const decision = authority.createPaperParagraphCorrectionDecision({
    previous: segment({ id: 'seg-a', sourceText: 'The left panel shows the' }),
    current: segment({ id: 'seg-b', sourceText: 'image in the observed band.', bbox: { x: 50, y: 155, width: 240, height: 20 }, lineBoxes: [{ x: 50, y: 155, width: 240, height: 10, pageNumber: 1 }] }),
    englishBodyFontSize: 9,
    verticalGap: 35,
    candidateReason: 'incomplete_sentence_large_gap',
  });
  assert.equal(decision.candidateGenerated, true);
  assert.equal(decision.decision, 'correct');
  assert.equal(decision.reason, 'incomplete_sentence_large_gap_recovered');
  assert.deepEqual(Array.from(decision.missingEvidence), []);
});

test('large-gap recovery uses the containing column box when the previous tail is a local line fragment', () => {
  const authority = loadParagraphCorrectionAuthority();
  const decision = authority.createPaperParagraphCorrectionDecision({
    previous: segment({
      id: 'seg-tail',
      sourceText: 'The left panel shows the Chandra',
      bbox: { x: 174, y: 100, width: 116, height: 10 },
      lineBoxes: [{ x: 174, y: 100, width: 116, height: 10, pageNumber: 1 }],
    }),
    current: segment({
      id: 'seg-next-line',
      sourceText: 'image in the observed band, while the right panel shows',
      bbox: { x: 50, y: 145, width: 240, height: 10 },
      lineBoxes: [{ x: 50, y: 145, width: 240, height: 10, pageNumber: 1 }],
    }),
    englishBodyFontSize: 9,
    verticalGap: 35,
    candidateReason: 'incomplete_sentence_large_gap',
  });
  assert.equal(decision.decision, 'correct');
  assert.equal(decision.boundary.evidence.directLineStartAligned, false);
  assert.equal(decision.boundary.evidence.currentBoxContainsPreviousFragment, true);
  assert.equal(decision.boundary.evidence.lineStartEvidenceSource, 'current_box_contains_previous_fragment');
  assert.deepEqual(Array.from(decision.missingEvidence), []);
});

test('large gap recovery remains no-op for a completed sentence or an excessive gap', () => {
  const authority = loadParagraphCorrectionAuthority();
  const completed = authority.createPaperParagraphCorrectionDecision({
    previous: segment({ sourceText: 'A complete paragraph.' }),
    current: segment({ sourceText: 'A distinct paragraph.', bbox: { x: 50, y: 155, width: 240, height: 20 }, lineBoxes: [{ x: 50, y: 155, width: 240, height: 10, pageNumber: 1 }] }),
    englishBodyFontSize: 9, verticalGap: 35, candidateReason: 'incomplete_sentence_large_gap',
  });
  const excessive = authority.createPaperParagraphCorrectionDecision({
    previous: segment({ sourceText: 'An unfinished phrase' }),
    current: segment({ sourceText: 'continues too far away', bbox: { x: 50, y: 220, width: 240, height: 20 }, lineBoxes: [{ x: 50, y: 220, width: 240, height: 10, pageNumber: 1 }] }),
    englishBodyFontSize: 9, verticalGap: 100, candidateReason: 'incomplete_sentence_large_gap',
  });
  assert.equal(completed.decision, 'no-op');
  assert.ok(Array.from(completed.missingEvidence).includes('previousSentenceIncomplete'));
  assert.equal(excessive.decision, 'no-op');
  assert.ok(Array.from(excessive.missingEvidence).includes('withinRecoverableGeometryGap'));
});

test('collapsed source-line geometry authorizes one bounded extended-gap continuation', () => {
  const authority = loadParagraphCorrectionAuthority();
  const previousText = 'Stellar masses are derived from broadband spectral fitting and deep imaging '.repeat(8).trim();
  const decision = authority.createPaperParagraphCorrectionDecision({
    previous: segment({
      id: 'seg-collapsed',
      sourceText: previousText,
      bbox: { x: 50, y: 80, width: 240, height: 20 },
      lineBoxes: [
        { x: 50, y: 80, width: 240, height: 10, pageNumber: 1 },
        { x: 50, y: 90, width: 240, height: 10, pageNumber: 1 },
      ],
    }),
    current: segment({ id: 'seg-tail', sourceText: 'form of tidal tails supporting the merger interpretation.', bbox: { x: 50, y: 210, width: 240, height: 20 }, lineBoxes: [{ x: 50, y: 210, width: 240, height: 10, pageNumber: 1 }] }),
    englishBodyFontSize: 9,
    verticalGap: 110,
    candidateReason: 'incomplete_sentence_large_gap',
  });
  assert.equal(decision.decision, 'correct');
  assert.equal(decision.boundary.evidence.collapsedSourceGeometry, true);
  assert.equal(decision.boundary.evidence.checks.withinRecoverableGeometryGap, true);
});

test('cross-column and cross-page identity recovery preserves physical page ownership', () => {
  const resolve = loadParagraphCorrectionAuthority().resolvePaperParagraphCrossBoundaryIdentityEvidence;
  const crossColumn = resolve(
    { paragraphId: 'ppr-1', pageNumber: 1, column: 'left', type: 'body', sourceText: 'driving inflows', blockedByZone: false },
    { paragraphId: 'ppr-2', pageNumber: 1, column: 'right', type: 'body', sourceText: 'toward the nuclear region.', blockedByZone: false },
  );
  const crossPage = resolve(
    { paragraphId: 'ppr-3', pageNumber: 3, column: 'right', type: 'body', sourceText: 'we infer luminosity using em-', blockedByZone: false },
    { paragraphId: 'ppr-4', pageNumber: 4, column: 'left', type: 'body', sourceText: 'pirical corrections.', blockedByZone: false },
  );
  assert.equal(crossColumn.isContinuation, true);
  assert.equal(crossColumn.source, 'cross_column_reading_order');
  assert.equal(crossColumn.previousPage, 1);
  assert.equal(crossColumn.currentPage, 1);
  assert.equal(crossPage.isContinuation, true);
  assert.equal(crossPage.source, 'cross_page_reading_order');
  assert.equal(crossPage.previousPage, 3);
  assert.equal(crossPage.currentPage, 4);
  assert.match(mainSource, /segment\.logicalParagraphId = run\.logicalParagraphId/);
  assert.doesNotMatch(mainSource, /run\.pageNumber\s*=\s*previousPhysicalRun\.pageNumber/);
});

test('semantic evidence reports every geometry check without changing its decision', () => {
  const resolve = loadParagraphCorrectionAuthority().resolvePaperParagraphSemanticContinuationEvidence;
  const evidence = resolve(
    segment({ sourceText: 'A complete sentence.' }),
    segment({ sourceText: 'Indented fragment.', bbox: { x: 50, y: 126, width: 240, height: 20 }, lineBoxes: [{ x: 62, y: 126, width: 228, height: 10, pageNumber: 1 }] }),
    9,
    6,
  );
  assert.equal(evidence.isContinuation, false);
  assert.equal(evidence.checks.noFirstLineIndentBoundary, false);
  assert.ok(Array.from(evidence.failedEvidence).includes('noFirstLineIndentBoundary'));
  assert.equal(typeof evidence.minimumContinuationGap, 'number');
  assert.equal(typeof evidence.maximumLineStartDelta, 'number');
});

test('semantic recovery cannot cross explicit paragraph, page, column, or indent boundaries', () => {
  const resolve = loadParagraphCorrectionAuthority().resolvePaperParagraphSemanticContinuationEvidence;
  const previous = segment({ sourceParagraphId: 'paragraph-a' });
  assert.equal(resolve(previous, segment({ sourceParagraphId: 'paragraph-b' }), 9, 6).isContinuation, false);
  assert.equal(resolve(segment(), segment({ pageNumber: 2, lineBoxes: [{ x: 50, y: 126, width: 240, height: 10, pageNumber: 2 }] }), 9, 6).isContinuation, false);
  assert.equal(resolve(segment(), segment({ column: 'right' }), 9, 6).isContinuation, false);
  assert.equal(resolve(segment(), segment({ bbox: { x: 50, y: 126, width: 240, height: 20 }, lineBoxes: [{ x: 62, y: 126, width: 228, height: 10, pageNumber: 1 }] }), 9, 6).isContinuation, false);
});

test('whole Paragraph reflow balances a short tail through the shared authority decision', () => {
  const wrap = loadWrapper();
  const font = { widthOfTextAtSize: (value) => Array.from(String(value || '')).length };
  const text = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地玄';
  const correctionDecision = {
    authorityVersion: 'paper-paragraph-correction/v1', decision: 'no-op', reason: 'boundary_preserved',
    boundary: { decision: 'no-op', reason: 'boundary_preserved' }, tail: { decision: 'pending', reason: 'not_evaluated' },
  };
  const lines = wrap(text, font, 1, 10, { paragraphCorrectionDecision: correctionDecision });
  assert.equal(lines.length, 3);
  assert.equal(lines.join(''), text);
  assert.ok(lines[2].length >= 5, `tail should be balanced: ${JSON.stringify(lines)}`);
  assert.equal(correctionDecision.tail.decision, 'correct');
  assert.equal(correctionDecision.decision, 'correct');
});

test('unscoped text is not visually rewritten without Paragraph authority', () => {
  const wrap = loadWrapper();
  const font = { widthOfTextAtSize: (value) => Array.from(String(value || '')).length };
  const text = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地玄';
  const lines = wrap(text, font, 1, 10);
  assert.equal(lines.join(''), text);
  assert.equal(lines[2].length, 5);
});

test('tail balancing is paragraph-local and does not rewrite semantic order', () => {
  const wrap = loadWrapper();
  const font = { widthOfTextAtSize: (value) => Array.from(String(value || '')).length };
  const first = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地玄';
  const second = '后续段落保持独立';
  const makeDecision = () => ({ authorityVersion: 'paper-paragraph-correction/v1', decision: 'no-op', boundary: { decision: 'no-op' }, tail: { decision: 'pending' } });
  const paragraphs = `${first}\n${second}`.split(/\n+/).map((paragraph) => wrap(paragraph, font, 1, 10, { paragraphCorrectionDecision: makeDecision() }));
  assert.equal(paragraphs[0].join(''), first);
  assert.equal(paragraphs[1].join(''), second);
  assert.deepEqual(Array.from(paragraphs[1]), [second]);
});

test('structural boundaries remain ahead of correction authority in Paragraph Run finalization', () => {
  const builder = extractFunction(mainSource, 'buildPaperParagraphRuns');
  const authorityIndex = builder.indexOf('createPaperParagraphCorrectionDecision');
  assert.ok(builder.indexOf('type_break_') < authorityIndex);
  assert.ok(builder.indexOf('formula_prose_block') < authorityIndex);
  assert.ok(builder.indexOf('image_region_block') < authorityIndex);
  assert.match(builder, /correctionDecision\.decision === 'correct'[\s\S]*else breakReason = "sentence_end_gap"/);
});

test('accepted Paragraph Run passes its single correction decision into final fit', () => {
  const groupBuilder = extractFunction(mainSource, 'buildPaperParagraphRunWriteGroups');
  assert.match(groupBuilder, /run,\s*topAnchorPlan/);
  assert.match(mainSource, /_paragraphRunGroup\.run\.paragraphCorrectionDecision/);
  assert.match(mainSource, /segment\.paragraphCorrectionDecision = _paragraphCorrectionDecision/);
  assert.match(mainSource, /entryReport\.paragraphCorrectionDecision = _paragraphCorrectionDecision/);
});

test('every finalized Paragraph exposes a diagnostic-only decision lifecycle', () => {
  const builder = extractFunction(mainSource, 'buildPaperParagraphRuns');
  assert.match(builder, /traceVersion: 'paper-paragraph-decision-trace\/v1'/);
  assert.match(builder, /diagnosticOnly: true/);
  assert.match(builder, /stage: 'paragraph_run_constructed'/);
  assert.match(builder, /stage: 'recovery_candidate_generation'/);
  assert.match(builder, /stage: 'boundary_decision'/);
  assert.match(builder, /eligibleTriggers: \['sentence_end_gap', 'incomplete_sentence_large_gap'\]/);
  assert.match(builder, /structural:[\s\S]*semantic:[\s\S]*geometry:/);
  assert.match(mainSource, /stage: 'paragraph_decision_finalized'/);
  assert.match(mainSource, /paperParagraphRecoveryCandidateGeneratedCount/);
  assert.match(mainSource, /paperParagraphDecisionTraceVersion/);
  assert.match(mainSource, /paperParagraphDecisionTraceCount/);
  assert.match(mainSource, /paperParagraphCorrectionDecisionDetails[\s\S]*decisionTrace/);
});

/* legacy resolver call retained below only as source-extraction regression fixture */
/*
  const evidence = resolve(
    segment({ sourceText: 'A complete sentence inside one paragraph.' }),
    segment({ sourceText: 'The extractor emitted the next sentence separately.', bbox: { x: 50, y: 126, width: 240, height: 20 }, lineBoxes: [{ x: 50, y: 126, width: 240, height: 10, pageNumber: 1 }] }),
    9,
    6,
  );
  assert.equal(evidence.isContinuation, true);
  assert.equal(evidence.source, 'same_grid_unindented_body_continuation');
});

test('semantic recovery cannot cross explicit paragraph, page, column, or indent boundaries', () => {
  const resolve = loadSemanticContinuationResolver();
  const previous = segment({ sourceParagraphId: 'paragraph-a' });
  assert.equal(resolve(previous, segment({ sourceParagraphId: 'paragraph-b' }), 9, 6).isContinuation, false);
  assert.equal(resolve(segment(), segment({ pageNumber: 2, lineBoxes: [{ x: 50, y: 126, width: 240, height: 10, pageNumber: 2 }] }), 9, 6).isContinuation, false);
  assert.equal(resolve(segment(), segment({ column: 'right' }), 9, 6).isContinuation, false);
  assert.equal(resolve(segment(), segment({ bbox: { x: 50, y: 126, width: 240, height: 20 }, lineBoxes: [{ x: 62, y: 126, width: 228, height: 10, pageNumber: 1 }] }), 9, 6).isContinuation, false);
});

test('whole Paragraph reflow balances a short tail without changing content or line count', () => {
  const wrap = loadWrapper();
  const font = { widthOfTextAtSize: (value) => Array.from(String(value || '')).length };
  const text = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地玄';
  const lines = wrap(text, font, 1, 10);
  assert.equal(lines.length, 3);
  assert.equal(lines.join(''), text);
  assert.ok(lines[2].length >= 5, `tail should be balanced: ${JSON.stringify(lines)}`);
  assert.ok(Math.abs(lines[1].length - lines[2].length) <= 2, `last two lines should be balanced: ${JSON.stringify(lines)}`);
});

test('tail balancing is paragraph-local and does not rewrite semantic order', () => {
  const wrap = loadWrapper();
  const font = { widthOfTextAtSize: (value) => Array.from(String(value || '')).length };
  const first = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地玄';
  const second = '后续段落保持独立';
  const paragraphs = `${first}\n${second}`.split(/\n+/).map((paragraph) => wrap(paragraph, font, 1, 10));
  assert.equal(paragraphs[0].join(''), first);
  assert.equal(paragraphs[1].join(''), second);
  assert.deepEqual(Array.from(paragraphs[1]), [second]);
});

test('structural boundaries remain ahead of semantic recovery in Paragraph Run finalization', () => {
  const builder = extractFunction(mainSource, 'buildPaperParagraphRuns');
  const semanticIndex = builder.indexOf('resolvePaperParagraphSemanticContinuationEvidence');
  assert.ok(builder.indexOf('type_break_') < semanticIndex);
  assert.ok(builder.indexOf('formula_prose_block') < semanticIndex);
  assert.ok(builder.indexOf('image_region_block') < semanticIndex);
  assert.match(builder, /semanticContinuation\.isContinuation[\s\S]*else breakReason = "sentence_end_gap"/);
});
*/
