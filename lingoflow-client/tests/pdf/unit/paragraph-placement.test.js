const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../../electron-app/main.js'), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
}
function load() {
  const context = vm.createContext({ normalizeFormulaToken: String, isPaperFormulaWrapToken: () => false,
    splitLongToken: (token) => [token] });
  for (const name of ['cleanPdfText', 'tokenizePaperWrapText', 'composePaperWrapTokens',
    'updatePaperParagraphCorrectionTailDecision', 'balancePaperParagraphTailLines',
    'wrapTranslatedTextForPaperBox', 'wrapPaperTextParagraphs', 'getPdfTextLayoutHeight',
    'measurePaperTextHeight', 'measurePaperWrappedText', 'resolvePaperParagraphPlacement']) {
    vm.runInContext(extract(name), context);
  }
  return context.resolvePaperParagraphPlacement;
}
const font = { widthOfTextAtSize: (text, size) => Array.from(text).length * size };
function fixture() {
  const run = { paragraphId: 'p1', pageNumber: 1, column: 'single', type: 'abstract',
    sourceBbox: { x: 20, y: 50, width: 60, height: 100 },
    paragraphCorrectionDecision: { authorityVersion: 'paper-paragraph-correction/v1', paragraphId: 'p1', tail: { decision: 'no-op' } } };
  return { run, box: { x: 0, y: 50, width: 100, height: 24 },
    fitted: { size: 10, lineHeight: 12, paragraphSpacing: 0, renderedTextHeight: 24 },
    plan: { paragraphId: 'p1', pageNumber: 1, column: 'single', maxWriteBottomY: 150 } };
}
test('placement uses real width measurements, restores source width and keeps owner/font/text', () => {
  const f = fixture(); const before = JSON.stringify(f);
  const result = load()(f.run, f.box, f.fitted, font, '甲乙丙丁戊己庚辛壬癸', 0, '', () => true, f.plan);
  assert.equal(result.decision.decision, 'correct');
  assert.equal(result.writeBox.x, 20); assert.equal(result.writeBox.width, 60);
  assert.equal(result.writeBox.y, 50); assert.equal(result.fitted.size, 10);
  assert.equal(result.fitted.paragraphs.flat().join(''), '甲乙丙丁戊己庚辛壬癸');
  assert.equal(JSON.stringify(f), before);
});
test('insufficient owned height is strict no-op and leaves original Tail trace untouched', () => {
  const f = fixture(); f.plan.maxWriteBottomY = 62;
  const before = JSON.stringify(f);
  const result = load()(f.run, f.box, f.fitted, font, '甲乙丙丁戊己庚辛壬癸', 0, '', () => true, f.plan);
  assert.equal(result.decision.reason, 'actual_font_height_exceeds_validated_region');
  assert.equal(result.writeBox, undefined); assert.equal(JSON.stringify(f), before);
});
test('placement refuses incomplete ownership, structural risks, flow uncertainty and layout rejection', () => {
  for (const mutate of [f => { f.run.runPageMismatch = true; }, f => { f.run.column = 'left'; },
    f => { f.run.sourceBbox.x = -1; }, f => { f.fitted.overflow = true; },
    f => { f.plan.pageNumber = 2; }, f => { f.run.paragraphCorrectionDecision = null; }]) {
    const f = fixture(); mutate(f);
    const result = load()(f.run, f.box, f.fitted, font, '甲乙丙丁', 0, '', () => true, f.plan);
    assert.equal(result.decision.decision, 'no-op'); assert.equal(result.writeBox, undefined);
  }
  const f = fixture();
  const result = load()(f.run, f.box, f.fitted, font, '甲乙丙丁', 0, '', () => false, f.plan);
  assert.equal(result.decision.reason, 'layout_validation_not_passed');
});
test('placement never clips an unbreakable overwide token to force success', () => {
  const f = fixture();
  const result = load()(f.run, f.box, f.fitted, font, 'unbreakablelongtoken', 0, '', () => true, f.plan);
  assert.equal(result.decision.reason, 'actual_font_width_overflow');
});

test('placement is idempotent and source/next-anchor capacities are both hard bounds', () => {
  const f = fixture(); const resolve = load();
  const first = resolve(f.run, f.box, f.fitted, font, '甲乙丙丁戊己庚辛壬癸', 0, '', () => true, f.plan);
  const second = resolve(f.run, first.writeBox, first.fitted, font, '甲乙丙丁戊己庚辛壬癸', 0, '', () => true, f.plan);
  assert.equal(second.decision.reason, 'already_at_source_width');
  f.run.sourceBbox.height = 12;
  const blocked = resolve(f.run, f.box, f.fitted, font, '甲乙丙丁戊己庚辛壬癸', 0, '', () => true, f.plan);
  assert.equal(blocked.decision.reason, 'actual_font_height_exceeds_validated_region');
});
