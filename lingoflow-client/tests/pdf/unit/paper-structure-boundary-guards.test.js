const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { semanticStructureProducerStages } = require('../../../electron-app/semantic-structure-authority.js');
const source = fs.readFileSync(path.resolve(__dirname, '../../../electron-app/main.js'), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  const end = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, end < 0 ? source.length : end);
}
function load() {
  const context = vm.createContext({
    normalizeExtractedPdfText: value => String(value || '').replace(/\s+/g, ' ').trim(),
    isReferencesHeadingText: value => /^(References|Bibliography|Works Cited)$/i.test(value),
    isPaperPdfConfig: config => config.mode === 'paper_pdf',
    splitReferenceSegmentsInOrder: segments => segments,
    semanticStructureProducerStages,
  });
  const names = ['isSectionHeadingText', 'getSegmentText', 'startsWithLowercaseWord',
    'startsWithNumericContinuation', 'endsWithHyphenatedWord', 'isSentenceLikeBodyText',
    'getContinuationMergeReason', 'isPaperReferenceHeadingText', 'detectReferenceHeadingSegment',
    'isReferenceModeExemptSegment', 'retagSegmentAsReference', 'applyReferenceMode',
    'classifyPaperReferenceChainSegment', 'isCrediblePostReferenceSectionHeading',
    'getLeadingBracketedReferenceNumber', 'hasStrongBibliographyEvidence',
    'detectHeadinglessReferenceStartIndex', 'applyReferenceTypingAndOrdering'];
  vm.runInContext(names.map(extract).join('\n'), context);
  return context;
}
test('explicit section headings cannot be demoted by numeric or body continuation', () => {
  const c = load();
  for (const sourceText of ['1.1 | Roadmap', '3.3 | The Tension', '3.4 | The Strengthened Exclusion Problem', '5 | Conclusion', '| Conclusion', 'References']) {
    assert.equal(c.getContinuationMergeReason({ type: 'heading', sourceText },
      { type: 'body', sourceText: 'A previous incomplete-' }, { type: 'body' }), '');
  }
});
test('existing prose fragments retain continuation evidence', () => {
  const c = load();
  for (const [text, expected] of [['2.4, which follows', 'numeric_continuation'], ['pirical evidence', 'hyphen_continuation']]) {
    assert.equal(c.getContinuationMergeReason({ type: 'body', sourceText: text },
      { type: 'body', sourceText: 'A preceding fragment' }, null), expected);
  }
});
const config = { mode: 'paper_pdf', enableReferencePreserve: true };
const seg = (id, column, y, sourceText = 'An entry', type = 'body', pageNumber = 11) =>
  ({ id, column, bbox: { y }, sourceText, type, pageNumber });
test('left-column References protects right-column entries above its Y, not earlier body', () => {
  const c = load();
  const result = c.applyReferenceMode([
    seg('before', 'left', 30), seg('heading', 'left', 210, 'References', 'heading'),
    seg('right-top', 'right', 30), seg('left-after', 'left', 240),
    seg('footer', 'right', 790, '81', 'pageNumber'), seg('next-page', 'left', 20, 'Entry', 'body', 12),
  ], config);
  assert.deepEqual(Array.from(result, s => s.type), ['body', 'heading', 'reference', 'reference', 'pageNumber', 'reference']);
  assert.deepEqual(Array.from(result, s => s.referenceRole || ''), ['', 'heading', 'entry', 'entry', '', 'entry']);
});
test('right-column References does not capture earlier left-column body below its Y', () => {
  const c = load();
  const result = c.applyReferenceMode([
    seg('left-body', 'left', 700), seg('right-before', 'right', 20),
    seg('heading', 'right', 210, 'References', 'heading'), seg('right-after', 'right', 250),
  ], config);
  assert.deepEqual(Array.from(result, s => s.type), ['body', 'body', 'heading', 'reference']);
  assert.deepEqual(Array.from(result, s => s.referenceRole || ''), ['', '', 'heading', 'entry']);
});
test('single-column and disabled reference preservation retain their contracts', () => {
  const c = load();
  const input = [seg('before', 'single', 20), seg('heading', 'single', 210, 'References', 'heading'), seg('after', 'single', 250)];
  const result = c.applyReferenceMode(input, config);
  assert.deepEqual(Array.from(result, s => s.type), ['body', 'heading', 'reference']);
  assert.deepEqual(Array.from(result, s => s.referenceRole || ''), ['', 'heading', 'entry']);
  assert.equal(c.applyReferenceMode(input, { ...config, enableReferencePreserve: false }), input);
});

test('center-spanning References heading protects both columns below its source anchor', () => {
  const c = load();
  const heading = { ...seg('heading', 'right', 308, 'REFERENCES', 'heading'),
    bbox: { x: 272.09, y: 308, width: 68.49, height: 9.96 }, items: [{ pageWidth: 612 }] };
  const result = c.applyReferenceMode([
    seg('body-left', 'left', 250), seg('body-right', 'right', 250), heading,
    seg('entry-left', 'left', 367), seg('entry-right', 'right', 330),
  ], config);
  assert.deepEqual(Array.from(result, s => s.type), ['body', 'body', 'heading', 'reference', 'reference']);
  assert.deepEqual(Array.from(result, s => s.referenceRole || ''), ['', '', 'heading', 'entry', 'entry']);
});

