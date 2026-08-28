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

function loadBuilder() {
  const context = vm.createContext({ Map, Set });
  vm.runInContext(extractFunction(mainSource, 'buildPaperParagraphLayoutCommits'), context);
  return context.buildPaperParagraphLayoutCommits;
}

function fixture() {
  const commitId = 'paragraph-layout-commit:run-1';
  const common = { paragraphLayoutCommitId: commitId, paragraphRunId: 'run-1', pageNumber: 2 };
  return {
    masks: [
      { meta: { ...common, maskKind: 'sourceCover', segmentId: 'seg-a' } },
      { meta: { ...common, maskKind: 'writeBackground', segmentId: 'seg-a' } },
    ],
    writes: [{ meta: { ...common, logicalSourceOrderIds: ['seg-a', 'seg-b'] } }],
    layouts: [{ segmentId: 'seg-a', segmentIds: ['seg-a', 'seg-b'], paragraphRunId: 'run-1', pageNumber: 2, writeDecision: 'write' }],
    reports: new Map([
      ['seg-a', { layoutPlanValidationStatus: 'pass', writeIncomplete: false }],
      ['seg-b', { layoutPlanValidationStatus: 'pass', writeIncomplete: false }],
    ]),
  };
}

test('complete legal paragraph layout commits masks and translation write together', () => {
  const build = loadBuilder();
  const f = fixture();
  const result = build(f.masks, f.writes, f.layouts, f.reports);
  assert.equal(result.stats.paragraphLayoutCommitCommittedCount, 1);
  assert.equal(result.stats.paragraphLayoutCommitRejectedCount, 0);
  assert.equal(result.stats.paragraphLayoutCommitAtomicMaskCount, 2);
  assert.equal(result.stats.paragraphLayoutCommitAtomicWriteCount, 1);
  assert.ok([...f.masks, ...f.writes].every((op) => op.paragraphLayoutCommitState === 'committed'));
});

test('incomplete paragraph layout rejects both source cover and translated write', () => {
  const build = loadBuilder();
  const f = fixture();
  f.reports.get('seg-b').writeIncomplete = true;
  const result = build(f.masks, f.writes, f.layouts, f.reports);
  assert.equal(result.stats.paragraphLayoutCommitCommittedCount, 0);
  assert.equal(result.stats.paragraphLayoutCommitRejectedCount, 1);
  assert.ok(result.commits[0].violations.includes('member_layout_incomplete:seg-b'));
  assert.ok([...f.masks, ...f.writes].every((op) => op.paragraphLayoutCommitState === 'rejected'));
});

test('paragraph execution gates consume only committed operations without touching caption authority', () => {
  assert.match(mainSource, /if \(op\.paragraphLayoutCommitId && op\.paragraphLayoutCommitState !== 'committed'\) return;/);
  assert.match(mainSource, /paragraphLayoutCommitId: _paragraphLayoutCommitId/);
  assert.doesNotMatch(extractFunction(mainSource, 'buildPaperParagraphLayoutCommits'), /captionGroup|translationInput|translationOutput|imageGeometry/);
});
