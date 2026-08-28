const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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

function makeFixture(overrides = {}) {
  const text = overrides.text === undefined ? '权威显示文本' : overrides.text;
  const textHash = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  const item = {
    segmentId: 'caption-canonical',
    segmentIds: ['caption-canonical', 'caption-covered'],
    pageNumber: 3,
    writeDecision: 'write',
    captionGroupId: 'caption-group-1',
    captionGroupAuditRole: 'canonical',
    captionGroupLayoutPlanText: text,
    captionLayoutItemId: 'caption-layout:caption-group-1:caption-canonical',
    captionDisplayId: 'caption-display:caption-group-1:hash',
    captionDisplayHash: 'display-artifact-hash',
    captionLayoutTextHash: textHash,
    ...overrides.item,
  };
  const candidate = {
    opType: 'write',
    opId: 'write_9',
    source: 'prelayout_write_candidate',
    authorityState: 'candidate_pending_layout_validation',
    meta: {
      captionGroupId: 'caption-group-1',
      segmentId: 'caption-canonical',
      pageNumber: 3,
      captionGroupAuditText: text,
      ...overrides.meta,
    },
  };
  const reports = new Map([['caption-canonical', { layoutPlanValidationStatus: 'pass' }]]);
  return { text, item, candidate, reports };
}

function makeContext() {
  const context = vm.createContext({ crypto, Map, Set, String, Number, Boolean, Array });
  vm.runInContext(extractFunction(mainSource, 'bindCaptionWriteCandidatesToLayout'), context);
  return context;
}

test('validated canonical layout item authorizes one write op with complete references', () => {
  const fixture = makeFixture();
  const result = makeContext().bindCaptionWriteCandidatesToLayout([fixture.candidate], [fixture.item], fixture.reports);
  assert.equal(result.violationCount, 0);
  assert.equal(result.authorizedCaptionWriteCount, 1);
  assert.equal(fixture.candidate.authorityState, 'authorized_write_op');
  assert.equal(fixture.candidate.source, 'validated_layout_item');
  assert.equal(fixture.candidate.meta.captionLayoutItemId, fixture.item.captionLayoutItemId);
  assert.equal(fixture.candidate.meta.captionDisplayId, fixture.item.captionDisplayId);
  assert.equal(fixture.candidate.meta.captionWriteOpId, fixture.candidate.opId);
  assert.equal(fixture.candidate.meta.captionWriteTextHash, fixture.item.captionLayoutTextHash);
});

test('multiple layout items do not let a covered member replace canonical authority', () => {
  const fixture = makeFixture();
  const covered = {
    ...fixture.item,
    segmentId: 'caption-covered',
    segmentIds: ['caption-covered'],
    writeDecision: 'covered_by_caption_group',
    captionGroupAuditRole: 'covered_member',
    captionLayoutItemId: 'caption-layout:caption-group-1:caption-covered',
  };
  const result = makeContext().bindCaptionWriteCandidatesToLayout([fixture.candidate], [covered, fixture.item], fixture.reports);
  assert.equal(result.violationCount, 0);
  assert.equal(fixture.candidate.meta.captionLayoutItemId, fixture.item.captionLayoutItemId);
});

test('missing layout, text mismatch, page drift and unvalidated layout remain unauthorized', () => {
  const context = makeContext();
  const missing = makeFixture();
  let result = context.bindCaptionWriteCandidatesToLayout([missing.candidate], [], missing.reports);
  assert.match(result.violations.map((entry) => entry.code).join(','), /caption_write_missing_layout_item/);
  assert.equal(missing.candidate.authorityState, 'candidate_pending_layout_validation');

  const mismatch = makeFixture({ meta: { captionGroupAuditText: 'different text', pageNumber: 4 } });
  mismatch.reports.set('caption-canonical', { layoutPlanValidationStatus: 'failed' });
  result = context.bindCaptionWriteCandidatesToLayout([mismatch.candidate], [mismatch.item], mismatch.reports);
  const codes = result.violations.map((entry) => entry.code).join(',');
  assert.match(codes, /caption_layout_write_text_mismatch/);
  assert.match(codes, /caption_write_page_drift/);
  assert.match(codes, /caption_write_references_unvalidated_layout_item/);
  assert.equal(mismatch.candidate.authorityState, 'candidate_pending_layout_validation');
});

test('production sequence validates layout before binding and render requires authorized write reference', () => {
  const validationIndex = mainSource.indexOf('validateLayoutPlanBeforeExecution(_layoutPlan.items');
  const bindingIndex = mainSource.indexOf('bindCaptionWriteCandidatesToLayout(_paperWriteOps');
  const executionIndex = mainSource.indexOf('executePaperWrites();', bindingIndex);
  assert.ok(validationIndex > 0 && bindingIndex > validationIndex && executionIndex > bindingIndex);
  assert.match(mainSource, /captionWriteAuthorityStatus !== 'authorized_from_validated_layout_item'/);
  assert.match(mainSource, /captionLayoutItemId: _captionLayoutItemId/);
  assert.match(mainSource, /source: 'prelayout_write_candidate'/);
  assert.doesNotMatch(extractFunction(mainSource, 'bindCaptionWriteCandidatesToLayout'), /font|bbox|margin|lineHeight|drawFittedPdfText|mask|overflow/);
});
