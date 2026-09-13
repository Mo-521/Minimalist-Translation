const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = path.resolve(__dirname, '../../../electron-app');
const main = fs.readFileSync(path.join(app, 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(app, 'renderer.js'), 'utf8');
function loadValidator(source, next) {
  const start = source.indexOf('function getTranslationOutputSemanticFailure(');
  const end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({});
  vm.runInContext(source.slice(start, end), context);
  return context.getTranslationOutputSemanticFailure;
}
const validators = [loadValidator(main, 'async function exportSimpleTranslatedPdfDocumentFlow('),
  loadValidator(renderer, 'function getInvalidTranslationReason(')];
for (const [label, validate] of validators.entries()) {
  test(`validator ${label}: intact accented author citation is not source prose`, () => {
    const citation = '(Crane and Árnadóttir 2013, 263)';
    assert.equal(validate(citation + ' Crane and Árnadóttir discuss this argument.', citation + ' Crane和Árnadóttir讨论此论证。'), '');
    assert.equal(validate('(Smith 2020) (Jones 2021) The result follows.', '(Smith 2020) (Jones 2021) 由此得出结果。'), '');
    assert.equal(validate(citation + ' The original argument remains.', citation + ' The original argument remains.补充说明。'), 'invalid_translation_leading_source_carryover');
  });
  test(`validator ${label}: no vocabulary whitelist for a single retained technical term`, () => {
    for (const word of ['grounding', 'entropy', 'foobar', 'kbol']) {
      assert.equal(validate(word + ' describes the mechanism.', word + '描述了该机制。'), '');
    }
    assert.equal(validate('grounding is a useful tool.', 'grounding is a useful工具。'), 'invalid_translation_leading_source_carryover');
  });
  test(`validator ${label}: retained multi-token product and benchmark names are not prose carryover`, () => {
    assert.equal(validate('Reddit GitLab Map Overall', 'Reddit GitLab 地图 总体'), '');
    assert.equal(validate('AssistantBench WorkArena Avg.', 'AssistantBench WorkArena 平均值。'), '');
    assert.equal(validate('AssistantBench WorkArena Avg. BoN Pairwise BoN', 'AssistantBench WorkArena 平均 BoN 成对 BoN'), '');
    assert.equal(validate('This Paper Presents Results', 'This Paper 给出结果'), 'invalid_translation_leading_source_carryover');
  });
  test(`validator ${label}: unchanged prose and refusals remain blocked`, () => {
    assert.equal(validate('This is the original sentence.', 'This is the original sentence.'), 'invalid_translation_source_language_unchanged');
    assert.equal(validate('The result follows.', '请提供原文，无法翻译。'), 'invalid_translation_refusal');
    assert.equal(validate('(This is ordinary prose) The result follows.', '(This is ordinary prose)结果如下。'), 'invalid_translation_leading_source_carryover');
  });
}
function retryContext(translate) {
  const start = renderer.indexOf('function isRetryablePdfTranslationError(');
  const end = renderer.indexOf('function buildSimplePdfTranslationPrompt(', start);
  const context = vm.createContext({ translateSegmentSourceText: translate,
    getInvalidTranslationReason: () => '', setTimeout, clearTimeout });
  vm.runInContext(renderer.slice(start, end), context);
  context.waitForPdfTranslationRetry = async () => {};
  return context;
}
test('IPC terminated response receives bounded retry and can recover', async () => {
  let calls = 0;
  const context = retryContext(async () => {
    if (++calls === 1) throw new Error("Error invoking remote method 'lingoflow-provider:translate': TypeError: terminated");
    return '有效译文';
  });
  const result = await context.translatePaperSegmentWithRetry('source', null);
  assert.equal(calls, 2);
  assert.equal(result.retryCount, 1);
  assert.equal(result.translated, '有效译文');
});
test('persistent termination stops at three attempts; auth and cancellation never retry', async () => {
  let calls = 0;
  const context = retryContext(async () => { calls++; throw new Error('TypeError: terminated'); });
  await assert.rejects(context.translatePaperSegmentWithRetry('source', null), /terminated/);
  assert.equal(calls, 3);
  assert.equal(context.isRetryablePdfTranslationError({ name: 'AbortError', message: 'TypeError: terminated' }), false);
  assert.equal(context.isRetryablePdfTranslationError({ httpStatus: 401, message: 'TypeError: terminated' }), false);
  assert.equal(context.isRetryablePdfTranslationError({ message: 'unauthorized TypeError: terminated' }), false);
  assert.equal(context.isRetryablePdfTranslationError({ message: 'task terminated by user' }), false);
});
