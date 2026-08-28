const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');
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

function loadGeometryFunctions() {
  const context = vm.createContext({ crypto });
  vm.runInContext([
    'const PDF_IMAGE_GEOMETRY_SCHEMA_VERSION = "pdf-image-geometry-v1";',
    extractFunction(mainSource, 'makePdfImageGeometryArtifact'),
    extractFunction(mainSource, 'extractPdfImageGeometryArtifactsFromOperatorList'),
    extractFunction(mainSource, 'auditPdfImageGeometryPages'),
  ].join('\n'), context);
  return context;
}

test('operator-list geometry is the sole page-space image authority', () => {
  const context = loadGeometryFunctions();
  const OPS = {
    save: 10,
    restore: 11,
    transform: 12,
    paintImageXObject: 85,
    paintImageXObjectRepeat: 88,
  };
  const result = context.extractPdfImageGeometryArtifactsFromOperatorList({
    fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore, OPS.paintImageXObjectRepeat],
    argsArray: [[], [100, 0, 0, 50, 20, 30], ['img-a'], [], ['img-b', 10, 12, [5, 6, 25, 26]]],
  }, { width: 200, height: 300, transform: [1, 0, 0, -1, 0, 300] }, 3, { OPS });

  assert.equal(result.source, 'pdfjs-operator-list');
  assert.equal(result.artifacts.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(result.artifacts.map(({ x, y, width, height }) => ({ x, y, width, height })))), [
    { x: 20, y: 220, width: 100, height: 50 },
    { x: 5, y: 282, width: 10, height: 12 },
    { x: 25, y: 262, width: 10, height: 12 },
  ]);
});

test('authority audit rejects inferred or modified image geometry', () => {
  const context = loadGeometryFunctions();
  const valid = context.extractPdfImageGeometryArtifactsFromOperatorList({
    fnArray: [85], argsArray: [['img-a']],
  }, { width: 100, height: 100, transform: [1, 0, 0, -1, 0, 100] }, 1, { OPS: { paintImageXObject: 85 } });
  const page = {
    pageNumber: 1,
    imageRegions: valid.artifacts,
    imageGeometrySchemaVersion: valid.schemaVersion,
    imageGeometryCoordinateSpace: valid.coordinateSpace,
    imageGeometrySource: valid.source,
    imageGeometryHash: valid.pageGeometryHash,
  };
  assert.equal(context.auditPdfImageGeometryPages([page]).status, 'passed');

  const modified = JSON.parse(JSON.stringify(page));
  modified.imageRegions[0].source = 'caption-inferred';
  assert.equal(context.auditPdfImageGeometryPages([modified]).status, 'failed');
  assert.ok(context.auditPdfImageGeometryPages([modified]).violations.some(({ code }) => code === 'image_geometry_artifact_authority_invalid'));
  assert.ok(context.auditPdfImageGeometryPages([modified]).violations.some(({ code }) => code === 'image_geometry_page_hash_mismatch'));
});

test('production extraction and export contain no caption inference fallback', () => {
  const buildSource = extractFunction(mainSource, 'buildStructuredPdfText');
  const contextSource = extractFunction(mainSource, 'inferPaperPageContextsFromSegments');
  assert.doesNotMatch(buildSource, /detectImageRegionsForPaperPage|inferImageRegionsForPage|applyBodySegmentImageRegionCounterProof/);
  assert.doesNotMatch(contextSource, /inferImageRegionsForPage/);
  assert.match(buildSource, /imageGeometryByPage\.get\(pageNumber\)/);
  assert.match(mainSource, /PDF_IMAGE_GEOMETRY_ARTIFACT_INVALID/);
});
