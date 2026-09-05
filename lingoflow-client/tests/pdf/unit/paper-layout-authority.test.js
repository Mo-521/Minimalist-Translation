const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const authority = require(path.join(root, 'electron-app/paper-layout-authority'));

function sourceSizes(segment) {
  return (segment.lineBoxes || []).map((line) => Number(line.fontSize || 0)).filter(Boolean);
}

test('document authority preserves the existing dynamic visual-equal font scale', () => {
  const context = authority.buildPaperLayoutAuthorityContext({
    zhFontPath: 'C:/Windows/Fonts/simhei.ttf',
    collectSourceFontSizes: sourceSizes,
    segments: [
      { type: 'body', lineBoxes: [{ fontSize: 10 }, { fontSize: 10 }] },
      { type: 'caption', lineBoxes: [{ fontSize: 8 }] },
      { type: 'heading', lineBoxes: [{ fontSize: 12 }] },
      { type: 'title', lineBoxes: [{ fontSize: 16 }] },
      { type: 'metadata', lineBoxes: [{ fontSize: 7 }] },
    ],
  });
  assert.equal(context.authorityVersion, 'paper-layout-authority/v1');
  assert.equal(context.zhFontVisualScale, 0.85);
  assert.deepEqual(context.scale, {
    title: 13.5, heading: 10, body: 8.5, abstract: 8.5, keywords: 8.5,
    caption: 7, affiliation: 6.5, funding: 6.5, receivedDate: 6.5,
    correspondence: 6.5, metadata: 6.5, fallback: 8.5,
  });
});

test('one segment authority owns kind style font spacing alignment padding and overflow policy', () => {
  const documentAuthority = authority.buildPaperLayoutAuthorityContext({
    zhFontPath: 'C:/Windows/Fonts/simhei.ttf',
    collectSourceFontSizes: sourceSizes,
    segments: [{ type: 'body', lineBoxes: [{ fontSize: 10 }] }],
  });
  const segment = { type: 'body', sourceText: 'Source', translatedText: '中文正文' };
  const resolved = authority.resolvePaperLayoutAuthority({
    segment,
    lineMasks: [{}, {}, {}],
    averageFontSize: 10,
    targetLanguage: 'zh',
    pageBodyMedianFontSize: 10,
    visualEqualZhFontSizeScale: documentAuthority,
    text: segment.translatedText,
    fontStats: { sourceFontSizeRatioToPageBody: 1, sourceBoldLike: false },
  });
  assert.equal(resolved.kind, 'body');
  assert.equal(resolved.alignment, 'left');
  assert.equal(resolved.typography.initialFontSize, 8.5);
  assert.equal(resolved.typography.minimumFontSize, 8);
  assert.equal(resolved.typography.maximumFontSize, 8.5);
  assert.equal(resolved.typography.paragraphSpacingMultiplier, 0.35);
  assert.equal(resolved.overflow.allowFontShrink, true);
  assert.deepEqual(resolved.padding.candidates, [2]);
  assert.deepEqual(resolved.metricsForFontSize(8.5, segment.translatedText), {
    fontSize: 8.5,
    lineHeight: 10.54,
    paragraphSpacing: 2.9749999999999996,
  });
});

test('caption authority preserves fixed size and bounded own-region padding behavior', () => {
  const resolved = authority.resolvePaperLayoutAuthority({
    segment: { type: 'caption', sourceText: 'Figure 1', translatedText: '图 1' },
    lineMasks: [{}],
    averageFontSize: 8,
    targetLanguage: 'zh',
    visualEqualZhFontSizeScale: { scale: { caption: 7.5, fallback: 8.5 } },
    pageBodyMedianFontSize: 10,
    text: '图 1',
    fontStats: { sourceFontSizeRatioToPageBody: 0.8, sourceBoldLike: false },
  });
  assert.equal(resolved.kind, 'caption');
  assert.equal(resolved.typography.initialFontSize, 7.5);
  assert.equal(resolved.typography.minimumFontSize, 7.5);
  assert.equal(resolved.overflow.allowFontShrink, false);
  assert.equal(resolved.overflow.captionOwnRegionOnly, true);
  assert.deepEqual(resolved.padding.candidates, [2, 1.5, 1]);
});

test('write kind consumes canonical semantic type and never guesses from text', () => {
  assert.equal(authority.resolveWriteKind({ type: 'body', sourceText: 'Abstract', translatedText: '摘要' }, [{}]), 'body');
  assert.equal(authority.resolveWriteKind({ semanticType: 'keywords', type: 'body', sourceText: 'Body prose' }, [{}]), 'keywords');
  assert.throws(
    () => authority.resolveWriteKind({ sourceText: 'Abstract', translatedText: '摘要' }, [{}]),
    (error) => error && error.code === 'LAYOUT_SEMANTIC_TYPE_REQUIRED'
  );
  assert.throws(
    () => authority.resolveWriteKind({ type: 'formula', sourceText: 'x = 1' }, [{}]),
    (error) => error && error.code === 'LAYOUT_SEMANTIC_TYPE_NOT_WRITABLE'
  );
});

test('authority decisions are input-driven and do not contain sample identities', () => {
  const source = require('node:fs').readFileSync(path.join(root, 'electron-app/paper-layout-authority.js'), 'utf8');
  assert.doesNotMatch(source, /seg-\d+|论文样本|pageNumber\s*===|fileName/);
  const small = authority.buildPaperLayoutAuthorityContext({
    zhFontPath: 'simhei.ttf', collectSourceFontSizes: sourceSizes,
    segments: [{ type: 'body', lineBoxes: [{ fontSize: 8 }] }],
  });
  const large = authority.buildPaperLayoutAuthorityContext({
    zhFontPath: 'simhei.ttf', collectSourceFontSizes: sourceSizes,
    segments: [{ type: 'body', lineBoxes: [{ fontSize: 12 }] }],
  });
  assert.notEqual(small.computedZhBodyFontSize, large.computedZhBodyFontSize);
});

test('main production path consumes one resolved authority object for fit retries', () => {
  const source = require('node:fs').readFileSync(path.join(root, 'electron-app/main.js'), 'utf8');
  assert.match(source, /const layoutAuthority = paperLayoutAuthority\.resolvePaperLayoutAuthority\(/);
  assert.match(source, /const kind = layoutAuthority\.kind;/);
  assert.match(source, /const style = layoutAuthority\.style;/);
  assert.match(source, /layoutAuthority\.padding\.candidates\.slice\(1\)/);
  assert.match(source, /options\.layoutAuthority \|\| paperLayoutAuthority\.resolvePaperLayoutAuthority\(/);
  assert.doesNotMatch(source, /const FONT_SHRINK_FLOOR = 8\.0/);
  const authorityStart = source.indexOf('const layoutAuthority = paperLayoutAuthority.resolvePaperLayoutAuthority(');
  const finalDisplayTextStart = source.indexOf('let translatedText = _paragraphRunTextSegments.length > 1', authorityStart);
  assert.ok(authorityStart > 0 && finalDisplayTextStart > authorityStart);
  assert.doesNotMatch(source.slice(authorityStart, finalDisplayTextStart), /text:\s*translatedText/);
  assert.match(source.slice(authorityStart, finalDisplayTextStart), /text:\s*String\(segment && segment\.translatedText \|\| ""\)/);
});
