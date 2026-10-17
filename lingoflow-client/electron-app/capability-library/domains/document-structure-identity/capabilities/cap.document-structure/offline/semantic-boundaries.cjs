"use strict";
// One mechanism suite over every page. Human rectangles are never inputs here.
const crypto=require('node:crypto'),assert=require('node:assert/strict');
function build(inputs){
const before=inputs?.before;
const frozen=inputs?.source;
const glyph=inputs?.glyph;
const after=structuredClone(before),source=structuredClone(frozen),operations=[],held=[],lineage=[];
const words=t=>(t.match(/[A-Za-z]{3,}/g)||[]).length;
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)]||0;
const terminal=t=>/[.!?](?:["')\]]|\s|□)*$/u.test(t.trim());
const union=bs=>{const x=Math.min(...bs.map(b=>b.x)),y=Math.min(...bs.map(b=>b.y));return{x,y,width:Math.max(...bs.map(b=>b.x+b.width))-x,height:Math.max(...bs.map(b=>b.y+b.height))-y};};
const pad=b=>({x:b.x-.5,y:b.y-.5,width:b.width+1,height:b.height+1});
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,24);
const intersection=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
function refresh(o,lines,support){
 o.sourceLineIds=[...new Set(o.sourceLineIds)].sort((a,b)=>lines.get(a).bbox.y-lines.get(b).bbox.y||lines.get(a).bbox.x-lines.get(b).bbox.x);
 o.sourceText=o.sourceLineIds.map(id=>lines.get(id).text).join('\n');o.memberCount=o.sourceLineIds.length;
 o.memberLineBoxes=o.sourceLineIds.map(sourceLineId=>({sourceLineId,bbox:lines.get(sourceLineId).bbox}));
 const boxes=o.sourceLineIds.map(id=>support[id]?.box||{...lines.get(id).bbox,y:lines.get(id).bbox.y-lines.get(id).bbox.height});
 o.spatialFragments=[{bbox:pad(union(boxes)),sourceLineIds:[...o.sourceLineIds]}];
}
function newObject(key,type,ids,template,lines,support){
 const o={...structuredClone(template),objectId:'stage67:'+digest([key,type,ids]),type,sourceLineIds:ids,authority:'none',status:'offline_candidate_not_truth'};
 o.reconstructionParentObjectIds=[template.objectId];
 o.evidence=type==='formula'?['source_region_display_isolation','math_led_relation','prose_boundary_on_both_sides','original_pdf_glyph_support']:['prose_boundary_reconstruction','original_pdf_glyph_support'];
 delete o.sourceCandidateIds;
 delete o.internalVisualHints;refresh(o,lines,support);return o;
}
function counts(page){const m=new Map();for(const o of [...page.objects,...(page.referenceObjectRefs||[])])for(const id of o.sourceLineIds)m.set(id,(m.get(id)||0)+1);for(const x of [...page.pendingMembership,...page.excludedSourceLines])m.set(x.sourceLineId,(m.get(x.sourceLineId)||0)+1);return m;}
for(const[key,page]of Object.entries(after.pages)){
 const lines=new Map(source.pages[key].sourceLines.map(l=>[l.sourceLineId,l])),support=glyph.pages[key].lines;
 // Detect source-region display breaks before treating grammatical continuity
 // as permission to merge a paragraph's frames. Natural qualifiers can occur
 // within math-led display rows; prose-led math remains guarded.
 for(const body of [...page.objects].filter(o=>o.type==='body'&&o.memberCount>=4&&!o.internalVisualHints)){
  const rows=body.sourceLineIds.map(id=>lines.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y);
  const prose=rows.filter(l=>words(l.text)>=6);if(prose.length<2)continue;
  const left=median(prose.map(l=>l.bbox.x)),width=median(prose.map(l=>l.bbox.width)),h=median(prose.map(l=>l.bbox.height));
  const mathLed=l=>!/https?:|www\.|github\./iu.test(l.text)&&/^[A-Za-zΑ-ω][\w_^{}(),\s]*[=≤≥<>≃≡]/u.test(l.text.trim())&&/[=≤≥<>≃≡]/u.test(l.text)&&words(l.text)<=5;
  const cores=rows.map((l,i)=>({l,i})).filter(({l})=>mathLed(l)&&l.bbox.x-left>Math.max(24,h*3)&&l.bbox.width<width*.8&&Math.abs(l.bbox.x+l.bbox.width/2-left-width/2)<width*.18);
  const regions=[];
  for(const{l,i}of cores){
   const compatible=q=>q.column===l.column&&words(q.text)<=1&&q.bbox.x-left>h*3&&q.bbox.width<width*.8&&q.bbox.y-l.bbox.y<=h*2.5&&l.bbox.y-q.bbox.y<=h*2.5;
   let start=i,end=i;while(start>0&&compatible(rows[start-1]))start--;while(end+1<rows.length&&compatible(rows[end+1]))end++;
   if(start===0||end===rows.length-1)continue;
   const above=rows[start-1],below=rows[end+1],members=rows.slice(start,end+1),g=union(members.map(q=>support[q.sourceLineId]?.box||{...q.bbox,y:q.bbox.y-q.bbox.height}));
   const a=support[above.sourceLineId]?.box,b=support[below.sourceLineId]?.box;
   if(!a||!b||words(above.text)<4||words(below.text)<4||Math.abs(above.bbox.x-left)>h||Math.abs(below.bbox.x-left)>h)continue;
   if(g.y-a.y-a.height<h*.35||b.y-g.y-g.height<h*.35)continue;
   if(regions.some(r=>start<=r.end&&end>=r.start))continue;
   regions.push({start,end,evidence:{indent:l.bbox.x-left,widthRatio:l.bbox.width/width,upperGlyphGap:g.y-a.y-a.height,lowerGlyphGap:b.y-g.y-g.height,mathLed:true}});
  }
  if(!regions.length)continue;
  regions.sort((a,b)=>a.start-b.start);const children=[];let cursor=0;
  for(const r of regions){if(r.start>cursor)children.push(newObject(key,'body',rows.slice(cursor,r.start).map(l=>l.sourceLineId),body,lines,support));children.push(newObject(key,'formula',rows.slice(r.start,r.end+1).map(l=>l.sourceLineId),body,lines,support));cursor=r.end+1;}
  if(cursor<rows.length)children.push(newObject(key,'body',rows.slice(cursor).map(l=>l.sourceLineId),body,lines,support));
  page.objects.splice(page.objects.indexOf(body),1,...children);operations.push({key,kind:'undetected_display_region_split',beforeObjectId:body.objectId,afterObjectIds:children.map(o=>o.objectId),regions});
 }
 // A mathematical-looking condition can complete a prose sentence. It needs
 // normal lane alignment, normal flow, unfinished grammar and unique ownership.
 const tails=[...page.pendingMembership.map(p=>({pending:p,ids:[p.sourceLineId]})),...page.objects.filter(o=>o.type==='formula'&&o.memberCount<=2&&o.sourceText.length<=120).map(o=>({object:o,ids:o.sourceLineIds}))];
 for(const tail of tails){
  if(tail.object&&!page.objects.includes(tail.object))continue;
  const rs=tail.ids.map(id=>lines.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y),first=rs[0],text=rs.map(l=>l.text).join(' ');
  if(/^\s*\(?\d+(?:\.\d+)*\)?\s*$/u.test(text)||!terminal(text))continue;
  const copula=/^(?:is|are|was|were|equals|satisfies)\s+\S/u.test(text.trim());
  const condition=/^[A-Za-zΑ-ω][\w_^{}(),\s]*[=≤≥<>]/u.test(text.trim())&&/[=≤≥<>]/u.test(text);
  if(!copula&&!condition)continue;
  const targets=[];
  for(const body of page.objects.filter(o=>o.type==='body'&&o.memberCount>=2&&!o.internalVisualHints)){
   const bs=body.sourceLineIds.map(id=>lines.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y),last=bs.at(-1),h=median(bs.map(l=>l.bbox.height));
   const rhythm=median(bs.slice(1).map((l,i)=>l.bbox.y-bs[i].bbox.y).filter(d=>d>h*.5&&d<h*2));
   const step=first.bbox.y-last.bbox.y,left=median(bs.map(l=>l.bbox.x));
   if(first.column!==last.column||step<=2||step>Math.max(rhythm,h)*1.85||Math.abs(first.bbox.x-left)>h*.6||terminal(last.text)||words(last.text)<5)continue;
   const grammar=copula&&/[A-Za-z]{3,}\s*$/u.test(last.text)||condition&&/\b(?:whenever|provided|assuming|if)\s*$/iu.test(last.text);
   if(!grammar)continue;
   const conflict=page.objects.some(o=>o!==body&&o!==tail.object&&o.spatialFragments.some(f=>{const b=f.bbox;return b.y+b.height/2>last.bbox.y&&b.y+b.height/2<first.bbox.y&&intersection(b,{x:left,y:last.bbox.y,width:Math.max(first.bbox.width,last.bbox.width),height:step})>0;}));
   if(!conflict)targets.push({body,evidence:{normalLane:true,step,rhythm,unfinishedGrammar:true,proseWords:words(last.text),copula,condition}});
  }
  if(targets.length!==1)continue;
  const {body,evidence}=targets[0],beforeIds=[body.objectId,...(tail.object?[tail.object.objectId]:[])];
  body.sourceLineIds.push(...tail.ids);refresh(body,lines,support);body.objectId='stage67:'+digest([key,beforeIds,body.sourceLineIds]);
  if(tail.object)page.objects.splice(page.objects.indexOf(tail.object),1);else page.pendingMembership=page.pendingMembership.filter(p=>p.sourceLineId!==tail.pending.sourceLineId);
  operations.push({key,kind:tail.object?'inline_condition_restored_to_body':'mathematical_prose_tail_attached',beforeObjectIds:beforeIds,afterObjectId:body.objectId,sourceLineIds:tail.ids,evidence});
 }
 // Split a fused source only when exact PDF prose text, separate math glyphs
 // and a unique existing display independently corroborate the partition.
 for(const split of glyph.pages[key].mixedSpans){
  const parent=lines.get(split.sourceLineId);if(parent.sourceSpanKind)continue;
  const owning=page.objects.find(o=>o.sourceLineIds.includes(parent.sourceLineId)),pending=page.pendingMembership.find(p=>p.sourceLineId===parent.sourceLineId);
  if(owning&&owning.type!=='body'||!owning&&!pending)continue;
  const proseGrammar=words(split.prefix)>=2||owning&&/^[a-z]{4,}$/u.test(split.prefix)&&owning.type==='body';if(!proseGrammar)continue;
  const targets=page.objects.filter(o=>o.type==='formula'&&o.spatialFragments.some(f=>{
   const b=f.bbox,g=split.suffixBox;return g.x>=b.x-2&&g.x+g.width<=b.x+b.width+2&&g.y>=b.y-8&&g.y+g.height<=b.y+b.height+8;
  }));
  if(targets.length!==1){held.push({key,sourceLineId:parent.sourceLineId,reason:'mixed_source_display_target_ambiguous'});continue;}
  const spans=[['prose',split.prefixBox,0,split.splitAt],['math_member',split.suffixBox,split.splitAt,parent.text.length]].map(([kind,b,start,end])=>({...parent,
   sourceLineId:parent.sourceLineId+':stage67:'+kind,text:parent.text.slice(start,end),bbox:{...b,y:b.y+b.height},parentSourceLineId:parent.sourceLineId,sourceSpanKind:kind,textSpan:{start,end}}));
  source.pages[key].sourceLines.splice(source.pages[key].sourceLines.findIndex(l=>l.sourceLineId===parent.sourceLineId),1,...spans);lines.delete(parent.sourceLineId);
  for(const [index,l]of spans.entries()){lines.set(l.sourceLineId,l);support[l.sourceLineId]={box:index?split.suffixBox:split.prefixBox,glyphCount:1,horizontalCoverage:1};}
  if(owning){owning.sourceLineIds=owning.sourceLineIds.filter(id=>id!==parent.sourceLineId);owning.sourceLineIds.push(spans[0].sourceLineId);refresh(owning,lines,support);}
  else{page.pendingMembership=page.pendingMembership.filter(p=>p.sourceLineId!==parent.sourceLineId);page.objects.push(newObject(key,'body',[spans[0].sourceLineId],targets[0],lines,support));}
  targets[0].sourceLineIds.push(spans[1].sourceLineId);refresh(targets[0],lines,support);
  const record={key,parentSourceLineId:parent.sourceLineId,parentText:parent.text,spans:spans.map(s=>({sourceLineId:s.sourceLineId,text:s.text,textSpan:s.textSpan,bbox:s.bbox})),formulaObjectId:targets[0].objectId};
  lineage.push(record);operations.push({...record,kind:'mixed_prose_math_source_partition'});
  page.sourceSpanLineage=[...(page.sourceSpanLineage||[]),record];
  // Re-evaluate the clean prose span only AFTER removing the fused math.
  // A lowercase tail at normal line rhythm may complete the preceding body;
  // an independent introduction must remain separate from the next display.
  if(owning&&owning.memberCount===1&&/^[a-z]+(?:\s+[a-z]+)?$/u.test(split.prefix)){
   const first=spans[0],targets=page.objects.filter(o=>o!==owning&&o.type==='body'&&o.memberCount>=2&&!o.internalVisualHints).filter(o=>{
    const rs=o.sourceLineIds.map(id=>lines.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y),last=rs.at(-1),h=median(rs.map(l=>l.bbox.height));
    const step=first.bbox.y-last.bbox.y,left=median(rs.map(l=>l.bbox.x));
    return first.column===last.column&&step>2&&step<h*2&&Math.abs(first.bbox.x-left)<h*.6&&!terminal(last.text)&&words(last.text)>=4&&
     !page.objects.some(other=>other!==o&&other!==owning&&other.spatialFragments.some(f=>{const b=f.bbox;return b.y+b.height/2>last.bbox.y&&b.y+b.height/2<first.bbox.y&&intersection(b,{x:left,y:last.bbox.y,width:last.bbox.width,height:step})>0;}));
   });
   if(targets.length===1){const target=targets[0];target.sourceLineIds.push(first.sourceLineId);refresh(target,lines,support);page.objects.splice(page.objects.indexOf(owning),1);
    operations.push({key,kind:'partitioned_prose_tail_attached',beforeObjectIds:[target.objectId,owning.objectId],afterObjectId:target.objectId,sourceLineIds:[first.sourceLineId]});}
  }
 }
 // Check ALL inherited body frames, not just modified Objects. Enlarge only
 // reliable member coverage; nearby non-body collisions remain held diagnostics.
 for(const body of page.objects.filter(o=>o.type==='body'&&!o.internalVisualHints))for(const[index,fragment]of body.spatialFragments.entries()){
  const matched=fragment.sourceLineIds.map(id=>support[id]);if(matched.some(s=>!s?.box||s.horizontalCoverage<.9))continue;
  const g=union(matched.map(s=>s.box)),old=fragment.bbox;
  const miss=Math.max(old.x-g.x,old.y-g.y,g.x+g.width-old.x-old.width,g.y+g.height-old.y-old.height);
  if(miss<1.5)continue;
  const h=median(fragment.sourceLineIds.map(id=>lines.get(id).bbox.height)),proposed=union([old,g]);
  // Small font-metric differences are not missing rows and are not a license
  // to inflate every paragraph rectangle. Keep them diagnostic only.
  if(miss<h*.65)continue;
  if(proposed.height-old.height>h*2.5||proposed.width-old.width>h*2){held.push({key,objectId:body.objectId,reason:'member_coverage_large_growth',miss});continue;}
  const conflicts=page.objects.filter(o=>o!==body&&o.spatialFragments.some(f=>intersection(proposed,f.bbox)>intersection(old,f.bbox)+1));
  if(conflicts.length){held.push({key,objectId:body.objectId,reason:'member_coverage_neighbor_conflict',conflictObjectIds:conflicts.map(o=>o.objectId),miss});continue;}
  fragment.bbox=proposed;operations.push({key,kind:'inherited_member_frame_coverage_repaired',objectId:body.objectId,fragmentIndex:index,oldBox:old,newBox:proposed,miss});
 }
 const actual=counts(page),expected=new Set(source.pages[key].sourceLines.map(l=>l.sourceLineId));assert.equal(actual.size,expected.size,key);assert([...actual].every(([id,n])=>expected.has(id)&&n===1),key+': ownership');
 if(operations.some(o=>o.key===key)){const byType={};for(const o of [...page.objects,...(page.referenceObjectRefs||[])])byType[o.type]=(byType[o.type]||0)+1;page.summary={...page.summary,objects:page.objects.length+(page.referenceObjectRefs||[]).length,byType};}
}
after.stage67={authority:'none',status:'offline_candidate_not_truth',operations,held};
source.stage67={authority:'none',status:'derived_evidence_not_truth',lineage};
return {candidate:after,source};
}
module.exports={build};
