const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const rendererSource = fs.readFileSync(path.join(projectRoot, 'electron-app', 'renderer.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(projectRoot, 'electron-app', 'main.js'), 'utf8');

function extractFunction(source, name) {
  const asyncStart = source.indexOf(`async function ${name}(`);
  const plainStart = source.indexOf(`function ${name}(`);
  const start = asyncStart !== -1 ? asyncStart : plainStart;
  assert.notEqual(start, -1, `${name} must exist in production source`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unable to extract ${name}`);
}

function makeRendererAuditContext() {
  const context = {
    window: { crypto: crypto.webcrypto },
    TextEncoder,
    console: { log() {} },
    Date,
    Array,
    String,
    Number,
    Boolean,
    Promise,
    Uint8Array,
  };
  vm.createContext(context);
  vm.runInContext([
    extractFunction(rendererSource, 'requireCanonicalSemanticType'),
    extractFunction(rendererSource, 'sha256HexForPaperTranslationAudit'),
    extractFunction(rendererSource, 'makePaperTranslationLifecycleEvent'),
    extractFunction(rendererSource, 'appendPaperTranslationLifecycleEvent'),
  ].join('\n'), context);
  return context;
}

function makeMainAuditContext() {
  const context = { crypto, Array, String, Number, Boolean };
  vm.createContext(context);
  vm.runInContext([
    extractFunction(mainSource, 'makeCaptionGroupAuditTextSnapshot'),
    extractFunction(mainSource, 'normalizePaperTranslationLifecycleEvents'),
    extractFunction(mainSource, 'buildCaptionGroupTranslationEventEvidence'),
  ].join('\n'), context);
  return context;
}

test('真实 request/response 事件共享 source identity，且记录当时 group 未知', async () => {
  const context = makeRendererAuditContext();
  const segment = { id: 'seg-generic', type: 'caption', pageNumber: 2, translationLifecycleEvents: [] };
  const request = await context.makePaperTranslationLifecycleEvent({
    stage: 'translationInput', outcome: 'submitted', attemptId: 'attempt-1', taskId: 1,
    fileId: 'file-1', segment, text: 'Figure 1. Generic caption source.',
  });
  const response = await context.makePaperTranslationLifecycleEvent({
    stage: 'translationOutput', outcome: 'accepted', attemptId: 'attempt-1', taskId: 1,
    fileId: 'file-1', segment, text: '图1。通用图注译文。',
    sourceHash: request.textSnapshot.sha256,
    sourceVersion: request.sourceIdentity.sourceVersion,
  });
  context.appendPaperTranslationLifecycleEvent(segment, request);
  context.appendPaperTranslationLifecycleEvent(segment, response);

  assert.equal(request.textSnapshot.sha256.length, 64);
  assert.equal(response.sourceIdentity.sourceHash, request.textSnapshot.sha256);
  assert.equal(request.groupIdentityAtEvent.known, false);
  assert.equal(segment.translationLifecycleEvents.length, 2);
});

test('Export 映射选择同一 attempt 的真实 accepted 事件并验证哈希', async () => {
  const renderer = makeRendererAuditContext();
  const main = makeMainAuditContext();
  const segment = { id: 'seg-generic', type: 'caption', pageNumber: 3, translationLifecycleEvents: [] };
  const request = await renderer.makePaperTranslationLifecycleEvent({
    stage: 'translationInput', outcome: 'submitted', attemptId: 'attempt-2', taskId: 2,
    fileId: 'file-2', segment, text: 'Table 2. Generic source.',
  });
  const response = await renderer.makePaperTranslationLifecycleEvent({
    stage: 'translationOutput', outcome: 'accepted', attemptId: 'attempt-2', taskId: 2,
    fileId: 'file-2', segment, text: '表2。通用译文。',
    sourceHash: request.textSnapshot.sha256,
    sourceVersion: request.sourceIdentity.sourceVersion,
  });
  segment.translationLifecycleEvents.push(request, response);

  const evidence = main.buildCaptionGroupTranslationEventEvidence([segment], segment.id);
  assert.equal(evidence.inputItems.length, 1);
  assert.equal(evidence.outputItems.length, 1);
  assert.equal(evidence.inputItems[0].attemptId, 'attempt-2');
  assert.equal(evidence.outputItems[0].attemptId, 'attempt-2');
  assert.equal(evidence.hashValidationErrors.length, 0);
});

test('被篡改的事件文本不会被当作可信历史证据', async () => {
  const renderer = makeRendererAuditContext();
  const main = makeMainAuditContext();
  const segment = { id: 'seg-generic', type: 'caption', pageNumber: 4, translationLifecycleEvents: [] };
  const request = await renderer.makePaperTranslationLifecycleEvent({
    stage: 'translationInput', outcome: 'submitted', attemptId: 'attempt-3', taskId: 3,
    fileId: 'file-3', segment, text: 'Original source.',
  });
  request.textSnapshot.text = 'Mutated after request.';
  segment.translationLifecycleEvents.push(request);

  const evidence = main.buildCaptionGroupTranslationEventEvidence([segment], segment.id);
  assert.ok(evidence.hashValidationErrors.length > 0);
});

test('第三批仅让 Caption 使用 finalized group source，普通 segment 仍使用原 source', () => {
  assert.match(rendererSource, /var translationRequestText = getPaperTranslationRequestText\(segment\);/);
  assert.match(rendererSource, /return String\(segment && segment\.sourceText \|\| ""\);/);
  assert.match(rendererSource, /return String\(finalSource\.value\.fullText \|\| ""\);/);
  assert.match(rendererSource, /translatePaperSegmentWithRetry\(translationRequestText, state\.pdfTranslateAbortController\.signal\)/);
  assert.match(rendererSource, /translateSegmentSourceText\(sourceText, signal\)/);
  assert.match(mainSource, /behaviorMutationApplied: false/);
});
