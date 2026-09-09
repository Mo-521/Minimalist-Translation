const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');
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

function makeSegment(taggedPage, realPage, text = 'source') {
  return {
    pageNumber: taggedPage,
    sourceText: text,
    lines: [{ pageNumber: realPage, text }],
    lineBoxes: [{ pageNumber: realPage, x: 10, y: 10, width: 40, height: 8, text }],
    items: [],
  };
}

function loadContract() {
  const context = vm.createContext({ Array, Number, Set });
  vm.runInContext([
    extractFunction(mainSource, 'finalizePaperSourcePageAuthority'),
    extractFunction(mainSource, 'finalizePaperSourceMergeContract'),
  ].join('\n'), context);
  return context;
}

test('real line geometry finalizes a stale segment page tag before merge authorization', () => {
  const context = loadContract();
  const left = makeSegment(2, 3, 'left');
  const right = makeSegment(2, 3, 'right');
  const result = context.finalizePaperSourceMergeContract(left, right);

  assert.equal(result.status, 'ok');
  assert.equal(result.sourcePage, 3);
  assert.equal(left.pageNumber, 3);
  assert.equal(right.pageNumber, 3);
  assert.equal(left.sourcePageFinalizedBy, 'line_lineBox_geometry');
});

test('matching stale tags cannot authorize a merge across different real source pages', () => {
  const context = loadContract();
  const pageTwo = makeSegment(2, 2, 'ends-with-');
  const pageThree = makeSegment(2, 3, 'continuation');
  const result = context.finalizePaperSourceMergeContract(pageTwo, pageThree);

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'source_page_authority_mismatch');
  assert.equal(pageTwo.pageNumber, 2);
  assert.equal(pageThree.pageNumber, 3);
});

test('mixed line and lineBox ownership is rejected instead of falling back to segment.pageNumber', () => {
  const context = loadContract();
  const mixed = makeSegment(2, 2, 'mixed');
  mixed.lineBoxes.push({ pageNumber: 3, x: 10, y: 20, width: 40, height: 8, text: 'page three' });
  const peer = makeSegment(2, 2, 'peer');
  const result = context.finalizePaperSourceMergeContract(mixed, peer);

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'source_page_authority_not_unique');
  assert.equal(result.baseAuthority.status, 'conflict');
  assert.deepEqual(Array.from(result.baseAuthority.evidencePages.realPages), [2, 3]);
});

test('source merge entry points are guarded and rejected merges preserve incoming objects', () => {
  const genericMerge = extractFunction(mainSource, 'mergeSegments');
  const danglingMerge = extractFunction(mainSource, 'canMergePaperDanglingHyphenSegments');
  const headingFlow = extractFunction(mainSource, 'applyHeadingContinuationMerges');
  const bodyFlow = extractFunction(mainSource, 'applyBodyContinuationMerges');
  const captionFlow = extractFunction(mainSource, 'applyCaptionFragmentMerges');
  const inlineMerge = extractFunction(mainSource, 'mergeInlineFigureReferenceCaptionIntoBody');
  const paragraphMerge = extractFunction(mainSource, 'splitAndMergeParagraphs');

  assert.match(genericMerge, /finalizePaperSourceMergeContract\(base, incoming\)/);
  assert.match(genericMerge, /status !== 'ok'\) return null/);
  assert.match(danglingMerge, /finalizePaperSourceMergeContract\(previous, next\)/);
  assert.match(headingFlow, /const merged = mergeSegments\([\s\S]+?if \(merged\)/);
  assert.match(bodyFlow, /const merged = mergeSegments\([\s\S]+?if \(merged\)/);
  assert.match(captionFlow, /const merged = mergeSegments\([\s\S]+?if \(merged\)/);
  assert.doesNotMatch(mainSource, /function mergeSimpleCrossPageParagraphs\(/);
  assert.match(inlineMerge, /finalizePaperSourceMergeContract\(body, caption\)/);
  assert.match(paragraphMerge, /finalizePaperSourceMergeContract\(previous, classifiedParagraph\)/);
  assert.doesNotMatch(mainSource, /function postProcessPdfParagraphs\(/);
  assert.doesNotMatch(mainSource, /function splitPageOneTopMatter\(/);
});

test('caption continuation recovery checks finalized page authority before consuming a member', () => {
  const recovery = extractFunction(mainSource, 'mergeImageAdjacentCaptionContinuations');
  assert.match(recovery, /finalizePaperSourceMergeContract\(segment, candidate\)\.status !== 'ok'/);
  assert.ok(
    recovery.indexOf('finalizePaperSourceMergeContract(segment, candidate)') < recovery.indexOf('members.push(candidate)'),
    'page finalization contract must run before the member is consumed'
  );
});
