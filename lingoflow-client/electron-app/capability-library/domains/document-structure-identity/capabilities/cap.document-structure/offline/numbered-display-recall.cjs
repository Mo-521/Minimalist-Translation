"use strict";
// Offline-only numbered-display recall; no human frame coordinates or runtime edits.
const crypto=require('node:crypto'),assert=require('node:assert/strict');
function build(inputs){
const before=inputs?.before;
const source=inputs?.source;
const {proposals,held}=inputs?.proposalResult;
const glyph=inputs?.glyph;
const glyphById=new Map(glyph.matched.map(x=>[x.sourceLineId,x.box]));
const after=structuredClone(before),operations=[];
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,24);
const sourceBox=l=>({x:l.bbox.x,y:l.bbox.y-l.bbox.height,width:l.bbox.width,height:l.bbox.height});
const union=bs=>({x:Math.min(...bs.map(b=>b.x)),y:Math.min(...bs.map(b=>b.y)),width:Math.max(...bs.map(b=>b.x+b.width))-Math.min(...bs.map(b=>b.x)),height:Math.max(...bs.map(b=>b.y+b.height))-Math.min(...bs.map(b=>b.y))});
const ordered=(ids,lines)=>ids.map(id=>lines.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x);
function create(seed,ids,lines,key,reason,type,visual){
 const members=ordered(ids,lines),sourceLineIds=members.map(l=>l.sourceLineId);
 return {...seed,objectId:`stage59:${digest([key,type,sourceLineIds,reason])}`,type,sourceLineIds,
  sourceText:members.map(l=>l.text).join('\n'),memberCount:sourceLineIds.length,
  memberLineBoxes:members.map(l=>({sourceLineId:l.sourceLineId,bbox:l.bbox})),
  spatialFragments:[{bbox:visual||union(members.map(sourceBox)),sourceLineIds}],
  sourceCandidateIds:[...new Set([...(seed.sourceCandidateIds||[]),seed.objectId].filter(Boolean))],
  evidence:[...(seed.evidence||[]),reason],authority:'none',status:'offline_candidate_not_truth'};
}
function ownership(page){
 const m=new Map();for(const o of [...page.objects,...(page.referenceObjectRefs||[])])for(const id of o.sourceLineIds)m.set(id,(m.get(id)||0)+1);
 for(const p of [...page.pendingMembership,...page.excludedSourceLines])m.set(p.sourceLineId,(m.get(p.sourceLineId)||0)+1);
 return [...m].sort(([a],[b])=>a.localeCompare(b));
}
for(const [key,page] of Object.entries(after.pages)){
 const lines=new Map(source.pages[key].sourceLines.map(l=>[l.sourceLineId,l]));
 const baseline=ownership(before.pages[key]);
 for(const p of proposals.filter(p=>p.key===key)){
  const body=page.objects.find(o=>o.objectId===p.bodyId);
  assert(body&&body.type==='body'&&body.sourceLineIds.includes(p.mathLineId));
  assert(page.pendingMembership.some(x=>x.sourceLineId===p.labelId));
  assert(glyphById.has(p.mathLineId)&&glyphById.has(p.labelId));
  const members=ordered(body.sourceLineIds,lines),position=members.findIndex(l=>l.sourceLineId===p.mathLineId);
  const groups=[members.slice(0,position),members.slice(position+1)].filter(g=>g.length);
  const replacements=groups.map((g,i)=>create(body,g.map(l=>l.sourceLineId),lines,key,`prose_side_${i+1}_of_numbered_display`,'body'));
  const formula=create({type:'formula',evidence:[],sourceCandidateIds:[body.objectId]},[p.mathLineId],lines,key,'numbered_isolated_math_recalled','formula',glyphById.get(p.mathLineId));
  const number=create({type:'equation_number',evidence:[],sourceCandidateIds:[]},[p.labelId],lines,key,'printed_number_separate_from_recalled_display','equation_number',glyphById.get(p.labelId));
  page.objects=page.objects.filter(o=>o!==body);
  page.objects.push(...replacements,formula,number);
  page.pendingMembership=page.pendingMembership.filter(x=>x.sourceLineId!==p.labelId);
  operations.push({key,kind:'number_anchored_display_recalled',oldBodyId:body.objectId,newBodyIds:replacements.map(o=>o.objectId),
   newFormulaId:formula.objectId,newNumberId:number.objectId,mathLineId:p.mathLineId,labelId:p.labelId,sourceLaneConflict:p.sourceLaneConflict});
 }
 assert.deepEqual(ownership(page),baseline,key+': source conservation');
 assert(baseline.every(([,n])=>n===1),key+': duplicate source ownership');
 assert.deepEqual(page.referenceObjectRefs,before.pages[key].referenceObjectRefs,key+': reference altered');
 const byType={};for(const o of [...page.objects,...(page.referenceObjectRefs||[])])byType[o.type]=(byType[o.type]||0)+1;
 page.summary={...page.summary,byType,objects:page.objects.length+(page.referenceObjectRefs||[]).length,pending:page.pendingMembership.length};
}
after.stage59={authority:'none',status:'offline_candidate_not_truth',operations,held:[...held,...glyph.held]};
return after;
}
module.exports={build};
