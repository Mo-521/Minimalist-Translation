const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const mainSource = fs.readFileSync(path.join(__dirname, '../../../electron-app/main.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(__dirname, '../../../electron-app/renderer.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unable to extract ${name}`);
}

function loadIdentityContract() {
  const context = vm.createContext({});
  vm.runInContext([
    'const PDF_SEGMENT_IDENTITY_SCHEMA_VERSION = "pdf-segment-identity-v1";',
    extractFunction(mainSource, 'createSegmentIdAllocator'),
    extractFunction(mainSource, 'materializeSegmentIdentity'),
    extractFunction(mainSource, 'assertUniqueSegmentIds'),
    extractFunction(mainSource, 'assertSegmentIdentityContractOrThrow'),
    'this.api = { createSegmentIdAllocator, materializeSegmentIdentity, assertUniqueSegmentIds, assertSegmentIdentityContractOrThrow };',
  ].join('\n'), context);
  return context.api;
}

test('derived segments receive collision-free identities and aligned line identities', () => {
  const { createSegmentIdAllocator, materializeSegmentIdentity, assertUniqueSegmentIds } = loadIdentityContract();
  const parent = { id: 'seg-4', pageNumber: 2, sourceText: 'parent', lineBoxes: [{ segmentId: 'seg-4' }] };
  const allocator = createSegmentIdAllocator([parent, { id: 'seg-9' }]);
  const first = materializeSegmentIdentity({ ...parent, sourceText: 'first' }, parent.id, 'split');
  const second = materializeSegmentIdentity({ ...parent, sourceText: 'second', splitFromSegmentId: parent.id }, allocator.next(), 'split');
  const audit = assertUniqueSegmentIds([first, second]);
  assert.equal(audit.unique, true);
  assert.notEqual(first.id, second.id);
  assert.equal(second.lineBoxes[0].segmentId, second.id);
  assert.equal(second.segmentIdentity.parentSegmentId, parent.id);
});

test('identity contract rejects duplicate IDs, repeated objects, and line ownership drift', () => {
  const { materializeSegmentIdentity, assertSegmentIdentityContractOrThrow } = loadIdentityContract();
  const first = materializeSegmentIdentity({ lineBoxes: [{}] }, 'seg-1', 'test');
  const duplicate = materializeSegmentIdentity({ lineBoxes: [{}] }, 'seg-1', 'test');
  assert.throws(() => assertSegmentIdentityContractOrThrow([first, duplicate], 'test_stage'), { code: 'PDF_SEGMENT_IDENTITY_CONTRACT_FAILED' });
  assert.throws(() => assertSegmentIdentityContractOrThrow([first, first], 'test_stage'), { code: 'PDF_SEGMENT_IDENTITY_CONTRACT_FAILED' });
  const drifted = { ...first, lineBoxes: [{ segmentId: 'seg-other' }] };
  assert.throws(() => assertSegmentIdentityContractOrThrow([drifted], 'test_stage'), { code: 'PDF_SEGMENT_IDENTITY_CONTRACT_FAILED' });
});

test('post-finalization image constraint is the only identity-aware split call', () => {
  const calls = [...mainSource.matchAll(/applyImageRegionSegmentationConstraints\(([^\n]+)\)/g)].map((match) => match[0]);
  const constraintSource = extractFunction(mainSource, 'applyImageRegionSegmentationConstraints');
  assert.equal(calls.filter((call) => call.includes('enforceSegmentIdentity: true')).length, 1);
  assert.match(constraintSource, /splitParts\.forEach[\s\S]*appendSegment\([\s\S]*"oversized_image_region_split"/);
  assert.equal((constraintSource.match(/output\.push\(/g) || []).length, 2, 'only appendSegment itself may write to output');
  assert.match(mainSource, /assertSegmentIdentityContractOrThrow\(segments, "post_image_region_segmentation"\)/);
  assert.match(mainSource, /assertSegmentIdentityContractOrThrow\(allSegments, "export_all_segments_input"\)/);
  assert.match(extractFunction(rendererSource, 'normalizePdfSegments'), /segmentIdentity:\s*segment\.segmentIdentity/);
  assert.match(extractFunction(rendererSource, 'buildTranslatedPdfPayload'), /segmentIdentity:\s*segment\.segmentIdentity/);
});

test('final image-region split repairs dangling source words before identity materialization', () => {
  const fnStart = mainSource.indexOf('function applyImageRegionSegmentationConstraints(');
  const fnEnd = mainSource.indexOf('function auditPaperImageTextPreserveRisk', fnStart);
  assert.ok(fnStart >= 0 && fnEnd > fnStart);
  const block = mainSource.slice(fnStart, fnEnd);
  const repairAt = block.indexOf('applyPaperSourceTextRepairs(output, config)');
  const materializeAt = block.indexOf('sourceFinalizedOutput.map(materializeFinalIdentity)');
  assert.ok(repairAt >= 0, 'final source repair must run after geometry splitting');
  assert.ok(materializeAt > repairAt, 'identity must be materialized only after source finalization');
  assert.match(block, /materializeSegmentIdentity\(segment, segmentId/);
});
