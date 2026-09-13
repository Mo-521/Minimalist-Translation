const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const main = fs.readFileSync(path.resolve(__dirname, '../../../electron-app/main.js'), 'utf8');
const renderer = fs.readFileSync(path.resolve(__dirname, '../../../electron-app/renderer.js'), 'utf8');
const start = main.indexOf('function makeCaptionGroupAuditTextSnapshot(');
const end = main.indexOf('function buildCaptionGroupTranslationEventEvidence(', start);
const context = vm.createContext({ crypto });
vm.runInContext(main.slice(start, end), context);
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
const source = '(Crane and Árnadóttir 2013, 263) The argument continues.';
const output = '(Crane and Árnadóttir 2013, 263) 论证继续。';
function failedSegment() {
  return { id: 'test-body', type: 'body', status: 'failed', translatedText: '',
    invalidTranslationReason: 'invalid_translation_leading_source_carryover',
    translationLifecycleEvents: [
      { stage: 'translationInput', textSnapshot: { text: source, sha256: hash(source) },
        sourceIdentity: { sourceHash: hash(source) } },
      { stage: 'translationOutput', outcome: 'rejected_invalid_translation',
        textSnapshot: { text: output, sha256: hash(output) },
        sourceIdentity: { sourceHash: hash(source) } },
    ] };
}
test('debug failure evidence retains exact rejected body response and verified hash without making it writable', () => {
  const segment = failedSegment();
  const before = JSON.stringify(segment);
  const result = context.buildFailedTranslationEvidence(segment, true);
  assert.equal(result.observation, 'recorded_output');
  assert.equal(result.inputObserved, true);
  assert.equal(result.events[1].textSnapshot.text, output);
  assert.equal(result.events[1].textHashVerified, true);
  assert.equal(JSON.stringify(segment), before);
});
test('normal export and successful segments do not expose failed response text', () => {
  assert.equal(context.buildFailedTranslationEvidence(failedSegment(), false), null);
  assert.equal(context.buildFailedTranslationEvidence({ ...failedSegment(), status: 'done' }, true), null);
});
test('missing historical response stays explicitly unobserved, never replaced by original prose', () => {
  const result = context.buildFailedTranslationEvidence({ id: 'legacy', status: 'failed', sourceText: source }, true);
  assert.equal(result.observation, 'missing_output_event');
  assert.equal(result.inputObserved, false);
  assert.equal(result.events.length, 0);
});
test('tampered recorded response cannot acquire a verified hash', () => {
  const segment = failedSegment();
  segment.translationLifecycleEvents[1].textSnapshot.text += 'changed';
  assert.equal(context.buildFailedTranslationEvidence(segment, true).events[1].textHashVerified, false);
});
test('real IPC serialization retains events and export report consumes failure evidence', () => {
  assert.match(renderer, /translationLifecycleEvents: Array\.isArray\(segment\.translationLifecycleEvents\)/);
  assert.match(main, /failedTranslationEvidence: buildFailedTranslationEvidence\(segment, developerDiagnosticsRequested\)/);
});
