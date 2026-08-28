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

function makeContext() {
  const context = vm.createContext({
    Array, Boolean, Math, Number, Set, String,
    PAPER_VISUAL_GROUP_MIN_HEIGHT_PER_MEMBER: 29,
    PDF_EXPORT_PRESERVE_TYPES: new Set(),
  });
  vm.runInContext([
    extractFunction(mainSource, 'getPaperParagraphRunCompressionHardFailReasons'),
    extractFunction(mainSource, 'buildPaperGroupCompressionAudit'),
  ].join('\n'), context);
  return context;
}

function makeGroup(overrides = {}) {
  return {
    id: 'representative-generic',
    finalWriteRepresentativeId: 'representative-generic',
    finalWriteGroupSegmentIds: ['member-a', 'member-b', 'member-c', 'member-d'],
    pageNumber: 1,
    type: 'body',
    status: 'done',
    writeApplied: true,
    actualWriteApplied: true,
    completeWriteApplied: true,
    finalWriteBox: { x: 10, y: 20, width: 200, height: 100 },
    renderedTextBbox: { x: 10, y: 20, width: 200, height: 95 },
    naturalTextHeight: 95,
    ...overrides,
  };
}

test('a complete Paragraph Run is not judged by legacy visual-group capacity', () => {
  const context = makeContext();
  const report = makeGroup({
    paragraphRunWriteApplied: true,
    paragraphRunId: 'paragraph-run-generic',
    visualParagraphGroupId: 'paragraph-run-generic',
    paragraphLayoutCommitStatus: 'committed',
    paperWriteFitStatus: 'fit',
  });
  const result = context.buildPaperGroupCompressionAudit([report]);
  assert.equal(result.paperVisualGroupCompressionHardFailCount, 0);
  assert.equal(result.paperVisualGroupCompressionParagraphRunHardFailCount, 0);
  assert.equal(result.paperVisualGroupCompressionParagraphRunLegacyCapacitySuppressedCount, 1);
});

test('Paragraph Run remains fail-closed for real fit commit render failures', () => {
  const context = makeContext();
  const base = {
    paragraphRunWriteApplied: true,
    paragraphRunId: 'paragraph-run-generic',
    visualParagraphGroupId: 'paragraph-run-generic',
    paragraphLayoutCommitStatus: 'committed',
    paperWriteFitStatus: 'fit',
  };
  for (const evidence of [
    { translatedTextTruncated: true },
    { writeIncomplete: true },
    { renderedTextHeightOverflow: true },
    { fontSizeBelowReadable: true },
    { actualLineBoxOverlap: true },
    { paragraphCollisionRisk: true },
    { paragraphLayoutCommitStatus: 'rejected' },
    { actualWriteApplied: false },
  ]) {
    const result = context.buildPaperGroupCompressionAudit([makeGroup({ ...base, ...evidence })]);
    assert.equal(result.paperVisualGroupCompressionHardFailCount, 1, JSON.stringify(evidence));
    assert.equal(result.paperVisualGroupCompressionParagraphRunHardFailCount, 1, JSON.stringify(evidence));
    assert.equal(result.paperVisualGroupCompressionDetails[0].reason, 'paragraph_run_execution_hard_fail');
  }
});

test('ordinary Visual Groups retain both existing compression hard-fail rules', () => {
  const context = makeContext();
  const dense = context.buildPaperGroupCompressionAudit([makeGroup({
    finalWriteGroupSegmentIds: ['member-a', 'member-b'],
    naturalTextHeight: 95,
  })]);
  assert.equal(dense.paperVisualGroupCompressionHardFailCount, 1);
  assert.equal(dense.paperVisualGroupCompressionOrdinaryGroupHardFailCount, 1);
  assert.equal(dense.paperVisualGroupCompressionDetails[0].reason, 'group_write_rendered_text_too_dense');

  const memberCapacity = context.buildPaperGroupCompressionAudit([makeGroup({
    naturalTextHeight: 80,
    renderedTextBbox: { x: 10, y: 20, width: 200, height: 80 },
  })]);
  assert.equal(memberCapacity.paperVisualGroupCompressionHardFailCount, 1);
  assert.equal(memberCapacity.paperVisualGroupCompressionDetails[0].reason, 'group_write_too_many_members_for_height');
});

test('Paper Visual Audit exposes Paragraph Run and ordinary-group compression separately', () => {
  const start = mainSource.indexOf('function buildPaperVisualAuditReport(');
  const end = mainSource.indexOf('function getPaperParagraphRunCompressionHardFailReasons(', start);
  assert.ok(start >= 0 && end > start);
  const auditSource = mainSource.slice(start, end);
  assert.match(auditSource, /paragraphRunHardFailCount/);
  assert.match(auditSource, /ordinaryGroupHardFailCount/);
});
