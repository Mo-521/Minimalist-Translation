const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../../electron-app/main.js'), 'utf8');
const start = source.indexOf('function getPaperTranslationReadinessBeforeExport(');
const end = source.indexOf('function getCaptionGroupMemberCoverageStatus(', start);

function readiness(reports) {
  const context = vm.createContext({
    PAPER_WRITE_ONLY_SKIP_REASONS: new Set(['caption_region_overflow']),
    hasPdfExportReportDisposition: (report, expected) => report.semanticTranslationDisposition === expected,
  });
  vm.runInContext(source.slice(start, end), context);
  return context.getPaperTranslationReadinessBeforeExport(reports);
}

test('translation readiness counts every frozen canonical translate segment, including covered duplicates', () => {
  const result = readiness([
    { id: 'a', semanticTranslationDisposition: 'translate', status: 'done', hasTranslatedText: true, skipReason: '' },
    { id: 'b', semanticTranslationDisposition: 'translate', status: 'done', hasTranslatedText: true, skipReason: 'cross_page_duplicate_fragment' },
    { id: 'c', semanticTranslationDisposition: 'preserve', status: 'preserved', hasTranslatedText: false, skipReason: 'reference_preserve_original' },
  ]);
  assert.equal(result.ready, true);
  assert.equal(result.translatableSegments, 2);
  assert.equal(result.translatedSegments, 2);
});

test('a pending canonical duplicate remains incomplete instead of disappearing from the denominator', () => {
  const result = readiness([
    { id: 'a', semanticTranslationDisposition: 'translate', status: 'done', hasTranslatedText: true, skipReason: '' },
    { id: 'b', semanticTranslationDisposition: 'translate', status: 'pending', hasTranslatedText: false, skipReason: 'cross_page_duplicate_fragment' },
  ]);
  assert.equal(result.ready, false);
  assert.equal(result.translatableSegments, 2);
  assert.equal(result.translatedSegments, 1);
  assert.deepEqual(Array.from(result.incompleteTranslatableSegmentIds), ['b']);
});

test('final export summary keeps covered duplicate fragments in canonical counts', () => {
  const summaryStart = source.indexOf('// The denominator is the complete frozen canonical translate set.');
  const summaryEnd = source.indexOf('const isSimpleExport =', summaryStart);
  const summary = source.slice(summaryStart, summaryEnd);
  assert.match(summary, /const translatableReports = segmentReports\.filter\(\(report\) => report\.semanticTranslationDisposition === 'translate'\)/);
  assert.match(summary, /isCoveredCrossPageDuplicate/);
  assert.match(summary, /const translatedReports = translatableReports\.filter\(\(report\) => report\.status === "done" && report\.hasTranslatedText\)/);
  assert.doesNotMatch(summary, /translatableReports = segmentReports\.filter[^;]+cross_page_duplicate_fragment/);
});
