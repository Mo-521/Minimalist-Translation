"use strict";
// Offline-only. Human edits nominate failure modes, never line membership.
const crypto=require('node:crypto'),assert=require('node:assert/strict');
function build(inputs){
const before=inputs?.before;
const source=inputs?.source;
const proposals=(inputs?.proposals).proposals;
const glyph=inputs?.glyph;
const glyphById=new Map(glyph.matched.map(x=>[x.sourceLineId,x.box]));
const after=structuredClone(before),operations=[];
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,24);
const lineBox=l=>({x:l.bbox.x,y:l.bbox.y-l.bbox.height,width:l.bbox.width,height:l.bbox.height});
const union=bs=>({x:Math.min(...bs.map(b=>b.x)),y:Math.min(...bs.map(b=>b.y)),width:Math.max(...bs.map(b=>b.x+b.width))-Math.min(...bs.map(b=>b.x)),height:Math.max(...bs.map(b=>b.y+b.height))-Math.min(...bs.map(b=>b.y))});
const distance=(a,b)=>Math.max(0,a.y-b.y-b.height,b.y-a.y-a.height);
const ordered=(ids,lines)=>ids.map(id=>lines.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x);
function rebuild(seed,ids,lines,key,reason,fragments){
 const ms=ordered(ids,lines),sorted=ms.map(l=>l.sourceLineId);
 return {...seed,objectId:`stage58:${digest([key,seed.objectId,sorted,reason])}`,sourceLineIds:sorted,
  sourceText:ms.map(l=>l.text).join('\n'),memberCount:sorted.length,
  memberLineBoxes:ms.map(l=>({sourceLineId:l.sourceLineId,bbox:l.bbox})),
  spatialFragments:fragments,sourceCandidateIds:[...new Set([...(seed.sourceCandidateIds||[]),seed.objectId])],
  evidence:[...(seed.evidence||[]),reason],authority:'none',status:'offline_candidate_not_truth'};
}
function ownership(page){
 const m=new Map();for(const o of [...page.objects,...(page.referenceObjectRefs||[])])for(const id of o.sourceLineIds)m.set(id,(m.get(id)||0)+1);
 for(const p of [...page.pendingMembership,...page.excludedSourceLines])m.set(p.sourceLineId,(m.get(p.sourceLineId)||0)+1);
 return [...m].sort(([a],[b])=>a.localeCompare(b));
}
for(const [key,page] of Object.entries(after.pages)){
 const baseline=ownership(before.pages[key]),lines=new Map(source.pages[key].sourceLines.map(l=>[l.sourceLineId,l]));
 for(const proposal of proposals.filter(p=>p.key===key)){
  const owner=page.objects.find(o=>o.objectId===proposal.oldBodyId),host=page.objects.find(o=>o.objectId===proposal.formulaId);
  const support=glyphById.get(proposal.lineId);
  assert(owner&&host&&support,key+': candidate drift or glyph support missing');
  assert.equal(owner.type,'body');assert.equal(host.type,'formula');
  assert(owner.sourceLineIds.includes(proposal.lineId));
  const remaining=owner.sourceLineIds.filter(id=>id!==proposal.lineId);
  const bodyFragments=owner.spatialFragments.map(f=>{
   const ids=f.sourceLineIds.filter(id=>id!==proposal.lineId);
   if(!ids.length)return null;
   if(ids.length===f.sourceLineIds.length)return f;
   return {bbox:union(ids.map(id=>lineBox(lines.get(id)))),sourceLineIds:ids};
  }).filter(Boolean);
  let bodyAfter=null;
  if(remaining.length){
   assert(bodyFragments.length);
   bodyAfter=rebuild(owner,remaining,lines,key,'display_edge_member_removed_from_body',bodyFragments);
  }
  const distances=host.spatialFragments.map(f=>distance(f.bbox,support));
  const nearest=distances.indexOf(Math.min(...distances));
  const formulaFragments=host.spatialFragments.map((f,i)=>i===nearest?{
   bbox:union([f.bbox,support]),sourceLineIds:[...new Set([...f.sourceLineIds,proposal.lineId])]
  }:f);
  const formulaAfter=rebuild(host,[...host.sourceLineIds,proposal.lineId],lines,key,'display_edge_member_joined_unique_formula',formulaFragments);
  page.objects=page.objects.filter(o=>o!==owner&&o!==host);
  if(bodyAfter)page.objects.push(bodyAfter);
  page.objects.push(formulaAfter);
  operations.push({key,kind:'body_edge_math_to_unique_display',sourceLineId:proposal.lineId,sourceText:lines.get(proposal.lineId).text,
   beforeBodyId:owner.objectId,afterBodyId:bodyAfter?.objectId||null,beforeFormulaId:host.objectId,afterFormulaId:formulaAfter.objectId,
   glyphBox:support,overlapRatio:proposal.overlapRatio});
 }
 assert.deepEqual(ownership(page),baseline,key+': source ownership drift');
 assert(baseline.every(([,n])=>n===1),key+': duplicate ownership');
 assert.deepEqual(page.referenceObjectRefs,before.pages[key].referenceObjectRefs,key+': reference altered');
 const byType={};for(const o of [...page.objects,...(page.referenceObjectRefs||[])])byType[o.type]=(byType[o.type]||0)+1;
 page.summary={...page.summary,byType,objects:page.objects.length+(page.referenceObjectRefs||[]).length,pending:page.pendingMembership.length};
}
after.stage58={authority:'none',status:'offline_candidate_not_truth',operations,held:glyph.held};
return after;
}
module.exports={build};
