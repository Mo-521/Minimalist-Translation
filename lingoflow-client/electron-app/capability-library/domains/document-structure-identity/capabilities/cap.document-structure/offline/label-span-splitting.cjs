"use strict";
const crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,24);
function build(inputs){
const candidate=structuredClone(inputs?.candidate);
const source=structuredClone(inputs?.source);
const spans=inputs?.spans;
for(const s of spans.matched){
 const page=candidate.pages[s.page],inv=source.pages[s.page],parent=inv.sourceLines.find(l=>l.sourceLineId===s.parentSourceLineId);
 if(!parent)throw Error('missing label parent');
 const make=(kind,text,b)=>({...parent,sourceLineId:parent.sourceLineId+':stage49:'+kind,text,
  bbox:{...b,y:b.y+b.height},parentSourceLineId:parent.sourceLineId,sourceSpanKind:kind,
  textSpan:kind==='equation_number'?[0,s.labelText.length]:[s.labelText.length,parent.text.trim().length]});
 const number=make('equation_number',s.labelText,s.labelBox),math=make('formula',s.formulaText,s.formulaBox);
 inv.sourceLines.splice(inv.sourceLines.indexOf(parent),1,number,math);
 const prior=page.objects.find(o=>o.sourceLineIds.includes(parent.sourceLineId));
 if(prior&&prior.type==='formula'){
  prior.sourceLineIds=prior.sourceLineIds.map(id=>id===parent.sourceLineId?math.sourceLineId:id);
  prior.sourceText=prior.sourceLineIds.map(id=>inv.sourceLines.find(l=>l.sourceLineId===id).text).join('\n');
  for(const f of prior.spatialFragments)f.sourceLineIds=f.sourceLineIds.map(id=>id===parent.sourceLineId?math.sourceLineId:id);
  prior.objectId='stage49:'+hash([s.page,prior.sourceLineIds]);
 }else{
  if(prior){prior.sourceLineIds=prior.sourceLineIds.filter(id=>id!==parent.sourceLineId);if(!prior.sourceLineIds.length)page.objects=page.objects.filter(o=>o!==prior);else{
   const ls=prior.sourceLineIds.map(id=>inv.sourceLines.find(l=>l.sourceLineId===id));prior.sourceText=ls.map(l=>l.text).join('\n');
   prior.spatialFragments=ls.map(l=>({bbox:{...l.bbox,y:l.bbox.y-l.bbox.height},sourceLineIds:[l.sourceLineId]}));}}
  const targets=page.objects.filter(o=>o.type==='formula'&&o.spatialFragments.some(f=>
   parent.bbox.y>=f.bbox.y&&parent.bbox.y<=f.bbox.y+f.bbox.height&&
   Math.max(0,Math.min(s.formulaBox.x+s.formulaBox.width,f.bbox.x+f.bbox.width)-Math.max(s.formulaBox.x,f.bbox.x))>Math.min(s.formulaBox.width,f.bbox.width)*.5));
  if(targets.length===1){
   const target=targets[0];target.sourceLineIds.push(math.sourceLineId);
   target.sourceLineIds.sort((a,b)=>inv.sourceLines.find(l=>l.sourceLineId===a).bbox.y-inv.sourceLines.find(l=>l.sourceLineId===b).bbox.y);
   target.sourceText=target.sourceLineIds.map(id=>inv.sourceLines.find(l=>l.sourceLineId===id).text).join('\n');
   target.spatialFragments[0].sourceLineIds.push(math.sourceLineId);target.objectId='stage49:'+hash([s.page,target.sourceLineIds]);
  }else page.objects.push({objectId:'stage49:'+hash([s.page,math.sourceLineId]),type:'formula',sourceLineIds:[math.sourceLineId],sourceText:math.text,
   spatialFragments:[{bbox:s.formulaBox,sourceLineIds:[math.sourceLineId]}],evidence:['mathematical_source_span_after_printed_label']});
 }
 page.pendingMembership=page.pendingMembership.filter(p=>p.sourceLineId!==parent.sourceLineId);
 page.objects.push({objectId:'stage49:'+hash([s.page,number.sourceLineId]),type:'equation_number',sourceLineIds:[number.sourceLineId],sourceText:number.text,
  spatialFragments:[{bbox:s.labelBox,sourceLineIds:[number.sourceLineId]}],evidence:[s.evidence]});
 page.sourceSpanLineage=[...(page.sourceSpanLineage||[]),{parentSourceLineId:parent.sourceLineId,parentSourceText:parent.text,
  formulaSourceLineId:math.sourceLineId,numberSourceLineId:number.sourceLineId,labelTextSpan:number.textSpan,formulaTextSpan:math.textSpan,evidence:s.evidence}];
}
candidate.stage49.labelSplits=spans.matched.length;
return {candidate,source};
}
module.exports={build};
