"use strict";
const assert=require('node:assert/strict');
function build(inputs){
const before=inputs?.before,frozen=inputs?.source,evidence=inputs?.evidence,front=inputs?.front;
const after=structuredClone(before),source=structuredClone(frozen),operations=[],held=[],lineage=[];
const union=bs=>{const x=Math.min(...bs.map(b=>b.x)),y=Math.min(...bs.map(b=>b.y));return{x,y,width:Math.max(...bs.map(b=>b.x+b.width))-x,height:Math.max(...bs.map(b=>b.y+b.height))-y};};
const intersects=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
function refresh(o,inv){const m=new Map(inv.sourceLines.map(l=>[l.sourceLineId,l]));o.sourceText=o.sourceLineIds.map(id=>m.get(id).text).join('\n');o.memberCount=o.sourceLineIds.length;o.memberLineBoxes=o.sourceLineIds.map(id=>({sourceLineId:id,bbox:m.get(id).bbox}));}
for(const p of evidence.proposals){
 const page=after.pages[p.key],inv=source.pages[p.key],parent=inv.sourceLines.find(l=>l.sourceLineId===p.sourceLineId),body=page.objects.find(o=>o.objectId===p.bodyObjectId),formula=page.objects.find(o=>o.objectId===p.formulaObjectId);
 if(!parent||!body||!formula||formula.type!=='formula'||body.type!=='body'||p.guards.length!==5){held.push({...p,reason:'invalid_partition_evidence'});continue;}
 assert.equal(parent.text.slice(0,p.splitAt),p.proseText);assert.equal(parent.text.slice(p.splitAt),p.mathText);
 const spans=[['prose',p.proseBox,0,p.splitAt],['display_member',p.mathBox,p.splitAt,parent.text.length]].map(([kind,b,start,end])=>({...parent,sourceLineId:parent.sourceLineId+':stage71:'+kind,text:parent.text.slice(start,end),bbox:{...b,y:b.y+b.height},sourceSpanKind:kind,parentSourceLineId:parent.sourceLineId,textSpan:{start,end}}));
 inv.sourceLines.splice(inv.sourceLines.indexOf(parent),1,...spans);body.sourceLineIds=body.sourceLineIds.map(id=>id===parent.sourceLineId?spans[0].sourceLineId:id);
 for(const f of body.spatialFragments)f.sourceLineIds=f.sourceLineIds.map(id=>id===parent.sourceLineId?spans[0].sourceLineId:id);
 formula.sourceLineIds.unshift(spans[1].sourceLineId);const nearest=formula.spatialFragments.find(f=>intersects(f.bbox,p.mathBox)>0);assert(nearest);
 nearest.sourceLineIds.unshift(spans[1].sourceLineId);const oldBox=structuredClone(nearest.bbox);nearest.bbox=union([nearest.bbox,p.mathBox]);
 refresh(body,inv);refresh(formula,inv);body.evidence=[...(body.evidence||[]),'native_prose_prefix_partitioned'];formula.evidence=[...(formula.evidence||[]),'foreign_display_span_owned','native_glyph_extent_without_padding'];
 const record={key:p.key,parentSourceLineId:parent.sourceLineId,parentText:parent.text,spans:spans.map(l=>({sourceLineId:l.sourceLineId,text:l.text,textSpan:l.textSpan,bbox:l.bbox})),evidence:p.guards};lineage.push(record);page.sourceSpanLineage=[...(page.sourceSpanLineage||[]),record];operations.push({key:p.key,kind:'fused_prose_display_source_partition',bodyObjectId:body.objectId,formulaObjectId:formula.objectId,parentSourceLineId:parent.sourceLineId,oldFormulaBox:oldBox,newFormulaBox:nearest.bbox,visualExtentChanged:JSON.stringify(oldBox)!==JSON.stringify(nearest.bbox)});
}
for(const[key,page]of Object.entries(after.pages)){
 const inv=source.pages[key],m=new Map(inv.sourceLines.map(l=>[l.sourceLineId,l]));
 for(const small of [...page.objects].filter(o=>o.type==='formula'&&o.spatialFragments.length===1&&/^(?:\s*[A-Za-z]\s*=\s*\d+\s*){2,}$/u.test(o.sourceText))){
  const b=small.spatialFragments[0].bbox;
  const targets=page.objects.filter(o=>o!==small&&o.type==='formula'&&o.spatialFragments.length===1).filter(o=>{
   const f=o.spatialFragments[0].bbox,p=evidence.proposals.find(p=>p.key===key&&p.formulaObjectId===o.objectId),operators=p?.rawMathGlyphs.filter(g=>g.text==='(cid:88)'||g.text==='∑').length||0;
   return operators>=2&&b.height<f.height*.6&&b.x>=f.x&&b.x+b.width<=f.x+f.width&&b.y-f.y-f.height>=-1&&b.y-f.y-f.height<f.height*.3;
  });
  if(targets.length!==1)continue;const target=targets[0],combined=union([target.spatialFragments[0].bbox,b]);
  if(page.objects.some(o=>o!==small&&o!==target&&['body','abstract','caption','heading','table','figure','equation_number'].includes(o.type)&&o.spatialFragments.some(f=>intersects(combined,f.bbox)>0)))continue;
  target.sourceLineIds.push(...small.sourceLineIds);target.spatialFragments=[{bbox:combined,sourceLineIds:[...target.sourceLineIds]}];refresh(target,inv);target.evidence.push('native_multiple_sum_anchor_with_aligned_lower_limits');page.objects.splice(page.objects.indexOf(small),1);operations.push({key,kind:'aligned_repeated_limits_attached',formulaObjectId:target.objectId,removedObjectId:small.objectId,sourceLineIds:small.sourceLineIds});
 }
 if(Number(key.split(':')[1])===1){
  for(const o of page.objects.filter(o=>o.type==='body'&&/^Abstract\s*[—:–-]/u.test(o.sourceText)&&o.sourceText.split(/\s+/).length>80)){
   const glyphs=o.sourceLineIds.map(id=>front.pages[key].lines[id]);
   if(glyphs.some(g=>!g||g.textSimilarity<.9)||o.spatialFragments.length!==1||new Set(glyphs.map(g=>g.font)).size>2)continue;
   const start=o.spatialFragments[0].bbox.y,headings=page.objects.filter(x=>x.type==='heading').flatMap(x=>x.spatialFragments.map(f=>f.bbox.y));
   if(headings.some(y=>y<start))continue;o.type='abstract';o.evidence=[...(o.evidence||[]),'explicit_abstract_lead_and_front_typography'];operations.push({key,kind:'explicit_front_abstract_retyped',objectId:o.objectId});
  }
 }
 for(const label of evidence.labelRows.filter(l=>l.key===key)){
  const l=m.get(label.sourceLineId);if(!/^(?:Keywords|Index Terms)\s*:/iu.test(l.text)||Number(key.split(':')[1])!==1)continue;
  const targets=page.objects.filter(o=>o.type==='body'&&o.sourceLineIds.length===1).filter(o=>{const v=m.get(o.sourceLineIds[0]),b=v.bbox,gap=b.x-label.box.x-label.box.width;return Math.abs(b.y-l.bbox.y)<1&&Math.abs(b.height-l.bbox.height)<1&&gap>=0&&gap<label.size*1.5&&/[—;,]/u.test(v.text)&&v.text.length<500&&!/[.!?]\s*$/u.test(v.text);});
  if(targets.length!==1){held.push({key,sourceLineId:l.sourceLineId,reason:'metadata_value_not_unique'});continue;}
  const target=targets[0],b=union([label.box,...target.spatialFragments.map(f=>f.bbox)]);
  if(page.objects.some(o=>o!==target&&o.spatialFragments.some(f=>intersects(b,f.bbox)>0))){held.push({key,sourceLineId:l.sourceLineId,reason:'metadata_boundary_conflict'});continue;}
  const abstracts=page.objects.filter(o=>o.type==='abstract');if(!abstracts.some(o=>o.spatialFragments.some(f=>f.bbox.y+f.bbox.height<label.box.y)))continue;
  target.sourceLineIds.unshift(l.sourceLineId);target.type='unsupported_structured_block';target.unsupportedKind='publication_metadata';target.spatialFragments=[{bbox:b,sourceLineIds:[...target.sourceLineIds]}];refresh(target,inv);target.evidence=[...(target.evidence||[]),'same_row_label_value_metadata','native_label_glyph_support','abstract_following_metadata_position'];
  if(l.column!==m.get(target.sourceLineIds[1]).column)target.upstream_hint_conflict={kind:'same_row_label_value_lane_disagreement',action:'structure_only_compatibility_exception'};
  page.pendingMembership=page.pendingMembership.filter(x=>x.sourceLineId!==l.sourceLineId);operations.push({key,kind:'leading_metadata_label_value_owned',objectId:target.objectId,sourceLineId:l.sourceLineId});
 }
 if(operations.some(o=>o.key===key)){const byType={};for(const o of [...page.objects,...page.referenceObjectRefs||[]])byType[o.type]=(byType[o.type]||0)+1;page.summary={...page.summary,byType,objects:page.objects.length+(page.referenceObjectRefs||[]).length,pending:page.pendingMembership.length};page.sourceLineCount=inv.sourceLines.length;}
}
after.stage71={authority:'none',status:'offline_candidate_not_truth',operations,held};source.stage71={authority:'none',status:'derived_evidence_not_truth',lineage};
return {candidate:after,source};
}
module.exports={build};
