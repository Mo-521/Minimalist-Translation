"use strict";
// Offline-only semantic ownership reconstruction. Human frames are evidence,
// never coordinate or membership truth.
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
function build(inputs){
const before = inputs?.before ;
const inventory = inputs?.inventory ;
const after = structuredClone(before);
const operations = [];
const held = [];
const mathWords = new Set(['sin','cos','tan','ln','log','lim','dim','max','min','exp','span','inf','arg','sup','cvar','anchor','train']);
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);
const extent = line => ({x:line.bbox.x,y:line.bbox.y-line.bbox.height,width:line.bbox.width,height:line.bbox.height});
const union = boxes => ({x:Math.min(...boxes.map(b=>b.x)),y:Math.min(...boxes.map(b=>b.y)),width:Math.max(...boxes.map(b=>b.x+b.width))-Math.min(...boxes.map(b=>b.x)),height:Math.max(...boxes.map(b=>b.y+b.height))-Math.min(...boxes.map(b=>b.y))});
const overlap = (a,b) => Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
const median = numbers => {const a=[...numbers].sort((x,y)=>x-y);return a[Math.floor(a.length/2)]||0;};
const proseWords = text => (text.match(/[A-Za-z]{3,}/g)||[]).filter(w=>!mathWords.has(w.toLowerCase())&&!/^[A-Z]{2,}$/.test(w));
const mathMarks = text => (text.match(/[=<>≤≥≈≃≡∑∫^_√γμσλαβδεπχ∂∇±∈∀∃]/g)||[]).length;
const relation = text => /(?:=|<|>|≤|≥|≈|≃|≡|:=)/.test(text);
const order = (ids,lines) => ids.map(id=>lines.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x);
function rebuild(seed,ids,lines,key,reason,type=seed.type){
 const members=order(ids,lines),sourceLineIds=members.map(l=>l.sourceLineId);
 return {...seed,objectId:`stage56:${digest([key,type,sourceLineIds,reason])}`,type,sourceLineIds,
  sourceText:members.map(l=>l.text).join('\n'),memberCount:sourceLineIds.length,
  memberLineBoxes:members.map(l=>({sourceLineId:l.sourceLineId,bbox:l.bbox})),
  spatialFragments:[{bbox:union(members.map(extent)),sourceLineIds}],
  sourceCandidateIds:[...new Set([...(seed.sourceCandidateIds||[]),seed.objectId].filter(Boolean))],
  evidence:[...(seed.evidence||[]),reason],authority:'none',status:'offline_candidate_not_truth'};
}
function countOwnership(page){
 const out=new Map();for(const o of [...page.objects,...page.referenceObjectRefs||[]])for(const id of o.sourceLineIds)out.set(id,(out.get(id)||0)+1);
 for(const p of [...page.pendingMembership,...page.excludedSourceLines])out.set(p.sourceLineId,(out.get(p.sourceLineId)||0)+1);
 return [...out].sort(([a],[b])=>a.localeCompare(b));
}
function pageGeometry(page,lines){
 const byColumn=new Map();
 for(const o of page.objects.filter(o=>o.type==='body'))for(const id of o.sourceLineIds){
  const l=lines.get(id);if(proseWords(l.text).length<3||l.bbox.width<75)continue;
  if(!byColumn.has(l.column))byColumn.set(l.column,[]);byColumn.get(l.column).push(l);
 }
 return new Map([...byColumn].map(([column,items])=>[column,{
  width:median(items.map(l=>l.bbox.width)),center:median(items.map(l=>l.bbox.x+l.bbox.width/2))}]));
}
function strongMath(line,geometry){
 const t=line.text.trim(),g=geometry.get(line.column);if(!g||!t||t.length>150)return false;
 const words=proseWords(t),marks=mathMarks(t);
 if(words.length>1||marks<1||!(relation(t)||marks>=4))return false;
 if(/\b(?:where|which|because|therefore|however|moreover|assuming|then|hence|given|following|consequently|and|but|from|with)\b/i.test(t))return false;
 const centered=Math.abs(line.bbox.x+line.bbox.width/2-g.center)<g.width*.25;
 const narrowed=line.bbox.width<g.width*.73;
 return centered&&narrowed&&(marks>=2||t.length<=12);
}
function weakMath(line,anchor){
 const t=line.text.trim();if(!t||t.length>28||proseWords(t).length>0||mathMarks(t)>0&&relation(t))return false;
 const a=extent(anchor),b=extent(line);
 return Math.abs(line.bbox.y-anchor.bbox.y)<Math.max(14,anchor.bbox.height*1.2)&&
  overlap(a,b)>Math.min(a.width,b.width)*.45&&line.bbox.width<anchor.bbox.width*.8;
}
function isolatedMath(line,all,group,geometry){
 const g=geometry.get(line.column);if(!g)return false;
 const b=extent(line);
 // An extraction fragment sharing the prose baseline is inline evidence, not
 // a new block. Only group peers may occupy the same row.
 const competing=all.filter(l=>l.column===line.column&&!group.has(l.sourceLineId)&&
  proseWords(l.text).length>=3&&l.bbox.width>g.width*.52&&
  Math.abs(line.bbox.y-l.bbox.y)<Math.min(line.bbox.height,l.bbox.height)*1.1&&
  Math.min(b.y+b.height,extent(l).y+extent(l).height)-Math.max(b.y,extent(l).y)>Math.min(b.height,l.bbox.height)*.42);
 return competing.length===0;
}
function boundaryGroups(body,lines,geometry){
 const members=order(body.sourceLineIds,lines),anchors=members.filter(l=>strongMath(l,geometry));
 if(!anchors.length)return null;
 const math=new Set(anchors.map(l=>l.sourceLineId));
 for(const a of anchors)for(const l of members)if(!math.has(l.sourceLineId)&&weakMath(l,a))math.add(l.sourceLineId);
 for(const id of [...math])if(!isolatedMath(lines.get(id),members,math,geometry))math.delete(id);
 if(![...math].some(id=>anchors.some(a=>a.sourceLineId===id)))return null;
 const groups=[];for(const l of members){const kind=math.has(l.sourceLineId)?'formula':'body';if(groups.at(-1)?.type!==kind)groups.push({type:kind,ids:[]});groups.at(-1).ids.push(l.sourceLineId);}
 return groups.some(g=>g.type==='formula')?groups:null;
}
function recoverNumbers(page,lines,key){
 const candidates=[...page.pendingMembership.filter(p=>/^\(\d{1,3}(?:\.\d+)?[a-z]?\)$/.test(p.text.trim())).map(p=>({...p,owner:null})),
  ...page.objects.filter(o=>o.type==='body').flatMap(o=>o.sourceLineIds.map(id=>lines.get(id)).filter(l=>/^\(\d{1,3}(?:\.\d+)?[a-z]?\)$/.test(l.text.trim())).map(l=>({...l,owner:o})))];
 for(const item of candidates){const line=lines.get(item.sourceLineId),b=extent(line);
  const matches=page.objects.filter(o=>o.type==='formula'&&o.sourceLineIds.some(id=>{
   const m=lines.get(id),f=extent(m);return Math.abs(m.bbox.y-line.bbox.y)<Math.max(14,m.bbox.height*1.25)&&
    b.x>=f.x+f.width-2&&b.x-f.x-f.width<130;
  }));
  if(matches.length!==1)continue;
  if(item.owner){const remaining=item.owner.sourceLineIds.filter(id=>id!==line.sourceLineId),i=page.objects.indexOf(item.owner);
   if(i<0)continue;if(remaining.length)page.objects.splice(i,1,rebuild(item.owner,remaining,lines,key,'printed_equation_number_removed_from_body'));
   else page.objects.splice(i,1);
  }else page.pendingMembership=page.pendingMembership.filter(p=>p.sourceLineId!==line.sourceLineId);
  page.objects.push(rebuild({type:'equation_number',evidence:[],sourceCandidateIds:[]},[line.sourceLineId],lines,key,'printed_equation_number_separate_object','equation_number'));
  operations.push({key,kind:'equation_number_separated',sourceLineId:line.sourceLineId,adjacentFormulaId:matches[0].objectId});
 }
}
function attachMathResidue(page,lines,key,geometry){
 const proposals=[...page.objects.filter(o=>o.type==='body').flatMap(owner=>owner.sourceLineIds.map(id=>({line:lines.get(id),owner}))),
  ...page.pendingMembership.map(p=>({line:lines.get(p.sourceLineId),owner:null}))];
 for(const {line,owner} of proposals){
  const t=line?.text.trim();if(!t||t.length>42||/^\(\d{1,3}(?:\.\d+)?[a-z]?\)$/.test(t)||proseWords(t).length>0||
   /\b(?:is|as|of|on|in|at|to|by|or|and|for|if|we|it|so)\b/i.test(t))continue;
  const notation=mathMarks(t)>0||/^(?:[A-Za-z]{1,2}\s+){1,}[A-Za-z]{1,2}$/.test(t);
  if(!notation)continue;
  const b=extent(line),g=geometry.get(line.column);if(!g)continue;
  const hosts=page.objects.filter(o=>o.type==='formula').map(o=>({o,d:Math.min(...o.sourceLineIds.map(id=>{
   const m=lines.get(id),f=extent(m);return m.column===line.column&&
    Math.abs(m.bbox.y-line.bbox.y)<Math.max(19,m.bbox.height*1.55)&&
    overlap(f,b)>Math.min(f.width,b.width)*.44?Math.abs(m.bbox.y-line.bbox.y):Infinity;
  }))})).filter(x=>Number.isFinite(x.d)).sort((a,b)=>a.d-b.d);
  if(!hosts.length||hosts[1]&&hosts[1].d<hosts[0].d*1.6)continue;
  const prose=page.objects.filter(o=>o.type==='body'&&o!==owner).flatMap(o=>o.sourceLineIds.map(id=>lines.get(id)));
  if(!isolatedMath(line,prose,new Set(),geometry))continue;
  const host=hosts[0].o;
  if(owner){const remaining=owner.sourceLineIds.filter(id=>id!==line.sourceLineId),i=page.objects.indexOf(owner);
   if(i<0)continue;if(remaining.length)page.objects.splice(i,1,rebuild(owner,remaining,lines,key,'math_residue_removed_from_body'));
   else page.objects.splice(i,1);
  }else page.pendingMembership=page.pendingMembership.filter(p=>p.sourceLineId!==line.sourceLineId);
  page.objects.splice(page.objects.indexOf(host),1,rebuild(host,[...host.sourceLineIds,line.sourceLineId],lines,key,'math_residue_joined_unique_display','formula'));
  operations.push({key,kind:'math_residue_attached_to_display',sourceLineId:line.sourceLineId,previousOwner:owner?.objectId||'pending',formulaId:host.objectId});
 }
}
function isolateFooterNumber(page,lines,key,pageSize){
 for(const body of [...page.objects.filter(o=>o.type==='body')])for(const id of [...body.sourceLineIds]){
  const line=lines.get(id),b=line.bbox;
  if(line.text.trim()!==String(page.pageNumber)||b.y<pageSize.height*.86||
   Math.abs(b.x+b.width/2-pageSize.width/2)>pageSize.width*.08)continue;
  const remaining=body.sourceLineIds.filter(x=>x!==id),i=page.objects.indexOf(body);
  if(remaining.length)page.objects.splice(i,1,rebuild(body,remaining,lines,key,'footer_page_number_removed_from_body'));
  else page.objects.splice(i,1);
  page.objects.push(rebuild({type:'page_number',evidence:[],sourceCandidateIds:[]},[id],lines,key,'page_index_aligned_footer_furniture','page_number'));
  operations.push({key,kind:'footer_page_number_separated',sourceLineId:id});
 }
}
function mergeFormulaContinuations(page,lines,key){
 let changed=true;
 while(changed){
  changed=false;
  const formulas=page.objects.filter(o=>o.type==='formula').map(o=>({o,m:order(o.sourceLineIds,lines)}))
   .sort((a,b)=>a.m[0].bbox.y-b.m[0].bbox.y);
  for(let i=1;i<formulas.length;i++){
   const a=formulas[i-1],b=formulas[i],first=b.m[0],last=a.m.at(-1);
   if(first.column!==last.column)continue;
   const gap=first.bbox.y-last.bbox.y;
   if(gap<=0||gap>Math.max(25,Math.max(first.bbox.height,last.bbox.height)*1.75))continue;
   const operatorIndex=b.m.findIndex(l=>/^\s*[=≤≥≈≃≡+−-]/.test(l.text));
   if(operatorIndex<0||operatorIndex>2||b.m.slice(0,operatorIndex).some(l=>l.text.trim().length>12||proseWords(l.text).length))continue;
   const ab=union(a.m.map(extent)),bb=union(b.m.map(extent));
   if(overlap(ab,bb)<Math.min(ab.width,bb.width)*.35)continue;
   const proseBetween=page.objects.filter(o=>o.type==='body').some(o=>o.sourceLineIds.some(id=>{
    const l=lines.get(id);return l.column===first.column&&l.bbox.y>last.bbox.y&&l.bbox.y<first.bbox.y;
   }));
   const independentlyNumbered=page.objects.filter(o=>o.type==='equation_number').some(o=>o.sourceLineIds.some(id=>{
    const l=lines.get(id);return Math.abs(l.bbox.y-last.bbox.y)<Math.max(13,last.bbox.height);
   }));
   if(proseBetween||independentlyNumbered)continue;
   const merged=rebuild(a.o,[...a.o.sourceLineIds,...b.o.sourceLineIds],lines,key,'aligned_display_continuation_joined','formula');
   merged.sourceCandidateIds=[...new Set([...(a.o.sourceCandidateIds||[]),a.o.objectId,...(b.o.sourceCandidateIds||[]),b.o.objectId])];
   page.objects=page.objects.filter(o=>o!==a.o&&o!==b.o);page.objects.push(merged);
   operations.push({key,kind:'formula_continuation_joined',oldIds:[a.o.objectId,b.o.objectId],sourceLineIds:merged.sourceLineIds});
   changed=true;break;
  }
 }
}
for(const [key,page] of Object.entries(after.pages)){
 const lines=new Map(inventory.pages[key].sourceLines.map(l=>[l.sourceLineId,l]));
 const baseline=countOwnership(before.pages[key]),geometry=pageGeometry(page,lines);
 for(const body of [...page.objects.filter(o=>o.type==='body')]){
  const groups=boundaryGroups(body,lines,geometry);if(!groups)continue;
  const i=page.objects.indexOf(body);if(i<0)continue;
  const replacements=groups.map(g=>rebuild(body,g.ids,lines,key,g.type==='formula'?'isolated_math_row_removed_from_prose':'prose_separated_at_display_boundary',g.type));
  page.objects.splice(i,1,...replacements);
  operations.push({key,kind:'body_display_membership_split',oldId:body.objectId,parts:groups.map(g=>({type:g.type,sourceLineIds:g.ids}))});
 }
 attachMathResidue(page,lines,key,geometry);
 recoverNumbers(page,lines,key);
 mergeFormulaContinuations(page,lines,key);
 isolateFooterNumber(page,lines,key,inventory.pages[key].pageSize);
 const ownership=countOwnership(page);assert.deepEqual(ownership,baseline,key+': source conservation');
 assert(ownership.every(([,n])=>n===1),key+': duplicate ownership');
 assert.deepEqual(page.referenceObjectRefs,before.pages[key].referenceObjectRefs,key+': reference altered');
 const byType={};for(const o of [...page.objects,...page.referenceObjectRefs||[]])byType[o.type]=(byType[o.type]||0)+1;
 page.summary={...page.summary,byType,objects:page.objects.length+(page.referenceObjectRefs||[]).length,pending:page.pendingMembership.length};
}
after.stage56={authority:'none',status:'offline_candidate_not_truth',operations,held};
return after;
}
module.exports={build};
