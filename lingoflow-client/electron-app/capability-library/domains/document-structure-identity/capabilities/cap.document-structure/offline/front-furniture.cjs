"use strict";
const crypto=require('node:crypto'),assert=require('node:assert/strict');
function build(inputs){
const before=inputs?.before,frozen=inputs?.source,pdf=inputs?.pdf;
const after=structuredClone(before),source=structuredClone(frozen),operations=[],held=[],lineage=[];
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)]||0;
const union=bs=>{const x=Math.min(...bs.map(b=>b.x)),y=Math.min(...bs.map(b=>b.y));return{x,y,width:Math.max(...bs.map(b=>b.x+b.width))-x,height:Math.max(...bs.map(b=>b.y+b.height))-y};};
const intersect=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,24);
const metadata=t=>/^(?:Draft\s+version|Typeset\s+using|Received\s*:|Funding\s*:|Keywords\s*:|ORIGINAL\s+ARTICLE|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/iu.test(t.trim());
const institution=t=>/\b(?:University|Department|Institute|Laboratory|Research|School|Centre|Center|Correspondence)\b/iu.test(t);
function furnitureSignal(key,l,reason){const [paper,page]=key.split(':').map(Number),s=source.pages[key].pageSize,b=l.bbox,edge=b.y<s.height*.08?'top':b.y>s.height*.92?'bottom':null;
 if(!edge)return null;if(reason==='page_number'&&(!/^\d{1,3}$/u.test(l.text.trim())||Number(l.text)!==page))return null;
 return{paper,edge,anchor:Math.round((b.x+b.width/2)/s.width*10),text:reason==='page_number'?'numeric':l.text.replace(/\d+/g,'#').trim(),kind:reason};}
const recurrence=new Map();for(const[key,p]of Object.entries(before.pages))for(const x of p.excludedSourceLines){if(!['page_number','running_header','running_footer'].includes(x.exclusionReason))continue;const l=source.pages[key].sourceLines.find(l=>l.sourceLineId===x.sourceLineId),s=furnitureSignal(key,l,x.exclusionReason);if(s){const k=JSON.stringify(s);if(!recurrence.has(k))recurrence.set(k,new Set());recurrence.get(k).add(key);}}
for(const[key,page]of Object.entries(after.pages)){
 const inv=source.pages[key],lines=new Map(inv.sourceLines.map(l=>[l.sourceLineId,l])),glyph=pdf.pages[key].lines;
 function rowOrder(a,b){const x=glyph[a.sourceLineId]?.box,y=glyph[b.sourceLineId]?.box;if(!x||!y)return a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x;const d=x.y+x.height/2-y.y-y.height/2;return Math.abs(d)<Math.min(x.height,y.height)*.7?x.x-y.x:d;}
 function create(type,members,reason){const rows=[...members].sort(rowOrder),ids=rows.map(l=>l.sourceLineId);assert(rows.every(l=>glyph[l.sourceLineId]?.box));return{objectId:'stage70:'+digest([key,type,ids,reason]),type,page:inv.pageNumber,sourceLineIds:ids,sourceText:rows.map(l=>l.text).join('\n'),memberCount:ids.length,memberLineBoxes:rows.map(l=>({sourceLineId:l.sourceLineId,bbox:l.bbox})),spatialFragments:[{bbox:union(rows.map(l=>glyph[l.sourceLineId].box)),sourceLineIds:ids}],evidence:[reason,'original_pdf_glyph_support'],authority:'none',status:'offline_candidate_not_truth'};}
 function claim(type,rows,kind,extra={}){if(!rows.length)return;const o={...create(type,rows,kind),...extra};page.objects.push(o);const ids=new Set(o.sourceLineIds);page.pendingMembership=page.pendingMembership.filter(p=>!ids.has(p.sourceLineId));operations.push({key,kind,afterObjectId:o.objectId,sourceLineIds:o.sourceLineIds});return o;}
 if(Number(key.split(':')[1])===1){
  for(const pending of [...page.pendingMembership].filter(p=>p.reason==='front_matter_pending')){
   const parent=lines.get(pending.sourceLineId),g=glyph[parent.sourceLineId],s=g?.offRowPrefix;if(!s)continue;
   const targets=page.objects.filter(o=>o.type==='front_matter_affiliation_or_contact'&&o.sourceLineIds.some(id=>{const b=glyph[id]?.box;if(!b)return false;return Math.abs(b.y-s.prefixBox.y)<Math.max(b.height,s.prefixBox.height)&&b.x-s.prefixBox.x-s.prefixBox.width>=-1&&b.x-s.prefixBox.x-s.prefixBox.width<Math.max(b.height,s.prefixBox.height);}));
   if(targets.length!==1){held.push({key,sourceLineId:parent.sourceLineId,reason:'off_row_affiliation_target_ambiguous'});continue;}
   const spans=[['affiliation_marker',s.prefixBox,0,s.splitAt],['author',s.mainBox,s.splitAt,parent.text.length]].map(([kind,b,start,end])=>({...parent,sourceLineId:parent.sourceLineId+':stage70:'+kind,text:parent.text.slice(start,end),bbox:{...b,y:b.y+b.height},sourceSpanKind:kind,parentSourceLineId:parent.sourceLineId,textSpan:{start,end}}));
   inv.sourceLines.splice(inv.sourceLines.indexOf(parent),1,...spans);lines.delete(parent.sourceLineId);for(const[i,l]of spans.entries()){lines.set(l.sourceLineId,l);glyph[l.sourceLineId]={...g,box:i?s.mainBox:s.prefixBox,glyphText:l.text,offRowPrefix:undefined};}
   page.pendingMembership=page.pendingMembership.filter(p=>p!==pending);page.pendingMembership.push({...pending,sourceLineId:spans[1].sourceLineId,text:spans[1].text,bbox:spans[1].bbox});
   const target=targets[0],members=[...target.sourceLineIds.map(id=>lines.get(id)),spans[0]],updated=create(target.type,members,'off_row_institution_marker_attached');updated.spatialFragments[0].bbox=union([...target.spatialFragments.map(f=>f.bbox),s.prefixBox]);page.objects.splice(page.objects.indexOf(target),1,updated);
   const record={key,parentSourceLineId:parent.sourceLineId,parentText:parent.text,spans:spans.map(l=>({sourceLineId:l.sourceLineId,text:l.text,textSpan:l.textSpan,bbox:l.bbox}))};lineage.push(record);page.sourceSpanLineage=[...(page.sourceSpanLineage||[]),record];operations.push({...record,kind:'front_matter_off_row_source_partition',afterObjectId:updated.objectId});
  }
  const starts=page.objects.filter(o=>['body','abstract'].includes(o.type)&&o.sourceText.length>80).flatMap(o=>o.sourceLineIds.map(id=>lines.get(id).bbox.y)),cutoff=Math.min(...starts);
  const pending=page.pendingMembership.filter(p=>p.reason==='front_matter_pending').map(p=>lines.get(p.sourceLineId)).filter(l=>l.bbox.y<cutoff&&glyph[l.sourceLineId]?.textSimilarity>=.75);
  const seeds=pending.filter(l=>!metadata(l.text)&&l.text.split(/\s+/).length>=4&&l.bbox.width>inv.pageSize.width*.25).sort((a,b)=>glyph[b.sourceLineId].size-glyph[a.sourceLineId].size);
  const seed=seeds[0];let title;
  if(seed){const g=glyph[seed.sourceLineId],center=Math.abs(seed.bbox.x+seed.bbox.width/2-inv.pageSize.width/2)<inv.pageSize.width*.2;
   const bodySizes=inv.sourceLines.filter(l=>l.bbox.y>=cutoff&&l.bbox.y<cutoff+60&&glyph[l.sourceLineId]).map(l=>glyph[l.sourceLineId].size),bodySize=median(bodySizes);
   const prominent=g.size>bodySize*1.2||/Bold|Medi|CMB|SFBX/iu.test(g.font);
   if(center&&prominent){const rows=pending.filter(l=>!metadata(l.text)&&glyph[l.sourceLineId].font===g.font&&Math.abs(glyph[l.sourceLineId].size-g.size)<.9&&Math.abs(l.bbox.y-seed.bbox.y)<g.size*5);
    title=claim('title',rows,'front_matter_title_recalled');}
  }
  if(title){const bottom=Math.max(...title.sourceLineIds.map(id=>lines.get(id).bbox.y));
   const possible=pending.filter(l=>!title.sourceLineIds.includes(l.sourceLineId)&&l.bbox.y>bottom&&l.bbox.y<cutoff&&!metadata(l.text));
   const affils=possible.filter(l=>institution(l.text));claim('front_matter_affiliation_or_contact',affils,'front_matter_institution_recalled');
   const affilStart=Math.min(cutoff,...page.objects.filter(o=>o.type==='front_matter_affiliation_or_contact').flatMap(o=>o.sourceLineIds.map(id=>lines.get(id).bbox.y)));
   const authors=possible.filter(l=>!institution(l.text)&&l.bbox.y<affilStart).filter(l=>{const text=l.text.replace(/\^\d+(?:,\d+)*/g,'').replace(/[\d,*]/g,' ').trim(),tokens=text.match(/\p{L}[\p{L}.’-]*/gu)||[],nameLike=tokens.filter(t=>/^\p{Lu}/u.test(t)).length;
    if(tokens.length<2||nameLike/tokens.length<.6||/[=∑∫]/u.test(text))return false;
    if(/^\d+\s/u.test(l.text)&&!/^\d/u.test(glyph[l.sourceLineId].glyphText)){held.push({key,sourceLineId:l.sourceLineId,reason:'front_source_off_row_marker_requires_partition'});return false;}return true;});
   claim('author',authors,'front_matter_author_recalled');
  }
  // Publication notes are explicit unsupported metadata, never abstract/body.
  const notes=pending.filter(l=>metadata(l.text)&&page.pendingMembership.some(p=>p.sourceLineId===l.sourceLineId));
  const groups=[];for(const l of notes.sort((a,b)=>a.bbox.y-b.bbox.y)){const last=groups.at(-1);if(last&&l.bbox.y-last.at(-1).bbox.y<20)last.push(l);else groups.push([l]);}
  for(const rows of groups)claim('unsupported_structured_block',rows,'publication_metadata_recalled',{unsupportedKind:'publication_metadata'});
  for(const pending of [...page.pendingMembership].filter(p=>p.reason==='front_matter_pending')){
   const l=lines.get(pending.sourceLineId),b=glyph[l.sourceLineId]?.box;if(!/^\d{1,2}$/u.test(l.text.trim())||!b||l.bbox.y>=cutoff)continue;
   const targets=page.objects.filter(o=>['author','front_matter_affiliation_or_contact'].includes(o.type)&&o.sourceLineIds.some(id=>{const r=glyph[id]?.box;return r&&Math.abs(b.y+b.height/2-r.y-r.height/2)<Math.max(b.height,r.height)*.9&&Math.max(0,r.x-b.x-b.width,b.x-r.x-r.width)<Math.max(b.height,r.height)*.6;}));
   if(targets.length!==1)continue;const target=targets[0],updated=create(target.type,[...target.sourceLineIds.map(id=>lines.get(id)),l],'front_matter_marker_membership');updated.spatialFragments[0].bbox=union([...target.spatialFragments.map(f=>f.bbox),b]);page.objects.splice(page.objects.indexOf(target),1,updated);page.pendingMembership=page.pendingMembership.filter(p=>p!==pending);operations.push({key,kind:'front_matter_marker_attached',sourceLineIds:[l.sourceLineId],beforeObjectId:target.objectId,afterObjectId:updated.objectId});
  }
 }
 for(const excluded of [...page.excludedSourceLines]){
  if(!['page_number','running_header','running_footer'].includes(excluded.exclusionReason))continue;
  const l=lines.get(excluded.sourceLineId),s=furnitureSignal(key,l,excluded.exclusionReason),repeats=s?recurrence.get(JSON.stringify(s))?.size||0:0;
  if(!s||repeats<2||!glyph[l.sourceLineId]?.box){held.push({key,sourceLineId:l.sourceLineId,reason:'furniture_recurrence_or_glyph_support_insufficient'});continue;}
  const o=create(excluded.exclusionReason,[l],'page_furniture_isolated');o.evidence.push('page_edge','stable_anchor','cross_page_recurrence');if(o.type==='page_number')o.evidence.push('pure_number','agrees_with_pdf_page_index');page.objects.push(o);page.excludedSourceLines=page.excludedSourceLines.filter(x=>x.sourceLineId!==l.sourceLineId);operations.push({key,kind:'recognized_furniture_exposed',afterObjectId:o.objectId,sourceLineIds:o.sourceLineIds,repeats,previousExclusion:excluded});
 }
 // Only repair a bitmap figure that conflicts with independently corroborated
 // furniture. No blanket trimming or deletion of internal figure members.
 const furniture=page.objects.filter(o=>['page_number','running_header','running_footer'].includes(o.type));
 for(const figure of page.objects.filter(o=>o.type==='figure'&&o.spatialFragments.length===1)){
  const old=figure.spatialFragments[0].bbox;if(!furniture.some(o=>o.spatialFragments.some(f=>intersect(old,f.bbox)>0)))continue;
  const images=pdf.pages[key].images.filter(b=>intersect(old,b)/(b.width*b.height)>.95&&b.width*b.height>old.width*old.height*.15).sort((a,b)=>a.y-b.y);
  const contiguous=images.length>0&&images.length<=4&&images.every((b,i)=>!i||Math.abs(b.x-images[i-1].x)<3&&Math.abs(b.width-images[i-1].width)<3&&Math.abs(b.y-images[i-1].y-images[i-1].height)<10);
  if(!contiguous||figure.sourceLineIds.length){held.push({key,objectId:figure.objectId,reason:'figure_furniture_requires_vector_or_member_audit'});continue;}
  const b=union(images);if(b.width*b.height<old.width*old.height*.5||page.objects.some(o=>o!==figure&&['body','caption','table','heading'].includes(o.type)&&o.spatialFragments.some(f=>intersect(b,f.bbox)>1))){held.push({key,objectId:figure.objectId,reason:'bitmap_panel_container_conflict'});continue;}
  if(furniture.some(o=>o.spatialFragments.some(f=>intersect(b,f.bbox)>0))){held.push({key,objectId:figure.objectId,reason:'bitmap_still_intersects_furniture'});continue;}
  figure.spatialFragments[0].bbox=b;figure.evidence=[...(figure.evidence||[]),'original_pdf_bitmap_container_without_furniture'];operations.push({key,kind:'figure_furniture_boundary_repaired',objectId:figure.objectId,oldBox:old,newBox:b,pdfPanelCount:images.length});
 }
 const counts=new Map([...lines.keys()].map(id=>[id,0]));for(const o of [...page.objects,...page.referenceObjectRefs||[]])for(const id of o.sourceLineIds){assert(counts.has(id));counts.set(id,counts.get(id)+1);}for(const x of [...page.pendingMembership,...page.excludedSourceLines])counts.set(x.sourceLineId,counts.get(x.sourceLineId)+1);assert([...counts.values()].every(n=>n===1),key+': source accounting');
 if(operations.some(o=>o.key===key)){const byType={};for(const o of [...page.objects,...page.referenceObjectRefs||[]])byType[o.type]=(byType[o.type]||0)+1;page.summary={...page.summary,byType,objects:page.objects.length+(page.referenceObjectRefs||[]).length,pending:page.pendingMembership.length};page.sourceLineCount=inv.sourceLines.length;}
}
after.stage70={authority:'none',status:'offline_candidate_not_truth',operations,held,diagnostics:{pages:Object.keys(after.pages).length,sourceUnits:Object.values(source.pages).reduce((n,p)=>n+p.sourceLines.length,0),pending:Object.values(after.pages).reduce((n,p)=>n+p.pendingMembership.length,0),excluded:Object.values(after.pages).reduce((n,p)=>n+p.excludedSourceLines.length,0)}};source.stage70={authority:'none',status:'derived_evidence_not_truth',lineage};return {candidate:after,source};
}
module.exports={build};
