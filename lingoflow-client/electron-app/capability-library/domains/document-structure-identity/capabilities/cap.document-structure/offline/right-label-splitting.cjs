"use strict";
const crypto=require('node:crypto'),assert=require('node:assert/strict');
function build(inputs){
const candidate=structuredClone(inputs?.candidate);
const source=structuredClone(inputs?.source);
const evidence=inputs?.evidence;
const ops=[];
const union=bs=>{const x=Math.min(...bs.map(b=>b.x)),y=Math.min(...bs.map(b=>b.y));return{x,y,width:Math.max(...bs.map(b=>b.x+b.width))-x,height:Math.max(...bs.map(b=>b.y+b.height))-y};};
const box=l=>({x:l.bbox.x,y:l.bbox.y-l.bbox.height,width:l.bbox.width,height:l.bbox.height});
const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
const id=(key,kind,ids)=>'stage52:'+crypto.createHash('sha256').update(JSON.stringify([key,kind,ids])).digest('hex').slice(0,24);
function refresh(o,inv,key,why){const byId=new Map(inv.sourceLines.map(l=>[l.sourceLineId,l]));o.sourceLineIds.sort((a,b)=>byId.get(a).bbox.y-byId.get(b).bbox.y||byId.get(a).bbox.x-byId.get(b).bbox.x);const ls=o.sourceLineIds.map(id=>byId.get(id));o.sourceText=ls.map(l=>l.text).join('\n');o.memberCount=ls.length;o.memberLineBoxes=ls.map(l=>({sourceLineId:l.sourceLineId,bbox:l.bbox}));o.spatialFragments=[{bbox:union(ls.map(box)),sourceLineIds:[...o.sourceLineIds]}];o.sourceCandidateIds=[...(o.sourceCandidateIds||[]),o.objectId].filter(Boolean);o.objectId=id(key,why,o.sourceLineIds);o.evidence=[...(o.evidence||[]),why];return o;}
for(const s of evidence.matched){const page=candidate.pages[s.page],inv=source.pages[s.page],parent=inv.sourceLines.find(l=>l.sourceLineId===s.parentSourceLineId);assert(parent);
 const split=(kind,text,b,span)=>({...parent,sourceLineId:`${parent.sourceLineId}:stage52:${kind}`,text,bbox:{...b,y:b.y+b.height},parentSourceLineId:parent.sourceLineId,sourceSpanKind:kind,textSpan:span});
 const math=split('formula',s.formulaText,s.formulaBox,s.formulaTextSpan),number=split('equation_number',s.labelText,s.labelBox,s.labelTextSpan);
 inv.sourceLines.splice(inv.sourceLines.indexOf(parent),1,math,number);
 const original=page.objects.find(o=>o.sourceLineIds.includes(parent.sourceLineId));if(original){original.sourceLineIds=original.sourceLineIds.filter(x=>x!==parent.sourceLineId);if(!original.sourceLineIds.length)page.objects.splice(page.objects.indexOf(original),1);else refresh(original,inv,s.page,'right_label_parent_split');}
 page.pendingMembership=page.pendingMembership.filter(x=>x.sourceLineId!==parent.sourceLineId);
 if(original?.type==='formula'){original.sourceLineIds.push(math.sourceLineId);if(!page.objects.includes(original))page.objects.push(original);refresh(original,inv,s.page,'right_label_removed_from_formula');}
 else{
  const ms=page.objects.filter(o=>o.type==='formula').map(o=>({o,b:union(o.spatialFragments.map(f=>f.bbox))})).filter(x=>{const b=s.formulaBox,dy=Math.max(0,Math.max(b.y-x.b.y-x.b.height,x.b.y-b.y-b.height));return dy<16&&overlap(b,x.b)>Math.min(b.width,x.b.width)*.4;});
  if(ms.length===1){ms[0].o.sourceLineIds.push(math.sourceLineId);refresh(ms[0].o,inv,s.page,'right_label_display_continuation');}
  else page.objects.push(refresh({objectId:id(s.page,'new_formula',[math.sourceLineId]),type:'formula',sourceLineIds:[math.sourceLineId],sourceCandidateIds:[],evidence:[]},inv,s.page,'printed_label_excluded_from_display'));
 }
 page.objects.push(refresh({objectId:id(s.page,'new_number',[number.sourceLineId]),type:'equation_number',sourceLineIds:[number.sourceLineId],sourceCandidateIds:[],evidence:[s.evidence]},inv,s.page,'printed_equation_number_distinct'));
 page.sourceSpanLineage=[...(page.sourceSpanLineage||[]),{parentSourceLineId:parent.sourceLineId,parentSourceText:parent.text,formulaSourceLineId:math.sourceLineId,numberSourceLineId:number.sourceLineId,formulaTextSpan:s.formulaTextSpan,labelTextSpan:s.labelTextSpan,evidence:s.evidence}];
 ops.push({key:s.page,kind:'right_label_split',parentSourceLineId:parent.sourceLineId,formulaSourceLineId:math.sourceLineId,numberSourceLineId:number.sourceLineId,previousType:original?.type||'pending'});
}
for(const [key,page] of Object.entries(candidate.pages)){
 const inv=source.pages[key];page.sourceLineCount=inv.sourceLines.length;page.reviewableLineCount=inv.sourceLines.filter(l=>l.coverageClass==='reviewable_content').length;
 const owner=new Map();for(const o of [...page.objects,...page.referenceObjectRefs||[]])for(const sid of o.sourceLineIds)owner.set(sid,(owner.get(sid)||0)+1);for(const p of [...page.pendingMembership,...page.excludedSourceLines])owner.set(p.sourceLineId,(owner.get(p.sourceLineId)||0)+1);
 assert.deepEqual([...owner.keys()].sort(),inv.sourceLines.map(l=>l.sourceLineId).sort(),`${key}: source line lost`);assert([...owner.values()].every(n=>n===1),`${key}: duplicate source line`);
 for(const o of page.objects)assert.equal(o.sourceText,o.sourceLineIds.map(sid=>inv.sourceLines.find(l=>l.sourceLineId===sid).text).join('\n'));
 const types={};for(const o of [...page.objects,...page.referenceObjectRefs||[]])types[o.type]=(types[o.type]||0)+1;
 page.summary={...page.summary,objects:page.objects.length+(page.referenceObjectRefs||[]).length,byType:types,assigned:[...page.objects,...page.referenceObjectRefs||[]].reduce((n,o)=>n+o.sourceLineIds.length,0),pending:page.pendingMembership.length};
}
candidate.stage52={authority:'none',status:'offline_candidate_not_truth',operations:ops,held:evidence.held};
candidate.summary={...candidate.summary,sourceLines:0,reviewable:0,pageLocalObjects:0,assigned:0,pending:0,byType:{}};
for(const p of Object.values(candidate.pages)){candidate.summary.sourceLines+=p.sourceLineCount;candidate.summary.reviewable+=p.reviewableLineCount;candidate.summary.pageLocalObjects+=p.objects.length;candidate.summary.assigned+=p.summary.assigned;candidate.summary.pending+=p.pendingMembership.length;for(const [type,n] of Object.entries(p.summary.byType))candidate.summary.byType[type]=(candidate.summary.byType[type]||0)+n;}
return {candidate,source};
}
module.exports={build};
