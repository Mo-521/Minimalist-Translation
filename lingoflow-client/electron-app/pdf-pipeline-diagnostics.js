const crypto = require('crypto');
const fs = require('fs');

const DIAGNOSTIC_SCHEMA_VERSION = 'pdf-pipeline-diagnostics-v1';
const STAGE_ORDER = Object.freeze({
  extraction: 10,
  segmentation: 20,
  translation_boundary: 30,
  display: 40,
  layout: 50,
  write_planning: 60,
  render: 70,
  export_audit: 80,
});

function stableValue(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
    return value;
  }
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => stableValue(item, seen));
  if (value instanceof Map) {
    return Array.from(value.entries())
      .map(([key, item]) => [String(key), stableValue(item, seen)])
      .sort(([left], [right]) => left.localeCompare(right));
  }
  if (value instanceof Set) return Array.from(value).map((item) => stableValue(item, seen)).sort();
  return Object.keys(value).sort().reduce((result, key) => {
    const item = value[key];
    if (typeof item !== 'function' && item !== undefined) result[key] = stableValue(item, seen);
    return result;
  }, {});
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value || ''), Buffer.isBuffer(value) ? undefined : 'utf8').digest('hex');
}

function sourceDocumentHash(sourcePath, fallbackIdentity) {
  try {
    if (sourcePath && fs.existsSync(sourcePath)) return sha256(fs.readFileSync(sourcePath));
  } catch (_) {}
  return sha256(fallbackIdentity || 'unknown-pdf-document');
}

function normalizeFinding(runId, stage, plugin, rawFinding, order) {
  const raw = rawFinding || {};
  const ruleId = String(raw.ruleId || raw.code || plugin.id);
  const evidence = raw.evidence !== undefined ? raw.evidence : raw.details;
  const core = {
    runId,
    ruleId,
    ruleVersion: String(raw.ruleVersion || plugin.version || '1'),
    stage,
    severity: ['error', 'warning', 'info'].includes(raw.severity) ? raw.severity : 'error',
    disposition: String(raw.disposition || (raw.severity === 'warning' || raw.severity === 'info' ? 'recorded' : 'blocked')),
    artifactRefs: Array.isArray(raw.artifactRefs) ? raw.artifactRefs.map(String) : [],
    pageIdentity: raw.pageIdentity === undefined ? null : raw.pageIdentity,
    segmentIdentity: raw.segmentIdentity === undefined ? null : raw.segmentIdentity,
    groupIdentity: raw.groupIdentity === undefined ? null : raw.groupIdentity,
    expected: raw.expected === undefined ? null : raw.expected,
    actual: raw.actual === undefined ? null : raw.actual,
    evidencePreview: evidence === undefined ? '' : stableStringify(evidence).slice(0, 200),
    evidenceHash: evidence === undefined ? '' : sha256(stableStringify(evidence)),
    firstObservedOrder: order,
    sourceFunction: String(raw.sourceFunction || plugin.sourceFunction || plugin.id),
    message: String(raw.message || raw.reason || raw.code || ruleId),
    causeCategory: String(raw.causeCategory || 'validator'),
  };
  return { ...core, findingId: sha256(stableStringify({ runId, ruleId, stage, artifactRefs: core.artifactRefs, pageIdentity: core.pageIdentity, segmentIdentity: core.segmentIdentity, groupIdentity: core.groupIdentity, evidenceHash: core.evidenceHash })).slice(0, 24) };
}

function findingsFromAudit(result, options = {}) {
  const violations = Array.isArray(result && result.violations) ? result.violations : [];
  if (violations.length) {
    return violations.map((violation) => ({
      ...violation,
      ruleId: String(violation.code || options.ruleId || 'validator_violation'),
      severity: options.severity || 'error',
      disposition: options.disposition || 'blocked',
      sourceFunction: options.sourceFunction,
      evidence: violation,
    }));
  }
  const reasons = Array.isArray(result && result.exportCompletenessFailureReasons)
    ? result.exportCompletenessFailureReasons : [];
  return reasons.map((reason) => ({
    ruleId: String(reason),
    severity: options.severity || 'error',
    disposition: options.disposition || 'blocked',
    sourceFunction: options.sourceFunction,
    evidence: { reason },
    message: String(reason),
  }));
}

