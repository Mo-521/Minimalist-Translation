"use strict";
// Offline generic inherited pass. Reviewer geometry is not an input.
const crypto=require('node:crypto'),assert=require('node:assert/strict');
function build(inputs){
const before=inputs?.before,frozen=inputs?.source;
const evidence=inputs?.evidence,glyph=inputs?.glyph;
const candidate=structuredClone(before),source=structuredClone(frozen),operations=[],lineage=[],held=[...evidence.held];
const union=bs=>{const x=Math.min(...bs.map(b=>b.x)),y=Math.min(...bs.map(b=>b.y));return{x,y,width:Math.max(...bs.map(b=>b.x+b.width))-x,height:Math.max(...bs.map(b=>b.y+b.height))-y};};
const top=l=>({...l.bbox,y:l.bbox.y-l.bbox.height});
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,24);
const words=t=>(t.match(/[A-Za-z]{3,}/g)||[]).length;
function refresh(o,lines,key,reason,box){
 const parentId=o.objectId;o.sourceLineIds=[...new Set(o.sourceLineIds)].sort((a,b)=>lines.get(a).bbox.y-lines.get(b).bbox.y||lines.get(a).bbox.x-lines.get(b).bbox.x);
 o.memberCount=o.sourceLineIds.length;o.sourceText=o.sourceLineIds.map(id=>lines.get(id).text).join('\n');o.memberLineBoxes=o.sourceLineIds.map(sourceLineId=>({sourceLineId,bbox:lines.get(sourceLineId).bbox}));
 o.objectId='stage68:'+digest([key,o.type,o.sourceLineIds,reason]);o.reconstructionParentObjectIds=[...(o.reconstructionParentObjectIds||[]),parentId].filter(Boolean);
 o.spatialFragments=[{bbox:box||union(o.sourceLineIds.map(id=>glyph.pages[key].lines[id]?.box||top(lines.get(id)))),sourceLineIds:[...o.sourceLineIds]}];
 o.evidence=[...(o.evidence||[]),reason];o.authority='none';o.status='offline_candidate_not_truth';return o;
}
for(const[key,page]of Object.entries(candidate.pages)){
 const inv=source.pages[key],lines=new Map(inv.sourceLines.map(l=>[l.sourceLineId,l]));
 for(const p of evidence.matched.filter(p=>p.key===key)){
  const parent=lines.get(p.parentSourceLineId),owner=page.objects.find(o=>o.sourceLineIds.includes(parent.sourceLineId));
  const texts=p.mode==='left_label_prose'?[parent.text.slice(0,p.cut),parent.text.slice(p.cut)]:[parent.text.slice(p.cut),parent.text.slice(0,p.cut)];
  const spans=[['equation_number',p.labelBox,texts[0],p.mode==='left_label_prose'?{start:0,end:p.cut}:{start:p.cut,end:parent.text.length}],
   [p.mode==='left_label_prose'?'prose':'formula',p.contentBox,texts[1],p.mode==='left_label_prose'?{start:p.cut,end:parent.text.length}:{start:0,end:p.cut}]].map(([kind,b,text,textSpan])=>({...parent,sourceLineId:parent.sourceLineId+':stage68:'+kind,text,bbox:{...b,y:b.y+b.height},sourceSpanKind:kind,parentSourceLineId:parent.sourceLineId,textSpan}));
  if(owner&&owner.type!=='body'){held.push({...p,reason:'protected_owner'});continue;}
  if(p.mode==='right_label_display'){
   const b=p.contentBox;
   const conflict=page.objects.some(o=>['figure','table','caption','reference','heading'].includes(o.type)&&o.spatialFragments.some(f=>b.x>=f.bbox.x&&b.x+b.width<=f.bbox.x+f.bbox.width&&b.y>=f.bbox.y&&b.y+b.height<=f.bbox.y+f.bbox.height));
   if(conflict){held.push({...p,reason:'opaque_or_protected_region'});continue;}
  }
  inv.sourceLines.splice(inv.sourceLines.indexOf(parent),1,...spans);lines.delete(parent.sourceLineId);for(const l of spans)lines.set(l.sourceLineId,l);
  page.pendingMembership=page.pendingMembership.filter(x=>x.sourceLineId!==parent.sourceLineId);
  const beforeObjectId=owner?.objectId;
  if(owner){
   // The label changes horizontal membership, not established paragraph height.
   // Broad native glyph windows can reach nearby formula rows: do not use them
   // to silently undo inherited vertical boundary calibration.
   const fragments=structuredClone(owner.spatialFragments);
   owner.sourceLineIds=owner.sourceLineIds.filter(id=>id!==parent.sourceLineId);owner.sourceLineIds.push(spans[1].sourceLineId);
   for(const f of fragments){f.sourceLineIds=f.sourceLineIds.map(id=>id===parent.sourceLineId?spans[1].sourceLineId:id);
    const bs=f.sourceLineIds.map(id=>id===spans[1].sourceLineId?p.contentBox:glyph.pages[key].lines[id]?.box||top(lines.get(id)));
    const x=Math.min(...bs.map(b=>b.x)),right=Math.max(...bs.map(b=>b.x+b.width));f.bbox={...f.bbox,x,width:right-x};}
   refresh(owner,lines,key,'cross_column_label_removed_from_prose',union(fragments.map(f=>f.bbox)));owner.spatialFragments=fragments;
  }
  else page.objects.push(refresh({type:'formula',sourceLineIds:[spans[1].sourceLineId],evidence:['printed_label','indented_mathematical_region','non_prose_grammar']},lines,key,'pending_numbered_display_recalled',p.contentBox));
  page.objects.push(refresh({type:'equation_number',sourceLineIds:[spans[0].sourceLineId],evidence:['original_pdf_printed_label','not_page_furniture']},lines,key,'printed_label_isolated',p.labelBox));
  const record={key,parentSourceLineId:parent.sourceLineId,parentText:parent.text,spans:spans.map(l=>({sourceLineId:l.sourceLineId,text:l.text,textSpan:l.textSpan,bbox:l.bbox})),upstreamHintConflict:p.upstreamHintConflict,displayTargets:p.displayTargets};
  lineage.push(record);page.sourceSpanLineage=[...(page.sourceSpanLineage||[]),record];operations.push({...record,kind:p.mode==='left_label_prose'?'cross_column_equation_label_partition':'pending_display_and_label_recalled',beforeObjectId});
 }
 // Existing formula fragments also need membership reconstruction. Only
 // narrow subordinate rows aligned with a separately evidenced large operator
 // may join. Adjacent ordinary relation formulas have no such anchor.
 for(const child of [...page.objects].filter(o=>o.type==='formula'&&o.memberCount<=5&&words(o.sourceText)===0)){
  if(!page.objects.includes(child)||child.spatialFragments.length!==1)continue;
  const b=child.spatialFragments[0].bbox,ls=child.sourceLineIds.map(id=>lines.get(id));
  if(b.width>70||b.height>65||!/[Α-ωρβγ∈≤≥<>]/u.test(child.sourceText))continue;
  const targets=[];
  for(const anchor of evidence.operatorAnchors[key]||[]){
   const parent=page.objects.find(o=>o.objectId===anchor.objectId||(o.reconstructionParentObjectIds||[]).includes(anchor.objectId));if(!parent||parent===child||parent.spatialFragments.length!==1)continue;
   const a=anchor.box,r=parent.spatialFragments[0].bbox,h=Math.max(...ls.map(l=>l.bbox.height));
   if(r.width<b.width*3||Math.abs(b.x+b.width/2-a.x-a.width/2)>Math.max(a.width,b.width)*.65||b.y<a.y||b.y-a.y-a.height>h*2.5||b.y+b.height-a.y>h*7)continue;
   const gap=Math.max(0,b.y-r.y-r.height);if(gap>h*1.5)continue;
   const intervening=page.objects.some(o=>o!==child&&o!==parent&&o.spatialFragments.some(f=>{const q=f.bbox;return q.y+q.height/2>r.y+r.height&&q.y+q.height/2<b.y&&q.x<b.x+b.width&&q.x+q.width>b.x;}));
   if(!intervening)targets.push({parent,anchor,gap});
  }
  const unique=[...new Map(targets.map(t=>[t.parent.objectId,t])).values()];
  if(unique.length!==1){if(unique.length)held.push({key,objectId:child.objectId,reason:'subordinate_operator_target_ambiguous'});continue;}
  const {parent,anchor,gap}=unique[0],oldIds=[parent.objectId,child.objectId],box=union([parent.spatialFragments[0].bbox,b]);
  parent.sourceLineIds.push(...child.sourceLineIds);refresh(parent,lines,key,'operator_subordinate_members_regrouped',box);page.objects.splice(page.objects.indexOf(child),1);
  operations.push({key,kind:'existing_formula_subordinate_regrouped',beforeObjectIds:oldIds,afterObjectId:parent.objectId,sourceLineIds:child.sourceLineIds,operatorEvidence:anchor,gap});
 }
 const counts=new Map(inv.sourceLines.map(l=>[l.sourceLineId,0]));for(const o of [...page.objects,...page.referenceObjectRefs||[]])for(const id of o.sourceLineIds){assert(counts.has(id));counts.set(id,counts.get(id)+1);}for(const x of [...page.pendingMembership,...page.excludedSourceLines]){assert(counts.has(x.sourceLineId));counts.set(x.sourceLineId,counts.get(x.sourceLineId)+1);}assert([...counts.values()].every(n=>n===1),key+': ownership');
 if(operations.some(o=>o.key===key)){const byType={};for(const o of [...page.objects,...page.referenceObjectRefs||[]])byType[o.type]=(byType[o.type]||0)+1;page.summary={...page.summary,byType,objects:page.objects.length+(page.referenceObjectRefs||[]).length,pending:page.pendingMembership.length};page.sourceLineCount=inv.sourceLines.length;}
}
candidate.stage68={authority:'none',status:'offline_candidate_not_truth',operations,held};source.stage68={authority:'none',status:'derived_evidence_not_truth',lineage};
candidate.stage68.diagnostics={pages:Object.keys(candidate.pages).length,sourceUnits:Object.values(source.pages).reduce((n,p)=>n+p.sourceLines.length,0),byType:{},pending:0};
for(const p of Object.values(candidate.pages)){candidate.stage68.diagnostics.pending+=p.pendingMembership.length;for(const o of p.objects)candidate.stage68.diagnostics.byType[o.type]=(candidate.stage68.diagnostics.byType[o.type]||0)+1;}
return {candidate,source};
}
module.exports={build};
