"use strict";
// Offline-only. Review frames nominate the failure; frozen source + PDF glyphs decide membership.
const crypto=require('node:crypto'),assert=require('node:assert/strict');
function build(inputs){
const before=inputs?.before;
const source=inputs?.source;
const proposals=(inputs?.proposalResult).proposals;
const glyph=inputs?.glyph;
const supported=new Map(glyph.matched.map(x=>[x.sourceLineId,x.box]));
const after=structuredClone(before),operations=[],held=[...glyph.held];
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,24);
const top=l=>({x:l.bbox.x,y:l.bbox.y-l.bbox.height,width:l.bbox.width,height:l.bbox.height});
const union=bs=>({x:Math.min(...bs.map(b=>b.x)),y:Math.min(...bs.map(b=>b.y)),width:Math.max(...bs.map(b=>b.x+b.width))-Math.min(...bs.map(b=>b.x)),height:Math.max(...bs.map(b=>b.y+b.height))-Math.min(...bs.map(b=>b.y))});
const ordered=(ids,byId)=>ids.map(id=>byId.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x);
const ownership=page=>{
 const m=new Map();for(const o of [...page.objects,...(page.referenceObjectRefs||[])])for(const id of o.sourceLineIds)m.set(id,(m.get(id)||0)+1);
 for(const p of [...page.pendingMembership,...page.excludedSourceLines])m.set(p.sourceLineId,(m.get(p.sourceLineId)||0)+1);
 return [...m].sort(([a],[b])=>a.localeCompare(b));
};
function rebuild(seed,ids,byId,key,reason,spatialFragments){
 const ms=ordered(ids,byId),sorted=ms.map(x=>x.sourceLineId);
 return {...seed,objectId:`stage60:${hash([key,seed.objectId,sorted,reason])}`,sourceLineIds:sorted,
  sourceText:ms.map(x=>x.text).join('\n'),memberCount:sorted.length,
  memberLineBoxes:ms.map(x=>({sourceLineId:x.sourceLineId,bbox:x.bbox})),spatialFragments,
  sourceCandidateIds:[...new Set([...(seed.sourceCandidateIds||[]),seed.objectId])],
  evidence:[...(seed.evidence||[]),reason],authority:'none',status:'offline_candidate_not_truth'};
}
for(const [key,page] of Object.entries(after.pages)){
 const baseline=ownership(before.pages[key]),byId=new Map(source.pages[key].sourceLines.map(x=>[x.sourceLineId,x]));
 for(const proposal of proposals.filter(p=>p.key===key)){
  const support=supported.get(proposal.lineId);
  if(!support){held.push({...proposal,reason:'glyph_support_held'});continue;}
  const body=page.objects.find(o=>o.objectId===proposal.bodyId),formula=page.objects.find(o=>o.objectId===proposal.formulaId);
  assert(body&&formula&&body.type==='body'&&formula.type==='formula',key+': candidate drift');
  assert(body.sourceLineIds.includes(proposal.lineId));
  const keep=body.sourceLineIds.filter(id=>id!==proposal.lineId);
  if(!keep.length){held.push({...proposal,reason:'would_remove_entire_body'});continue;}
  const bodyFragments=body.spatialFragments.map(f=>{
   const ids=f.sourceLineIds.filter(id=>id!==proposal.lineId);
   if(!ids.length)return null;
   return ids.length===f.sourceLineIds.length?f:{bbox:union(ids.map(id=>top(byId.get(id)))),sourceLineIds:ids};
  }).filter(Boolean);
  assert(bodyFragments.length);
  const formulaFragments=formula.spatialFragments.map((f,i)=>i===0?{
   bbox:union([f.bbox,support]),sourceLineIds:[...f.sourceLineIds,proposal.lineId]
  }:f);
  const bodyAfter=rebuild(body,keep,byId,key,'numeric_math_edge_removed_from_body',bodyFragments);
  const formulaAfter=rebuild(formula,[...formula.sourceLineIds,proposal.lineId],byId,key,'numeric_math_edge_joined_to_formula',formulaFragments);
  page.objects=page.objects.filter(o=>o!==body&&o!==formula);
  page.objects.push(bodyAfter,formulaAfter);
  operations.push({key,kind:'numeric_formula_member_reassigned',sourceLineId:proposal.lineId,sourceText:proposal.text,
   beforeBodyId:body.objectId,afterBodyId:bodyAfter.objectId,beforeFormulaId:formula.objectId,afterFormulaId:formulaAfter.objectId,
   spatialGap:proposal.spatialGap,glyphBox:support});
 }
 assert.deepEqual(ownership(page),baseline,key+': ownership drift');
 assert(baseline.every(([,count])=>count===1),key+': duplicate source ownership');
 assert.deepEqual(page.referenceObjectRefs,before.pages[key].referenceObjectRefs,key+': references changed');
 const byType={};for(const o of [...page.objects,...(page.referenceObjectRefs||[])])byType[o.type]=(byType[o.type]||0)+1;
 page.summary={...page.summary,byType,objects:page.objects.length+(page.referenceObjectRefs||[]).length,pending:page.pendingMembership.length};
}
after.stage60={authority:'none',status:'offline_candidate_not_truth',operations,held};
return after;
}
module.exports={build};
