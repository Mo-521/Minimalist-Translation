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
  const bodyStart = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unable to extract ${name}`);
}

function loadColumnFlowPlanner(safeSpans = null, overlapArea = 0) {
  const configuredSafeSpans = safeSpans || [{ id: '1:left:safe', x: 40, y: 60, width: 240, height: 600 }];
  const context = vm.createContext({
    Number,
    String,
    Boolean,
    Map,
    Set,
    Array,
    Math,
    getPaperColumnFlowSegmentIds: (op) => (op.meta.groupSegmentIds || [op.meta.segmentId]).map(String),
    getPaperColumnFlowEstimatedHeight: (op) => Number(op.meta.renderedHeight || op.meta.writeBox.height || 0),
    paperColumnFlowBoxesOverlap: () => false,
    getPaperColumnFlowBlockingBoxes: () => [],
    paperColumnFlowHasUnsafeGroupMember: () => false,
    paperColumnFlowSourceSignature: (item) => (item.segmentIds || []).join('|'),
    getPaperColumnFlowSafeSpans: () => configuredSafeSpans.map((span) => ({ ...span })),
    computeLayoutPlanBoxOverlapArea: () => overlapArea,
  });
  vm.runInContext(extractFunction(mainSource, 'paperColumnFlowHasSharedSourceIdentity'), context);
  vm.runInContext(extractFunction(mainSource, 'buildPaperColumnFlowPlan'), context);
  return context.buildPaperColumnFlowPlan;
}

function loadPaperTextWrapper() {
  const context = vm.createContext({
    String,
    Array,
    RegExp,
    normalizeFormulaToken: (value) => String(value || ''),
    isPaperFormulaWrapToken: () => false,
    splitLongToken: (token) => [token],
  });
  vm.runInContext(extractFunction(mainSource, 'cleanPdfText'), context);
  vm.runInContext(extractFunction(mainSource, 'tokenizePaperWrapText'), context);
  vm.runInContext(extractFunction(mainSource, 'wrapTranslatedTextForPaperBox'), context);
  return context.wrapTranslatedTextForPaperBox;
}

test('paragraph visual boundary prefix survives wrapping only on the first rendered line', () => {
  const wrap = loadPaperTextWrapper();
  const font = { widthOfTextAtSize: (value, size) => Array.from(String(value || '')).length * size };
  const indented = wrap('甲乙丙丁戊己庚辛', font, 10, 50, { firstLinePrefix: '\u3000\u3000' });
  const plain = wrap('甲乙丙丁戊己庚辛', font, 10, 50);

  assert.equal(indented[0].startsWith('\u3000\u3000'), true);
  assert.equal(indented.slice(1).some((line) => line.startsWith('\u3000')), false);
  assert.equal(plain[0].startsWith('\u3000'), false);
});

test('paragraph runs participate in the existing column flow authority', () => {
  const buildPlan = loadColumnFlowPlanner();
  const op = {
    opType: 'write',
    meta: {
      writeKind: 'paragraphRun',
      segmentId: 'generic-body',
      groupSegmentIds: ['generic-body'],
      pageNumber: 1,
      column: 'left',
      type: 'body',
      renderedHeight: 80,
      writeBox: { x: 40, y: 300, width: 240, height: 180 },
    },
  };
  const reportById = new Map([['generic-body', { id: 'generic-body', type: 'body' }]]);
  const plan = buildPlan([op], { reportById });

  assert.equal(plan.items[0].columnFlowCandidate, true);
  assert.equal(plan.items[0].flowApplied, true);
  assert.equal(plan.items[0].flowSkipReason, '');
  assert.equal(plan.items[0].flowWriteBox.y, 300);
  assert.equal(plan.items[0].flowWriteBox.height, 80);
  assert.equal(plan.items[0].positionAnchorApplied, true);
  assert.equal(plan.items[0].positionAnchorDisplacementY, 0);
});

test('independent paragraph runs preserve a visible authority-derived boundary in column flow', () => {
  const buildPlan = loadColumnFlowPlanner();
  const makeOp = (id, y) => ({
    opType: 'write',
    meta: {
      writeKind: 'paragraphRun',
      paragraphRunId: `run-${id}`,
      segmentId: id,
      groupSegmentIds: [id],
      pageNumber: 1,
      column: 'left',
      type: 'body',
      renderedHeight: 40,
      writeBox: { x: 40, y, width: 240, height: 80 },
    },
  });
  const first = makeOp('paragraph-a', 100);
  const second = makeOp('paragraph-b', 220);
  const reportById = new Map([
    ['paragraph-a', { id: 'paragraph-a', type: 'body', finalLineHeight: 12 }],
    ['paragraph-b', { id: 'paragraph-b', type: 'body', finalLineHeight: 10 }],
  ]);
  const plan = buildPlan([first, second], { reportById });

  assert.equal(plan.items[0].flowWriteBox.y, 100);
  assert.equal(plan.items[0].paragraphBoundaryGapAfter, 9);
  assert.equal(plan.items[0].paragraphBoundaryGapSource, 'layout_authority_final_line_height');
  assert.equal(plan.items[1].flowWriteBox.y, 220);
});

test('source anchor moves forward only by the occupied paragraph boundary', () => {
  const buildPlan = loadColumnFlowPlanner();
  const makeOp = (id, y, height) => ({
    opType: 'write',
    meta: {
      writeKind: 'paragraphRun', paragraphRunId: `run-${id}`, segmentId: id,
      groupSegmentIds: [id], pageNumber: 1, column: 'left', type: 'body',
      renderedHeight: height, writeBox: { x: 40, y, width: 240, height },
    },
  });
  const first = makeOp('paragraph-a', 100, 80);
  const second = makeOp('paragraph-b', 150, 40);
  const reportById = new Map([
    ['paragraph-a', { id: 'paragraph-a', type: 'body', finalLineHeight: 12 }],
    ['paragraph-b', { id: 'paragraph-b', type: 'body', finalLineHeight: 12 }],
  ]);
  const plan = buildPlan([first, second], { reportById });

  assert.equal(plan.items[0].flowWriteBox.y, 100);
  assert.equal(plan.items[1].flowWriteBox.y, 189);
  assert.equal(plan.items[1].positionAnchorDisplacementY, 39);
});

test('source anchor selects the containing later safe span without backward relocation', () => {
  const buildPlan = loadColumnFlowPlanner([
    { id: 'upper', x: 40, y: 60, width: 240, height: 100 },
    { id: 'lower', x: 40, y: 260, width: 240, height: 240 },
  ]);
  const op = {
    opType: 'write',
    meta: {
      writeKind: 'paragraphRun', paragraphRunId: 'run-lower', segmentId: 'paragraph-lower',
      groupSegmentIds: ['paragraph-lower'], pageNumber: 1, column: 'left', type: 'body',
      renderedHeight: 50, writeBox: { x: 40, y: 300, width: 240, height: 80 },
    },
  };
  const plan = buildPlan([op], { reportById: new Map([['paragraph-lower', { finalLineHeight: 12 }]]) });

  assert.equal(plan.items[0].safeSpanId, 'lower');
  assert.equal(plan.items[0].flowWriteBox.y, 300);
  assert.equal(plan.items[0].positionAnchorDisplacementY, 0);
});

test('formula-owning flow item retains post-equation capacity from its real source extent', () => {
  const context = vm.createContext({
    Number, String, Boolean, Map, Set, Array, Math,
    medianNumber: (values, fallback) => values.length ? values[0] : fallback,
    normalizePdfLineBoxes: (segment) => segment.lineBoxes || [],
    isFormulaProtectedLineBox: (line) => Boolean(line && line.formulaProtected),
    getFormulaProtectedLineBoxes: (segment) => (segment.lineBoxes || []).filter((line) => line.formulaProtected),
    getPaperColumnFlowBlockingBoxes: () => [],
    paperColumnFlowBoxesOverlap: () => false,
  });
  vm.runInContext(extractFunction(mainSource, 'getPaperColumnFlowSafeSpans'), context);
  const item = {
    pageNumber: 1, column: 'left', segmentIds: ['formula-prose'],
    originalWriteBox: { x: 40, y: 100, width: 240, height: 80 },
  };
  const segment = {
    id: 'formula-prose', bbox: { x: 40, y: 100, width: 240, height: 200 },
    lineBoxes: [{ x: 80, y: 150, width: 120, height: 18, formulaProtected: true }],
  };
  const spans = context.getPaperColumnFlowSafeSpans(1, 'left', {
    candidatesByKey: new Map([['1:left', [item]]]),
    allSegments: [segment], pipelineConfig: { mode: 'paper_pdf' },
  });

  assert.equal(spans.length, 1);
  assert.equal(spans[0].y + spans[0].height, 300);
});

test('scientific object blocker reserves the full column and following equation-number baseline', () => {
  const context = vm.createContext({ Number, Math });
  context.makeRawSourceGlyphMaskBox = (line) => ({ x: line.x - 1, y: line.y - 8, width: line.width + 2, height: 11 });
  vm.runInContext(extractFunction(mainSource, 'makeFormulaScientificObjectBlockingBox'), context);
  const blocker = context.makeFormulaScientificObjectBlockingBox(
    { x: 120, y: 150, width: 130, height: 10, fontSize: 10 },
    { x: 40, y: 60, width: 240, height: 400 },
  );

  assert.equal(blocker.x, 40);
  assert.equal(blocker.width, 240);
  assert.equal(blocker.y, 142);
  assert.equal(blocker.height, 27);
  assert.ok(blocker.y + blocker.height > 160, 'equation number baseline must remain protected');
});

test('unsupported write owners remain excluded from column flow', () => {
  const buildPlan = loadColumnFlowPlanner();
  const op = {
    opType: 'write',
    meta: {
      writeKind: 'captionGroupUnified',
      segmentId: 'generic-caption',
      pageNumber: 1,
      column: 'left',
      type: 'body',
      writeBox: { x: 40, y: 300, width: 240, height: 80 },
    },
  };
  const plan = buildPlan([op], { reportById: new Map() });

  assert.equal(plan.items[0].columnFlowCandidate, false);
  assert.equal(plan.items[0].flowSkipReason, 'not_flow_write');
});

test('paragraph run remains canonical when a legacy member write reaches flow first', () => {
  const buildPlan = loadColumnFlowPlanner();
  const shared = {
    segmentId: 'generic-body', pageNumber: 1, column: 'left', type: 'body', renderedHeight: 80,
    writeBox: { x: 40, y: 200, width: 240, height: 100 },
  };
  const memberWrite = { opType: 'write', meta: { ...shared, writeKind: 'segment' } };
  const paragraphWrite = {
    opType: 'write',
    meta: { ...shared, writeKind: 'paragraphRun', paragraphRunId: 'generic-run', memberSegmentIds: ['generic-body'] },
  };
  const reportById = new Map([['generic-body', { id: 'generic-body', type: 'body', paragraphRunId: 'generic-run' }]]);
  const plan = buildPlan([memberWrite, paragraphWrite], { reportById });
  const memberItem = plan.items.find((item) => item.op === memberWrite);
  const paragraphItem = plan.items.find((item) => item.op === paragraphWrite);

  assert.equal(paragraphItem.flowApplied, true);
  assert.equal(paragraphItem.flowSkipReason, '');
  assert.equal(memberItem.flowApplied, false);
  assert.equal(memberItem.flowSkipReason, 'source_overlap_duplicate');
  assert.equal(memberItem.canonicalItem, paragraphItem);
});

test('geometrically touching heading and paragraph remain independent source owners', () => {
  const buildPlan = loadColumnFlowPlanner(null, 20);
  const heading = {
    opType: 'write',
    meta: {
      writeKind: 'segment', segmentId: 'heading-owner', pageNumber: 1, column: 'left', type: 'heading',
      renderedHeight: 24, writeBox: { x: 40, y: 180, width: 240, height: 30 },
    },
  };
  const paragraph = {
    opType: 'write',
    meta: {
      writeKind: 'paragraphRun', segmentId: 'body-owner', groupSegmentIds: ['body-owner'],
      pageNumber: 1, column: 'left', type: 'body', renderedHeight: 50,
      writeBox: { x: 40, y: 205, width: 240, height: 70 },
    },
  };
  const reports = new Map([
    ['heading-owner', { id: 'heading-owner', type: 'heading', sourceText: '2. Methods' }],
    ['body-owner', { id: 'body-owner', type: 'body', sourceText: 'The experiment begins here.' }],
  ]);
  const plan = buildPlan([heading, paragraph], { reportById: reports });
  const headingItem = plan.items.find((item) => item.op === heading);
  const paragraphItem = plan.items.find((item) => item.op === paragraph);

  assert.equal(headingItem.flowSkipReason, '');
  assert.equal(paragraphItem.flowSkipReason, '');
  assert.equal(headingItem.flowApplied, true);
  assert.equal(paragraphItem.flowApplied, true);
});

test('execution audit matches a plan to canonical background geometry, not duplicate insertion order', () => {
  const context = vm.createContext({ Number, String, Boolean, Map, Set, Array, Math });
  vm.runInContext(extractFunction(mainSource, 'buildPaperExecutionConsistencyAudit'), context);
  const canonical = { x: 40, y: 80, width: 240, height: 90 };
  const stale = { x: 40, y: 240, width: 240, height: 160 };
  const maskOps = [
    { meta: { segmentId: 'generic-body', maskKind: 'writeBackground', writeBackgroundBox: stale } },
    {
      meta: {
        segmentId: 'generic-run-owner',
        groupSegmentIds: ['generic-run-owner', 'generic-body'],
        memberSegmentIds: ['generic-body'],
        maskKind: 'writeBackground',
        writeBackgroundBox: canonical,
      },
    },
    { meta: { segmentId: 'generic-body', maskKind: 'sourceCover' } },
  ];
  const writeOps = [{ opType: 'write', meta: { segmentId: 'generic-body', finalWriteBox: canonical } }];
  const layoutItems = [{
    segmentId: 'generic-body', segmentIds: ['generic-body'], writeDecision: 'write',
    finalWriteBox: canonical, maskBoxes: [canonical],
  }];

  const audit = context.buildPaperExecutionConsistencyAudit(maskOps, writeOps, layoutItems);
  assert.equal(audit.paperMaskBoxChangedDuringExecutionCount, 0);

  const realDrift = context.buildPaperExecutionConsistencyAudit(maskOps.slice(0, 1), writeOps, layoutItems);
  assert.equal(realDrift.paperMaskBoxChangedDuringExecutionCount, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(realDrift.paperMaskBoxChangedDetails)), [{
    segmentId: 'generic-body',
    segmentIds: ['generic-body'],
    pageNumber: 0,
    writeKind: '',
    paragraphRunId: '',
    planMaskBox: canonical,
    execMaskBox: stale,
    dx: 0,
    dy: 160,
    dw: 0,
    dh: 70,
    maskOwnerSegmentId: 'generic-body',
    maskOwnerGroupSegmentIds: [],
    maskReason: '',
  }]);
});

test('execution audit uses post-collision write background authority instead of stale derived mask array', () => {
  const context = vm.createContext({ Number, String, Boolean, Map, Set, Array, Math });
  vm.runInContext(extractFunction(mainSource, 'buildPaperExecutionConsistencyAudit'), context);
  const beforePushdown = { x: 40, y: 80, width: 240, height: 90 };
  const afterPushdown = { ...beforePushdown, y: 130 };
  const maskOps = [{
    meta: {
      segmentId: 'generic-body',
      groupSegmentIds: ['generic-body'],
      maskKind: 'writeBackground',
      writeBackgroundBox: afterPushdown,
      reason: 'final_write_background_mask',
    },
  }];
  const writeOps = [{ opType: 'write', meta: { segmentId: 'generic-body', finalWriteBox: afterPushdown } }];
  const layoutItems = [{
    segmentId: 'generic-body', segmentIds: ['generic-body'], writeDecision: 'write',
    finalWriteBox: afterPushdown,
    writeBackgroundBox: afterPushdown,
    maskBoxes: [beforePushdown],
  }];

  const audit = context.buildPaperExecutionConsistencyAudit(maskOps, writeOps, layoutItems);
  assert.equal(audit.paperMaskBoxChangedDuringExecutionCount, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(audit.paperMaskBoxChangedDetails)), []);
});

test('layout-to-mask synchronization treats height-only geometry changes as real changes', () => {
  const context = vm.createContext({ Number, Boolean, Math });
  vm.runInContext(extractFunction(mainSource, 'paperLayoutBoxesDiffer'), context);

  const before = { x: 40, y: 80, width: 240, height: 120 };
  assert.equal(context.paperLayoutBoxesDiffer(before, { ...before, height: 90 }, 1), true);
  assert.equal(context.paperLayoutBoxesDiffer(before, { ...before, y: 80.5, height: 120.5 }, 1), false);

  const syncBlock = mainSource.slice(
    mainSource.indexOf('// Sync pushdown-adjusted positions from layoutPlan back to write/mask ops.'),
    mainSource.indexOf('// ── Primary writer ownership resolution', mainSource.indexOf('// Sync pushdown-adjusted positions from layoutPlan back to write/mask ops.'))
  );
  assert.match(syncBlock, /paperLayoutBoxesDiffer\(item\.writeBackgroundBox, opWbBox, 1\)/);
  assert.match(syncBlock, /finalWriteBox:\s*\{ \.\.\.\(item\.finalWriteBox \|\| item\.writeBackgroundBox\) \}/);
});
