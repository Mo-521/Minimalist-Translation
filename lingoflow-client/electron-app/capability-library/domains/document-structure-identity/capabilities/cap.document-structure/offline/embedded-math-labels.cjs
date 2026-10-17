"use strict";
// Offline-only source membership reconstruction. No review rectangle is used as truth.
const assert=require("node:assert/strict");
function build(inputs){
const before=inputs?.before;
const source=inputs?.source;
const after=structuredClone(before),operations=[],held=[];
const area=b=>b.width*b.height;
function intersection(a,b){
 const w=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
 const h=Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
 return w*h;
}
function owned(page){
 const counts=new Map();
 for(const o of [...page.objects,...(page.referenceObjectRefs||[])])for(const id of o.sourceLineIds)counts.set(id,(counts.get(id)||0)+1);
 for(const item of [...page.pendingMembership,...page.excludedSourceLines])counts.set(item.sourceLineId,(counts.get(item.sourceLineId)||0)+1);
 return [...counts].sort(([a],[b])=>a.localeCompare(b));
}
function refresh(obj,byId){
 obj.memberCount=obj.sourceLineIds.length;
 obj.memberLineBoxes=obj.sourceLineIds.map(sourceLineId=>({sourceLineId,bbox:byId.get(sourceLineId).bbox}));
 obj.sourceText=obj.sourceLineIds.map(id=>byId.get(id).text).join("\n");
}
for(const [key,page] of Object.entries(after.pages)){
 const byId=new Map(source.pages[key].sourceLines.map(l=>[l.sourceLineId,l]));
 const prior=owned(before.pages[key]);
 // A one-character mathematical source unit *inside* one prose row is an inline
 // member, not an isolated display. Long and relation-bearing displays are excluded.
 for(const formula of [...page.objects].filter(o=>o.type==="formula"&&o.sourceLineIds.length===1&&/^\p{L}$/u.test(o.sourceText.trim()))){
  if(formula.spatialFragments.length!==1)continue;
  const f=formula.spatialFragments[0].bbox;
  const targets=page.objects.filter(o=>o.type==="body"&&o.sourceLineIds.length===1&&o.spatialFragments.length===1&&
    o.sourceText.length>=50&&/[∑∫≤≥⩽⩾=+_]/u.test(o.sourceText)&&
    intersection(o.spatialFragments[0].bbox,f)/area(f)>=.95);
  if(targets.length!==1){held.push({key,formulaId:formula.objectId,reason:"single_symbol_without_unique_prose_container"});continue;}
  const body=targets[0],lineId=formula.sourceLineIds[0];
  body.sourceLineIds.push(lineId);
  body.spatialFragments[0].sourceLineIds.push(lineId);
  refresh(body,byId);
  page.objects.splice(page.objects.indexOf(formula),1);
  operations.push({key,kind:"embedded_math_symbol_to_body",sourceLineId:lineId,
    beforeFormulaId:formula.objectId,afterBodyId:body.objectId,
    evidence:["one_character_math_unit","inside_prose_row","no_independent_display_region"]});
 }
 // Isolated parenthesized annotation markers printed *under* an existing display
 // are formula members when the following body lines form a separate prose region.
 for(const body of page.objects.filter(o=>o.type==="body"&&o.sourceLineIds.length>=2&&o.spatialFragments.length>=2)){
  const first=byId.get(body.sourceLineIds[0]);
  if(!first||! /^(?:\([a-z]\)\s*){2,}$/u.test(first.text.trim()))continue;
  const labelFragment=body.spatialFragments.find(f=>f.sourceLineIds.length===1&&f.sourceLineIds[0]===first.sourceLineId);
  const otherFragments=body.spatialFragments.filter(f=>f!==labelFragment);
  if(!labelFragment||otherFragments.length!==1||otherFragments[0].bbox.y-labelFragment.bbox.y<20)continue;
  const targets=page.objects.filter(o=>o.type==="formula"&&o.spatialFragments.length===1&&
    intersection(o.spatialFragments[0].bbox,labelFragment.bbox)/area(labelFragment.bbox)>=.8&&
    o.sourceText.length>=20);
  if(targets.length!==1){held.push({key,bodyId:body.objectId,reason:"display_annotation_without_unique_formula"});continue;}
  const formula=targets[0],lineId=first.sourceLineId;
  body.sourceLineIds=body.sourceLineIds.filter(id=>id!==lineId);
  body.spatialFragments=otherFragments;
  refresh(body,byId);
  formula.sourceLineIds.push(lineId);
  formula.spatialFragments[0].sourceLineIds.push(lineId);
  refresh(formula,byId);
  operations.push({key,kind:"display_annotation_from_body_to_formula",sourceLineId:lineId,
    bodyId:body.objectId,formulaId:formula.objectId,
    evidence:["multiple_parenthesized_annotation_marks","inside_display_frame","separate_prose_region"]});
 }
 assert.deepEqual(owned(page),prior,key+": ownership drift");
 assert(prior.every(([,n])=>n===1),key+": duplicate source ownership");
 assert.deepEqual(page.referenceObjectRefs,before.pages[key].referenceObjectRefs,key+": reference drift");
 const byType={};for(const o of [...page.objects,...(page.referenceObjectRefs||[])])byType[o.type]=(byType[o.type]||0)+1;
 page.summary={...page.summary,objects:page.objects.length+(page.referenceObjectRefs||[]).length,byType};
}
after.stage63={authority:"none",status:"offline_candidate_not_truth",operations,held};
return after;
}
module.exports={build};
