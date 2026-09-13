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

test('one rejected segment preserves its original while unrelated segments stay writable', () => {
  const context = vm.createContext({ String, Boolean, Array, Set, Map });
  vm.runInContext(extractFunction(mainSource, 'getPaperOperationOwnerIds'), context);
  vm.runInContext(extractFunction(mainSource, 'isolatePaperMaskWriteOperations'), context);
  const failed = { id: 'failed', layoutPlanValidationStatus: 'failed', maskApplied: true, writeApplied: true };
  const healthy = { id: 'healthy', layoutPlanValidationStatus: 'pass', maskApplied: false, writeApplied: false };
  const reports = new Map([['failed', failed], ['healthy', healthy]]);
  const masks = [{ meta: { segmentId: 'failed' } }, { meta: { segmentId: 'healthy' } }];
  const writes = [{ meta: { segmentId: 'failed' } }, { meta: { segmentId: 'healthy' } }];
  const result = context.isolatePaperMaskWriteOperations(masks, writes, reports, { violations: [] });
  assert.equal(result.authorizedMaskOps.length, 1);
  assert.equal(result.authorizedWriteOps.length, 1);
  assert.equal(result.authorizedWriteOps[0].meta.segmentId, 'healthy');
  assert.equal(failed.maskApplied, false);
  assert.equal(failed.writeApplied, false);
  assert.equal(failed.visualResidualRisk, false);
  assert.equal(writes[0].writeIsolationState, 'isolated_preserve_original');
  assert.equal(writes[1].writeIsolationState, 'authorized');
});

test('layout validation failures are isolated before mask and write execution', () => {
  const gateStart = mainSource.indexOf('_paperWriteIsolationPlan = isolatePaperMaskWriteOperations');
  const gateEnd = mainSource.indexOf('_captionGroupLifecycleAudits = finalizeCaptionGroupLifecycleAudits', gateStart);
  assert.notEqual(gateStart, -1);
  assert.notEqual(gateEnd, -1);
  const gate = mainSource.slice(gateStart, gateEnd);

  assert.match(gate, /isolatePaperMaskWriteOperations\([\s\S]*executePaperMasks\(\);\s*executePaperWrites\(\);/);
  assert.match(mainSource, /if \(op\.writeIsolationState === 'isolated_preserve_original'\) return/);
  assert.doesNotMatch(gate, /_layoutPlanExecutionBlocked\s*=\s*true/);
});

test('local write failure cannot rename or downgrade the generated user PDF', () => {
  assert.doesNotMatch(mainSource, /outputFilePath\s*=\s*outputFilePath\.replace\([^\n]*debugFail/);
  assert.doesNotMatch(mainSource, /fs\.renameSync\(outputFilePath/);
  assert.match(mainSource, /exportSummary\.exportGenerated = exportGenerated/);
  assert.match(mainSource, /ok: exportGenerated/);
});

test('fallback sidecar is developer diagnostics only', () => {
  const fallbackStart = mainSource.indexOf('// ── Guaranteed fallback sidecar');
  const fallbackEnd = mainSource.indexOf('// ── end fallback sidecar', fallbackStart);
  assert.notEqual(fallbackStart, -1);
  assert.notEqual(fallbackEnd, -1);
  const fallback = mainSource.slice(fallbackStart, fallbackEnd);
  assert.match(fallback, /if \(developerDiagnosticsRequested && isPaperExport && exportedPdfSize > 0\)/);
  assert.match(fallback, /const fallbackDiagnosticPlatform = diagnosticRuntime\.snapshot\(\)/);
  assert.match(fallback, /diagnosticRunId: diagnosticRuntime\.context\.runId/);
  assert.match(fallback, /extra: \{ diagnosticPlatform: fallbackDiagnosticPlatform \}/);
  assert.match(mainSource, /function writePdfDebugSidecarsFallback\([^)]*extra[^)]*\)/);
});

test('export completeness accepts a covered caption member from per-member canonical evidence', () => {
  const context = vm.createContext({ String, Boolean, Set });
  vm.runInContext(extractFunction(mainSource, 'isCaptionGroupOwnerAwareCoveredForCompleteness'), context);
  const report = {
    id: 'member-generic',
    skipReason: 'caption_group_member_covered_by_canonical',
    captionGroupCompletenessCovered: true,
    captionGroupMemberSuppressedFromBodyWrite: true,
    captionGroupCanonicalOwnerId: 'canonical-generic',
    captionGroupCoverageRecognizedByFinalResidualCheck: true,
  };
  const evidence = {
    finalSuppressedIds: new Set(['member-generic']),
    coverageMissingIds: new Set(),
    finalResidualRiskIds: new Set(),
  };

  assert.equal(context.isCaptionGroupOwnerAwareCoveredForCompleteness(report, evidence), true);
  assert.equal(context.isCaptionGroupOwnerAwareCoveredForCompleteness(
    report,
    { ...evidence, coverageMissingIds: new Set(['member-generic']) }
  ), false, 'missing per-member coverage evidence must still fail closed');
  assert.equal(context.isCaptionGroupOwnerAwareCoveredForCompleteness(
    report,
    { ...evidence, finalResidualRiskIds: new Set(['member-generic']) }
  ), false, 'a real per-member residual risk must still fail closed');
});

test('caption-wide visual audit status is not used to invalidate proven member coverage', () => {
  const summaryStart = mainSource.indexOf('const _captionFinalSuppressedIds');
  const summaryEnd = mainSource.indexOf('const exportSummary = {', summaryStart);
  assert.ok(summaryStart >= 0 && summaryEnd > summaryStart);
  const ownerAwareBlock = mainSource.slice(summaryStart, summaryEnd);
  assert.match(ownerAwareBlock, /isCaptionGroupOwnerAwareCoveredForCompleteness\(report, _captionCoverageEvidence\)/);
  assert.doesNotMatch(ownerAwareBlock, /captionVisualReplacementAuditStatus|_captionCoverageAuditOk/);
});
