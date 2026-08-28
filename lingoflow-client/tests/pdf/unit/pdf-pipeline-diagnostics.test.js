const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DIAGNOSTIC_SCHEMA_VERSION,
  createPdfDiagnosticRuntime,
  findingsFromAudit,
} = require('../../../electron-app/pdf-pipeline-diagnostics');

function runtime() {
  return createPdfDiagnosticRuntime({ fileName: 'generic.pdf', mode: 'paper_pdf', config: { mode: 'paper_pdf' } });
}

test('one run owns one immutable context and one record per artifact identity', () => {
  const diagnostics = runtime();
  assert.equal(diagnostics.context.schemaVersion, DIAGNOSTIC_SCHEMA_VERSION);
  assert.ok(diagnostics.context.runId);
  assert.ok(Object.isFrozen(diagnostics.context));

  const first = diagnostics.registerArtifact({ artifactType: 'segment', artifactId: 'seg-a', producerStage: 'segmentation', value: { pageNumber: 1 } });
  const repeated = diagnostics.registerArtifact({ artifactType: 'segment', artifactId: 'seg-a', producerStage: 'segmentation', value: { pageNumber: 1 } });
  assert.equal(first, repeated);
  assert.equal(diagnostics.snapshot().artifacts.length, 1);
});

test('artifact identity conflict fails before silent Map replacement', () => {
  const diagnostics = runtime();
  diagnostics.registerArtifact({ artifactType: 'segment', artifactId: 'seg-a', producerStage: 'segmentation', value: { pageNumber: 1 } });
  assert.throws(() => diagnostics.registerArtifact({ artifactType: 'segment', artifactId: 'seg-a', producerStage: 'segmentation', value: { pageNumber: 2 } }), {
    code: 'PDF_DIAGNOSTIC_ARTIFACT_CONFLICT',
  });
  const snapshot = diagnostics.snapshot();
  assert.equal(snapshot.artifacts.length, 1);
  assert.equal(snapshot.findings[0].ruleId, 'artifact_identity_conflict');
});

test('pipeline observer mode records a conflict without changing business control flow', () => {
  const diagnostics = runtime();
  diagnostics.registerArtifact({ artifactType: 'segment', artifactId: 'seg-a', producerStage: 'segmentation', value: { pageNumber: 1 } }, { required: false });
  const retained = diagnostics.registerArtifact({ artifactType: 'segment', artifactId: 'seg-a', producerStage: 'segmentation', value: { pageNumber: 2 } }, { required: false });
  assert.equal(retained.pageIdentity, null);
  const snapshot = diagnostics.snapshot();
  assert.equal(snapshot.artifacts.length, 1);
  assert.equal(snapshot.findings[0].ruleId, 'artifact_identity_conflict');
  assert.equal(snapshot.summary.status, 'failed');
});

test('pipeline integration can register a large artifact by compact identity without traversing its value', () => {
  const diagnostics = runtime();
  const value = {};
  Object.defineProperty(value, 'expensive', { enumerable: true, get() { throw new Error('large business value was traversed'); } });
  assert.doesNotThrow(() => diagnostics.registerArtifact({
    artifactType: 'layout-item', artifactId: 'layout-a', producerStage: 'layout', pageIdentity: 1, value,
  }, { required: false, hashValue: false }));
  assert.equal(diagnostics.snapshot().artifacts.length, 1);
});

test('validator adapter emits normalized findings without changing business result', () => {
  const diagnostics = runtime();
  diagnostics.registerPlugin({
    id: 'existing-validator', stage: 'segmentation', sourceFunction: 'existingValidator',
    evaluate: (_context, input) => {
      const result = { violationCount: 1, violations: [{ code: 'existing_rule_failed', actual: input.value }] };
      return { result, findings: findingsFromAudit(result, { sourceFunction: 'existingValidator' }) };
    },
  });
  const input = { value: 7 };
  const result = diagnostics.runPlugin('existing-validator', input);
  assert.equal(result.violationCount, 1);
  assert.deepEqual(input, { value: 7 });
  const finding = diagnostics.snapshot().findings[0];
  assert.equal(finding.ruleId, 'existing_rule_failed');
  assert.equal(finding.stage, 'segmentation');
  assert.equal(finding.sourceFunction, 'existingValidator');
  assert.ok(finding.findingId);
  assert.ok(finding.evidenceHash);
});

test('diagnostic plugin mutation is rejected', () => {
  const diagnostics = runtime();
  diagnostics.registerPlugin({
    id: 'mutating-validator', stage: 'segmentation',
    evaluate: (_context, input) => { input.changed = true; return { result: {}, findings: [] }; },
  });
  assert.throws(() => diagnostics.runPlugin('mutating-validator', {}), { code: 'PDF_DIAGNOSTIC_PLUGIN_MUTATION' });
});

test('plugin execution cannot move backward through pipeline stages', () => {
  const diagnostics = runtime();
  diagnostics.registerPlugin({ id: 'display-validator', stage: 'display', evaluate: () => ({ result: {}, findings: [] }) });
  diagnostics.registerPlugin({ id: 'early-validator', stage: 'segmentation', evaluate: () => ({ result: {}, findings: [] }) });
  diagnostics.runPlugin('display-validator', {});
  assert.throws(() => diagnostics.runPlugin('early-validator', {}), { code: 'PDF_DIAGNOSTIC_STAGE_ORDER_INVALID' });
});

test('optional reporter failure is visible but does not replace business output', () => {
  const diagnostics = runtime();
  diagnostics.registerPlugin({
    id: 'optional-reporter', stage: 'export_audit', mode: 'reporter', required: false,
    evaluate: () => { throw new Error('disk unavailable'); },
  });
  assert.equal(diagnostics.runPlugin('optional-reporter', { businessResult: 'kept' }), null);
  const snapshot = diagnostics.snapshot();
  assert.equal(snapshot.executions[0].status, 'failed');
  assert.equal(snapshot.findings[0].disposition, 'reporter_failed');
});
