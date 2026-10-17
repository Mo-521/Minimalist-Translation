"use strict";

// Input-driven first pass over PDF source lines. Proposals carry evidence only;
// they are not a replacement for the complete Object producer or reviewed labels.
const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const marks = text => (clean(text).match(/[=≈≃∼≤≥⩽⩾⪯⪰∑∫√^_{}⟨⟩⊙∈∉⊂⊆∪∩∞α-ωΑ-Ωλ−±+]/gu) || []).length;
const mathGlyph = /[∂∇∥⊥∮∏∐⊗⊕∅⋆]/u;
const proseWords = text => (clean(text).match(/\b[A-Za-z]{3,}\b/g) || []).length;
const equationNumber = text => /^\(\d{1,3}(?:\.\d+)?[a-z]?\)$/i.test(clean(text));
const prose = /\b(?:the|this|that|these|those|where|which|we|our|their|with|from|into|using|thus|hence|therefore|then|however|also|let|for|and|or|by|of|in|to|is|are|was|were|gives|implies|yields|assume|defined|denotes|shows|consider)\b/i;
const proseLead = /^(?:equivalently|consequently|furthermore|similarly|hence|therefore|thus|however|in particular|moreover)\b/i;
const relation = /[=≈≃∼≤≥⩽⩾⪯⪰≡]/u;
const median = values => values.length ? values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)] : 0;
const verticalBox = line => ({ x: line.bbox.x, y: line.bbox.y,
  right: line.bbox.x + line.bbox.width, bottom: line.bbox.y + line.bbox.height });
function near(a, b) {
  const commonX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
  const gap = Math.max(0, a.y - b.bottom, b.y - a.bottom);
  return commonX >= Math.min(a.right - a.x, b.right - b.x) * .25 &&
    gap <= Math.min(19, Math.max(7, Math.max(a.bottom - a.y, b.bottom - b.y) * .85));
}
function profile(lines) {
  const maxWidth = Math.max(0, ...lines.map(line => line.bbox.width));
  const wide = lines.filter(line => line.bbox.width >= maxWidth * .64).sort((a, b) => a.bbox.y - b.bbox.y);
  return { wide, width: median(wide.map(line => line.bbox.width)),
    left: median(wide.map(line => line.bbox.x)),
    center: median(wide.map(line => line.bbox.x + line.bbox.width / 2)),
    height: median(lines.map(line => line.bbox.height)) };
}
function isolatedComparison(line, lane) {
  const s = clean(line.text);
  if (lane.wide.length < 3 || !lane.width || s.length > 100 || prose.test(s)) return false;
  const outsideArguments = s.replace(/\(\s*[<>][^)]*\)/g, "");
  if (!/[<>∨∧]/u.test(outsideArguments) ||
    !((s.match(/[A-Z](?:_?\d+)?/g) || []).length >= 2 || /^[A-Z][A-Za-z_\d]*\s*[<>]\s*\d+(?:\.\d+)?$/.test(s)) ||
    proseWords(s) > 1 || line.bbox.width > lane.width * .56) return false;
  const center = line.bbox.x + line.bbox.width / 2;
  if (Math.abs(center - lane.center) > lane.width * .16) return false;
  const before = lane.wide.filter(other => other.bbox.y < line.bbox.y).at(-1);
  const after = lane.wide.find(other => other.bbox.y > line.bbox.y);
  const threshold = Math.max(4, lane.height * .45);
  return (!before || line.bbox.y - before.bbox.y - before.bbox.height > threshold) &&
    (!after || after.bbox.y - line.bbox.y - line.bbox.height > threshold);
}
function anchor(line, pageWidth, lane) {
  const s = clean(line.text);
  if (!s || equationNumber(s) || proseLead.test(s) || s.length > 180) return null;
  const labelled = /^\(\d{1,3}(?:\.\d+)?[a-z]?\)\s*/i.test(s);
  const body = s.replace(/^\(\d{1,3}(?:\.\d+)?[a-z]?\)\s*/i, "");
  const mathMarks = marks(body);
  const isolated = !relation.test(body) && isolatedComparison(line, lane);
  const indentedDisplay = relation.test(body) && mathMarks >= 5 && lane.width > 0 &&
    line.bbox.x - lane.left >= Math.max(25, pageWidth * .055) &&
    line.bbox.width < lane.width * .8 && proseWords(body) <= 8 &&
    !/^(?:the|we|this|that|for|in|as|thus|hence|since|where|let|consider)\b/i.test(body);
  const sparseEquation = relation.test(body) && mathMarks === 1 &&
    /^[A-Za-z][A-Za-z0-9_]*\s*=\s*[A-Za-z0-9_]+(?:\s*[+−*/]\s*[A-Za-z0-9_]+)+$/u.test(body) &&
    lane.width > 0 && line.bbox.width < lane.width * .55 &&
    Math.abs(line.bbox.x + line.bbox.width / 2 - lane.center) < lane.width * .22;
  if (!isolated && !sparseEquation && (!relation.test(body) || mathMarks < 2)) return null;
  if (prose.test(body) && !indentedDisplay && (!labelled || mathMarks < 5)) return null;
  if (proseWords(body) > 3 && !indentedDisplay) return null;
  if (line.bbox.width / pageWidth > .86 && !labelled) return null;
  return { kind: isolated ? "isolated_comparison" : "math_relation", marks: mathMarks };
}
function compactMember(line) {
  const s = clean(line.text);
  return !!s && s.length <= 18 && !equationNumber(s) && !prose.test(s) &&
    proseWords(s) <= 1 && (marks(s) > 0 || mathGlyph.test(s) || /^[A-Za-z][A-Za-z0-9]{0,2}$/.test(s));
}
const xOverlap = (a, b) => Math.max(0, Math.min(a.bbox.x + a.bbox.width, b.bbox.x + b.bbox.width) -
  Math.max(a.bbox.x, b.bbox.x));
