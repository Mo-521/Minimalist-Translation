"use strict";
// Offline-only: neither review rectangles nor human decisions are used as source membership truth.
const crypto=require('node:crypto'),assert=require('node:assert/strict');
function build(inputs){
const before=inputs?.before;
const source=inputs?.source;
const proposals=(inputs?.proposalResult).proposals;
const glyph=inputs?.glyph;
const byGlyph=new Map(glyph.matched.map(x=>[x.lineId,x.box]));
const after=structuredClone(before),operations=[],held=[...glyph.held];
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,24);
function ownership(page){
 const map=new Map();for(const o of [...page.objects,...(page.referenceObjectRefs||[])])for(const id of o.sourceLineIds)map.set(id,(map.get(id)||0)+1);
 for(const p of [...page.pendingMembership,...page.excludedSourceLines])map.set(p.sourceLineId,(map.get(p.sourceLineId)||0)+1);
 return [...map].sort(([a],[b])=>a.localeCompare(b));
}
for(const [key,page] of Object.entries(after.pages)){
 const baseline=ownership(before.pages[key]);
 for(const proposal of proposals.filter(p=>p.key===key)){
  const frame=byGlyph.get(proposal.lineId),pending=page.pendingMembership.find(p=>p.sourceLineId===proposal.lineId);
  if(!frame){held.push({...proposal,reason:'glyph_support_held'});continue;}
  assert(pending,key+': pending source drift');
  const line=source.pages[key].sourceLines.find(l=>l.sourceLineId===proposal.lineId);assert(line);
  const id=`stage61:${hash([key,proposal.lineId,'isolated_mixed_display'])}`;
  page.objects.push({objectId:id,type:'formula',page:page.pageNumber,sourceLineIds:[line.sourceLineId],
   sourceText:line.text,memberCount:1,memberLineBoxes:[{sourceLineId:line.sourceLineId,bbox:line.bbox}],
   spatialFragments:[{bbox:frame,sourceLineIds:[line.sourceLineId]}],
   evidence:['source_only_isolated_display','multiple_math_relations','centered_narrow_row','display_break','pdf_glyph_extent'],
   authority:'none',status:'offline_candidate_not_truth'});
  page.pendingMembership=page.pendingMembership.filter(p=>p.sourceLineId!==proposal.lineId);
  operations.push({key,kind:'isolated_mixed_display_recalled',sourceLineId:proposal.lineId,
   afterFormulaId:id,sourceText:line.text,frame,relations:proposal.relations,centerOffset:proposal.centerOffset});
 }
 assert.deepEqual(ownership(page),baseline,key+': source ownership drift');
 assert(baseline.every(([,count])=>count===1),key+': duplicate ownership');
 assert.deepEqual(page.referenceObjectRefs,before.pages[key].referenceObjectRefs,key+': references changed');
 const byType={};for(const o of [...page.objects,...(page.referenceObjectRefs||[])])byType[o.type]=(byType[o.type]||0)+1;
 page.summary={...page.summary,byType,objects:page.objects.length+(page.referenceObjectRefs||[]).length,pending:page.pendingMembership.length};
}
after.stage61={authority:'none',status:'offline_candidate_not_truth',operations,held};
return after;
}
module.exports={build};
