"use strict";
// Generic offline display recall. Human frames supply regression evidence only.
const crypto=require('node:crypto'),assert=require('node:assert/strict');
function build(inputs){
const previous=inputs?.previous;
const source=inputs?.source;
const glyph=new Map((inputs?.glyph).matched.map(x=>[x.sourceLineId,x.visualBox]));
const next=structuredClone(previous),operations=[],rejected=[];
const union=bs=>{const x=Math.min(...bs.map(b=>b.x)),y=Math.min(...bs.map(b=>b.y));return{x,y,width:Math.max(...bs.map(b=>b.x+b.width))-x,height:Math.max(...bs.map(b=>b.y+b.height))-y};};
const box=l=>glyph.get(l.sourceLineId)||{x:l.bbox.x,y:l.bbox.y-l.bbox.height,width:l.bbox.width,height:l.bbox.height};
const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
const sort=(a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x;
function make(old,ids,lines,key,why,type=old.type){const ls=ids.map(id=>lines.get(id)).sort(sort);return {...old,objectId:'stage51:'+crypto.createHash('sha256').update(JSON.stringify([key,type,ls.map(l=>l.sourceLineId),why])).digest('hex').slice(0,24),type,sourceLineIds:ls.map(l=>l.sourceLineId),sourceCandidateIds:[...(old.sourceCandidateIds||[]),old.objectId].filter(Boolean),memberCount:ls.length,memberLineBoxes:ls.map(l=>({sourceLineId:l.sourceLineId,bbox:l.bbox})),sourceText:ls.map(l=>l.text).join('\n'),spatialFragments:[{bbox:union(ls.map(box)),sourceLineIds:ls.map(l=>l.sourceLineId)}],evidence:[...(old.evidence||[]),why]};}
function owner(page,id){return page.objects.find(o=>o.sourceLineIds.includes(id));}
function included(page,id){return owner(page,id)||page.pendingMembership.some(x=>x.sourceLineId===id);}
function sourceWords(text){return (text.match(/[A-Za-z]{3,}/g)||[]).filter(w=>!/(?:math|match|fmt|qry|alt|span|dim|sin|cos|tan|log|exp|max|min|lim|inf|sup|theta|lambda|phi|sigma|rho|pi)/i.test(w)).length;}
function mathSignals(text){return (text.match(/[=≈≃∼~≤≥<>±+×÷∑∫√πλθϕσρ∈∞^_{}|ˆ̃]/gu)||[]).length;}
function removeMember(page,id,lines,key){page.objects=page.objects.flatMap(o=>{if(!o.sourceLineIds.includes(id))return[o];const keep=o.sourceLineIds.filter(x=>x!==id);return keep.length?[make(o,keep,lines,key,'display_member_removed_from_prose')]:[];});page.pendingMembership=page.pendingMembership.filter(x=>x.sourceLineId!==id);}
function owned(page){const m=new Map();for(const o of [...page.objects,...page.referenceObjectRefs||[]])for(const id of o.sourceLineIds)m.set(id,(m.get(id)||0)+1);for(const p of [...page.pendingMembership,...page.excludedSourceLines])m.set(p.sourceLineId,(m.get(p.sourceLineId)||0)+1);return [...m].sort((a,b)=>a[0].localeCompare(b[0]));}
for(const [key,page] of Object.entries(next.pages)){
 const inventory=source.pages[key],lines=new Map(inventory.sourceLines.map(l=>[l.sourceLineId,l]));
 const reviewable=inventory.sourceLines.filter(l=>l.coverageClass==='reviewable_content');
 const protectedIds=new Set([...page.objects,...page.referenceObjectRefs||[]].filter(o=>['figure','table','caption','heading','title','author','reference','equation_number','unsupported_structured_block','page_number','running_header','running_footer'].includes(o.type)).flatMap(o=>o.sourceLineIds));
 const bodyHeights=page.objects.filter(o=>o.type==='body').flatMap(o=>o.sourceLineIds.map(id=>lines.get(id).bbox.height)).sort((a,b)=>a-b),normal=bodyHeights[Math.floor(bodyHeights.length/2)]||11;
 for(const line of [...reviewable].sort(sort)){
  const id=line.sourceLineId,prior=owner(page,id),s=line.text.trim(),signals=mathSignals(s),words=sourceWords(s);if(protectedIds.has(id)||!included(page,id)||prior&&!['body'].includes(prior.type)||s.length<5||s.length>180)continue;
  if(/https?:|\b(?:doi|arxiv|figure|table)\b|^\(?\d+(?:\.\d+)*\)?$/i.test(s))continue;
  const lane=reviewable.filter(l=>l!==line&&l.column===line.column).sort(sort);
  const p=lane.filter(l=>l.bbox.y<line.bbox.y-1).at(-1),n=lane.find(l=>l.bbox.y>line.bbox.y+1);
  const prevGap=p?box(line).y-(box(p).y+box(p).height):99,nextGap=n?box(n).y-(box(line).y+box(line).height):99;
  const beforeProse=lane.filter(l=>l.bbox.y<line.bbox.y-1&&sourceWords(l.text)>=3).at(-1),afterProse=lane.find(l=>l.bbox.y>line.bbox.y+1&&sourceWords(l.text)>=3);
  const clearAfter=!afterProse||box(afterProse).y-box(line).y-box(line).height>2;
  const clearBefore=!beforeProse||box(line).y-box(beforeProse).y-box(beforeProse).height>2;
  const laneLeft=Math.min(...lane.filter(l=>sourceWords(l.text)>=3&&l.bbox.width>70).map(l=>l.bbox.x),line.bbox.x),inset=line.bbox.x-laneLeft;
  const narrow=line.bbox.width<(line.column==='single'?.75:.72)*inventory.pageSize.width*(line.column==='single'?1:.5);
  const tall=line.bbox.height>=normal*1.25,isolated=(prevGap>Math.max(3,normal*.25)||nextGap>Math.max(3,normal*.25));
  const grammaticalLead=/^[A-Za-z]{3,}\s*:/u.test(s)||words>=2&&(/^[A-Z][a-z]{3,}\s*\d*\./.test(s)||/\b(?:if|then|where|therefore|hence|because)\b.*[,.;]/i.test(s));
  const noProse=(words<=1||words<=2&&signals>=4)&&!grammaticalLead&&!/^\s*(?:where|hence|therefore|then|we|for|if|and|using)\b/i.test(s);
  const relation=/[=≈≃∼~≤≥<>]/u.test(s),tuple=(s.match(/[,;]/g)||[]).length>=2&&/[ˆ̃^_πλθϕσρ]/u.test(s);
  const proseBreak=clearAfter&&(clearBefore||tuple&&tall&&inset>=18&&beforeProse&&/[:：]\s*$/.test(beforeProse.text.trim()));
  // A numerator/denominator or symbol line may be inside an existing display.
  // Require one unique, overlapping mathematical parent; never create an extra
  // formula object for the same display's residual source unit.
  if(noProse&&signals>=2){const b=box(line),parents=page.objects.filter(o=>o.type==='formula').map(o=>({o,b:union(o.spatialFragments.map(f=>f.bbox))})).filter(x=>{
   const vertical=Math.max(0,Math.max(x.b.y-b.y-b.height,b.y-x.b.y-x.b.height));
   return vertical<=Math.max(4,normal*.55)&&overlap(b,x.b)>=b.width*.55;
  }).sort((a,b)=>Math.abs(a.b.y+a.b.height/2-box(line).y-box(line).height/2)-Math.abs(b.b.y+b.b.height/2-box(line).y-box(line).height/2));
   if(parents.length===1||parents.length>1&&Math.abs(parents[0].b.y-box(line).y)+4<Math.abs(parents[1].b.y-box(line).y)){
    const target=parents[0].o,oldId=target.objectId,ids=[...target.sourceLineIds,id];removeMember(page,id,lines,key);
    page.objects=page.objects.filter(o=>o.objectId!==oldId);page.objects.push(make(target,ids,lines,key,'mathematical_member_joins_existing_display','formula'));
    operations.push({key,kind:'display_member_attached',sourceLineId:id,formulaId:oldId,text:s});continue;
   }
  }
  const eligible=noProse&&signals>=2&&(relation||tuple&&signals>=3)&&narrow&&proseBreak&&(tall||inset>=12||isolated&&signals>=4);
  if(!eligible){if(noProse&&signals>=2&&narrow)rejected.push({key,sourceLineId:id,reason:'display_evidence_insufficient',text:s.slice(0,100)});continue;}
  // A line sharing a physical prose row can carry inline math; keep that unit intact.
  const sameRowProse=lane.some(l=>Math.abs(l.bbox.y-line.bbox.y)<Math.min(l.bbox.height,line.bbox.height)*.32&&sourceWords(l.text)>=3&&overlap(box(l),box(line))>0);
  if(sameRowProse)continue;
  removeMember(page,id,lines,key);const made=make({type:'formula',sourceCandidateIds:[],evidence:[]},[id],lines,key,'isolated_math_without_relation_only_guard','formula');page.objects.push(made);
  operations.push({key,kind:'display_recalled',sourceLineId:id,previousType:prior?.type||'pending',text:s,signals,words,normalHeight:normal,visual:{inset,tall,prevGap,nextGap}});
 }
 // Split a paragraph if a newly recalled display sits between its members.
 for(const body of [...page.objects.filter(o=>o.type==='body'&&o.sourceLineIds.length>1)]){
  const ls=body.sourceLineIds.map(id=>lines.get(id)).sort(sort),groups=[[]];
  for(const line of ls){const prev=groups.at(-1).at(-1);if(prev&&line.column===prev.column&&page.objects.some(o=>o.type==='formula'&&o.sourceLineIds.some(id=>{const f=lines.get(id);return f.column===line.column&&f.bbox.y>prev.bbox.y+1&&f.bbox.y<line.bbox.y-1;})))groups.push([]);groups.at(-1).push(line);}
  if(groups.length>1){page.objects.splice(page.objects.indexOf(body),1,...groups.map(g=>make(body,g.map(l=>l.sourceLineId),lines,key,'display_barrier_separates_paragraphs')));operations.push({key,kind:'paragraph_split',oldId:body.objectId,parts:groups.length});}
 }
 assert.deepEqual(owned(page),owned(previous.pages[key]),`${key}: source ownership changed`);
 assert(owned(page).every(([,count])=>count===1),`${key}: duplicate source ownership`);
 assert.deepEqual(page.referenceObjectRefs,previous.pages[key].referenceObjectRefs,`${key}: reference modification`);
 const types={};for(const o of [...page.objects,...page.referenceObjectRefs||[]])types[o.type]=(types[o.type]||0)+1;
 page.summary={...page.summary,objects:page.objects.length+(page.referenceObjectRefs||[]).length,byType:types,assigned:[...page.objects,...page.referenceObjectRefs||[]].reduce((n,o)=>n+o.sourceLineIds.length,0),pending:page.pendingMembership.length};
}
next.stage51={authority:'none',status:'offline_candidate_not_truth',operations,rejected};
next.summary={...next.summary,pageLocalObjects:0,assigned:0,pending:0,byType:{}};
for(const p of Object.values(next.pages)){next.summary.pageLocalObjects+=p.objects.length;next.summary.assigned+=p.summary.assigned;next.summary.pending+=p.pendingMembership.length;for(const [type,n] of Object.entries(p.summary.byType))next.summary.byType[type]=(next.summary.byType[type]||0)+n;}
return next;
}
module.exports={build};
