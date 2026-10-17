"use strict";
const assert=require("node:assert/strict");
function build(inputs){
const before=inputs?.before;
const source=inputs?.source;
const glyphAudit=inputs?.glyphAudit;
const after=structuredClone(before),operations=[],held=[];
function union(a,b){const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);return {x,y,width:Math.max(a.x+a.width,b.x+b.width)-x,height:Math.max(a.y+a.height,b.y+b.height)-y};}
function ownership(p){const m=new Map();for(const o of [...p.objects,...(p.referenceObjectRefs||[])])for(const id of o.sourceLineIds)m.set(id,(m.get(id)||0)+1);for(const x of [...p.pendingMembership,...p.excludedSourceLines])m.set(x.sourceLineId,(m.get(x.sourceLineId)||0)+1);return [...m].sort(([a],[b])=>a.localeCompare(b));}
for(const [key,page] of Object.entries(after.pages)){
 const byId=new Map(source.pages[key].sourceLines.map(l=>[l.sourceLineId,l]));
 for(const formula of [...page.objects].filter(o=>o.type==='formula'&&o.sourceLineIds.length===1)){
  const token=formula.sourceText.replace(/\s/g,'');
  // Extraction may emit a radical's font-mapped stem as a letter. Require a
  // radical-only short token, a complete prose row and source baseline continuity.
  if(token.length>3||!/[√∛∜]/u.test(token)||!/^[\p{L}√∛∜]+$/u.test(token))continue;
  const line=byId.get(formula.sourceLineIds[0]),b=line.bbox;
  const targets=[];
  for(const body of page.objects.filter(o=>o.type==='body'))for(const id of body.sourceLineIds){
   const prose=byId.get(id),pb=prose.bbox;
   if(prose.column!==line.column||prose.text.length<60||(prose.text.match(/[A-Za-z]{3,}/g)||[]).length<5)continue;
   if(!/[=+≤≥⩽⩾]/u.test(prose.text)||b.x<pb.x-1||b.x+b.width>pb.x+pb.width+1)continue;
   if(Math.abs(b.y-pb.y)>.75*Math.max(b.height,pb.height)||b.height>1.25*pb.height)continue;
   const fragment=body.spatialFragments.find(f=>f.sourceLineIds.includes(id));
   if(fragment)targets.push({body,prose,fragment});
  }
  const unique=[...new Map(targets.map(t=>[t.body.objectId,t])).values()];
  const hit=glyphAudit.hits.find(h=>h.key===key&&h.formulaId===formula.objectId);
  if(unique.length!==1||!hit?.formulaGlyphBox){held.push({key,formulaId:formula.objectId,reason:'no_unique_prose_and_glyph_support'});continue;}
  const {body,prose,fragment}=unique[0],g=hit.formulaGlyphBox;
  // Glyph support must stay within the prose row's horizontal extent and vertical
  // envelope; it cannot reach a separate display above or below the prose.
  if(g.x<prose.bbox.x-1||g.x+g.width>prose.bbox.x+prose.bbox.width+1||
    g.y<prose.bbox.y-prose.bbox.height-2||g.y+g.height>prose.bbox.y+prose.bbox.height){
   held.push({key,formulaId:formula.objectId,reason:'glyph_support_outside_prose_row'});continue;
  }
  const oldBox=structuredClone(fragment.bbox),lineId=line.sourceLineId;
  body.sourceLineIds.push(lineId);fragment.sourceLineIds.push(lineId);
  fragment.bbox=union(fragment.bbox,g);
  body.memberCount=body.sourceLineIds.length;
  body.memberLineBoxes=body.sourceLineIds.map(sourceLineId=>({sourceLineId,bbox:byId.get(sourceLineId).bbox}));
  body.sourceText=body.sourceLineIds.map(id=>byId.get(id).text).join('\n');
  page.objects.splice(page.objects.indexOf(formula),1);
  operations.push({key,kind:'inline_radical_fragment_to_body',beforeFormulaId:formula.objectId,
   afterBodyId:body.objectId,sourceLineId:lineId,proseLineId:prose.sourceLineId,oldBox,newBox:fragment.bbox,
   evidence:['short_operatorless_radical_fragment','same_source_baseline','inside_prose_row_x_extent','long_prose_row','pdf_glyph_row_support']});
 }
 assert.deepEqual(ownership(page),ownership(before.pages[key]),key+': ownership drift');
 if(operations.some(o=>o.key===key)){
  const byType={};for(const o of [...page.objects,...(page.referenceObjectRefs||[])])byType[o.type]=(byType[o.type]||0)+1;
  page.summary={...page.summary,objects:page.objects.length+(page.referenceObjectRefs||[]).length,byType};
 }
}
after.stage64={authority:'none',status:'offline_candidate_not_truth',operations,held};
return after;
}
module.exports={build};
