"use strict";
const crypto=require('node:crypto'),assert=require('node:assert/strict');
function build(inputs){
const before=inputs?.before;
const source=inputs?.source;
const after=structuredClone(before),operations=[],held=[];
const median=xs=>{const a=[...xs].sort((a,b)=>a-b);return a[Math.floor(a.length/2)]||0;};
const words=t=>(t.match(/[A-Za-z]{3,}/g)||[]).length;
const terminal=t=>/[.!?](?:[”’"')\]]|\s|□)*$/u.test(t.trim());
const label=t=>/^(?:Proof|Remark|Theorem|Lemma|Proposition|Corollary|Assumption|Example)(?:\s|[.:])/u.test(t);
const citation=t=>/^\([^)]{3,}\b\d{4}\b[^)]*\)$/u.test(t.trim());
const list=t=>/^(?:\d+[.)]|[a-z][.)]|[•●▪]|[-–])\s+/u.test(t);
function listContext(line,pageLines){
 const numbered=/^(\d+)[.)]\s+[A-Z]/u.exec(line.text.trim());
 const bullet=/^[•●▪-]\s+[A-Za-z]/u.test(line.text.trim());
 if(!numbered&&!bullet)return false;
 return pageLines.some(other=>{
  if(other===line||other.column!==line.column||words(other.text)<4||Math.abs(other.bbox.x-line.bbox.x)>3||Math.abs(other.bbox.y-line.bbox.y)>120)return false;
  if(numbered){const match=/^(\d+)[.)]\s+[A-Z]/u.exec(other.text.trim());return match&&Math.abs(Number(match[1])-Number(numbered[1]))===1;}
  return /^[•●▪-]\s+[A-Za-z]/u.test(other.text.trim());
 });
}
const union=bs=>{const x=Math.min(...bs.map(b=>b.x)),y=Math.min(...bs.map(b=>b.y));return {x,y,width:Math.max(...bs.map(b=>b.x+b.width))-x,height:Math.max(...bs.map(b=>b.y+b.height))-y};};
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,24);
function membership(p){const m=new Map();for(const o of [...p.objects,...(p.referenceObjectRefs||[])])for(const id of o.sourceLineIds)m.set(id,(m.get(id)||0)+1);for(const x of [...p.pendingMembership,...p.excludedSourceLines])m.set(x.sourceLineId,(m.get(x.sourceLineId)||0)+1);return [...m].sort(([a],[b])=>a.localeCompare(b));}
function refresh(o,lines){o.sourceLineIds=[...new Set(o.sourceLineIds)].sort((a,b)=>lines.get(a).bbox.y-lines.get(b).bbox.y||lines.get(a).bbox.x-lines.get(b).bbox.x);o.memberCount=o.sourceLineIds.length;o.memberLineBoxes=o.sourceLineIds.map(sourceLineId=>({sourceLineId,bbox:lines.get(sourceLineId).bbox}));o.sourceText=o.sourceLineIds.map(id=>lines.get(id).text).join('\n');}
function fragmentsFor(ids,old,lines){
 const selected=new Set(ids),out=[];
 for(const f of old.spatialFragments){
  const members=f.sourceLineIds.filter(id=>selected.has(id));if(!members.length)continue;
  if(members.length===f.sourceLineIds.length){out.push({...structuredClone(f),sourceLineIds:members});continue;}
  // Keep the already aligned frame's x extent and obtain partition y boundaries
  // from adjacent original source rows. Exact glyph rendering is a separate check.
  const all=f.sourceLineIds.map(id=>lines.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y);
  const included=members.map(id=>lines.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y);
  const first=included[0],last=included.at(-1);
  const prior=all.filter(l=>l.bbox.y<first.bbox.y).at(-1),next=all.find(l=>l.bbox.y>last.bbox.y);
  const top=prior?(prior.bbox.y+first.bbox.y)/2- first.bbox.height*.45:f.bbox.y;
  const bottom=next?(last.bbox.y+next.bbox.y)/2-last.bbox.height*.4:f.bbox.y+f.bbox.height;
  out.push({bbox:{...f.bbox,y:Math.max(f.bbox.y,top),height:Math.max(1,Math.min(f.bbox.y+f.bbox.height,bottom)-Math.max(f.bbox.y,top))},sourceLineIds:members});
 }
 return out;
}
for(const [key,page] of Object.entries(after.pages)){
 const lines=new Map(source.pages[key].sourceLines.map(l=>[l.sourceLineId,l]));
 for(const body of [...page.objects].filter(o=>o.type==='body'&&o.sourceLineIds.length>1)){
  const rows=body.sourceLineIds.map(id=>lines.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x);
  const prose=rows.filter(l=>words(l.text)>=3),rhythm=median(prose.slice(1).map((l,i)=>l.bbox.y-prose[i].bbox.y).filter(g=>g>2&&g<40));
  const cuts=[];
  for(let i=1;i<rows.length;i++){
   const current=rows[i],previous=rows[i-1],height=Math.max(current.bbox.height,previous.bbox.height),step=current.bbox.y-previous.bbox.y;
   if(current.column!==previous.column||step<=2||words(current.text)<4)continue;
   const priorProse=rows.slice(Math.max(0,i-4),i).filter(l=>words(l.text)>=3);
   const left=median(priorProse.map(l=>l.bbox.x)),indent=current.bbox.x-left;
   const spaced=rhythm>0&&step>rhythm*1.25;
   const indented=indent>Math.max(4,current.bbox.height*.6);
   const complete=terminal(previous.text);
   let reason;
   if(label(current.text.trim())&&complete&&(spaced||step>=height*1.25))reason='semantic_label_after_complete_unit';
   else if(citation(previous.text)&&/^[A-Z]/u.test(current.text.trim())&&step>height*1.5&&previous.bbox.x-current.bbox.x>height*4)reason='citation_end_before_new_paragraph';
   else if(list(current.text.trim())&&listContext(current,[...lines.values()])&&step>=median(prose.map(l=>l.bbox.height))*.6&&priorProse.length)reason='explicit_list_item_boundary';
   else if(complete&&words(previous.text)>=3&&/^[A-Z]/u.test(current.text.trim())&&(spaced||indented)&&current.bbox.height/previous.bbox.height>=.75&&current.bbox.height/previous.bbox.height<=1.3)
    reason=spaced&&indented?'terminal_indent_and_gap':'terminal_with_flow_change';
   if(reason)cuts.push({index:i,reason,sourceLineId:current.sourceLineId,evidence:{terminal:complete,indent,step,rhythm,spaced,indented}});
  }
  if(!cuts.length)continue;
  const sourceOverlap=rows.some((l,i)=>{if(!i)return false;const p=rows[i-1];
   return Math.max(0,Math.min(l.bbox.y,p.bbox.y)-Math.max(l.bbox.y-l.bbox.height,p.bbox.y-p.bbox.height))/Math.min(l.bbox.height,p.bbox.height)>.5;
  });
  if(sourceOverlap&&cuts.some(c=>c.reason==='explicit_list_item_boundary')){
   held.push({key,objectId:body.objectId,reason:'list_source_rows_have_overlapping_envelopes',cuts});continue;
  }
  // Spatial fragments may repeat one source row for an end-of-proof glyph;
  // that row cannot be split into duplicate-owned objects.
  const seen=new Set(),duplicated=body.spatialFragments.some(f=>f.sourceLineIds.some(id=>{if(seen.has(id))return true;seen.add(id);return false;}));
  if(duplicated){held.push({key,objectId:body.objectId,reason:'source_repeated_across_visual_fragments',cuts});continue;}
  const starts=[0,...cuts.map(c=>c.index)],parts=starts.map((start,i)=>rows.slice(start,starts[i+1]??rows.length));
  const children=parts.map((members,i)=>{
   const ids=members.map(l=>l.sourceLineId),o={...structuredClone(body),objectId:'stage66:'+digest([key,body.objectId,ids]),sourceLineIds:ids};
   o.spatialFragments=fragmentsFor(ids,body,lines);refresh(o,lines);return o;
  });
  const index=page.objects.indexOf(body);page.objects.splice(index,1,...children);
  operations.push({key,kind:'body_semantic_boundary_split',beforeObjectId:body.objectId,afterObjectIds:children.map(o=>o.objectId),cuts});
 }
 // Join short prose fragments that share a physical text row with one existing
 // paragraph member. Lane differences are evidence conflicts, not a veto.
 for(const child of [...page.objects].filter(o=>o.type==='body'&&o.sourceLineIds.length===1&&o.spatialFragments.length===1&&/^[A-Za-z]+(?:\s+[A-Za-z]+){0,2}$/u.test(o.sourceText.trim())&&o.sourceText.length<=20)){
  if(!page.objects.includes(child))continue;
  const line=lines.get(child.sourceLineIds[0]),targets=[];
  for(const parent of page.objects.filter(o=>o!==child&&o.type==='body'&&o.sourceLineIds.length>=3))for(const id of parent.sourceLineIds){
   const row=lines.get(id),a=row.bbox,b=line.bbox,gap=b.x-a.x-a.width;
   if(Math.abs(a.y-b.y)>Math.max(a.height,b.height)*.5||gap< -1||gap>Math.max(a.height,b.height)||terminal(row.text))continue;
   const fragment=parent.spatialFragments.find(f=>f.sourceLineIds.includes(id));if(!fragment)continue;
   const conflict=page.objects.some(o=>o!==child&&o!==parent&&o.type!=='body'&&o.spatialFragments.some(f=>{
    const r=f.bbox,c=child.spatialFragments[0].bbox;return Math.max(0,Math.min(r.x+r.width,c.x+c.width)-Math.max(r.x,c.x))>0&&Math.max(0,Math.min(r.y+r.height,c.y+c.height)-Math.max(r.y,c.y))>0;
   }));
   if(!conflict)targets.push({parent,fragment,row});
  }
  const unique=[...new Map(targets.map(t=>[t.parent.objectId,t])).values()];if(unique.length!==1)continue;
  const {parent,fragment,row}=unique[0],oldIds=[parent.objectId,child.objectId];
  parent.sourceLineIds.push(...child.sourceLineIds);fragment.sourceLineIds.push(...child.sourceLineIds);
  fragment.bbox=union([fragment.bbox,child.spatialFragments[0].bbox]);refresh(parent,lines);
  parent.objectId='stage66:'+digest([key,oldIds,parent.sourceLineIds]);page.objects.splice(page.objects.indexOf(child),1);
  operations.push({key,kind:'same_row_prose_fragment_attached',oldIds,afterObjectId:parent.objectId,sourceLineIds:child.sourceLineIds,
   upstreamHintConflict:row.column!==line.column?[row.column,line.column]:[]});
 }
 // Adjacent continuation joins require an unfinished prose row (or an explicit
 // right-aligned quotation citation), compatible spacing and no intervening type.
 for(let round=0;round<3;round++){
  let joined=false;
  const bodies=page.objects.filter(o=>o.type==='body'&&o.spatialFragments.length===1);
  for(const left of bodies){
   if(!page.objects.includes(left))continue;
   const ls=left.sourceLineIds.map(id=>lines.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y),last=ls.at(-1);
   for(const right of bodies.filter(o=>o!==left)){
    if(!page.objects.includes(right))continue;
    const rs=right.sourceLineIds.map(id=>lines.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y),first=rs[0];
    if(ls.length>2&&rs.length>2)continue;
    const step=first.bbox.y-last.bbox.y,h=Math.max(first.bbox.height,last.bbox.height);
    if(first.column!==last.column||step<=2||step>h*1.8||label(first.text.trim())||list(first.text.trim()))continue;
    const quotedCitation=citation(right.sourceText)&&rs.length===1&&ls.length>=2&&
     Math.abs(right.spatialFragments[0].bbox.x+right.spatialFragments[0].bbox.width-left.spatialFragments[0].bbox.x-left.spatialFragments[0].bbox.width)<h*2;
    const continuation=!terminal(last.text)&&words(left.sourceText)>=3&&
     /^(?:\[\d+\]\s*)?[a-z]/u.test(first.text.trim())&&Math.abs(first.bbox.x-left.spatialFragments[0].bbox.x)<h*.7;
    const gap=right.spatialFragments[0].bbox.y-left.spatialFragments[0].bbox.y-left.spatialFragments[0].bbox.height;
    const fullLineFlow=terminal(last.text)&&ls.length>=2&&rs.length<=2&&words(last.text)>=4&&words(first.text)>=4&&
     last.bbox.width>=median(ls.map(l=>l.bbox.width))*.97&&Math.abs(first.bbox.x-left.spatialFragments[0].bbox.x)<1.5&&gap>=-1&&gap<Math.min(first.bbox.height,last.bbox.height)*.5;
    if(!quotedCitation&&!continuation&&!fullLineFlow)continue;
    if(continuation&&right.sourceText.length<=20&&/[=_^∑∫√]/u.test(right.sourceText)){
     held.push({key,objectId:right.objectId,reason:'tiny_mixed_prose_math_source_requires_span_check'});continue;
    }
    const x=left.spatialFragments[0].bbox;
    const intervening=page.objects.some(o=>o!==left&&o!==right&&o.spatialFragments.some(f=>{
     const b=f.bbox,c=b.y+b.height/2,w=Math.max(0,Math.min(b.x+b.width,x.x+x.width)-Math.max(b.x,x.x));
     return c>last.bbox.y&&c<first.bbox.y&&w>Math.min(b.width,x.width)*.2;
    }));
    if(intervening)continue;
    const oldIds=[left.objectId,right.objectId];left.sourceLineIds.push(...right.sourceLineIds);refresh(left,lines);
    left.spatialFragments=[{bbox:union([left.spatialFragments[0].bbox,right.spatialFragments[0].bbox]),sourceLineIds:[...left.sourceLineIds]}];
    left.objectId='stage66:'+digest([key,oldIds,left.sourceLineIds]);page.objects.splice(page.objects.indexOf(right),1);
    operations.push({key,kind:quotedCitation?'quotation_citation_attached':fullLineFlow?'sentence_continuation_same_paragraph':'short_prose_continuation_attached',oldIds,afterObjectId:left.objectId});joined=true;break;
   }
  }
  if(!joined)break;
 }
 // Multiple frames of one paragraph can be consolidated when their actual flow
 // continues through inline mathematics and no other semantic Object intervenes.
 for(const body of page.objects.filter(o=>o.type==='body'&&o.spatialFragments.length>1)){
  const fragments=[...body.spatialFragments].sort((a,b)=>a.bbox.y-b.bbox.y);
  const ids=fragments.flatMap(f=>f.sourceLineIds);if(new Set(ids).size!==ids.length)continue;
  if(new Set(ids.map(id=>lines.get(id).column)).size!==1)continue;
  let valid=true;
  for(let i=1;i<fragments.length;i++){
   const a=fragments[i-1],b=fragments[i],as=a.sourceLineIds.map(id=>lines.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y),bs=b.sourceLineIds.map(id=>lines.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y);
   const last=as.at(-1),first=bs[0],h=median([...as,...bs].map(l=>l.bbox.height));
   const gap=b.bbox.y-a.bbox.y-a.bbox.height;
   if(terminal(last.text)||! /^(?:\[\d+\]\s*)?[a-z]/u.test(first.text.trim())||words(first.text)<2||gap>h*1.8||Math.abs(a.bbox.x-b.bbox.x)>h*.5){valid=false;break;}
   if(page.objects.some(o=>o!==body&&o.spatialFragments.some(f=>{const r=f.bbox,c=r.y+r.height/2,w=Math.max(0,Math.min(r.x+r.width,b.bbox.x+b.bbox.width)-Math.max(r.x,b.bbox.x));return c>a.bbox.y+a.bbox.height&&c<b.bbox.y&&w>Math.min(r.width,b.bbox.width)*.2;}))){valid=false;break;}
  }
  if(!valid)continue;
  const oldFragments=structuredClone(body.spatialFragments);refresh(body,lines);
  body.spatialFragments=[{bbox:union(fragments.map(f=>f.bbox)),sourceLineIds:[...body.sourceLineIds]}];
  operations.push({key,kind:'continuous_paragraph_frames_consolidated',objectId:body.objectId,oldFragments});
 }
 // A terminal proof marker can share an extraction row with prose while being
 // drawn at the far right. Preserve it as an internal visual hint, rather than
 // displaying a second editable body fragment with the same source ID.
 for(const body of page.objects.filter(o=>o.type==='body'&&o.spatialFragments.length>1)){
  if(!/□\s*$/u.test(body.sourceText)||(body.sourceText.match(/[A-Za-z]{2,}/g)||[]).length<2)continue;
  const sorted=[...body.spatialFragments].sort((a,b)=>a.bbox.x-b.bbox.x),first=sorted[0],last=sorted.at(-1);
  if(sorted.length!==2||first.sourceLineIds.length!==1||last.sourceLineIds.length!==1||first.sourceLineIds[0]!==last.sourceLineIds[0])continue;
  if(last.bbox.width>last.bbox.height*1.2||last.bbox.x-first.bbox.x-first.bbox.width<first.bbox.height*4||Math.abs(last.bbox.y-first.bbox.y)>first.bbox.height*.5)continue;
  body.internalVisualHints=[...(body.internalVisualHints||[]),{kind:'proof_end_marker',bbox:last.bbox,sourceLineIds:last.sourceLineIds,authority:'none'}];
  body.spatialFragments=[first];
  operations.push({key,kind:'proof_marker_to_internal_hint',objectId:body.objectId,sourceLineIds:last.sourceLineIds});
 }
 assert.deepEqual(membership(page),membership(before.pages[key]),key+': source loss/duplication');
 if(operations.some(o=>o.key===key)){
  const byType={};for(const o of [...page.objects,...(page.referenceObjectRefs||[])])byType[o.type]=(byType[o.type]||0)+1;
  page.summary={...page.summary,objects:page.objects.length+(page.referenceObjectRefs||[]).length,byType};
 }
}
const uniqueHeld=[...new Map(held.map(h=>[h.key+'|'+h.objectId+'|'+h.reason,h])).values()];
after.stage66={authority:'none',status:'offline_candidate_not_truth',operations,held:uniqueHeld};
return after;
}
module.exports={build};