test('center-spanning heading classifies left-column entries that precede it in extraction order', () => {
  const c = load();
  const heading = { ...seg('heading', 'right', 308, 'REFERENCES', 'heading'),
    bbox: { x: 272.09, y: 308, width: 68.49, height: 9.96 }, items: [{ pageWidth: 612 }] };
  const result = c.applyReferenceMode([
    seg('body-left', 'left', 250),
    seg('entry-left-a', 'left', 324, 'Bañados, E. 2018, Nature, 553, 473'),
    seg('entry-left-b', 'left', 453, 'Brammer, G. B. 2012, ApJS, 200, 13'),
    heading,
    seg('entry-right', 'right', 330, 'Freeman, P. 2001, SPIE, 4477'),
  ], config);
  assert.deepEqual(Array.from(result, s => s.type), ['body', 'reference', 'reference', 'heading', 'reference']);
  assert.deepEqual(Array.from(result, s => s.referenceRole || ''), ['', 'entry', 'entry', 'heading', 'entry']);
});

test('an explicit later section heading terminates Reference mode across following pages', () => {
  const c = load();
  const input = [
    seg('heading', 'left', 210, 'References', 'heading', 11),
    seg('entry', 'left', 240, 'Doe, J. 2025.', 'body', 11),
    { ...seg('appendix', 'left', 100, 'Appendix A', 'heading', 12), referenceSectionBoundary: 'end' },
    seg('appendix-body', 'left', 130, 'Supplementary prose.', 'body', 12),
  ];
  const result = c.applyReferenceMode(input, config);
  assert.deepEqual(Array.from(result, s => s.type), ['heading', 'reference', 'heading', 'body']);
  assert.deepEqual(Array.from(result, s => s.referenceRole || ''), ['heading', 'entry', '', '']);
});

test('Reference ordering passes the inherited section-end type through producer evidence', () => {
  const c = load();
  const appendix = c.classifyPaperReferenceChainSegment(
    seg('appendix', 'single', 100, 'Appendix A', 'heading', 12),
    'paper_reference_section_end',
    { inheritedSemanticType: 'heading', classificationReason: 'reference_section_explicit_heading_end' },
  );
  assert.equal(appendix.type, 'heading');
  assert.equal(appendix.referenceSectionBoundary, 'end');
  assert.equal(appendix.referenceRole, '');
});

test('bibliographic text misclassified as a heading cannot terminate Reference authority', () => {
  const c = load();
  const result = c.applyReferenceTypingAndOrdering([
    seg('heading', 'single', 210, 'References', 'heading', 12),
    seg('entry-a', 'single', 240, '[1] Doe, J. 2025.', 'body', 12),
    seg('false-heading', 'single', 80, '29 Jan. 2024, www.imdrf.org/documents/good-machine-learning-', 'heading', 13),
    seg('entry-b', 'single', 110, '[20] Miller, R. A., et al. 1982.', 'body', 13),
  ]);
  assert.deepEqual(Array.from(result, s => s.type), ['heading', 'reference', 'reference', 'reference']);
  assert.deepEqual(Array.from(result, s => s.referenceRole || ''), ['heading', 'entry', 'entry', 'entry']);
});

test('a credible Appendix heading still terminates Reference authority', () => {
  const c = load();
  const result = c.applyReferenceTypingAndOrdering([
    seg('heading', 'single', 210, 'References', 'heading', 12),
    seg('entry', 'single', 240, '[1] Doe, J. 2025.', 'body', 12),
    seg('appendix', 'single', 100, 'Appendix A', 'heading', 13),
    seg('appendix-body', 'single', 130, 'Supplementary prose.', 'body', 13),
  ]);
  assert.deepEqual(Array.from(result, s => s.type), ['heading', 'reference', 'heading', 'body']);
  assert.equal(result[2].referenceSectionBoundary, 'end');
});

test('a strong numbered bibliography chain starts Reference authority without a heading', () => {
  const c = load();
  const input = [
    seg('conclusion', 'left', 100, 'We conclude that the measurements remain consistent.', 'body', 9),
    seg('ack', 'left', 600, 'Acknowledgements: This work was supported by the Example Foundation.', 'body', 10),
    seg('refs-a', 'left', 650, '[1] M. Le and I. Trujillo, Astrophysical Journal 100, 1 (2025). [16] S. Hawking, Monthly Notices 20, 2 (1974).', 'body', 10),
    seg('refs-b', 'left', 700, '[2] A. Author, Physics Letters 3, 4 (2024). [17] B. Author, Nature 5, 6 (2023).', 'body', 10),
    seg('refs-c', 'left', 100, '[3] C. Author, Science 7, 8 (2022). [18] D. Author, Journal of Physics 9, 10 (2021).', 'body', 11),
  ];
  const typed = c.applyReferenceTypingAndOrdering(input);
  assert.deepEqual(Array.from(typed, s => s.type), ['body', 'body', 'reference', 'reference', 'reference']);
  assert.equal(typed[2].referenceChainStart, true);
  const preserved = c.applyReferenceMode(typed, config);
  assert.deepEqual(Array.from(preserved, s => s.status || ''), ['', '', 'preserved', 'preserved', 'preserved']);
  assert.ok(preserved.slice(2).every(s => s.referenceModeApplied));
});

test('an isolated numbered body list cannot start headingless Reference authority', () => {
  const c = load();
  const input = [
    seg('body', 'left', 100, '[1] First experiment. [2] Second experiment.', 'body', 3),
    seg('next', 'left', 140, 'The numbered discussion continues as ordinary prose.', 'body', 3),
  ];
  const typed = c.applyReferenceTypingAndOrdering(input);
  assert.deepEqual(Array.from(typed, s => s.type), ['body', 'body']);
});
