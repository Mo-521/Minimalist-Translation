const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');
const rendererSource = fs.readFileSync(path.join(root, 'electron-app/renderer.js'), 'utf8');
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

function makeSegments(text = 'caption translation') {
  const translationHash = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  const sourceHash = crypto.createHash('sha256').update('full caption source', 'utf8').digest('hex');
  const group = { groupId: 'group-1', canonicalSegmentId: 'cap-1', memberSegmentIds: ['cap-2'] };
  return {
    translationHash,
    segments: ['cap-1', 'cap-2'].map((id, index) => ({
      id,
      type: 'caption',
      captionGroupId: group.groupId,
      captionGroupRole: index === 0 ? 'canonical' : 'member',
      captionGroupArtifact: { finalizedBeforeTranslation: true, value: group },
      finalCaptionSource: { finalizedBeforeTranslation: true, finalized: true, sourceVersion: `caption-source-sha256:${sourceHash}`, sourceHash, value: { fullText: 'full caption source' } },
    })),
  };
}

test('accepted group translation creates one display identity for canonical and member', () => {
  const fixture = makeSegments();
  const context = vm.createContext({ state: { segments: fixture.segments }, Set, JSON, String });
  vm.runInContext(extractFunction(rendererSource, 'applyCaptionGroupTranslationResult'), context);
  context.applyCaptionGroupTranslationResult(fixture.segments[0], 'caption translation', { textSnapshot: { sha256: fixture.translationHash } });
  const canonical = fixture.segments[0].captionDisplayArtifact;
  const member = fixture.segments[1].captionDisplayArtifact;
  assert.equal(canonical.producerStage, 'renderer.caption_display');
  assert.equal(canonical.displayText, 'caption translation');
  assert.equal(canonical.displayHash, fixture.translationHash);
  assert.equal(canonical.translationHash, fixture.translationHash);
  assert.equal(member.displayId, canonical.displayId);
  assert.equal(member.displayHash, canonical.displayHash);
});

test('export audit rejects missing, stale, or member-overridden display artifacts', () => {
  const fixture = makeSegments();
  const translation = {
    accepted: true,
    sourceHash: fixture.segments[0].finalCaptionSource.sourceHash,
    translationText: 'caption translation',
    translationHash: fixture.translationHash,
  };
  const display = {
    accepted: true,
    captionGroupId: 'group-1',
    canonicalSegmentId: 'cap-1',
    sourceVersion: fixture.segments[0].finalCaptionSource.sourceVersion,
    sourceHash: fixture.segments[0].finalCaptionSource.sourceHash,
    translationHash: fixture.translationHash,
    displayId: `caption-display:group-1:${fixture.translationHash}`,
    displayText: 'caption translation',
    displayHash: fixture.translationHash,
  };
  fixture.segments.forEach((segment) => {
    segment.captionGroupTranslationArtifact = { ...translation };
    segment.captionDisplayArtifact = { ...display };
  });
  const context = vm.createContext({ crypto, Map, Set, String, Number, Boolean });
  vm.runInContext(extractFunction(mainSource, 'auditCaptionDisplayArtifactsForExport'), context);
  assert.equal(context.auditCaptionDisplayArtifactsForExport(fixture.segments).violationCount, 0);
  fixture.segments[1].captionDisplayArtifact = { ...display, displayId: 'member-override' };
  assert.match(context.auditCaptionDisplayArtifactsForExport(fixture.segments).violations.map((item) => item.code).join(','), /caption_display_member_reference_drift/);
  delete fixture.segments[0].captionDisplayArtifact;
  assert.match(context.auditCaptionDisplayArtifactsForExport(fixture.segments).violations.map((item) => item.code).join(','), /missing_caption_display_artifact/);
});

test('fourth-batch source boundary keeps export read-only and layout/write/render implementations untouched', () => {
  assert.match(rendererSource, /captionDisplayArtifact:\s*segment\.captionDisplayArtifact/);
  assert.match(mainSource, /CAPTION_DISPLAY_ARTIFACT_INVALID/);
  const displayBlockStart = mainSource.indexOf("if (_captionGroupRole && _captionGroupRole.role === 'canonical')");
  const displayBlockEnd = mainSource.indexOf('captionGroupWriteKind', displayBlockStart);
  const displayBlock = mainSource.slice(displayBlockStart, displayBlockEnd);
  assert.match(displayBlock, /_captionGroupRole\.displayArtifact/);
  assert.doesNotMatch(displayBlock, /_groupTranslationArtifact\.translationText/);
  assert.doesNotMatch(displayBlock, /_captionGroupMemberSegments\.map/);
  const displayProducer = extractFunction(rendererSource, 'applyCaptionGroupTranslationResult');
  assert.doesNotMatch(displayProducer, /bbox|layout|writeBox|pageNumber|font|draw/);
});
