"use strict";
// Offline-only: repair prose/math continuity without consuming human frames as truth.
const crypto=require('node:crypto'),assert=require('node:assert/strict');
function build(inputs){
const prior=inputs?.prior;
const source=inputs?.source;
const candidate=structuredClone(prior),operations=[],held=[];
const mathWords=new Set(['sin','cos','tan','ln','log','lim','dim','max','min','exp','span','inf','arg','sup','amax']);
const grammarWords=s=>(s.match(/[A-Za-z]{3,}/g)||[]).filter(w=>!mathWords.has(w.toLowerCase())&&!/[A-Z].*[A-Z]/.test(w));
const box=l=>({x:l.bbox.x,y:l.bbox.y-l.bbox.height,width:l.bbox.width,height:l.bbox.height});
const union=bs=>({x:Math.min(...bs.map(b=>b.x)),y:Math.min(...bs.map(b=>b.y)),width:Math.max(...bs.map(b=>b.x+b.width))-Math.min(...bs.map(b=>b.x)),height:Math.max(...bs.map(b=>b.y+b.height))-Math.min(...bs.map(b=>b.y))});
const xOverlap=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
const yOverlap=(a,b)=>Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
const centerY=b=>b.y+b.height/2;
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,24);
function ordered(ids,lines){return ids.map(id=>lines.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x);}
function rewrite(old,ids,lines,key,reason,type=old.type,visual){
 const members=ordered(ids,lines),sorted=members.map(l=>l.sourceLineId),extent=visual||union(members.map(box));
 return {...old,objectId:`stage55:${digest([key,type,sorted,reason])}`,type,sourceLineIds:sorted,
  sourceText:members.map(l=>l.text).join('\n'),memberCount:sorted.length,
  memberLineBoxes:members.map(l=>({sourceLineId:l.sourceLineId,bbox:l.bbox})),
  spatialFragments:[{bbox:extent,sourceLineIds:sorted}],
  sourceCandidateIds:[...new Set([...(old.sourceCandidateIds||[]),old.objectId].filter(Boolean))],
  evidence:[...(old.evidence||[]),reason]};
}
function counts(page){const out=new Map();for(const o of [...page.objects,...page.referenceObjectRefs||[]])for(const id of o.sourceLineIds)out.set(id,(out.get(id)||0)+1);for(const x of [...page.pendingMembership,...page.excludedSourceLines])out.set(x.sourceLineId,(out.get(x.sourceLineId)||0)+1);return out;}
function nearestBodies(page,formula,lines){
 const own=ordered(formula.sourceLineIds,lines),start=own[0],end=own.at(-1),col=start.column;
 const ranked=page.objects.filter(o=>o.type==='body'&&o.sourceLineIds.some(id=>lines.get(id).column===col)).map(o=>{
  const same=ordered(o.sourceLineIds.filter(id=>lines.get(id).column===col),lines);return {o,first:same[0],last:same.at(-1)};
 });
 const before=ranked.filter(x=>x.last.bbox.y<start.bbox.y).sort((a,b)=>b.last.bbox.y-a.last.bbox.y)[0];
 const after=ranked.filter(x=>x.first.bbox.y>end.bbox.y).sort((a,b)=>a.first.bbox.y-b.first.bbox.y)[0];
 return {before,after,start,end,col};
}
function protectedAt(page,b){return page.objects.some(o=>['table','figure','caption','heading','unsupported_structured_block'].includes(o.type)&&o.spatialFragments?.some(f=>xOverlap(f.bbox,b)>b.width*.5&&yOverlap(f.bbox,b)>b.height*.5));}
for(const [key,page] of Object.entries(candidate.pages)){
 const inventory=source.pages[key],lines=new Map(inventory.sourceLines.map(l=>[l.sourceLineId,l])),baseline=counts(prior.pages[key]);
 // First divergence: Stage 43 could treat one full-column prose/math sentence
 // as a display anchor. Require grammar, flow and common paragraph lineage.
 for(const formula of [...page.objects.filter(o=>o.type==='formula')]){
  const members=ordered(formula.sourceLineIds,lines),{before,after,start,end,col}=nearestBodies(page,formula,lines);
  const proseAnchor=members.find(l=>{
   const w=grammarWords(l.text),columnWidth=col==='single'?inventory.pageSize.width*.68:inventory.pageSize.width*.32;
   return w.length>=3&&w.filter(t=>t.length>=5).length>=2&&/[;,]/.test(l.text)&&
    /[=≤≥≈]/.test(l.text)&&l.bbox.width>=columnWidth;
  });
  const shared=before&&after&&(before.o.sourceCandidateIds||[]).some(id=>(after.o.sourceCandidateIds||[]).includes(id));
  const close=before&&after&&start.bbox.y-before.last.bbox.y<Math.max(29,start.bbox.height*2.7)&&
    after.first.bbox.y-end.bbox.y<Math.max(29,end.bbox.height*2.7);
  const flow=before&&after&&/[,:;]$/.test(before.last.text.trim())&&/^[a-z]/.test(after.first.text.trim());
  if(!proseAnchor||!shared||!close||!flow)continue;
  const ids=[...before.o.sourceLineIds,...formula.sourceLineIds,...after.o.sourceLineIds],merged=rewrite(before.o,ids,lines,key,'grammatical_inline_math_restored_to_paragraph','body');
  page.objects=page.objects.filter(o=>![before.o,formula,after.o].includes(o));page.objects.push(merged);
  operations.push({key,kind:'inline_math_paragraph_restored',oldIds:[before.o.objectId,formula.objectId,after.o.objectId],sourceLineIds:ids});
 }
 // A full-flow line with inline mathematics is not a display object merely
 // because it has relation symbols. Both prose grammar and visual paragraph
 // rhythm are required; an independently spaced or numbered display is kept.
 for(const formula of [...page.objects.filter(o=>o.type==='formula'&&o.sourceLineIds.length===1)]){
  const line=lines.get(formula.sourceLineIds[0]),{before,after}=nearestBodies(page,formula,lines);
  if(!before&&!after)continue;
  const wordList=grammarWords(line.text),normalWidth=Math.max(before?.last.bbox.width||0,after?.first.bbox.width||0);
  const aligned=(before&&Math.abs(line.bbox.x-before.last.bbox.x)<=12)||(after&&Math.abs(line.bbox.x-after.first.bbox.x)<=12);
  const aboveGap=before?line.bbox.y-before.last.bbox.y:Infinity,belowGap=after?after.first.bbox.y-line.bbox.y:Infinity;
  const nearbyAbove=aboveGap>0&&aboveGap<=Math.max(16,line.bbox.height*1.55);
  const nearbyBelow=belowGap>0&&belowGap<=Math.max(16,line.bbox.height*1.55);
  const wide=line.bbox.width>=normalWidth*.72;
  const numbered=page.objects.filter(o=>o.type==='equation_number').some(o=>{
   const n=lines.get(o.sourceLineIds[0]);return n&&n.column===line.column&&n.bbox.x>=line.bbox.x+line.bbox.width-1&&
    n.bbox.x-line.bbox.x-line.bbox.width<inventory.pageSize.width*.25&&Math.abs(n.bbox.y-line.bbox.y)<=Math.max(12,line.bbox.height);
  });
  const grammar=wordList.filter(w=>w.length>=4).length>=2&&/[,:;.]|\b(?:and|when|which)\b/i.test(line.text);
  const discourse=/^[A-Z][a-z]{5,},/.test(line.text.trim());
  const continuous=nearbyAbove&&nearbyBelow&&wide;
  if(numbered||!aligned||!(nearbyAbove||nearbyBelow)||!(grammar||discourse||continuous))continue;
  const joinBefore=nearbyAbove&&before&&(!/[.!?]$/.test(before.last.text.trim())||/^[a-z]/.test(line.text.trim()));
  const joinAfter=nearbyBelow&&after&&(!/[.!?]$/.test(line.text.trim())&&/^[a-z(\[ζσμλθαβγδ]/.test(after.first.text.trim()));
  const chosen=[joinBefore?before.o:null,formula,joinAfter?after.o:null].filter(Boolean);
  const ids=[...new Set(chosen.flatMap(o=>o.sourceLineIds))],seed=joinBefore?before.o:joinAfter?after.o:formula;
  const restored=rewrite(seed,ids,lines,key,'visual_prose_continuity_overrides_math_symbol_anchor','body');
  restored.sourceCandidateIds=[...new Set(chosen.flatMap(o=>[...(o.sourceCandidateIds||[]),o.objectId]))];
  page.objects=page.objects.filter(o=>!chosen.includes(o));page.objects.push(restored);
  operations.push({key,kind:'full_flow_inline_math_restored',oldIds:chosen.map(o=>o.objectId),sourceLineIds:ids});
 }
 // A tiny mathematical extraction piece can extend a body frame into a true
 // display. Require unique overlap with one existing formula and no prose role.
 for(const body of [...page.objects.filter(o=>o.type==='body')])for(const id of [...body.sourceLineIds]){
  const line=lines.get(id),b=box(line),t=line.text.trim();
  if(t.length>5||line.bbox.width>23||/\s/.test(t)||/^(?:and|or|for|the|then|where|if|by|on|in)$/i.test(t))continue;
  const matches=page.objects.filter(o=>o.type==='formula'&&o.spatialFragments?.some(f=>
   xOverlap(f.bbox,b)>=b.width*.6&&yOverlap(f.bbox,b)>=b.height*.4));
  if(matches.length!==1)continue;
  const f=matches[0],remaining=body.sourceLineIds.filter(x=>x!==id);
  const ix=page.objects.indexOf(body);if(remaining.length)page.objects[ix]=rewrite(body,remaining,lines,key,'math_piece_removed_from_paragraph');
  else page.objects.splice(ix,1);
  const oldVisual=f.spatialFragments.map(x=>x.bbox);
  page.objects.splice(page.objects.indexOf(f),1,rewrite(f,[...f.sourceLineIds,id],lines,key,'isolated_math_member_attached_to_display','formula',union([...oldVisual,b])));
  operations.push({key,kind:'tiny_math_member_reassigned',sourceLineId:id,from:body.objectId,to:f.objectId});
 }
 // A theorem-like block begins a new semantic unit only with matching visual
 // break evidence. The semantic label alone never splits a paragraph.
 for(const body of [...page.objects.filter(o=>o.type==='body'&&o.sourceLineIds.length>1)]){
  const members=ordered(body.sourceLineIds,lines),groups=[[]];
  for(const line of members){const prev=groups.at(-1).at(-1),starts=/^(?:\(\d{1,3}\)\s*)?(?:Assumption|Theorem|Lemma|Proposition|Corollary|Definition|Remark|Example|Proof)\s*\d*\.?\s+/i.test(line.text.trim());
   const gap=prev&&line.bbox.y-prev.bbox.y,shift=prev&&prev.bbox.x-line.bbox.x;
   if(prev&&starts&&/[.!?]$/.test(prev.text.trim())&&gap>prev.bbox.height*1.25&&shift>prev.bbox.height*1.2)groups.push([]);
   groups.at(-1).push(line);
  }
  if(groups.length<2)continue;
  page.objects.splice(page.objects.indexOf(body),1,...groups.map(g=>rewrite(body,g.map(l=>l.sourceLineId),lines,key,'semantic_block_start_after_visual_paragraph_break')));
  operations.push({key,kind:'semantic_block_boundary_split',oldId:body.objectId,parts:groups.length});
 }
 // Recover only uniquely supported pending source units. Others stay pending.
 for(const pending of [...page.pendingMembership]){
  const line=lines.get(pending.sourceLineId),b=box(line),t=line.text.trim();
  if(!line||line.coverageClass!=='reviewable_content'||protectedAt(page,b))continue;
  const nearby=page.objects.filter(o=>o.type==='formula').map(o=>({o,b:o.spatialFragments?.[0]?.bbox,column:lines.get(o.sourceLineIds[0])?.column})).filter(x=>x.b);
  if(/^\(\d{1,3}(?:\.\d+)?[a-z]?\)$/.test(t)){
   const eligible=nearby.filter(x=>Math.abs(centerY(x.b)-centerY(b))<=Math.max(13,x.b.height*.8)&&b.x>=x.b.x+x.b.width-2&&b.x-x.b.x-x.b.width<inventory.pageSize.width*.19);
   if(eligible.length===1){page.pendingMembership=page.pendingMembership.filter(x=>x.sourceLineId!==line.sourceLineId);page.objects.push(rewrite({type:'equation_number',evidence:[],sourceCandidateIds:[]},[line.sourceLineId],lines,key,'right_aligned_printed_equation_number','equation_number'));operations.push({key,kind:'pending_equation_number_recovered',sourceLineId:line.sourceLineId});continue;}
  }
  if(/[A-Za-z]/.test(t)&&t.length<=38&&/[,.:;]$/.test(t)&&!/[=≤≥≈∑∫]/.test(t)){
   const sameLane=x=>x.column===line.column||x.column==='single'&&Math.abs((x.b.x+x.b.width/2)-(b.x+b.width/2))<inventory.pageSize.width*.27;
   const above=nearby.filter(x=>sameLane(x)&&x.b.y+x.b.height<=b.y+2&&b.y-x.b.y-x.b.height<22).sort((a,b)=>b.b.y-a.b.y);
   const below=nearby.filter(x=>sameLane(x)&&x.b.y>=b.y+b.height-2&&x.b.y-b.y-b.height<22).sort((a,b)=>a.b.y-b.b.y);
   if(above.length&&below.length){page.pendingMembership=page.pendingMembership.filter(x=>x.sourceLineId!==line.sourceLineId);page.objects.push(rewrite({type:'body',evidence:[],sourceCandidateIds:[]},[line.sourceLineId],lines,key,'prose_bridge_between_display_blocks','body'));operations.push({key,kind:'pending_prose_bridge_recovered',sourceLineId:line.sourceLineId});continue;}
  }
  if(t.length<=5&&line.bbox.width<=23&&!/\s/.test(t)&&!/[A-Za-z]{4}/.test(t)){
   const matched=nearby.filter(x=>xOverlap(x.b,b)>b.width*.6&&yOverlap(x.b,b)>b.height*.4);
   if(matched.length===1){const f=matched[0].o;page.pendingMembership=page.pendingMembership.filter(x=>x.sourceLineId!==line.sourceLineId);page.objects.splice(page.objects.indexOf(f),1,rewrite(f,[...f.sourceLineIds,line.sourceLineId],lines,key,'pending_math_member_attached_to_display','formula',union([...f.spatialFragments.map(x=>x.bbox),b])));operations.push({key,kind:'pending_math_member_attached',sourceLineId:line.sourceLineId});continue;}
  }
  // Larger math-only extraction residue can straddle a display frame edge.
  // Require a unique visual host, compact mathematical tokens and no prose.
  if(t.length<=38&&grammarWords(t).length<=1&&!/^(?:and|or|where|hence|then|with|for|by)(?=[^A-Za-z]|$)/i.test(t)&&
   !/\b(?:where|hence|therefore|which|from|with|this|that|then)\b/i.test(t)&&/[\d!√∑∫^_]|^(?:[A-Za-z]{1,2}\s+){2,}/.test(t)){
   const matched=nearby.filter(x=>x.column===line.column&&xOverlap(x.b,b)>b.width*.55&&
    (yOverlap(x.b,b)>b.height*.22||Math.min(Math.abs(b.y-x.b.y-x.b.height),Math.abs(x.b.y-b.y-b.height))<b.height*.6));
   if(matched.length===1){const f=matched[0].o;page.pendingMembership=page.pendingMembership.filter(x=>x.sourceLineId!==line.sourceLineId);page.objects.splice(page.objects.indexOf(f),1,rewrite(f,[...f.sourceLineIds,line.sourceLineId],lines,key,'math_only_residue_joined_unique_display','formula',union([...f.spatialFragments.map(x=>x.bbox),b])));operations.push({key,kind:'pending_math_residue_attached',sourceLineId:line.sourceLineId});continue;}
  }
 }
 // A paragraph's inline superscript may be emitted as a separate visual
 // fragment. Coalesce only tiny fragments immediately adjoining its own main
 // paragraph rectangle; do not bridge columns or a full display gap.
 for(const body of page.objects.filter(o=>o.type==='body'&&o.spatialFragments?.length>1)){
  const fragments=body.spatialFragments,main=fragments.reduce((a,b)=>a.bbox.width*a.bbox.height>=b.bbox.width*b.bbox.height?a:b);
  const tiny=fragments.filter(f=>f!==main&&f.bbox.width*f.bbox.height<main.bbox.width*main.bbox.height*.12&&
   f.bbox.x>=main.bbox.x-2&&f.bbox.x+f.bbox.width<=main.bbox.x+main.bbox.width+2&&
   f.bbox.y>=main.bbox.y-20&&f.bbox.y<=main.bbox.y+main.bbox.height+3);
  if(!tiny.length)continue;
  const merged={bbox:union([main.bbox,...tiny.map(f=>f.bbox)]),sourceLineIds:[...new Set([...(main.sourceLineIds||[]),...tiny.flatMap(f=>f.sourceLineIds||[])])]};
  body.spatialFragments=[...fragments.filter(f=>f!==main&&!tiny.includes(f)),merged];
  body.evidence=[...(body.evidence||[]),'tiny_inline_fragment_coalesced_in_paragraph_frame'];
  operations.push({key,kind:'paragraph_visual_tiny_fragment_coalesced',objectId:body.objectId,fragments:tiny.length});
 }
 const after=counts(page);assert.deepEqual([...after].sort(),[...baseline].sort(),key+': source-line conservation');
 assert([...after.values()].every(n=>n===1),key+': duplicate ownership');
 assert.deepEqual(page.referenceObjectRefs,prior.pages[key].referenceObjectRefs,key+': reference mutation');
 const byType={};for(const o of [...page.objects,...page.referenceObjectRefs||[]])byType[o.type]=(byType[o.type]||0)+1;
 page.summary={...page.summary,byType,objects:page.objects.length+(page.referenceObjectRefs||[]).length,pending:page.pendingMembership.length};
}
candidate.stage55={authority:'none',status:'offline_candidate_not_truth',operations,held};
return candidate;
}
module.exports={build};
