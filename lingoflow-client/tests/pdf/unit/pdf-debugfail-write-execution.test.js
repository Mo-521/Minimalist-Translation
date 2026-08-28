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

test('layout validation failure writes the planned diagnostic PDF instead of copying the source unchanged', () => {
  const gateStart = mainSource.indexOf('_layoutPlanExecutionBlocked = isPaperExport');
  const gateEnd = mainSource.indexOf('_captionGroupLifecycleAudits = finalizeCaptionGroupLifecycleAudits', gateStart);
  assert.notEqual(gateStart, -1);
  assert.notEqual(gateEnd, -1);
  const gate = mainSource.slice(gateStart, gateEnd);

  assert.match(gate, /if \(!_layoutPlanExecutionBlocked\)\s*\{\s*executePaperMasks\(\);\s*executePaperWrites\(\);/s);
  assert.match(gate, /else if \(_layoutPlanExecutionBlocked\)\s*\{[\s\S]*executePaperMasks\(\);\s*executePaperWrites\(\);/);
  assert.doesNotMatch(gate, /else if \(debugFailExportRequested && paperTranslationReadiness && !paperTranslationReadiness\.ready\)/);
  assert.match(gate, /complete_translation_layout_validation_failed/);
});

test('failed layout still cannot be emitted as a normal translated PDF', () => {
  assert.match(mainSource, /if \(isPaperExport && _layoutPlanValidationStats\.layoutPlanValidationStatus === 'failed'\)\s*\{\s*_paperLayoutDebugFail = true;\s*outputFilePath = outputFilePath\.replace\(\/\\\.pdf\$\/i, '_debugFail\.pdf'\);/s);
  assert.match(mainSource, /const layoutPlanHardFail = Boolean\(isPaperExport && _paperLayoutDebugFail\)/);
});

test('guaranteed fallback sidecar carries the diagnostic run and current snapshot', () => {
  const fallbackStart = mainSource.indexOf('// ── Guaranteed fallback sidecar');
  const fallbackEnd = mainSource.indexOf('// ── end fallback sidecar', fallbackStart);
  assert.notEqual(fallbackStart, -1);
  assert.notEqual(fallbackEnd, -1);
  const fallback = mainSource.slice(fallbackStart, fallbackEnd);
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
