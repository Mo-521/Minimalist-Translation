"use strict";
// Shared offline pass: mathematical residuals cannot inflate prose frames.
const crypto=require('node:crypto');
const clean=s=>String(s).replace(/\s+/g,' ').trim();
const natural=s=>(clean(s).match(/[A-Za-z]{3,}/g)||[]).filter(w=>!/^(?:sin|cos|tan|log|exp|dim|span|max|min|lim|inf|sup)[A-Z]?$/i.test(w));
const box=l=>({...l.bbox,y:l.bbox.y-l.bbox.height});
const union=bs=>{const x=Math.min(...bs.map(b=>b.x)),y=Math.min(...bs.map(b=>b.y));return{x,y,width:Math.max(...bs.map(b=>b.x+b.width))-x,height:Math.max(...bs.map(b=>b.y+b.height))-y}};
const label=s=>/^\(\d+(?:\.\d+)?[a-z]?\)$/.test(clean(s));
const headerSignature=s=>clean(s).replace(/^\d+\s*/,'').replace(/\s*\d+$/,'').replace(/\s+/g,' ');
function headerPoolFor(source){const headerPool=new Map();
 for(const [key,p] of Object.entries(source.pages))for(const l of p.sourceLines){
  const sig=headerSignature(l.text);if(l.bbox.y>65||sig.length<10||(sig.match(/[A-Z]{2,}/g)||[]).length<2||/[a-z]/.test(sig))continue;
  const id=key.split(':')[0]+':'+sig,list=headerPool.get(id)||[];list.push({page:key,line:l});headerPool.set(id,list);
 }
 return headerPool;
}
const mathOnly=s=>{const t=clean(s);return t&&t.length<=45&&!label(t)&&
 !/\b(?:of|is|to|in|by|as|or|at|an|no|if|it|we|be|so|on)\b/i.test(t)&&
 !/^(?:\([a-z]\)\s*){2,}$/i.test(t)&&natural(t).length===0&&/\w|[α-ωΑ-Ω∑∫∞]/u.test(t)};
