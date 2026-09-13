const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../../electron-app/main.js'), 'utf8');
const code = source.slice(source.indexOf('async function exportPdfAtCurrentProgress('), source.indexOf('async function exportTranslatedPdf('));

function harness(overrides = {}) {
  const writes = new Map();
  let calls = 0;
  const context = vm.createContext({
    JSON, Date, Buffer, path,
    fs: { existsSync: (p) => p === '/source.pdf' || writes.has(p), mkdirSync() {}, writeFileSync: (p, data) => writes.set(p, data), unlinkSync: (p) => writes.delete(p) },
    process: { env: { PDF_EXPORT_OUTPUT_PATH: '/output.pdf' } },
    app: { getPath: (name) => name === 'userData' ? '/app-data' : '/' }, BrowserWindow: { getFocusedWindow: () => null },
    dialog: { showSaveDialog: async () => ({ canceled: true }) }, safeTxtBaseName: () => 'sample',
    readSharedConfig: () => ({ developerMode: false }), getDeveloperDiagnosticsDirectory: () => '/app-data/diagnostics',
    makeDeveloperDiagnosticBaseName: () => 'sample_run', console,
    exportTranslatedPdf: async (_payload, output) => { calls += 1; return { ok: true, exportGenerated: true, filePath: output }; },
    ...overrides,
  });
  vm.runInContext(code, context);
  return { run: (p) => context.exportPdfAtCurrentProgress(p), writes, calls: () => calls };
}

const payload = () => ({ fileName: 'sample.pdf', filePath: '/source.pdf', pdfTranslationMode: 'paper_pdf', allSegments: [
  { id: 'a', pageNumber: 1, status: 'done', sourceText: 'SOURCE', translatedText: '译文' },
  { id: 'b', pageNumber: 1, status: 'failed', sourceText: 'ORIGINAL', translatedText: '' },
] });

test('standard export uses one normal PDF path and creates no diagnostics', async () => {
  const h = harness(); const r = await h.run(payload());
  assert.equal(r.ok, true); assert.equal(r.exportGenerated, true); assert.equal(r.filePath, '/output.pdf');
  assert.equal(r.snapshotPath, undefined); assert.equal(r.textPath, undefined);
  assert.equal(r.segmentReportsPath, undefined); assert.equal(r.pipelineDebugPath, undefined); assert.equal(h.writes.size, 0);
});

test('developer diagnostics is globally gated and writes evidence under diagnostics', async () => {
  const denied = harness();
  assert.equal((await denied.run({ ...payload(), developerDiagnosticsRequested: true })).error, 'developer_mode_required');
  assert.equal(denied.calls(), 0);
  const h = harness({ readSharedConfig: () => ({ developerMode: true }) });
  const r = await h.run({ ...payload(), developerDiagnosticsRequested: true });
  assert.equal(r.ok, true); assert.match(r.filePath.replace(/\\/g, '/'), /\/app-data\/diagnostics\/sample_run\.pdf$/);
  assert.match(r.snapshotPath.replace(/\\/g, '/'), /\/app-data\/diagnostics\/sample_run\.snapshot\.json$/);
  assert.match(r.textPath.replace(/\\/g, '/'), /\/app-data\/diagnostics\/sample_run\.translations\.txt$/);
  assert.ok(h.writes.has(r.snapshotPath)); assert.ok(h.writes.has(r.textPath));
  assert.match(String(h.writes.get(r.textPath)), /译文/); assert.match(String(h.writes.get(r.textPath)), /ORIGINAL/);
});

test('cancel writes nothing and invokes no exporter', async () => {
  const h = harness({ process: { env: {} } });
  assert.equal((await h.run(payload())).canceled, true); assert.equal(h.writes.size, 0); assert.equal(h.calls(), 0);
});

test('original PDF output path is rejected before writes', async () => {
  const h = harness({ process: { env: { PDF_EXPORT_OUTPUT_PATH: '/source.pdf' } } });
  assert.equal((await h.run(payload())).ok, false); assert.equal(h.writes.size, 0);
});

test('exporter failure never creates a preserved, appendix, or debug PDF', async () => {
  const h = harness({ exportTranslatedPdf: async () => { throw new Error('layout crashed'); } });
  const r = await h.run(payload());
  assert.equal(r.ok, false); assert.equal(r.exportGenerated, false);
  assert.equal([...h.writes.keys()].some((p) => /preserved|appendix|debugFail/i.test(p)), false);
});

