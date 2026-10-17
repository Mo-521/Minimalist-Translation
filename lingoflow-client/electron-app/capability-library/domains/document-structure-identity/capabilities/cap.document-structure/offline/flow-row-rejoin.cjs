"use strict";
// Offline-only. Rejoin a body row split by misleading lane hints when the
// source line geometry and the paragraph flow independently agree.
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
function build(inputs){
const before=inputs?.before;
const inventory=inputs?.inventory;
const after=structuredClone(before);
const operations=[];
const held=[];
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,24);
const box=l=>({x:l.bbox.x,y:l.bbox.y-l.bbox.height,width:l.bbox.width,height:l.bbox.height});
const union=bs=>({x:Math.min(...bs.map(b=>b.x)),y:Math.min(...bs.map(b=>b.y)),width:Math.max(...bs.map(b=>b.x+b.width))-Math.min(...bs.map(b=>b.x)),height:Math.max(...bs.map(b=>b.y+b.height))-Math.min(...bs.map(b=>b.y))});
const median=xs=>{const a=[...xs].sort((x,y)=>x-y);return a[Math.floor(a.length/2)]||0;};
const ordered=(ids,lines)=>ids.map(id=>lines.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x);
function ownership(page){const m=new Map();for(const o of [...page.objects,...(page.referenceObjectRefs||[])])for(const id of o.sourceLineIds)m.set(id,(m.get(id)||0)+1);for(const p of [...page.pendingMembership,...page.excludedSourceLines])m.set(p.sourceLineId,(m.get(p.sourceLineId)||0)+1);return [...m].sort(([a],[b])=>a.localeCompare(b));}
function candidates(parent,page,lines){
 const members=ordered(parent.sourceLineIds,lines);
 if(members.length<4)return [];
 const pb=union(parent.spatialFragments.map(f=>f.bbox));
 const medianWidth=median(members.map(l=>l.bbox.width));
 const gaps=members.slice(1).map((l,i)=>l.bbox.y-members[i].bbox.y).filter(g=>g>0);
 const rhythm=median(gaps);
 if(rhythm<=0||medianWidth<90)return [];
 const children=page.objects.filter(o=>o!==parent&&o.type==='body'&&o.sourceLineIds.length<=2&&o.sourceLineIds.every(id=>{
  const b=box(lines.get(id));return b.x>=pb.x-2&&b.x+b.width<=pb.x+pb.width+2&&b.y>=pb.y-2&&b.y+b.height<=pb.y+pb.height+2;
 }));
 const rows=new Map();
 for(const child of children)for(const id of child.sourceLineIds){const l=lines.get(id);let row=[...rows.keys()].find(y=>Math.abs(y-l.bbox.y)<=1.5);if(row===undefined){row=l.bbox.y;rows.set(row,[]);}rows.get(row).push({child,line:l});}
 const results=[];
 for(const [y,parts] of rows){
  const row=parts.sort((a,b)=>a.line.bbox.x-b.line.bbox.x);
  if(row.some((p,i)=>i>0&&p.line.bbox.x-(row[i-1].line.bbox.x+row[i-1].line.bbox.width)>Math.max(7,p.line.bbox.height*1.4)))continue;
  const above=members.filter(l=>l.bbox.y<y-1.5).at(-1),below=members.find(l=>l.bbox.y>y+1.5);
  if(!above||!below)continue;
  const step1=y-above.bbox.y,step2=below.bbox.y-y;
  if(step1<rhythm*.7||step1>rhythm*1.3||step2<rhythm*.7||step2>rhythm*1.3)continue;
  const rb=union(row.map(p=>box(p.line)));
  if(rb.width<medianWidth*.83||rb.width>medianWidth*1.13||Math.abs(rb.x-pb.x)>Math.max(10,medianWidth*.04)||Math.abs(rb.x+rb.width-(pb.x+pb.width))>Math.max(10,medianWidth*.04))continue;
  if(/[.!?:;]\s*$/.test(above.text.trim())||/^[A-Z][a-z]{2,}\b/.test(below.text.trim()))continue;
  const childSet=[...new Set(row.map(p=>p.child))];
  if(childSet.some(c=>c.sourceLineIds.some(id=>!row.some(p=>p.line.sourceLineId===id))))continue;
  const other=page.objects.filter(o=>o!==parent&&!childSet.includes(o)&&o.sourceLineIds.some(id=>{
   const l=lines.get(id);if(Math.abs(l.bbox.y-y)>Math.max(2,rb.height*.35))return false;
   const b=box(l);return Math.max(0,Math.min(b.x+b.width,rb.x+rb.width)-Math.max(b.x,rb.x))>Math.min(b.width,rb.width)*.15;
  }));
  if(other.length)continue;
  results.push({row,children:childSet,above,below,rowBox:rb,rhythm});
 }
 return results;
}
for(const [key,page] of Object.entries(after.pages)){
 const lines=new Map(inventory.pages[key].sourceLines.map(l=>[l.sourceLineId,l]));
 const baseline=ownership(before.pages[key]);
 for(const parent of [...page.objects.filter(o=>o.type==='body')]){
  if(!page.objects.includes(parent))continue;
  const matches=candidates(parent,page,lines);
  for(const match of matches){
   if(!page.objects.includes(parent)||match.children.some(c=>!page.objects.includes(c)))continue;
   const ids=ordered([...parent.sourceLineIds,...match.children.flatMap(c=>c.sourceLineIds)],lines).map(l=>l.sourceLineId);
   const members=ordered(ids,lines);
   const oldIds=[parent.objectId,...match.children.map(c=>c.objectId)];
   const merged={...parent,objectId:`stage57:${digest([key,oldIds,ids])}`,sourceLineIds:ids,
    sourceText:members.map(l=>l.text).join('\n'),memberCount:ids.length,
    memberLineBoxes:members.map(l=>({sourceLineId:l.sourceLineId,bbox:l.bbox})),
    spatialFragments:[{bbox:union([...parent.spatialFragments.map(f=>f.bbox),...match.children.flatMap(c=>c.spatialFragments.map(f=>f.bbox))]),sourceLineIds:ids}],
    sourceCandidateIds:[...new Set([...oldIds,...(parent.sourceCandidateIds||[]),...match.children.flatMap(c=>c.sourceCandidateIds||[])])],
    evidence:[...(parent.evidence||[]),'same_flow_row_rejoined_across_lane_hints'],authority:'none',status:'offline_candidate_not_truth'};
   page.objects=page.objects.filter(o=>o!==parent&&!match.children.includes(o));page.objects.push(merged);
   operations.push({key,kind:'same_flow_row_rejoined_across_lane_hints',oldIds,newId:merged.objectId,sourceLineIds:ids,
    joinedLineIds:match.row.map(p=>p.line.sourceLineId),upstreamHintConflict:[...new Set(match.row.map(p=>p.line.column))],
    geometry:{rowBox:match.rowBox,rhythm:match.rhythm}});
  }
 }
 assert.deepEqual(ownership(page),baseline,key+': source ownership changed');
 assert(baseline.every(([,n])=>n===1),key+': duplicate source ownership');
 assert.deepEqual(page.referenceObjectRefs,before.pages[key].referenceObjectRefs,key+': reference altered');
 const byType={};for(const o of [...page.objects,...(page.referenceObjectRefs||[])])byType[o.type]=(byType[o.type]||0)+1;
 page.summary={...page.summary,byType,objects:page.objects.length+(page.referenceObjectRefs||[]).length,pending:page.pendingMembership.length};
}
after.stage57={authority:'none',status:'offline_candidate_not_truth',operations,held};
return after;
}
module.exports={build};
