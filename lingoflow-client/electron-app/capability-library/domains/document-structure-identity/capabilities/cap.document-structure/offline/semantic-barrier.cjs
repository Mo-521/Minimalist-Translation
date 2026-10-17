"use strict";
// Versioned offline pass. Human frames are deliberately not producer inputs.
const crypto=require('node:crypto'),assert=require('node:assert/strict');
const order=(a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x;
const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
const union=bs=>{const x=Math.min(...bs.map(b=>b.x)),y=Math.min(...bs.map(b=>b.y));return{x,y,width:Math.max(...bs.map(b=>b.x+b.width))-x,height:Math.max(...bs.map(b=>b.y+b.height))-y};};
function build(inputs){
const before=inputs?.before,candidate=structuredClone(before);
const source=inputs?.source;
const panels=(inputs?.panels).pages;
const glyph=new Map((inputs?.glyph).matched.map(x=>[x.sourceLineId,x.visualBox]));
const operations=[],held=[];
const visual=l=>glyph.get(l.sourceLineId)||{...l.bbox,y:l.bbox.y-l.bbox.height};
function make(old,ids,lines,key,reason,type=old.type,box){const ls=ids.map(id=>lines.get(id)).sort(order);ids=ls.map(l=>l.sourceLineId);return {...old,objectId:'stage50:'+crypto.createHash('sha256').update(JSON.stringify([key,ids,type,reason])).digest('hex').slice(0,24),type,sourceCandidateIds:[...(old.sourceCandidateIds||[]),old.objectId].filter(Boolean),sourceLineIds:ids,sourceText:ls.map(l=>l.text).join('\n'),memberCount:ids.length,memberLineBoxes:ls.map(l=>({sourceLineId:l.sourceLineId,bbox:l.bbox})),spatialFragments:[{bbox:box||union(ls.map(visual)),sourceLineIds:ids}],evidence:[...(old.evidence||[]),reason]};}
function detach(page,ids,lines,key,reason){const remove=new Set(ids);page.objects=page.objects.flatMap(o=>{const keep=o.sourceLineIds.filter(id=>!remove.has(id));return keep.length===o.sourceLineIds.length?[o]:keep.length?[make(o,keep,lines,key,reason)]:[];});page.pendingMembership=page.pendingMembership.filter(p=>!remove.has(p.sourceLineId));}
function ownership(p){const out=new Map();for(const o of [...p.objects,...p.referenceObjectRefs||[]])for(const id of o.sourceLineIds)out.set(id,(out.get(id)||0)+1);for(const member of [...p.pendingMembership,...p.excludedSourceLines])out.set(member.sourceLineId,(out.get(member.sourceLineId)||0)+1);return [...out].sort((a,b)=>a[0].localeCompare(b[0]));}
for(const [key,page] of Object.entries(candidate.pages)){
 const inventory=source.pages[key],lines=new Map(inventory.sourceLines.map(l=>[l.sourceLineId,l]));
 // Repeated enclosing panels + monospaced example text support an opaque
 // unsupported container. A border alone is insufficient; known tables and
 // figures are protected. Partial source-line crossings remain diagnostic.
 for(const panel of panels[key]||[]){const b=panel.bbox;
  const intersect=l=>overlap(b,visual(l))>0&&Math.min(b.y+b.height,visual(l).y+visual(l).height)>Math.max(b.y,visual(l).y);
  const contained=l=>{const v=visual(l);return v.x>=b.x-2&&v.x+v.width<=b.x+b.width+2&&v.y>=b.y-2&&v.y+v.height<=b.y+b.height+2;};
  if(page.objects.some(o=>['figure','table','caption','reference','heading'].includes(o.type)&&o.sourceLineIds.some(id=>contained(lines.get(id)))))continue;
  const eligible=inventory.sourceLines.filter(l=>l.coverageClass==='reviewable_content'&&contained(l));
  const ambiguous=inventory.sourceLines.filter(l=>intersect(l)&&!contained(l));
  const ids=eligible.map(l=>l.sourceLineId);if(!ids.length)continue;
  if(ids.some(id=>(page.referenceObjectRefs||[]).some(o=>o.sourceLineIds.includes(id))))continue;
  detach(page,ids,lines,key,'enclosed_example_members_removed_from_prose');
  page.objects.push(make({type:'unsupported_structured_block',sourceCandidateIds:[],evidence:[]},ids,lines,key,'enclosed_structured_example_not_table','unsupported_structured_block',b));
  operations.push({key,kind:'unsupported_container',members:ids.length,ambiguous:ambiguous.map(l=>l.sourceLineId),evidence:panel});
 }
 // Caption continuation requires an established caption seed, compatible
 // smaller typography, alignment, row spacing and no competing semantic owner.
 for(const original of [...page.objects.filter(o=>o.type==='caption')]){
  let cap=original,ls=cap.sourceLineIds.map(id=>lines.get(id)).sort(order),last=ls.at(-1);if(!last)continue;
  const heights=ls.map(l=>l.bbox.height).sort((a,b)=>a-b),h=heights[Math.floor(heights.length/2)],frame=union(ls.map(visual));
  for(let step=0;step<6;step++){
   const options=inventory.sourceLines.filter(l=>l.bbox.y>last.bbox.y+1&&l.bbox.y-last.bbox.y<=h*1.65&&overlap(frame,visual(l))>Math.min(frame.width,l.bbox.width)*.7).sort(order);
   const next=options[0];if(!next||cap.sourceLineIds.includes(next.sourceLineId))break;
   const owner=page.objects.find(o=>o.sourceLineIds.includes(next.sourceLineId));
   const compatible=Math.abs(next.bbox.height-h)<=Math.max(.8,h*.12)&&Math.abs(next.bbox.x-frame.x)<=12;
   const bodySizes=page.objects.filter(o=>o.type==='body').flatMap(o=>o.sourceLineIds.map(id=>lines.get(id).bbox.height)).sort((a,b)=>a-b),normal=bodySizes[Math.floor(bodySizes.length/2)]||h;
   if(!compatible||owner&&owner.type!=='body'||h>=normal*.97||/^(?:Fig(?:ure)?\.?|Table)\s*\d|^\d+(?:\.\d+)*\s+[A-Z]/i.test(next.text.trim()))break;
   const oldIds=cap.sourceLineIds,capId=cap.objectId;detach(page,[next.sourceLineId],lines,key,'caption_continuation_detached');
   page.objects=page.objects.filter(o=>o.objectId!==capId);cap=make(cap,[...oldIds,next.sourceLineId],lines,key,'caption_typography_reading_flow');page.objects.push(cap);last=next;
   operations.push({key,kind:'caption_continuation',sourceLineId:next.sourceLineId});
  }
 }
 // A full display region between prose rows is a semantic barrier, not merely
 // a visual fragment separator. Preserve equation numbers as separate objects.
 for(const body of [...page.objects.filter(o=>o.type==='body'&&o.sourceLineIds.length>1)]){
  const ls=body.sourceLineIds.map(id=>lines.get(id)).sort(order),groups=[[]];
  for(const l of ls){const previous=groups.at(-1).at(-1);let barrier;
   if(previous&&l.column===previous.column)barrier=page.objects.filter(o=>o.type==='formula').find(o=>{
    const ms=o.sourceLineIds.map(id=>lines.get(id));return ms.some(m=>m.column===l.column)&&o.spatialFragments.some(f=>f.bbox.y>=visual(previous).y+visual(previous).height-1&&f.bbox.y+f.bbox.height<=visual(l).y+1&&overlap(f.bbox,union([visual(previous),visual(l)]))>0);
   });
   if(barrier){groups.push([]);operations.push({key,kind:'body_split_at_display',bodyId:body.objectId,formulaId:barrier.objectId});}
   groups.at(-1).push(l);
  }
  if(groups.length>1)page.objects.splice(page.objects.indexOf(body),1,...groups.map(g=>make(body,g.map(l=>l.sourceLineId),lines,key,'strong_display_boundary_splits_body')));
 }
 // Extraction may divide one caption visual row at italic/font switches.
 // Recover contiguous same-baseline pieces without crossing column whitespace.
 for(let pass=0;pass<4;pass++)for(const cap of [...page.objects.filter(o=>o.type==='caption')]){
  const members=cap.sourceLineIds.map(id=>lines.get(id)),h=Math.min(...members.map(l=>l.bbox.height));
  const bodyHeights=page.objects.filter(o=>o.type==='body').flatMap(o=>o.sourceLineIds.map(id=>lines.get(id).bbox.height)).sort((a,b)=>a-b);
  if(h>=(bodyHeights[Math.floor(bodyHeights.length/2)]||h)*.97)continue;
  const add=page.objects.filter(o=>o.type==='body').flatMap(o=>o.sourceLineIds).filter(id=>{
   const l=lines.get(id);return Math.abs(l.bbox.height-h)<=Math.max(.8,h*.12)&&members.some(m=>Math.abs(m.bbox.y-l.bbox.y)<=1.5&&Math.min(Math.abs(l.bbox.x-(m.bbox.x+m.bbox.width)),Math.abs(m.bbox.x-(l.bbox.x+l.bbox.width)))<=6);
  });
  if(!add.length)continue;detach(page,add,lines,key,'caption_font_switch_pieces_detached');page.objects=page.objects.filter(o=>o.objectId!==cap.objectId);page.objects.push(make(cap,[...cap.sourceLineIds,...add],lines,key,'caption_same_visual_row_typography_continuity'));
  operations.push({key,kind:'caption_same_row_fragments',sourceLineIds:add});
 }
 for(const o of page.objects.filter(o=>o.type==='body'))for(const f of page.objects.filter(o=>o.type==='formula'))for(const id of o.sourceLineIds){const b=visual(lines.get(id));if(f.spatialFragments.some(x=>overlap(b,x.bbox)>0&&Math.min(b.y+b.height,x.bbox.y+x.bbox.height)-Math.max(b.y,x.bbox.y)>2))held.push({key,kind:'body_formula_member_overlap_unresolved',bodyId:o.objectId,formulaId:f.objectId,sourceLineId:id,text:lines.get(id).text});}
 assert.deepStrictEqual(ownership(page),ownership(before.pages[key]),`${key}: source ownership changed`);
 assert(ownership(page).every(([,n])=>n===1),`${key}: duplicate ownership`);
 assert.deepStrictEqual(page.referenceObjectRefs,before.pages[key].referenceObjectRefs,`${key}: references modified`);
 const types={};for(const o of [...page.objects,...page.referenceObjectRefs||[]])types[o.type]=(types[o.type]||0)+1;
 page.summary={...page.summary,objects:page.objects.length+(page.referenceObjectRefs||[]).length,byType:types,assigned:[...page.objects,...page.referenceObjectRefs||[]].reduce((n,o)=>n+o.sourceLineIds.length,0),pending:page.pendingMembership.length};
}
candidate.stage50={authority:'none',status:'offline_candidate_not_truth',operations,heldFindings:held};
candidate.summary={...candidate.summary,pageLocalObjects:0,assigned:0,pending:0,byType:{}};
for(const p of Object.values(candidate.pages)){candidate.summary.pageLocalObjects+=p.objects.length;candidate.summary.assigned+=p.summary.assigned;candidate.summary.pending+=p.pendingMembership.length;for(const [t,n] of Object.entries(p.summary.byType))candidate.summary.byType[t]=(candidate.summary.byType[t]||0)+n;}
return candidate;
}
module.exports={build};
