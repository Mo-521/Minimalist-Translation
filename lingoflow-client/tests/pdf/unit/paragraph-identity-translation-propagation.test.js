const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');
const rendererSource = fs.readFileSync(path.join(root, 'electron-app/renderer.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'electron-app/main.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unable to extract ${name}`);
}

function loadRendererHelpers(segments = []) {
  const context = vm.createContext({ String, Number, Math, Array, Boolean, RegExp, state: { segments } });
  vm.runInContext([
    extractFunction(rendererSource, 'addProtectedCitationToken'),
    extractFunction(rendererSource, 'buildProtectedCitationTokens'),
    extractFunction(rendererSource, 'restoreCitationTokensAfterTranslate'),
    extractFunction(rendererSource, 'joinPaperParagraphIdentitySourceParts'),
    extractFunction(rendererSource, 'splitPaperParagraphIdentityTextByWeights'),
    extractFunction(rendererSource, 'applyPaperParagraphIdentityTranslationResult'),
  ].join('\n'), context);
  return context;
}

test('citation protection keeps only the authoritative enclosing citation', () => {
  const context = loadRendererHelpers();
  const tokens = context.buildProtectedCitationTokens('mass (N. J. Secrest et al. 2017).');
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].raw, '(N. J. Secrest et al. 2017)');
});

test('citation restoration accepts provider-mutated visible placeholders', () => {
  const context = loadRendererHelpers();
  const restored = context.restoreCitationTokensAfterTranslate(
    '约占恒星总质量的2%【0†citation】',
    [{ raw: '(N. J. Secrest et al. 2017)' }]
  );
  assert.equal(restored.text, '约占恒星总质量的2%(N. J. Secrest et al. 2017)');
  assert.deepEqual(Array.from(restored.failed), []);
});

test('citation indices cannot consume a longer token index', () => {
  const context = loadRendererHelpers();
  const result = context.restoreCitationTokensAfterTranslate('CITATION_10', [{ raw: '(Author 2020)' }, { raw: '(Other 2021)' }]);
  assert.equal(result.text, 'CITATION_10');
  assert.equal(result.failed.length, 2);
});

function loadCitationTranslation(responses) {
  const context = loadRendererHelpers();
  let calls = 0;
  Object.assign(context, {
    state: { pdfSourceLang: 'en', pdfTargetLang: 'zh-CN', pdfTranslationMode: 'paper_pdf' },
    normalizePdfLang: value => value,
    sameConcreteLanguage: () => false,
    protectPdfFormulaTokensForTranslation: text => ({ text, tokens: [] }),
    restorePdfFormulaPlaceholders: text => text,
    toLegacyTranslateLang: value => value,
    PDF_TRANSLATION_PROVIDER: 'test',
    buildPdfTranslationPromptByMode: () => ({ context: 'test' }),
    debugPdfLog: () => {},
    getElectronIpc: () => ({ invoke: async () => ({ status: 'ok', text: responses[Math.min(calls++, responses.length - 1)] }) }),
    extractTranslatedText: data => data.text,
    getInvalidTranslationReason: () => '',
    waitForPdfTranslationRetry: async () => {},
  });
  vm.runInContext([
    extractFunction(rendererSource, 'replaceCitationTokensBeforeTranslate'),
    extractFunction(rendererSource, 'isRetryablePdfTranslationError'),
    'async ' + extractFunction(rendererSource, 'translateSegmentSourceText'),
    'async ' + extractFunction(rendererSource, 'translatePaperSegmentWithRetry'),
  ].join('\n'), context);
  return { context, calls: () => calls };
}

test('missing citation retries before accepting a complete response', async () => {
  const harness = loadCitationTranslation(['这些结果。', '这些结果 __CITATION_0__。']);
  const result = await harness.context.translatePaperSegmentWithRetry('Results (Author et al. 2020).');
  assert.equal(harness.calls(), 2);
  assert.equal(result.retryCount, 1);
  assert.match(result.translated, /Author et al\. 2020/);
  assert.equal(harness.context.translateSegmentSourceText.lastProtectionReport.citationTokenRestoreFailedCount, 0);
});

test('persistent citation loss fails after exactly three attempts', async () => {
  const harness = loadCitationTranslation(['这些结果。']);
  await assert.rejects(harness.context.translatePaperSegmentWithRetry('Results (Author et al. 2020).'),
    error => error.code === 'PDF_CITATION_INTEGRITY_FAILED' && error.pdfTranslationRetryCount === 2);
  assert.equal(harness.calls(), 3);
});

test('cross-page hyphenated source is joined before one translation request', () => {
  const context = loadRendererHelpers();
  assert.equal(
    context.joinPaperParagraphIdentitySourceParts(['we infer Lbol using em-', 'pirical corrections from X-rays']),
    'we infer Lbol using empirical corrections from X-rays'
  );
});

test('combined translation is split back to physical page-owned segments', () => {
  const segments = [
    { id: 'seg-a', pageNumber: 3, sourceText: 'first source fragment' },
    { id: 'seg-b', pageNumber: 4, sourceText: 'second source fragment' },
  ];
  const context = loadRendererHelpers(segments);
  const group = {
    logicalParagraphId: 'lp-31',
    authorityVersion: 'paper-paragraph-identity-recovery/v1',
    members: [
      { pageNumber: 3, segmentIds: ['seg-a'], sourceText: segments[0].sourceText },
      { pageNumber: 4, segmentIds: ['seg-b'], sourceText: segments[1].sourceText },
    ],
  };
  context.applyPaperParagraphIdentityTranslationResult(group, '这是同一个连续段落，后半部分继续说明结论。', { providerId: 'test' }, {});
  assert.ok(segments[0].translatedText);
  assert.ok(segments[1].translatedText);
  assert.equal(segments[0].pageNumber, 3);
  assert.equal(segments[1].pageNumber, 4);
  assert.equal(segments[0].paragraphIdentityTranslationGroupId, 'lp-31');
  assert.equal(segments[1].paragraphIdentityTranslationGroupId, 'lp-31');
  assert.equal(segments[0].paragraphIdentityTranslationSourceCombined, true);
  assert.equal(segments[1].paragraphIdentityTranslationSourceCombined, true);
});

test('translation plan reuses main paragraph identity authority and renderer consumes it', () => {
  assert.match(mainSource, /buildPaperParagraphRuns\([\s\S]*buildPaperParagraphIdentityTranslationPlan/);
  assert.match(mainSource, /pdf:paragraph-identity-translation-plan/);
  assert.match(rendererSource, /getPaperParagraphIdentityTranslationPlan\(\)/);
  assert.match(rendererSource, /joinPaperParagraphIdentitySourceParts/);
  assert.match(rendererSource, /applyPaperParagraphIdentityTranslationResult/);
});
