const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');
const mainSource = fs.readFileSync(path.join(root, 'electron-app/main.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'electron-app/renderer.js'), 'utf8');

function extractFunction(source, name) {
  const asyncStart = source.indexOf(`async function ${name}(`);
  const plainStart = source.indexOf(`function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : plainStart;
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

test('extracted text normalization rejoins detached Unicode combining marks without collapsing ordinary word spaces', () => {
  const context = vm.createContext({ String });
  vm.runInContext(extractFunction(mainSource, 'normalizeExtractedPdfText'), context);

  assert.equal(context.normalizeExtractedPdfText('Ba \u0303nados'), 'Bañados');
  assert.equal(context.normalizeExtractedPdfText('Mi \u0301ci \u0301c'), 'Mićić');
  assert.equal(context.normalizeExtractedPdfText('Bogd \u0301\u0301 an'), 'Bogdán');
  assert.equal(context.normalizeExtractedPdfText('ordinary scientific citation'), 'ordinary scientific citation');
});

test('PDF font runs use a Unicode fallback only for glyphs missing from the primary font', () => {
  const primary = { getCharacterSet: () => [32, 66, 97, 100, 111, 115] };
  const fallback = { getCharacterSet: () => [241, 263] };
  const context = vm.createContext({ String, Array });
  vm.runInContext(extractFunction(mainSource, 'pdfFontSupportsCharacter'), context);
  vm.runInContext(extractFunction(mainSource, 'makePdfFontRuns'), context);

  const runs = context.makePdfFontRuns('Bañados ć', primary, fallback);
  assert.deepEqual(JSON.parse(JSON.stringify(runs.map((run) => run.text))), ['Ba', 'ñ', 'ados ', 'ć']);
  assert.equal(runs[0].font, primary);
  assert.equal(runs[1].font, fallback);
  assert.equal(runs[2].font, primary);
  assert.equal(runs[3].font, fallback);
});

test('packed multi-line source identity recovers masks from same-page raw-line authority', () => {
  const context = vm.createContext({ String, Number, Array, Set });
  vm.runInContext(extractFunction(mainSource, 'normalizeExtractedPdfText'), context);
  vm.runInContext(extractFunction(mainSource, 'recoverPackedSourceLineBoxesFromRawAuthority'), context);
  const segment = {
    id: 'body-packed', pageNumber: 3, column: 'right',
    sourceText: 'The total integrated flux was derived from the fitted amplitude. The result remains physically consistent with the measured spectrum.',
  };
  const packed = [{ pageNumber: 3, x: 320, y: 520, width: 205, height: 14, fontSize: 10, text: segment.sourceText }];
  const rawLines = { '3': [
    { pageNumber: 3, column: 'right', bbox: { x: 320, y: 520, width: 245, height: 10 }, text: 'The total integrated flux was derived from the fitted amplitude.' },
    { pageNumber: 3, column: 'right', bbox: { x: 320, y: 533, width: 235, height: 10 }, text: 'The result remains physically consistent with the measured spectrum.' },
    { pageNumber: 3, column: 'left', bbox: { x: 40, y: 520, width: 245, height: 10 }, text: 'Unrelated text in the other column must not be consumed.' },
  ] };
  const recovered = context.recoverPackedSourceLineBoxesFromRawAuthority(segment, packed, rawLines);

  assert.equal(recovered.length, 2);
  assert.ok(recovered.every((line) => line.packedSourceGeometryRecovered));
  assert.deepEqual(JSON.parse(JSON.stringify(recovered.map((line) => line.y))), [520, 533]);
});

test('raw PDF baseline geometry is converted to a glyph-cover mask at the mask boundary', () => {
  const context = vm.createContext({ Math, Number });
  vm.runInContext(extractFunction(mainSource, 'makeRawSourceGlyphMaskBox'), context);
  const source = { x: 97.03, y: 262.62, width: 351.5, height: 8.97 };
  const mask = context.makeRawSourceGlyphMaskBox(source);

  assert.ok(mask.y < source.y, 'mask must cover glyph ascent above the PDF.js baseline');
  assert.ok(mask.y + mask.height > source.y, 'mask must cover glyph descent below the baseline');
  assert.ok(mask.x < source.x && mask.x + mask.width > source.x + source.width);
  assert.deepEqual(source, { x: 97.03, y: 262.62, width: 351.5, height: 8.97 }, 'source identity geometry must remain immutable');
});

test('paper translation automatically retries transient and invalid outputs but not authorization failures', async () => {
  let attempts = 0;
  const context = vm.createContext({
    String, Number, Array, Error,
    waitForPdfTranslationRetry: async () => {},
    getInvalidTranslationReason: (_source, translated) => translated === 'unchanged output' ? 'invalid_translation_source_language_unchanged' : '',
    translateSegmentSourceText: async () => {
      attempts += 1;
      if (attempts === 1) {
        const err = new Error('service unavailable');
        err.httpStatus = 503;
        throw err;
      }
      if (attempts === 2) return 'unchanged output';
      return '有效译文';
    },
  });
  vm.runInContext([
    extractFunction(rendererSource, 'isRetryablePdfTranslationError'),
    extractFunction(rendererSource, 'translatePaperSegmentWithRetry'),
  ].join('\n'), context);

  const recovered = await context.translatePaperSegmentWithRetry('source prose', null);
  assert.equal(recovered.translated, '有效译文');
  assert.equal(recovered.retryCount, 2);
  assert.equal(attempts, 3);

  const authError = new Error('unauthorized');
  authError.httpStatus = 401;
  assert.equal(context.isRetryablePdfTranslationError(authError), false);
  const rateLimit = new Error('rate limited');
  rateLimit.httpStatus = 429;
  assert.equal(context.isRetryablePdfTranslationError(rateLimit), true);
});

test('endpoint fallback occurs only for a missing endpoint', () => {
  const requestFirst = extractFunction(rendererSource, 'requestFirstJson');
  assert.match(requestFirst, /Number\(err\.httpStatus \|\| 0\) !== 404/);
  assert.doesNotMatch(requestFirst, /httpStatus.*429/);
});

test('caption raw-source masks consume glyph-cover geometry without changing layout or region authority', () => {
  const start = mainSource.indexOf("maskKind: 'captionGroupRawSourceMask'");
  assert.ok(start > 0);
  const sourceMaskBlock = mainSource.slice(start - 1200, start + 900);
  assert.match(sourceMaskBlock, /makeRawSourceGlyphMaskBox\(rawBox\)/);
  assert.match(sourceMaskBlock, /convertBoxToPdfCoords\(rawSourceGlyphMaskBox/);
  assert.match(sourceMaskBlock, /sourceBaselineBox/);
  assert.match(sourceMaskBlock, /sourceMaskBox: \{ \.\.\.rawSourceGlyphMaskBox, text: rawBox\.text \}/);
  assert.match(sourceMaskBlock, /sourceGeometryInterpretation: 'pdfjs_baseline_to_glyph_cover'/);
  assert.doesNotMatch(sourceMaskBlock, /captionRegion|writeBox\s*=|translatedText\s*=/);
});

test('source cover planning excludes protected formula lines before mask materialization', () => {
  const context = vm.createContext({
    Map, Set, Array, String, Number, Math,
    isFormulaProtectedSourceLine: (_segment, line) => Boolean(line && line.formulaProtected),
    getPaperSourceMaskPreserveBoxes: () => [],
    subtractTopLeftBox: (box) => [box],
    paperColumnFlowBoxesOverlap: () => true,
  });
  vm.runInContext(extractFunction(mainSource, 'buildPaperSourceCoverPlan'), context);
  const proseBox = { x: 40, y: 80, width: 200, height: 12 };
  const formulaBox = { x: 80, y: 110, width: 120, height: 18 };
  const plan = context.buildPaperSourceCoverPlan([
    { segmentId: 'body-a', pageNumber: 1, page: {}, line: { text: 'prose' }, maskBox: proseBox },
    { segmentId: 'body-a', pageNumber: 1, page: {}, line: { text: 'L=mc^2', formulaProtected: true }, maskBox: formulaBox },
  ], ['body-a'], [{ id: 'body-a' }], new Map(), { mode: 'paper_pdf' });

  assert.equal(plan.sourceMaskBoxes.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.sourceMaskBoxes[0].box)), proseBox);
  assert.equal(plan.preservedFormulaMaskBoxes.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.preservedFormulaMaskBoxes[0].box)), formulaBox);
});

test('formula protection distinguishes standalone equations from prose containing math glyphs', () => {
  const context = vm.createContext({ String, Array, RegExp });
  vm.runInContext(extractFunction(mainSource, 'cleanPdfText'), context);
  vm.runInContext(extractFunction(mainSource, 'hasStandardFormulaToken'), context);
  vm.runInContext(extractFunction(mainSource, 'isFormulaProtectedText'), context);
  vm.runInContext(extractFunction(mainSource, 'hasVerbLikeFormulaProse'), context);
  vm.runInContext(extractFunction(mainSource, 'isFormulaProseLineText'), context);
  vm.runInContext(extractFunction(mainSource, 'isFormulaProtectedLineBox'), context);
  const config = { mode: 'paper_pdf', enableFormulaLinePreserve: 'equation_block_only' };

  assert.equal(context.isFormulaProtectedLineBox({ text: 'Lbol/10^43 erg s^-1 = 4000(L[O III]/10^43 erg s^-1)^1.39' }, config), true);
  assert.equal(context.isFormulaProtectedLineBox({ text: 'rection relation (±0.6 dex) (J. Stern & A. Laor 2012).' }, config), false);
});

test('displayed equation number is preserved with its immediately preceding equation line', () => {
  const context = vm.createContext({ String, Array, RegExp, Set, Number, Math });
  context.normalizePdfLineBoxes = (segment) => segment.lineBoxes || [];
  context.isFormulaProtectedLineBox = (line) => Boolean(line.formulaProtected);
  vm.runInContext(extractFunction(mainSource, 'cleanPdfText'), context);
  vm.runInContext(extractFunction(mainSource, 'getFormulaSegmentLineGroups'), context);
  const equation = { x: 60, y: 620, width: 220, height: 10, text: 'log(MBH/M)=7.45', formulaProtected: true };
  const number = { x: 280, y: 634, width: 12, height: 10, text: '(4)' };
  const prose = { x: 60, y: 650, width: 220, height: 10, text: 'This relation was constructed' };
  const groups = context.getFormulaSegmentLineGroups({ lineBoxes: [equation, number, prose] }, {});

  assert.equal(groups.formulaLines.length, 2);
  assert.equal(groups.formulaLines.includes(number), true);
  assert.deepEqual(Array.from(groups.proseLines), [prose]);
});

test('following prose mask cannot erase a protected formula through inflated glyph metrics', () => {
  const functionSource = extractFunction(mainSource, 'getValidSegmentLineMasks');
  assert.match(functionSource, /getFormulaScientificObjectEnvelopeBoxes\(segment, pipelineConfig, currentPdfAllRawTextItemsByPage\)/);
  assert.match(functionSource, /protectedFormulaGlyphBoxes/);
  assert.match(functionSource, /const followsFormula = Number\(line\.y \|\| 0\) > Number\(formulaLine && formulaLine\.y \|\| 0\)/);
  assert.match(functionSource, /clippedByProtectedFormulaGlyph: true/);
  assert.match(functionSource, /if \(Number\(maskBox\.height \|\| 0\) < 2\) return/);
});

test('scientific object envelope includes detached formula members from raw PDF text-item authority', () => {
  const envelopeBuilder = extractFunction(mainSource, 'getFormulaScientificObjectEnvelopeBoxes');
  assert.match(mainSource, /currentPdfAllRawTextItemsByPage\[String\(pageNumber\)\] = rawTextItems/);
  assert.match(envelopeBuilder, /rawTextItemsByPage/);
  assert.match(envelopeBuilder, /baselineBand = Math\.max\(6, formulaFont \* 0\.85\)/);
  assert.match(envelopeBuilder, /isFormulaProseLineText\(rawText\)/);
  assert.match(envelopeBuilder, /isCompactFormulaVariable/);
  assert.match(envelopeBuilder, /isFormulaLikeLineBox\(rawItem\) \|\| isEquationNumber \|\| isCompactFormulaVariable/);
  assert.doesNotMatch(envelopeBuilder, /rawText\.length <= 12/);
  assert.match(envelopeBuilder, /isEquationNumber/);
  assert.match(envelopeBuilder, /unionTopLeftBoxes\(memberBoxes\)/);
});

test('page formula authority clips a preceding segment mask before the following scientific object', () => {
  const authorityBuilder = extractFunction(mainSource, 'buildPaperFormulaProtectionAuthority');
  const maskBuilder = extractFunction(mainSource, 'getValidSegmentLineMasks');
  assert.match(authorityBuilder, /getFormulaProtectedLineBoxes\(segment, pipelineConfig\)/);
  assert.match(authorityBuilder, /getFormulaScientificObjectEnvelopeBoxes\(segment, pipelineConfig, currentPdfAllRawTextItemsByPage\)/);
  assert.match(mainSource, /currentPdfFormulaProtectionByPage = buildPaperFormulaProtectionAuthority\(segments, pipelineConfig\)/);
  assert.match(maskBuilder, /currentPdfFormulaProtectionByPage\[String\(pageNumber\)\]/);
  assert.match(maskBuilder, /const precedesFormula = Number\(line\.y \|\| 0\) < Number\(formulaLine && formulaLine\.y \|\| 0\)/);
  assert.match(maskBuilder, /clippedByFollowingProtectedFormulaGlyph: true/);
});

test('a gutter-edge inline tail keeps the adjacent column identity through baseline continuity', () => {
  const columnDetector = extractFunction(mainSource, 'detectPageColumns');
  assert.match(columnDetector, /const unresolvedMiddleItems = \[\]/);
  assert.match(columnDetector, /baselineDelta <= Math\.max\(2, itemFont \* 0\.35\)/);
  assert.match(columnDetector, /gap >= -1 && gap <= continuityLimit/);
  assert.match(columnDetector, /leftItems\.push\(\{ \.\.\.item, column: 'left' \}\)/);
  assert.match(columnDetector, /rightItems\.push\(\{ \.\.\.item, column: 'right' \}\)/);
  assert.match(columnDetector, /middleItems\.splice\(0, middleItems\.length, \.\.\.unresolvedMiddleItems\)/);
});

test('continuous English body lines prevent PDF text fragments from fabricating two columns', () => {
  const context = vm.createContext({ Number, Math });
  const lines = Array.from({ length: 8 }, (_, index) => ({
    bbox: { x: 55, y: 80 + index * 13, width: 500, height: 10 },
    avgFontSize: 10,
    items: [
      { x: 55, width: 245, fontSize: 10 },
      { x: 302, width: 253, fontSize: 10 },
    ],
  }));
  context.filterHeaderFooterItems = items => items;
  context.getPageBounds = () => ({ x: 55, y: 80, width: 500, height: 104, right: 555, bottom: 184 });
  context.mergeTextItemsIntoLines = () => lines;
  context.mergeTextItemsIntoColumnEvidenceLines = () => lines;
  context.detectPageLayout = () => ({ layoutType: 'single_column', languageHint: 'en', confidence: 0.9, columnCount: 1 });
  vm.runInContext(extractFunction(mainSource, 'detectPageColumns'), context);
  const items = Array.from({ length: 30 }, (_, index) => ({
    x: index % 2 ? 302 : 55, y: 80 + Math.floor(index / 2) * 13, width: index % 2 ? 253 : 245,
    pageWidth: 612, pageHeight: 792, pageNumber: 11,
  }));
  const columns = context.detectPageColumns(items);
  assert.equal(columns.length, 1);
  assert.equal(columns[0].name, 'single');
  assert.ok(columns[0].items.every(item => item.column === 'single'));
});

test('translated duplicate formula prefix is removed while translated prose remains', () => {
  const context = vm.createContext({ String, Array, RegExp, Set, Number, Math });
  context.normalizePdfLineBoxes = (segment) => segment.lineBoxes || [];
  context.isFormulaProtectedLineBox = (line) => Boolean(line.formulaProtected);
  context.isFormulaProtectedText = (text) => /=/.test(text);
  vm.runInContext(extractFunction(mainSource, 'cleanPdfText'), context);
  vm.runInContext(extractFunction(mainSource, 'getFormulaSegmentLineGroups'), context);
  vm.runInContext(extractFunction(mainSource, 'getFormulaSemanticIdentityTokens'), context);
  vm.runInContext(extractFunction(mainSource, 'isSemanticallyEquivalentFormulaPrefix'), context);
  vm.runInContext(extractFunction(mainSource, 'stripLeadingPreservedFormulaFromTranslation'), context);
  const segment = { lineBoxes: [
    { x: 60, y: 620, width: 220, height: 10, text: 'log(MBH/M)=7.45', formulaProtected: true },
    { x: 60, y: 650, width: 220, height: 10, text: 'This relation was constructed' },
  ] };

  assert.equal(context.stripLeadingPreservedFormulaFromTranslation(segment, 'log(MBH/M)=7.45，该关系由样本建立', {}), '该关系由样本建立');
  const localizedUnitSegment = { lineBoxes: [
    { x: 60, y: 620, width: 220, height: 10, text: 'Lbol/10^43 erg s^-1 = 4000(L[OIII]/10^43 erg s^-1)^1.39', formulaProtected: true },
    { x: 60, y: 650, width: 220, height: 10, text: 'This relation yields bolometric luminosity' },
  ] };
  assert.equal(
    context.stripLeadingPreservedFormulaFromTranslation(localizedUnitSegment, '尔格秒^-1 = 4000(L[OIII]/10^43尔格秒^-1)^1.39。该关系式给出的热光度符合预期', {}),
    '该关系式给出的热光度符合预期'
  );
  assert.equal(
    context.stripLeadingPreservedFormulaFromTranslation(localizedUnitSegment, '该关系式给出的热光度为4000，与观测一致。', {}),
    '该关系式给出的热光度为4000，与观测一致。'
  );
});

test('translation acceptance rejects refusal, unchanged prose, and leading source carryover before masking', () => {
  const start = mainSource.indexOf('function getTranslationOutputSemanticFailure(');
  const end = mainSource.indexOf('async function exportSimpleTranslatedPdfDocumentFlow', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({ Math, String });
  vm.runInContext(mainSource.slice(start, end), context);

  assert.equal(
    context.getTranslationOutputSemanticFailure('ric correction:', '由于原文未提供具体段落内容，无法进行翻译。请提供需要翻译的文本。'),
    'invalid_translation_refusal'
  );
  assert.equal(
    context.getTranslationOutputSemanticFailure('residing in the smaller galaxy reacts dramatically', 'residing in the smaller galaxy reacts dramatically'),
    'invalid_translation_source_language_unchanged'
  );
  assert.equal(
    context.getTranslationOutputSemanticFailure('tion is kbol approximately 32', 'tion is kbol ≈32，且热光度'),
    'invalid_translation_leading_source_carryover'
  );
  assert.equal(
    context.getTranslationOutputSemanticFailure('tion is kbol approximately 32', 'tion是kbol ≈32，且热光度'),
    '' // One word alone cannot distinguish a source fragment from a permitted term.
  );
  assert.equal(
    context.getTranslationOutputSemanticFailure('Marconi et al. 2004). The resulting correction', 'Marconi et al. 2004）。由此产生的热改正'),
    ''
  );
  assert.equal(
    context.getTranslationOutputSemanticFailure('X-ray and [O III] emission.', 'X射线和[O III]发射。'),
    ''
  );
  assert.equal(
    context.getTranslationOutputSemanticFailure('kbol correction is applied here', 'kbol修正应用于此处'),
    ''
  );
});
