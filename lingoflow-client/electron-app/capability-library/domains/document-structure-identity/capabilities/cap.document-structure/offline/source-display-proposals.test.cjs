"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { proposeDisplayBlocks, proposeEquationNumbers, proposeFusedNumberPartition,
  materializeFusedNumberPartition, buildDisplayCandidatePage } = require("./source-display-proposals.cjs");
const line = (id, text, x, y, width) => ({ id, text, column: "single", bbox: { x, y, width, height: 10 } });

test("proposes math without converting adjacent prose or printed number", () => {
  const page = { width: 600, lines: [
    line("a", "We now show the desired bound for all values of the parameter.", 70, 100, 460),
    line("b", "x = y + z", 225, 123, 120),
    line("c", "(3.1)", 520, 123, 34),
    line("d", "The next result follows by substitution.", 70, 146, 380)
  ] };
  assert.deepEqual(proposeDisplayBlocks(page), [{ anchorSourceLineId: "b", sourceLineIds: ["b"], evidence: "math_relation" }]);
  assert.deepEqual(proposeEquationNumbers(page, proposeDisplayBlocks(page)), { numbers: [
    { sourceLineId: "c", formulaAnchorSourceLineId: "b", evidence: "isolated_printed_label_near_display" }
  ], needsSplit: [] });
});

test("fails closed on ambiguous compact fragments and prose with inline math", () => {
  const page = { width: 600, lines: [
    line("a", "where x = y and z > 0 implies the result", 70, 100, 450),
    line("b", "x = y + z", 190, 122, 100),
    line("c", "u", 270, 135, 10),
    line("d", "x = z + y", 190, 146, 100),
    line("e", "This is the next sentence of the proof.", 70, 169, 400)
  ] };
  const proposals = proposeDisplayBlocks(page);
  assert.deepEqual(proposals.map(proposal => proposal.anchorSourceLineId), ["b", "d"]);
  assert.equal(proposals.some(proposal => proposal.sourceLineIds.includes("a") || proposal.sourceLineIds.includes("c")), false);
});

test("overlapping mathematical fraction member joins its row, while a between-row token remains unassigned", () => {
  const page = { width: 600, lines: [
    line("p", "The two equations are given below.", 70, 80, 430),
    { ...line("a", "∂T + ∇T = 1", 180, 110, 150), bbox: { x: 180, y: 110, width: 150, height: 18 } },
    line("m", "∂t", 186, 124, 16),
    line("u", "r", 260, 129, 6),
    { ...line("b", "V = r + t", 175, 145, 160), bbox: { x: 175, y: 145, width: 160, height: 18 } },
    line("n", "r", 220, 158, 6),
    line("q", "The proof continues after these equations.", 70, 180, 430)
  ] };
  assert.deepEqual(proposeDisplayBlocks(page).map(proposal => proposal.sourceLineIds),
    [["a", "m"], ["b", "n"]]);
});

test("isolated comparison can be a display while the same expression in prose is not", () => {
  const page = { width: 600, lines: [
    line("a", "The two branches can be described by the following bounds.", 70, 80, 440),
    line("b", "Q < 1", 280, 107, 45),
    line("c", "for one branch of the physical system under study.", 70, 137, 410),
    line("d", "The opposite outcome has a corresponding bound as well.", 70, 158, 440)
  ] };
  assert.deepEqual(proposeDisplayBlocks(page).map(proposal => proposal.anchorSourceLineId), ["b"]);
});

test("continuation evidence merges display rows but a printed number separates equations", () => {
  const continuous = { width: 600, lines: [
    line("p", "The following equality holds for the selected variables.", 70, 80, 430),
    line("a", "x_t = y_t +", 180, 110, 180),
    line("b", "= z_t + w_t", 185, 126, 175),
    line("q", "The proof continues in the next paragraph.", 70, 155, 430)
  ] };
  assert.deepEqual(proposeDisplayBlocks(continuous).map(proposal => proposal.sourceLineIds), [["a", "b"]]);
  const numbered = { ...continuous, lines: [...continuous.lines, line("n", "(2.1)", 500, 110, 35)] };
  assert.deepEqual(proposeDisplayBlocks(numbered).map(proposal => proposal.sourceLineIds), [["a"], ["b"]]);
});

