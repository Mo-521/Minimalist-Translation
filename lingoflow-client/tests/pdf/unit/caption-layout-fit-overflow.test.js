const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');
const mainSource = fs.readFileSync(path.join(root, 'electron-app/main.js'), 'utf8');
const paperLayoutAuthority = require(path.join(root, 'electron-app/paper-layout-authority'));

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

test('caption fit retries only bounded positive inner padding values', () => {
  assert.deepEqual(Array.from(paperLayoutAuthority.getCaptionPaddingCandidates(2, 1)), [2, 1.5, 1]);
  assert.deepEqual(Array.from(paperLayoutAuthority.getCaptionPaddingCandidates(1, 1)), [1]);
});

test('adaptive padding is caption-owned and does not bypass fit or validators', () => {
  const fitStart = mainSource.indexOf('const captionInitialFit = captionOwnRegion ? fitted : null;');
  const fitEnd = mainSource.indexOf('if (captionOwnRegion) {', fitStart);
  assert.ok(fitStart > 0 && fitEnd > fitStart);
  const recovery = mainSource.slice(fitStart, fitEnd);
  assert.match(recovery, /captionOwnRegion && isPaperPdfConfig\(pipelineConfig\)/);
  assert.match(recovery, /fitPaperTextToBox\(translatedText/);
  assert.match(recovery, /!candidateFitted\.overflow && !candidateFitted\.hardOverflow/);
  assert.match(recovery, /captionOwnRegionPaddingReduced = true/);
  assert.doesNotMatch(recovery, /maskApplied|writeApplied|skipReason|layoutPlanValidationStatus/);

  const validationIndex = mainSource.indexOf('validatePaperLayoutWritePlanItem(');
  const commitIndex = mainSource.indexOf('const commitMasks = (visualBgBox) =>');
  assert.ok(validationIndex > 0 && commitIndex > validationIndex);
});
