"use strict";
const crypto=require('node:crypto');
function build(inputs){
const candidate=structuredClone(inputs?.candidate);
const evidence=inputs?.evidence;
const source=inputs?.source;
const byId=new Map(evidence.matched.map(x=>[x.sourceLineId,x.visualBox]));
const supportById=new Map(evidence.matched.map(x=>[x.sourceLineId,x]));
const union=bs=>{const x=Math.min(...bs.map(b=>b.x)),y=Math.min(...bs.map(b=>b.y));return{x,y,width:Math.max(...bs.map(b=>b.x+b.width))-x,height:Math.max(...bs.map(b=>b.y+b.height))-y}};
candidate.stage49.continuationBlocksAssembled=0;
for(const [key,page] of Object.entries(candidate.pages)){
 const lines=new Map(source.pages[key].sourceLines.map(l=>[l.sourceLineId,l]));
 // A labelled mathematical continuation can complete an unnumbered preceding
 // part of the same display. Never collapse two already numbered equations.
 for(const continuation of [...page.objects.filter(o=>o.type==='formula'&&/^[+−-]\s*\d/.test(
  o.sourceText.split('\n').find(t=>/[=≈≤≥⩽⩾]/.test(t)||/^[+−-]\s*\d/.test(t.trim()))?.trim()||''))]){
  const ownLines=continuation.sourceLineIds.map(id=>lines.get(id)),first=Math.min(...ownLines.map(l=>l.bbox.y));
  const options=page.objects.filter(o=>o.type==='formula'&&o!==continuation).map(o=>{
   const ls=o.sourceLineIds.map(id=>lines.get(id)),last=Math.max(...ls.map(l=>l.bbox.y));return {o,ls,last};
  }).filter(x=>first-x.last>0&&first-x.last<=28&&x.ls.some(l=>l.column===ownLines[0].column))
   .filter(x=>{const a=union(x.ls.map(l=>({...l.bbox,y:l.bbox.y-l.bbox.height}))),b=union(ownLines.map(l=>({...l.bbox,y:l.bbox.y-l.bbox.height})));
    return Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))>Math.min(a.width,b.width)*.35;})
   .filter(x=>!page.objects.some(o=>o.type==='equation_number'&&o.sourceLineIds.some(id=>{
    const y=lines.get(id).bbox.y;return y>=Math.min(...x.ls.map(l=>l.bbox.y))-8&&y<=x.last+8;
   })))
   .filter(x=>![...lines.values()].some(l=>l.column===ownLines[0].column&&l.bbox.y>x.last+2&&l.bbox.y<first-2&&/[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(l.text)))
   .sort((a,b)=>b.last-a.last);
  if(!options.length||options.length>1&&options[0].last-options[1].last<5)continue;
  const target=options[0].o;target.sourceLineIds=[...target.sourceLineIds,...continuation.sourceLineIds].sort((a,b)=>lines.get(a).bbox.y-lines.get(b).bbox.y);
  target.sourceCandidateIds=[...(target.sourceCandidateIds||[]),target.objectId,continuation.objectId];
  target.objectId='stage49:'+crypto.createHash('sha256').update(JSON.stringify([key,target.sourceLineIds,'labelled_continuation'])).digest('hex').slice(0,24);
  target.spatialFragments=[{bbox:target.spatialFragments[0].bbox,sourceLineIds:target.sourceLineIds}];
  target.evidence=[...(target.evidence||[]),'labelled_continuation_completes_unlabelled_display'];
  page.objects=page.objects.filter(o=>o!==continuation);
  candidate.stage49.continuationBlocksAssembled++;
 }
 for(const o of page.objects){
  o.memberCount=o.sourceLineIds.length;
  o.memberLineBoxes=o.sourceLineIds.map(id=>({sourceLineId:id,bbox:lines.get(id).bbox}));
  o.sourceText=o.sourceLineIds.map(id=>lines.get(id).text).join('\n');
  if(!['formula','body'].includes(o.type))continue;
  o.spatialFragments=o.spatialFragments.map(f=>({ ...f,bbox:union(f.sourceLineIds.map(id=>byId.get(id)||
   {...lines.get(id).bbox,y:lines.get(id).bbox.y-lines.get(id).bbox.height}))}));
  if(o.type==='body'&&o.sourceLineIds.length===1){
   const support=supportById.get(o.sourceLineIds[0]);
   if(support?.visualFragments.length>1)o.spatialFragments=support.visualFragments.map(bbox=>({bbox,sourceLineIds:o.sourceLineIds,visualOnly:true}));
  }
  o.evidence=[...(o.evidence||[]),'original_pdf_character_support_review_extent'];
 }
 const types={};for(const o of [...page.objects,...page.referenceObjectRefs||[]])types[o.type]=(types[o.type]||0)+1;
 page.summary={...page.summary,objects:page.objects.length+(page.referenceObjectRefs||[]).length,byType:types,
  assigned:[...page.objects,...page.referenceObjectRefs||[]].reduce((n,o)=>n+o.sourceLineIds.length,0),pending:page.pendingMembership.length};
 page.sourceLineCount=lines.size;page.reviewableLineCount=[...lines.values()].filter(l=>l.coverageClass==='reviewable_content').length;
}
candidate.stage49.glyphSupport=evidence.summary;
candidate.summary={...candidate.summary,sourceLines:0,reviewable:0,assigned:0,pending:0,excluded:0,pageLocalObjects:0,byType:{}};
for(const page of Object.values(candidate.pages)){
 for(const [field,value] of Object.entries({sourceLines:page.sourceLineCount,reviewable:page.reviewableLineCount,assigned:page.summary.assigned,pending:page.pendingMembership.length,excluded:page.excludedSourceLines.length,pageLocalObjects:page.objects.length}))candidate.summary[field]+=value;
 for(const [type,n] of Object.entries(page.summary.byType))candidate.summary.byType[type]=(candidate.summary.byType[type]||0)+n;
}
return candidate;
}
module.exports={build};