test("math-dominant indented row with a connective is display, full-width inline prose stays body", () => {
  const page = { width: 600, lines: [
    line("p", "We derive the following pair of numerical limits from the argument.", 70, 80, 460),
    line("a", "lim inf_T→∞ N^0(T) ≥ 0.4 and lim inf_T→∞ N^1(T) ≥ 0.3", 145, 107, 330),
    line("b", "The result is therefore valid for all t ≥ 1 and x = y + z.", 70, 135, 455),
    line("q", "Further details are supplied in the next section of the paper.", 70, 155, 460)
  ] };
  assert.deepEqual(proposeDisplayBlocks(page).map(proposal => proposal.anchorSourceLineId), ["a"]);
});

test("requires source identity and page geometry", () => {
  assert.throws(() => proposeDisplayBlocks({ width: 0, lines: [] }), /page with width/);
  assert.throws(() => proposeDisplayBlocks({ width: 600, lines: [{ text: "x=y", bbox: {} }] }), /require IDs/);
  assert.throws(() => proposeDisplayBlocks({ width: 600, lines: [line("same", "x=y", 10, 10, 20),
    line("same", "a=b", 10, 20, 20)] }), /unique per page/);
});

test("fused formula/number requires a source split rather than duplicate ownership", () => {
  const page = { width: 600, lines: [
    line("a", "The result follows from the next expression.", 70, 90, 430),
    line("b", "x_t = y_t + z_t (2.4)", 210, 120, 220),
    line("c", "The next paragraph remains separate.", 70, 150, 380)
  ] };
  const proposals = proposeDisplayBlocks(page);
  assert.equal(proposals.length, 1);
  assert.deepEqual(proposeEquationNumbers(page, proposals), { numbers: [], needsSplit: [
    { sourceLineId: "b", formulaAnchorSourceLineId: "b", reason: "formula_and_printed_label_fused_in_source_line" }
  ] });
  const raw = { ...page.lines[1], items: [
    { str: "x_t", x: 210, y: 120, width: 25, height: 10 },
    { str: "= y_t + z_t", x: 239, y: 120, width: 94, height: 10 },
    { str: "(2.4)", x: 400, y: 120, width: 30, height: 10 }
  ] };
  const partition = proposeFusedNumberPartition(raw);
  assert.equal(partition.spans.map(span => span.text).join(""), raw.text);
  assert.deepEqual(partition.spans.map(span => span.role), ["formula", "equation_number"]);
  assert.equal(partition.spans[0].bbox.x + partition.spans[0].bbox.width < partition.spans[1].bbox.x, true);
  const children = materializeFusedNumberPartition(raw, partition);
  assert.equal(children.map(child => child.text).join(""), raw.text);
  assert.deepEqual(children.map(child => child.sourceLineId), ["b:formula", "b:equation_number"]);
  assert.throws(() => materializeFusedNumberPartition(raw, { ...partition, parentText: "wrong" }), /text lineage/);
  const candidate = buildDisplayCandidatePage({ width: 600, lines: [page.lines[0], raw, page.lines[2]] });
  assert.equal(candidate.formulaCandidates.length, 1);
  assert.equal(candidate.equationNumberCandidates.length, 1);
  assert.deepEqual(candidate.formulaCandidates[0].sourceLineIds, ["b:formula"]);
  assert.deepEqual(candidate.equationNumberCandidates[0].sourceLineIds, ["b:equation_number"]);
  assert.equal(candidate.derivedLines.length, 4);
  assert.equal(candidate.pendingSourceLineIds.length, 2);
  assert.equal(proposeFusedNumberPartition({ ...raw, items: [{ str: raw.text, x: 210, y: 120, width: 220, height: 10 }] }), null);
});