test('developer diagnostics records an exporter exception instead of leaving only pre-export evidence', async () => {
  const h = harness({
    readSharedConfig: () => ({ developerMode: true }),
    exportTranslatedPdf: async () => { throw Object.assign(new Error('font draw crashed'), { code: 'FONT_DRAW_FAILED' }); },
  });
  const r = await h.run({ ...payload(), developerDiagnosticsRequested: true });
  assert.equal(r.ok, false);
  assert.match(r.exportFailurePath.replace(/\\/g, '/'), /\/app-data\/diagnostics\/sample_run\.exportFailure\.json$/);
  const evidence = JSON.parse(String(h.writes.get(r.exportFailurePath)));
  assert.equal(evidence.stage, 'exportTranslatedPdf.exception');
  assert.equal(evidence.error.code, 'FONT_DRAW_FAILED');
  assert.match(evidence.error.message, /font draw crashed/);
});

test('CJK font capability probe draws and saves before a candidate is accepted', () => {
  const probeStart = source.indexOf('async function canDrawWithCjkFont(');
  const probeEnd = source.indexOf('async function loadCjkFontLegacyUnused(', probeStart);
  const probe = source.slice(probeStart, probeEnd);
  assert.match(probe, /embedFont\([^\n]+\{ subset \}\)/);
  assert.match(probe, /probePage\.drawText\("中文字体测试"/);
  assert.match(probe, /await probeDoc\.save\(\)/);

  const loaderStart = source.indexOf('async function loadCjkFont(pdfDoc)');
  const loaderEnd = source.indexOf('function cleanPdfText(', loaderStart);
  const loader = source.slice(loaderStart, loaderEnd);
  assert.match(loader, /await canDrawWithCjkFont\(fontPath, true\)/);
  assert.match(loader, /await canDrawWithCjkFont\(fontPath, false\)/);
  assert.doesNotMatch(loader, /probeDoc\.embedFont/);
});

test('standard successful export removes accidental audit sidecars from user directory', async () => {
  const h = harness({ exportTranslatedPdf: async (_p, output) => {
    h.writes.set('/output.segmentReports.json', '{}'); h.writes.set('/output.pipelineDebug.json', '{}');
    return { ok: true, exportGenerated: true, filePath: output, segmentReportsPath: '/output.segmentReports.json', pipelineDebugPath: '/output.pipelineDebug.json' };
  } });
  const r = await h.run(payload());
  assert.equal(r.ok, true); assert.equal(r.segmentReportsPath, undefined); assert.equal(r.pipelineDebugPath, undefined); assert.equal(h.writes.size, 0);
});

test('IPC uses saving boundary and renderer export cannot trigger translation', () => {
  assert.match(source, /ipcMain.handle\("pdf:export-translated-pdf", \(_event, payload\) => exportPdfAtCurrentProgress\(payload\)\)/);
  const renderer = fs.readFileSync(path.resolve(__dirname, '../../../electron-app/renderer.js'), 'utf8');
  const handler = renderer.slice(renderer.indexOf('async function exportPdfTranslationByFormat('), renderer.indexOf('function getPdfTranslateProgressText('));
  assert.doesNotMatch(handler, /startPdfSegmentTranslation\(/); assert.match(handler, /developerDiagnosticsRequested: isDeveloperDiagnostics/);
});

test('legacy diagnostic PDF exporters and IPC paths stay retired', () => {
  const renderer = fs.readFileSync(path.resolve(__dirname, '../../../electron-app/renderer.js'), 'utf8');
  for (const token of [
    'exportPdfDebugBbox', 'exportPdfMaskTest', 'exportPdfDebugLineBox',
    'exportPdfDebugMaskArea', 'exportPdfMaskLineBoxTest',
    'pdf:export-debug-bbox', 'pdf:export-mask-test', 'pdf:export-debug-linebox',
    'pdf:export-debug-mask-area', 'pdf:export-mask-linebox-test',
    '_debug_bbox.pdf', '_mask_test.pdf', '_debug_linebox.pdf',
    '_debug_mask_area.pdf', '_mask_linebox_test.pdf',
  ]) {
    assert.doesNotMatch(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(renderer, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