function remake(o,ids,byId,key,reason,type=o.type){
 const lines=ids.map(id=>byId.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x);
 const sorted=lines.map(l=>l.sourceLineId),bbox=union(lines.map(box));
 return {...o,objectId:'stage49:'+crypto.createHash('sha256').update(JSON.stringify([key,type,sorted,reason])).digest('hex').slice(0,24),type,
  sourceLineIds:sorted,sourceText:lines.map(l=>l.text).join('\n'),memberCount:sorted.length,
  memberLineBoxes:lines.map(l=>({sourceLineId:l.sourceLineId,bbox:l.bbox})),spatialFragments:[{bbox,sourceLineIds:sorted}],
  sourceCandidateIds:[...(o.sourceCandidateIds||[]),o.objectId],evidence:[...(o.evidence||[]),reason]};
}
function refine(key,original,inventory,headerPool){
 const page=structuredClone(original),byId=new Map(inventory.sourceLines.map(l=>[l.sourceLineId,l])),ops=[];
 for(const line of inventory.sourceLines){
  const peers=headerPool.get(key.split(':')[0]+':'+headerSignature(line.text))||[];
  if(line.bbox.y>65||new Set(peers.map(p=>p.page)).size<3||peers.some(p=>Math.abs(p.line.bbox.y-line.bbox.y)>5))continue;
  const prior=page.objects.find(o=>o.sourceLineIds.includes(line.sourceLineId));
  if(prior&&prior.type!=='body'||page.excludedSourceLines.some(x=>x.sourceLineId===line.sourceLineId))continue;
  if(prior){const rest=prior.sourceLineIds.filter(id=>id!==line.sourceLineId);page.objects=page.objects.filter(o=>o!==prior);if(rest.length)page.objects.push(remake(prior,rest,byId,key,'recurrent_header_removed_from_prose'));}
  page.pendingMembership=page.pendingMembership.filter(p=>p.sourceLineId!==line.sourceLineId);
  page.objects.push(remake({objectId:prior?.objectId||'pending',type:'running_header'},[line.sourceLineId],byId,key,'recurrent_upper_page_anchor','running_header'));
  ops.push({kind:'recurrent_header_isolated',sourceLineId:line.sourceLineId});
 }
 // Preserve readable prose between displays. Mixed-height extraction rows
 // remain pending because shrinking their frame cannot resolve membership.
 for(const item of [...page.pendingMembership]){
  if(!['unresolved_membership','math_or_equation_label_pending'].includes(item.reason))continue;
  const line=byId.get(item.sourceLineId),t=clean(line.text),words=t.match(/[A-Za-z]{2,}/g)||[];
  if(line.bbox.height>14||words.length<2||natural(t).length<1||label(t)||
   !/\b(?:we|where|would|since|as|for|then|thus|hence)\b/i.test(t)||t.length>160||
   /^(?:end\s+(?:for|while|if)|else|return|break|continue)\b/i.test(t))continue;
  const bodyLines=page.objects.filter(o=>o.type==='body').flatMap(o=>o.sourceLineIds.map(id=>byId.get(id))).filter(l=>l.column===line.column);
  if(!bodyLines.length||Math.abs(line.bbox.x-Math.min(...bodyLines.map(l=>l.bbox.x)))>18)continue;
  const nearbyMath=page.objects.some(o=>o.type==='formula'&&o.sourceLineIds.some(id=>{
   const m=byId.get(id);return m.column===line.column&&Math.abs(m.bbox.y-line.bbox.y)<50;
  }));if(!nearbyMath)continue;
  page.pendingMembership=page.pendingMembership.filter(p=>p.sourceLineId!==line.sourceLineId);
  const prior=page.objects.filter(o=>o.type==='body').map(o=>({o,last:byId.get(o.sourceLineIds.at(-1))}))
   .filter(x=>x.last.column===line.column&&line.bbox.y-x.last.bbox.y>0&&line.bbox.y-x.last.bbox.y<20&&
    !/[.!?:]\s*$/.test(clean(x.last.text)))
   .filter(x=>!page.objects.some(o=>o.type==='formula'&&o.sourceLineIds.some(id=>{const y=byId.get(id).bbox.y;return y>x.last.bbox.y&&y<line.bbox.y;})))
   .sort((a,b)=>b.last.bbox.y-a.last.bbox.y)[0];
  if(prior){page.objects=page.objects.filter(o=>o!==prior.o);page.objects.push(remake(prior.o,[...prior.o.sourceLineIds,line.sourceLineId],byId,key,'readable_prose_tail_attached'));}
  else page.objects.push(remake({objectId:'pending',type:'body'},[line.sourceLineId],byId,key,'readable_prose_between_displays'));
  ops.push({kind:'prose_unit_recovered',sourceLineId:line.sourceLineId});
 }
 // Underscores in extraction text must not hide a real lexical word from
 // the residual-math test (for example a prose tail plus detached subscript).
 for(const formula of [...page.objects.filter(o=>o.type==='formula'&&o.evidence?.includes('residual_math_fragment_attached'))]){
  const lexical=formula.sourceLineIds.map(id=>byId.get(id)).filter(l=>natural(l.text).length&&
   clean(l.text).length<25&&!/[=≈≤≥∑∫∞α-ωΑ-Ω()]/u.test(l.text));
  for(const line of lexical){
   const current=page.objects.find(o=>o.sourceLineIds.includes(line.sourceLineId));if(!current||current.type!=='formula'||current.sourceLineIds.length<2)continue;
   const rest=current.sourceLineIds.filter(id=>id!==line.sourceLineId);
   page.objects=page.objects.filter(o=>o!==current);page.objects.push(remake(current,rest,byId,key,'lexical_tail_removed_from_formula'));
   const neighbor=page.objects.filter(o=>o.type==='body').map(o=>({o,last:byId.get(o.sourceLineIds.at(-1))}))
    .filter(x=>x.last.column===line.column&&line.bbox.y-x.last.bbox.y>0&&line.bbox.y-x.last.bbox.y<20)
    .sort((a,b)=>b.last.bbox.y-a.last.bbox.y)[0];
   if(neighbor){page.objects=page.objects.filter(o=>o!==neighbor.o);page.objects.push(remake(neighbor.o,[...neighbor.o.sourceLineIds,line.sourceLineId],byId,key,'lexical_paragraph_tail_restored'));}
   else page.objects.push(remake({objectId:current.objectId,type:'body'},[line.sourceLineId],byId,key,'lexical_prose_restored'));
   ops.push({kind:'lexical_prose_restored',sourceLineId:line.sourceLineId});
  }
 }
 // Conservative assignment/function displays without large math operators.
 const protectedIds=new Set([...page.objects,...page.referenceObjectRefs||[]].filter(o=>o.type!=='body').flatMap(o=>o.sourceLineIds));
 for(const line of inventory.sourceLines){
  const t=clean(line.text),lexical=natural(t).filter(w=>!(w.toLowerCase()==='and'&&(t.match(/:?=/g)||[]).length>=2));
  if(protectedIds.has(line.sourceLineId)||lexical.length||!/(?:[:=]|≡)/.test(t)||
    !/[A-Za-zα-ωΑ-Ω]\s*(?:[_\d]|\([^)]*\))?\s*:?=/u.test(t)||t.length>120)continue;
  const sameLane=inventory.sourceLines.filter(l=>l.column===line.column&&l.sourceLineId!==line.sourceLineId);
  const prose=sameLane.filter(l=>natural(l.text).length>=3),near=prose.filter(l=>Math.abs(l.bbox.y-line.bbox.y)<4);
  if(near.length)continue;
  const left=Math.min(...prose.map(l=>l.bbox.x));
  const before=prose.filter(l=>l.bbox.y<line.bbox.y).sort((a,b)=>b.bbox.y-a.bbox.y)[0],after=prose.filter(l=>l.bbox.y>line.bbox.y).sort((a,b)=>a.bbox.y-b.bbox.y)[0];
  if(!before||!after||line.bbox.x-left<20||line.bbox.width>inventory.pageSize.width*.72||
    line.bbox.y-before.bbox.y<13||after.bbox.y-line.bbox.y<13)continue;
  const prior=page.objects.find(o=>o.sourceLineIds.includes(line.sourceLineId));if(prior&&prior.type!=='body')continue;
  if(prior){const rest=prior.sourceLineIds.filter(id=>id!==line.sourceLineId);page.objects=page.objects.filter(o=>o!==prior);if(rest.length)page.objects.push(remake(prior,rest,byId,key,'assignment_display_detached'));}
  page.pendingMembership=page.pendingMembership.filter(p=>p.sourceLineId!==line.sourceLineId);
  page.objects.push(remake({objectId:'unassigned',type:'formula'},[line.sourceLineId],byId,key,'isolated_assignment_display_recalled','formula'));
  ops.push({kind:'assignment_display_recalled',sourceLineId:line.sourceLineId});
 }
 for(const line of inventory.sourceLines){
  if(line.coverageClass!=='reviewable_content'||!mathOnly(line.text))continue;
  const prior=page.objects.find(o=>o.sourceLineIds.includes(line.sourceLineId));if(!prior||prior.type!=='body')continue;
  const possible=page.objects.filter(o=>o.type==='formula').map(o=>{
   const members=o.sourceLineIds.map(id=>byId.get(id));const bbox=union(members.map(box));
   const overlap=Math.max(0,Math.min(line.bbox.x+line.bbox.width,bbox.x+bbox.width)-Math.max(line.bbox.x,bbox.x));
   const distance=Math.min(...members.map(l=>Math.abs(l.bbox.y-line.bbox.y)));
   return {o,bbox,members,distance,overlap};
  }).filter(x=>x.overlap>=Math.min(line.bbox.width,8)*.7&&x.distance<=22&&x.members.some(l=>l.column===line.column))
   .filter(x=>{const nearest=x.members.slice().sort((a,b)=>Math.abs(a.bbox.y-line.bbox.y)-Math.abs(b.bbox.y-line.bbox.y))[0];
    return !inventory.sourceLines.some(l=>l.column===line.column&&natural(l.text).length&&
     l.bbox.y>Math.min(nearest.bbox.y,line.bbox.y)+3&&l.bbox.y<Math.max(nearest.bbox.y,line.bbox.y)-3);})
   .sort((a,b)=>a.distance-b.distance);
  if(!possible.length||possible.length>1&&possible[1].distance-possible[0].distance<5)continue;
  const target=possible[0].o,rest=prior.sourceLineIds.filter(id=>id!==line.sourceLineId);
  page.objects=page.objects.filter(o=>o!==prior&&o!==target);
  if(rest.length)page.objects.push(remake(prior,rest,byId,key,'math_residual_removed_from_prose'));
  page.objects.push(remake(target,[...target.sourceLineIds,line.sourceLineId],byId,key,'context_supported_math_residual'));
  ops.push({kind:'math_residual_reassigned',sourceLineId:line.sourceLineId,from:prior.objectId,to:target.objectId});
 }
 // Paragraph display extents follow their remaining members; do not bridge a
 // mathematical region with a single rectangular envelope.
 for(const o of page.objects.filter(o=>o.type==='body')){
  const ls=o.sourceLineIds.map(id=>byId.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x),groups=[];
  for(const l of ls){const prev=groups.at(-1)?.at(-1);if(!prev||prev.column!==l.column||
   l.bbox.y-prev.bbox.y>25||Math.abs(l.bbox.x-prev.bbox.x)>inventory.pageSize.width*.25)groups.push([l]);else groups.at(-1).push(l);}
  o.spatialFragments=groups.map(g=>({bbox:union(g.map(box)),sourceLineIds:g.map(l=>l.sourceLineId)}));
 }
 const states=new Map(inventory.sourceLines.map(l=>[l.sourceLineId,0]));
 for(const o of [...page.objects,...page.referenceObjectRefs||[]])for(const id of o.sourceLineIds)states.set(id,(states.get(id)||0)+1);
 for(const p of [...page.pendingMembership,...page.excludedSourceLines])states.set(p.sourceLineId,(states.get(p.sourceLineId)||0)+1);
 if(states.size!==inventory.sourceLines.length||[...states.values()].some(n=>n!==1))throw Error('ownership '+key);
 page.stage49Operations=ops;return page;
}
function build(inputs){
 const base=inputs?.base;
 const source=inputs?.source;
 const headerPool=headerPoolFor(source);
 const pages={},counts={};for(const [k,p] of Object.entries(base.pages)){pages[k]=refine(k,p,source.pages[k],headerPool);for(const x of pages[k].stage49Operations)counts[x.kind]=(counts[x.kind]||0)+1;}
 return {...base,pages,schemaVersion:'OfflineStructuralObjectCandidate/vNext-formula-prose-support',stage49:{authority:'none',humanFramesAreProducerInput:false,operations:counts}};
}
module.exports={build,refine,headerPoolFor};
