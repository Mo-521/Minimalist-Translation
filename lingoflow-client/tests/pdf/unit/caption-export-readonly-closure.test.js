const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const mainSource = fs.readFileSync(path.join(root, 'electron-app/main.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'electron-app/renderer.js'), 'utf8');

test('caption transition compatibility producers and outputs are removed', () => {
  const production = `${mainSource}\n${rendererSource}`;
  [
    'captionTranslationCompatibilityMerge',
    'compatibilityTranslationMergeEvidence',
    'captionGroupRepair',
    'captionGroupDisplayMerge',
    'captionGroupMergedTranslatedTextLength',
    'captionGroupWriterAttempted',
    'captionGroupWriterApplied',
    'captionGroupPostFix',
    'captionVisualReplacementPostFix',
    '_memberJoined',
    'readPretranslationCaptionGroupPlanForExport',
  ].forEach((legacyName) => assert.doesNotMatch(production, new RegExp(legacyName), `${legacyName} must not remain in production`));
});

test('export consumes lifecycle artifacts and retains strict authority gates', () => {
  assert.match(mainSource, /function readCaptionLifecycleArtifactsForExport\s*\(/);
  assert.match(mainSource, /auditPretranslationCaptionArtifactsForExport\s*\(allSegments\)/);
  assert.match(mainSource, /auditCaptionDisplayArtifactsForExport\s*\(allSegments\)/);
  assert.match(mainSource, /bindCaptionWriteCandidatesToLayout\s*\(_paperWriteOps, _layoutPlan\.items/);
  assert.match(mainSource, /captionWriteAuthorityStatus !== 'authorized_from_validated_layout_item'/);
  assert.match(mainSource, /captionLifecycleArtifactDetails/);
});

test('export does not invoke caption source, grouping, translation, or display producers', () => {
  const exportStart = mainSource.indexOf('async function exportTranslatedPdf');
  assert.ok(exportStart > 0, 'exportTranslatedPdf must exist');
  const exportFlow = mainSource.slice(exportStart);
  [
    'finalizePretranslationCaptionGroups(',
    'buildPretranslationCaptionGroupPlan(',
    'applyCaptionGroupTranslationResult(',
  ].forEach((producerCall) => assert.doesNotMatch(exportFlow, new RegExp(producerCall.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${producerCall} must not run in Export`));
});
