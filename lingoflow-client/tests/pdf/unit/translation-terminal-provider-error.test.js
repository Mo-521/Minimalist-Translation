const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rendererPath = path.resolve(__dirname, '../../../electron-app/renderer.js');
const rendererSource = fs.readFileSync(rendererPath, 'utf8');

function loadTerminalErrorClassifier() {
  const start = rendererSource.indexOf('function isTerminalPdfTranslationProviderError(');
  const end = rendererSource.indexOf('function waitForPdfTranslationRetry(', start);
  assert.ok(start >= 0 && end > start, 'terminal provider error classifier must exist');
  const context = vm.createContext({});
  vm.runInContext(rendererSource.slice(start, end), context);
  return context.isTerminalPdfTranslationProviderError;
}

test('terminal provider classifier recognizes balance and authentication failures', () => {
  const classify = loadTerminalErrorClassifier();
  assert.equal(classify(new Error("Error invoking remote method 'lingoflow-provider:translate': Error: Provider HTTP 402 Payment Required：Insufficient Balance")), true);
  assert.equal(classify(Object.assign(new Error('request failed'), { httpStatus: 401 })), true);
  assert.equal(classify(new Error('Provider HTTP 403 Forbidden')), true);
  assert.equal(classify(new Error('invalid token')), true);
});

test('terminal provider classifier leaves transient and content failures retryable per segment', () => {
  const classify = loadTerminalErrorClassifier();
  assert.equal(classify(Object.assign(new Error('rate limited'), { httpStatus: 429 })), false);
  assert.equal(classify(new Error('Provider HTTP 500 Internal Server Error')), false);
  assert.equal(classify(new Error('invalid_translation_source_language_unchanged')), false);
  assert.equal(classify(Object.assign(new Error('translation aborted'), { name: 'AbortError' })), false);
});

test('paper and simple translation loops stop on the first terminal provider error', () => {
  const terminalBranches = rendererSource.match(/if \(isTerminalPdfTranslationProviderError\(err\)\) \{[\s\S]*?\bbreak;/g) || [];
  assert.equal(terminalBranches.length, 2, 'both PDF translation loops must stop on terminal provider errors');
  for (const branch of terminalBranches) {
    assert.match(branch, /state\.error = segment\.error/);
  }
  assert.match(rendererSource, /if \(isTerminalPdfTranslationProviderError\(err\)\) \{[\s\S]*?segment\.status = "failed";[\s\S]*?\bbreak;/);
  assert.match(rendererSource, /segment\.status = "failed";[\s\S]*?if \(isTerminalPdfTranslationProviderError\(err\)\) \{[\s\S]*?\bbreak;/);
});
