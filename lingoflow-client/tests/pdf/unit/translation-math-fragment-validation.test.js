const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = path.resolve(__dirname, '../../../electron-app');
const sources = [
  [fs.readFileSync(path.join(app, 'main.js'), 'utf8'), 'async function exportSimpleTranslatedPdfDocumentFlow('],
  [fs.readFileSync(path.join(app, 'renderer.js'), 'utf8'), 'function getInvalidTranslationReason('],
];

function loadValidator(source, next) {
  const start = source.indexOf('function getTranslationOutputSemanticFailure(');
  const end = source.indexOf(next, start);
  const context = vm.createContext({});
  vm.runInContext(source.slice(start, end), context);
  return context.getTranslationOutputSemanticFailure;
}

for (const [index, [source, next]] of sources.entries()) {
  const validate = loadValidator(source, next);

  test(`validator ${index}: formula-only fragments may remain unchanged`, () => {
    for (const formula of [
      '(gz(u) + ihz(u))(gz(u) + ihz(u))du',
      'X^DU X^n^+ r X^DUZ λ αj = mx_l fx_l(u)ψj(u)du',
      'l=1 j=1 -λ Xn+r Xk Z λ ⩾ mx_l + 2 mz_l |gz_l(u)|',
    ]) assert.equal(validate(formula, formula), '');
  });

  test(`validator ${index}: translated prose may retain a leading equation or proper name`, () => {
    assert.equal(validate(
      'lim inf_T_→∞ N^d(T) ⩾C_1:= C^0 + 1 = 0.83625..., N(T)2 67.25% of the non-trivial zeros of the zeta 83.62% are distinct.',
      'lim inf_T_→∞ N^d(T) ⩾C_1:= C^0 + 1 = 0.83625..., N(T)2 67.25% 的 zeta 非平凡零点中，83.62% 是不同的。'
    ), '');
    assert.equal(validate('von Mangoldt asymptotic N(T) may be found here.', 'von Mangoldt渐近式N(T)可在此处找到。'), '');
  });

  test(`validator ${index}: unchanged prose and real prose carryover remain blocked`, () => {
    assert.equal(validate('This is the original sentence.', 'This is the original sentence.'), 'invalid_translation_source_language_unchanged');
    assert.equal(validate('grounding is a useful tool.', 'grounding is a useful工具。'), 'invalid_translation_leading_source_carryover');
  });
}