function formulaCompatible(line, anchor, pageWidth) {
  if (String(line.column || "single") !== String(anchor.column || "single")) return false;
  const dy = Math.abs(line.bbox.y - anchor.bbox.y);
  const centerGap = Math.abs(line.bbox.x + line.bbox.width / 2 - anchor.bbox.x - anchor.bbox.width / 2);
  return dy <= Math.min(28, Math.max(21, line.bbox.height * 2.1, anchor.bbox.height * 2.1)) &&
    (xOverlap(line, anchor) > Math.min(line.bbox.width, anchor.bbox.width) * .18 || centerGap < pageWidth * .14);
}
function fragmentCompatible(line, anchor, pageWidth) {
  const s = clean(line.text);
  if (!s || equationNumber(s) || prose.test(s) || proseWords(s) > 2 || !formulaCompatible(line, anchor, pageWidth)) return false;
  if (s.length <= 2 && xOverlap(line, anchor) < line.bbox.width * .45) return false;
  return marks(s) > 0 || mathGlyph.test(s) || /^[\w\d()~,.'\s+−-]{1,80}$/u.test(s);
}
function proposeDisplayBlocks(page) {
  if (!page || !Array.isArray(page.lines) || !(page.width > 0)) throw Error("PDF source page with width and lines required");
  const lines = page.lines.map(line => ({ ...line, sourceLineId: line.sourceLineId || line.id }));
  if (lines.some(line => !line.sourceLineId || !line.bbox)) throw Error("PDF source lines require IDs and boxes");
  if (new Set(lines.map(line => line.sourceLineId)).size !== lines.length) throw Error("PDF source IDs must be unique per page");
  const lanes = new Map([...new Set(lines.map(line => String(line.column || "single")))].map(column =>
    [column, profile(lines.filter(line => String(line.column || "single") === column))]));
  const anchors = lines.map(line => ({ line, evidence: anchor(line, page.width, lanes.get(String(line.column || "single"))) }))
    .filter(entry => entry.evidence);
  const reserved = new Set(anchors.map(entry => entry.line.sourceLineId));
  const proposals = anchors.map(entry => ({ anchorSourceLineId: entry.line.sourceLineId,
    sourceLineIds: [entry.line.sourceLineId], evidence: entry.evidence.kind, anchors: [entry.line] }));
  for (const line of lines) {
    if (reserved.has(line.sourceLineId) || !compactMember(line) &&
      !proposals.some(proposal => proposal.anchors.some(another => fragmentCompatible(line, another, page.width)))) continue;
    const nearby = proposals.filter(proposal => proposal.anchors.some(another =>
      fragmentCompatible(line, another, page.width) || compactMember(line) && near(verticalBox(line), verticalBox(another))));
    if (!nearby.length) continue;
    let chosen = nearby[0];
    if (nearby.length > 1) {
      const ranked = nearby.map(proposal => ({ proposal,
        overlap: Math.max(...proposal.anchors.map(anchor => Math.max(0,
          Math.min(line.bbox.y + line.bbox.height, anchor.bbox.y + anchor.bbox.height) -
          Math.max(line.bbox.y, anchor.bbox.y)))),
        dy: Math.min(...proposal.anchors.map(anchor => Math.abs(line.bbox.y - anchor.bbox.y))) }))
        .sort((a, b) => b.overlap - a.overlap || a.dy - b.dy);
      if (ranked[0].overlap - ranked[1].overlap < 2 && ranked[1].dy - ranked[0].dy < 8) continue;
      chosen = ranked[0].proposal;
    }
    chosen.sourceLineIds.push(line.sourceLineId);
    reserved.add(line.sourceLineId);
  }
  for (let i = 0; i < proposals.length; i++) {
    const first = proposals[i];
    for (let j = proposals.length - 1; j > i; j--) {
      const second = proposals[j];
      const a = first.anchors.at(-1), b = second.anchors[0];
      if (String(a.column || "single") !== String(b.column || "single") ||
        b.bbox.y <= a.bbox.y || b.bbox.y - a.bbox.y > 28 ||
        xOverlap(a, b) < Math.min(a.bbox.width, b.bbox.width) * .2) continue;
      const preceding = clean(a.text), following = clean(b.text);
      if (!/[=+−,]$/u.test(preceding) && !/^[=≈≃≤≥⩽⩾+−]/u.test(following)) continue;
      const separateLabelBetween = lines.some(line => equationNumber(line.text) &&
        line.bbox.y >= a.bbox.y - 3 && line.bbox.y <= b.bbox.y + 3);
      const proseBetween = lines.some(line => line !== a && line !== b && prose.test(line.text) &&
        line.bbox.y > a.bbox.y && line.bbox.y < b.bbox.y &&
        line.bbox.width > Math.min(a.bbox.width, b.bbox.width) * .7);
      if (separateLabelBetween || proseBetween) continue;
      first.sourceLineIds.push(...second.sourceLineIds);
      first.anchors.push(...second.anchors);
      proposals.splice(j, 1);
    }
  }
  return proposals.map(({ anchors: ignored, ...proposal }) => proposal);
}
function proposeEquationNumbers(page, displayProposals) {
  if (!page || !Array.isArray(page.lines) || !Array.isArray(displayProposals)) throw Error("Source page and display proposals required");
  const lines = page.lines.map(line => ({ ...line, sourceLineId: line.sourceLineId || line.id }));
  if (new Set(lines.map(line => line.sourceLineId)).size !== lines.length) throw Error("PDF source IDs must be unique per page");
  const byId = new Map(lines.map(line => [line.sourceLineId, line]));
  const assigned = new Set(displayProposals.flatMap(proposal => proposal.sourceLineIds));
  const numbers = [], needsSplit = [];
  for (const line of lines) {
    const text = clean(line.text);
    if (!equationNumber(text) || assigned.has(line.sourceLineId)) continue;
    const compatible = displayProposals.map(proposal => {
      const members = proposal.sourceLineIds.map(id => byId.get(id)).filter(Boolean);
      const nearby = members.some(member => {
        const vertical = Math.abs(line.bbox.y - member.bbox.y);
        const horizontal = line.bbox.x >= member.bbox.x + member.bbox.width + 2 ||
          line.bbox.x + line.bbox.width <= member.bbox.x - 2;
        const sameArea = String(line.column || "single") === String(member.column || "single") ||
          (line.column === "single" || member.column === "single") &&
          Math.abs(line.bbox.x + line.bbox.width / 2 - member.bbox.x - member.bbox.width / 2) < page.width * .3;
        return vertical <= Math.max(13, member.bbox.height * 1.2) && horizontal &&
          sameArea;
      });
      return nearby ? proposal : null;
    }).filter(Boolean);
    if (compatible.length === 1) numbers.push({ sourceLineId: line.sourceLineId,
      formulaAnchorSourceLineId: compatible[0].anchorSourceLineId, evidence: "isolated_printed_label_near_display" });
  }
  for (const proposal of displayProposals) for (const id of proposal.sourceLineIds) {
    const line = byId.get(id);
    if (line && /\(\d{1,3}(?:\.\d+)?[a-z]?\)\s*$/i.test(clean(line.text)) &&
      !equationNumber(line.text)) needsSplit.push({ sourceLineId: id,
      formulaAnchorSourceLineId: proposal.anchorSourceLineId, reason: "formula_and_printed_label_fused_in_source_line" });
  }
  return { numbers, needsSplit };
}
const itemBox = item => ({ x: Number(item.x), y: Number(item.y),
  width: Number(item.width), height: Number(item.height) });
const union = boxes => ({ x: Math.min(...boxes.map(box => box.x)), y: Math.min(...boxes.map(box => box.y)),
  width: Math.max(...boxes.map(box => box.x + box.width)) - Math.min(...boxes.map(box => box.x)),
  height: Math.max(...boxes.map(box => box.y + box.height)) - Math.min(...boxes.map(box => box.y)) });
function proposeFusedNumberPartition(line) {
  const id = line?.sourceLineId || line?.id;
  const sourceText = String(line?.text || "");
  const match = /\(\d{1,3}(?:\.\d+)?[a-z]?\)\s*$/i.exec(sourceText);
  if (!id || !match || equationNumber(sourceText) || !Array.isArray(line.items)) return null;
  const number = match[0].trim();
  const labelItems = line.items.filter(item => clean(item.str || item.text) === number);
  if (labelItems.length !== 1) return null;
  const numberItem = labelItems[0], numberBox = itemBox(numberItem);
  const mathItems = line.items.filter(item => item !== numberItem && clean(item.str || item.text));
  if (mathItems.length < 2 || ![numberBox.x, numberBox.y, numberBox.width, numberBox.height].every(Number.isFinite) ||
    numberBox.width <= 0 || numberBox.height <= 0) return null;
  const boxes = mathItems.map(itemBox);
  if (boxes.some(box => ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
    box.width <= 0 || box.height <= 0)) return null;
  const mathBox = union(boxes);
  if (numberBox.x < mathBox.x + mathBox.width + 5) return null;
  const cut = match.index;
  if (!sourceText.slice(0, cut).trim()) return null;
  return { parentSourceLineId: id, parentText: sourceText, evidence: "native_separate_printed_label_item",
    spans: [
      { role: "formula", text: sourceText.slice(0, cut), textSpan: { start: 0, end: cut }, bbox: mathBox },
      { role: "equation_number", text: sourceText.slice(cut), textSpan: { start: cut, end: sourceText.length }, bbox: numberBox }
    ] };
}
function materializeFusedNumberPartition(line, proposal) {
  const parentId = line?.sourceLineId || line?.id;
  if (!parentId || proposal?.parentSourceLineId !== parentId || proposal.parentText !== line.text ||
    proposal.spans?.length !== 2 || proposal.spans[0].role !== "formula" ||
    proposal.spans[1].role !== "equation_number" ||
    proposal.spans[0].textSpan.start !== 0 ||
    proposal.spans[0].textSpan.end !== proposal.spans[1].textSpan.start ||
    proposal.spans[1].textSpan.end !== line.text.length ||
    proposal.spans.map(span => span.text).join("") !== line.text) throw Error("Fused number partition fails text lineage");
  const children = proposal.spans.map(span => ({ ...line,
    id: `${parentId}:${span.role}`, sourceLineId: `${parentId}:${span.role}`,
    text: span.text, bbox: { ...span.bbox }, sourceSpanKind: span.role,
    parentSourceLineId: parentId, textSpan: { ...span.textSpan }, items: undefined }));
  if (children[0].bbox.x + children[0].bbox.width >= children[1].bbox.x) throw Error("Fused number partition overlaps");
  return children;
}
function buildDisplayCandidatePage(page) {
  const lines = page.lines.map(line => ({ ...line, sourceLineId: line.sourceLineId || line.id }));
  const proposals = proposeDisplayBlocks({ ...page, lines });
  const numberProposal = proposeEquationNumbers({ ...page, lines }, proposals);
  const derivedLines = [...lines], splitLineage = [], held = [];
  const formulaMembers = proposals.map(proposal => ({ ...proposal, sourceLineIds: [...proposal.sourceLineIds] }));
  const numbers = [...numberProposal.numbers];
  for (const diagnostic of numberProposal.needsSplit) {
    const index = derivedLines.findIndex(line => line.sourceLineId === diagnostic.sourceLineId);
    if (index < 0) throw Error(`Fused diagnostic lacks source line: ${diagnostic.sourceLineId}`);
    const parent = derivedLines[index], partition = proposeFusedNumberPartition(parent);
    if (!partition) { held.push(diagnostic); continue; }
    const children = materializeFusedNumberPartition(parent, partition);
    derivedLines.splice(index, 1, ...children);
    const formula = formulaMembers.find(proposal => proposal.anchorSourceLineId === diagnostic.formulaAnchorSourceLineId);
    if (!formula || !formula.sourceLineIds.includes(parent.sourceLineId)) throw Error("Fused line lacks formula membership");
    formula.sourceLineIds = formula.sourceLineIds.map(id => id === parent.sourceLineId ? children[0].sourceLineId : id);
    numbers.push({ sourceLineId: children[1].sourceLineId,
      formulaAnchorSourceLineId: formula.anchorSourceLineId, evidence: "native_fused_line_partition" });
    splitLineage.push({ parentSourceLineId: parent.sourceLineId, parentText: parent.text,
      childSourceLineIds: children.map(child => child.sourceLineId) });
  }
  const byId = new Map(derivedLines.map(line => [line.sourceLineId, line]));
  if (byId.size !== derivedLines.length) throw Error("Derived source identity collision");
  const assigned = [...formulaMembers.flatMap(proposal => proposal.sourceLineIds), ...numbers.map(number => number.sourceLineId)];
  if (new Set(assigned).size !== assigned.length || assigned.some(id => !byId.has(id)))
    throw Error("Display candidate source ownership collision");
  const boxFor = ids => union(ids.map(id => byId.get(id).bbox));
  return { authority: "none", status: "offline_candidate_not_truth", derivedLines, splitLineage,
    formulaCandidates: formulaMembers.map(proposal => ({ candidateId: `display:${proposal.anchorSourceLineId}`,
      type: "formula", sourceLineIds: proposal.sourceLineIds, bbox: boxFor(proposal.sourceLineIds),
      evidence: proposal.evidence })),
    equationNumberCandidates: numbers.map(number => ({ candidateId: `number:${number.sourceLineId}`,
      type: "equation_number", sourceLineIds: [number.sourceLineId], bbox: boxFor([number.sourceLineId]),
      relatedFormulaAnchorSourceLineId: number.formulaAnchorSourceLineId, evidence: number.evidence })),
    pendingSourceLineIds: derivedLines.map(line => line.sourceLineId).filter(id => !assigned.includes(id)), held };
}
module.exports = { proposeDisplayBlocks, proposeEquationNumbers, proposeFusedNumberPartition,
  materializeFusedNumberPartition, buildDisplayCandidatePage };
