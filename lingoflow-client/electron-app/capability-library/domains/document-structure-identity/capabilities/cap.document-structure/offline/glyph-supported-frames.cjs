"use strict";
// Offline visual-frame refinement only. Source membership and semantic types are immutable here.
const assert = require("node:assert/strict");
function build(inputs){
const before = inputs?.before ;
const audit = inputs?.audit ;
const after = structuredClone(before);
const operations = [], held = [];

function area(box) { return box.width * box.height; }
function overlap(a, b) {
  const w = Math.max(0, Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
  const h = Math.max(0, Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  return w*h/Math.min(area(a),area(b));
}
function pad(box) { return {x:box.x-1,y:box.y-1,width:box.width+2,height:box.height+2}; }
function covered(frame, glyph) {
  return glyph.x >= frame.x-2 && glyph.y >= frame.y-2 &&
    glyph.x+glyph.width <= frame.x+frame.width+2 &&
    glyph.y+glyph.height <= frame.y+frame.height+2;
}
function sameSemanticObject(a,b) {
  for (const key of ["objectId","type","sourceLineIds","sourceText","memberCount","memberLineBoxes","evidence","authority","status"])
    assert.deepEqual(a[key],b[key]);
}
for (const hit of audit.hits) {
  if (hit.triage !== "frame_extent_candidate") {
    held.push({key:hit.key,bodyId:hit.bodyId,formulaId:hit.formulaId,reason:hit.triage});
    continue;
  }
  const page = after.pages[hit.key];
  const body = page.objects.find(o=>o.objectId===hit.bodyId);
  const formula = page.objects.find(o=>o.objectId===hit.formulaId);
  assert(body && formula && body.type==="body" && formula.type==="formula");
  assert.equal(formula.spatialFragments.length,1);
  assert.equal(body.spatialFragments.length,1);
  const oldBody = structuredClone(body.spatialFragments[0].bbox);
  const oldFormula = structuredClone(formula.spatialFragments[0].bbox);
  const nextFormula = pad(hit.formulaGlyphBox);
  const nextBody = pad(hit.bodyGlyphBox);
  const bodyTextLength = body.sourceText.replace(/\s/g,"").length;
  const bodySupport = hit.bodyGlyphCount/Math.max(1,bodyTextLength);
  if (!covered(oldFormula,hit.formulaGlyphBox) || !covered(oldBody,hit.bodyGlyphBox)) {
    held.push({key:hit.key,bodyId:hit.bodyId,formulaId:hit.formulaId,reason:"glyphs_outside_old_frame"});
    continue;
  }
  let bodyFrameChanged = false;
  if (overlap(oldBody,nextFormula) > .05) {
    if (bodySupport < .85 || overlap(nextBody,nextFormula) > .05) {
      held.push({key:hit.key,bodyId:hit.bodyId,formulaId:hit.formulaId,reason:"body_frame_cannot_safely_refine"});
      continue;
    }
    body.spatialFragments[0].bbox = nextBody;
    bodyFrameChanged = true;
  }
  const afterOverlap = overlap(body.spatialFragments[0].bbox,nextFormula);
  if (afterOverlap > .05 || hit.candidateFrameOverlap-afterOverlap < .15) {
    if (bodyFrameChanged) body.spatialFragments[0].bbox = oldBody;
    held.push({key:hit.key,bodyId:hit.bodyId,formulaId:hit.formulaId,reason:"overlap_not_resolved"});
    continue;
  }
  formula.spatialFragments[0].bbox = nextFormula;
  sameSemanticObject(body,before.pages[hit.key].objects.find(o=>o.objectId===hit.bodyId));
  sameSemanticObject(formula,before.pages[hit.key].objects.find(o=>o.objectId===hit.formulaId));
  operations.push({key:hit.key,bodyId:hit.bodyId,formulaId:hit.formulaId,
    reason:"distinct_complete_pdf_glyph_sets_and_frame_overlap",
    beforeOverlap:hit.candidateFrameOverlap,afterOverlap:Number(afterOverlap.toFixed(3)),
    oldBody,newBody:structuredClone(body.spatialFragments[0].bbox),oldFormula,newFormula:nextFormula,
    bodyFrameChanged,formulaGlyphToTextRatio:hit.formulaGlyphToTextRatio,
    bodyGlyphToTextRatio:Number(bodySupport.toFixed(3))});
}
after.stage62 = {authority:"none",status:"offline_candidate_not_truth",operations,held};
return after;
}
module.exports={build};
