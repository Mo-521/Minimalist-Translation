const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../../electron-app/renderer.js'), 'utf8');
const start = source.indexOf('function resolvePaperTranslationCompletion(');
const end = source.indexOf('\n}', start) + 2;
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);
test('completed requests with failed translations are incomplete, not successful', () => {
  const result = context.resolvePaperTranslationCompletion({ totalSegments: 100, doneSegments: 98, failedSegments: 2, pendingSegments: 0 }, false);
  assert.equal(result.stateName, 'incomplete');
  assert.equal(result.progress.percent, 98);
});
test('pending work and cancellation cannot be reported as translated', () => {
  assert.equal(context.resolvePaperTranslationCompletion({ totalSegments: 2, doneSegments: 1, pendingSegments: 1 }, false).stateName, 'incomplete');
  assert.equal(context.resolvePaperTranslationCompletion({ totalSegments: 2, doneSegments: 2 }, true).stateName, 'canceled');
});
test('all eligible translations complete gives 100 percent without preserved objects in denominator', () => {
  const result = context.resolvePaperTranslationCompletion({ totalSegments: 10, doneSegments: 10, pendingSegments: 0, failedSegments: 0 }, false);
  assert.equal(result.stateName, 'translated');
  assert.equal(result.progress.percent, 100);
});
test('identity invalid output is marked failed before handled error; terminal path consumes strict completeness', () => {
  const loop = source.slice(source.indexOf('async function startPaperPdfSegmentTranslation('), source.indexOf('function setupPdfLanguageControls('));
  assert.match(loop, /if \(identityInvalidReason\)\s*\{\s*markInvalidTranslationSegment\(segment, identityInvalidReason, identityTranslated\);/);
  assert.match(loop, /resolvePaperTranslationCompletion\(getPaperExportCompletenessStrict\(\), state.pdfTranslateCancelRequested\)/);
});

test('failed and canceled paper runs expose diagnostic export outside the success panel', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../../electron-app/index.html'), 'utf8');
  const stage = html.slice(html.indexOf('id="pdfTranslationStage"'), html.indexOf('id="pdfCompleteStage"'));
  assert.match(stage, /id="btnExportPdfIncomplete"/);
  assert.equal((html.match(/id="btnExportPdfIncomplete"/g) || []).length, 1);
  const start = source.indexOf('var incompleteExportBtn =', source.indexOf('function setPdfWorkflowState('));
  const end = source.indexOf('var workView', start);
  const code = source.slice(start, end);
  for (const [mode, status, running, count, hidden, disabled] of [
    ['paper_pdf', 'incomplete', false, 320, false, false],
    ['paper_pdf', 'canceled', false, 320, false, false],
    ['paper_pdf', 'translating', true, 320, false, false],
    ['paper_pdf', 'translated', false, 320, true, false],
    ['simple_pdf', 'incomplete', false, 320, false, false],
    ['paper_pdf', 'incomplete', false, 0, true, true],
  ]) {
    const button = {};
    vm.runInNewContext(code, { document: { getElementById: () => button },
      state: { pdfTranslationMode: mode, pdfTranslating: running, segments: new Array(count) }, stateName: status });
    assert.equal(button.hidden, hidden);
    assert.equal(button.disabled, disabled);
  }
  assert.match(source, /incompleteExportBtn\.addEventListener\("click", openPdfExportModal\)/);
});