function createPdfDiagnosticRuntime(options = {}) {
  const startedAt = new Date().toISOString();
  const documentHash = sourceDocumentHash(options.sourcePath, stableStringify({ fileName: options.fileName, mode: options.mode }));
  const runId = crypto.randomUUID();
  const context = Object.freeze({
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    runId,
    documentId: `pdf:${documentHash}`,
    documentHash,
    pipelineMode: String(options.mode || 'unknown'),
    targetLanguage: String(options.targetLanguage || ''),
    configHash: sha256(stableStringify(options.config || {})),
    codeVersion: String(options.codeVersion || '1.0.0'),
    startedAt,
  });
  const plugins = new Map();
  const artifacts = new Map();
  const findings = [];
  const executions = [];
  let sequence = 0;
  let highestStageOrder = 0;

  function addFinding(stage, plugin, finding) {
    const normalized = normalizeFinding(runId, stage, plugin, finding, ++sequence);
    findings.push(normalized);
    return normalized;
  }

  function registerPlugin(plugin) {
    if (!plugin || !plugin.id || typeof plugin.evaluate !== 'function') throw new Error('Diagnostic plugin requires id and evaluate().');
    if (!STAGE_ORDER[plugin.stage]) throw new Error(`Unknown diagnostic stage: ${plugin.stage}`);
    if (plugins.has(plugin.id)) throw new Error(`Duplicate diagnostic plugin id: ${plugin.id}`);
    const normalized = Object.freeze({
      version: '1', mode: 'validator', required: true, deterministic: true, verifyNoMutation: true, ...plugin,
    });
    plugins.set(normalized.id, normalized);
    return normalized;
  }

  function registerArtifact(artifact, registrationOptions = {}) {
    const type = String(artifact && artifact.artifactType || '');
    const id = String(artifact && artifact.artifactId || '');
    if (!type || !id) {
      const finding = addFinding(String(artifact && artifact.producerStage || 'extraction'), { id: 'artifact-registry', version: '1', sourceFunction: 'registerArtifact' }, {
        ruleId: 'artifact_identity_missing', severity: 'error', disposition: 'blocked', evidence: { type, id }, message: 'Artifact type and id are required.',
      });
      if (registrationOptions.required !== false) throw Object.assign(new Error(finding.message), { code: 'PDF_DIAGNOSTIC_ARTIFACT_INVALID', finding });
      return null;
    }
    const key = `${type}:${id}`;
    const compactIdentity = {
      artifactType: type,
      artifactId: id,
      artifactVersion: String(artifact.artifactVersion || '1'),
      producerStage: String(artifact.producerStage || 'extraction'),
      pageIdentity: artifact.pageIdentity === undefined ? null : artifact.pageIdentity,
      segmentIdentity: artifact.segmentIdentity === undefined ? null : artifact.segmentIdentity,
      groupIdentity: artifact.groupIdentity === undefined ? null : artifact.groupIdentity,
    };
    const contentHash = String(artifact.contentHash || sha256(stableStringify(
      registrationOptions.hashValue === false ? compactIdentity : artifact.value
    )));
    const record = Object.freeze({
      artifactType: type,
      artifactId: id,
      artifactVersion: String(artifact.artifactVersion || '1'),
      contentHash,
      producerStage: String(artifact.producerStage || 'extraction'),
      producer: String(artifact.producer || 'business-pipeline'),
      pageIdentity: artifact.pageIdentity === undefined ? null : artifact.pageIdentity,
      segmentIdentity: artifact.segmentIdentity === undefined ? null : artifact.segmentIdentity,
      groupIdentity: artifact.groupIdentity === undefined ? null : artifact.groupIdentity,
      registeredOrder: ++sequence,
    });
    const existing = artifacts.get(key);
    if (existing) {
      if (existing.contentHash === record.contentHash && existing.artifactVersion === record.artifactVersion) return existing;
      const finding = addFinding(record.producerStage, { id: 'artifact-registry', version: '1', sourceFunction: 'registerArtifact' }, {
        ruleId: 'artifact_identity_conflict', severity: 'error', disposition: 'blocked', artifactRefs: [key], expected: existing.contentHash, actual: record.contentHash,
        evidence: { existing, incoming: record }, message: `Artifact identity conflict: ${key}`,
      });
      if (registrationOptions.required !== false) throw Object.assign(new Error(finding.message), { code: 'PDF_DIAGNOSTIC_ARTIFACT_CONFLICT', finding });
      return existing;
    }
    artifacts.set(key, record);
    return record;
  }

  function runPlugin(pluginId, input) {
    const plugin = plugins.get(pluginId);
    if (!plugin) throw new Error(`Diagnostic plugin is not registered: ${pluginId}`);
    const stageOrder = STAGE_ORDER[plugin.stage];
    if (stageOrder < highestStageOrder) {
      const finding = addFinding(plugin.stage, plugin, { ruleId: 'diagnostic_stage_order_regression', severity: 'error', disposition: 'blocked', expected: highestStageOrder, actual: stageOrder });
      throw Object.assign(new Error('Diagnostic plugin stage order regressed.'), { code: 'PDF_DIAGNOSTIC_STAGE_ORDER_INVALID', finding });
    }
    highestStageOrder = stageOrder;
    const beforeHash = plugin.verifyNoMutation ? sha256(stableStringify(input)) : '';
    const execution = { pluginId, pluginVersion: plugin.version, stage: plugin.stage, mode: plugin.mode, required: Boolean(plugin.required), order: ++sequence, status: 'running' };
    executions.push(execution);
    try {
      const evaluated = plugin.evaluate(context, input);
      const result = evaluated && Object.prototype.hasOwnProperty.call(evaluated, 'result') ? evaluated.result : evaluated;
      const rawFindings = evaluated && Array.isArray(evaluated.findings) ? evaluated.findings : [];
      rawFindings.forEach((finding) => addFinding(plugin.stage, plugin, finding));
      if (plugin.verifyNoMutation && beforeHash !== sha256(stableStringify(input))) {
        const finding = addFinding(plugin.stage, plugin, { ruleId: 'diagnostic_plugin_mutated_input', severity: 'error', disposition: 'blocked', message: `${pluginId} mutated its input.` });
        throw Object.assign(new Error(finding.message), { code: 'PDF_DIAGNOSTIC_PLUGIN_MUTATION', finding });
      }
      execution.status = rawFindings.some((finding) => (finding.severity || 'error') === 'error') ? 'findings' : 'passed';
      execution.findingCount = rawFindings.length;
      return result;
    } catch (error) {
      execution.status = 'failed';
      execution.errorCode = String(error && error.code || 'DIAGNOSTIC_PLUGIN_FAILED');
      if (!error.finding) addFinding(plugin.stage, plugin, { ruleId: 'diagnostic_plugin_failed', severity: plugin.required ? 'error' : 'warning', disposition: plugin.required ? 'blocked' : 'reporter_failed', evidence: { message: String(error && error.message || error) } });
      if (plugin.required) throw error;
      return null;
    }
  }

  function snapshot() {
    return {
      schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
      context,
      plugins: Array.from(plugins.values()).map(({ evaluate, ...plugin }) => plugin),
      executions: executions.map((entry) => ({ ...entry })),
      artifacts: Array.from(artifacts.values()),
      findings: findings.slice().sort((left, right) => left.firstObservedOrder - right.firstObservedOrder),
      summary: {
        pluginCount: plugins.size,
        executedPluginCount: executions.length,
        artifactCount: artifacts.size,
        findingCount: findings.length,
        errorCount: findings.filter((finding) => finding.severity === 'error').length,
        warningCount: findings.filter((finding) => finding.severity === 'warning').length,
        status: findings.some((finding) => finding.severity === 'error') ? 'failed' : 'passed',
      },
    };
  }

  return Object.freeze({ context, registerPlugin, registerArtifact, runPlugin, snapshot });
}

module.exports = {
  DIAGNOSTIC_SCHEMA_VERSION,
  STAGE_ORDER,
  createPdfDiagnosticRuntime,
  findingsFromAudit,
  sha256,
  stableStringify,
};
