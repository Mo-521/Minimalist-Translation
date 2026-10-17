#!/usr/bin/env node
"use strict";
// Offline-only display-block assembly. Source membership is derived from the
// Stage 44 candidate and frozen/derived source units, never reviewer frames.
const crypto=require("node:crypto");
const tidy=s=>String(s||"").replace(/\s+/g," ").trim();
const hash=x=>crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0,24);
const baselineBox=l=>({x:l.bbox.x,y:l.bbox.y-l.bbox.height,width:l.bbox.width,height:l.bbox.height});
const union=boxes=>({x:Math.min(...boxes.map(b=>b.x)),y:Math.min(...boxes.map(b=>b.y)),
  width:Math.max(...boxes.map(b=>b.x+b.width))-Math.min(...boxes.map(b=>b.x)),
  height:Math.max(...boxes.map(b=>b.y+b.height))-Math.min(...boxes.map(b=>b.y))});
const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
const center=b=>b.x+b.width/2,midY=b=>b.y+b.height/2;
const order=(a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x;
function proseBridge(line){
  const s=tidy(line.text);
  return s.length<=28&&/^(?:one has|we have|we obtain|we may write|we define|then|hence|therefore|thus|and|and so|where)$/i.test(s)&&
    !/[=≈≃≤≥∑∫√^_{}]/u.test(s);
}
function formulaBox(ids,byId,glyphById){return union(ids.map(id=>glyphById.get(id)||baselineBox(byId.get(id))))}
function rebuild(old,ids,byId,key,tag,glyphById){
  const lines=ids.map(id=>byId.get(id)).sort(order),ordered=lines.map(l=>l.sourceLineId);
  const box=old.type==="formula"?formulaBox(ordered,byId,glyphById):union(lines.map(baselineBox));
  return {...old,objectId:`stage45:${hash([key,old.type,ordered,tag])}`,sourceLineIds:ordered,
    memberCount:ordered.length,sourceText:lines.map(l=>tidy(l.text)).join("\n"),
    memberLineBoxes:lines.map(l=>({sourceLineId:l.sourceLineId,bbox:l.bbox})),
    spatialFragments:[{bbox:box,sourceLineIds:ordered}],
    sourceCandidateIds:[...(old.sourceCandidateIds||[]),old.objectId],
    evidence:[...(old.evidence||[]),tag]};
}
function detachProseBridges(page,byId,key,ops,glyphById){
  for(const formula of [...page.objects.filter(o=>o.type==="formula"&&o.sourceLineIds.length>1)]){
    for(const id of [...formula.sourceLineIds]){
      const line=byId.get(id);if(!proseBridge(line))continue;
      const b=baselineBox(line);
      const targets=page.objects.filter(o=>o.type==="body"&&o.sourceLineIds.length>0).map(o=>{
        const last=byId.get(o.sourceLineIds.at(-1)),q=baselineBox(last);
        return {o,q,gap:b.y-(q.y+q.height)};
      }).filter(x=>x.gap>=-2&&x.gap<=18&&Math.abs(x.q.x-b.x)<=35&&
        byId.get(x.o.sourceLineIds.at(-1)).column===line.column).sort((a,b)=>a.gap-b.gap);
      if(targets.length!==1&&(!targets.length||targets[1].gap-targets[0].gap<4))continue;
      const body=targets[0].o,rest=formula.sourceLineIds.filter(x=>x!==id);
      if(!rest.length)continue;
      page.objects.splice(page.objects.indexOf(formula),1,rebuild(formula,rest,byId,key,"prose_bridge_excluded_from_formula",glyphById));
      page.objects.splice(page.objects.indexOf(body),1,rebuild(body,[...body.sourceLineIds,id],byId,key,"prose_bridge_returned_to_body",glyphById));
      ops.push({kind:"prose_bridge_returned_to_body",sourceLineId:id,from:formula.objectId,to:body.objectId});
      break;
    }
  }
}
function labelsFor(formulas,numbers,byId,pageWidth){
  const result=new Map(formulas.map(f=>[f.objectId,new Set()]));
  const covered=new Set(numbers.flatMap(o=>o.sourceLineIds));
  const labels=[...numbers.map(o=>({id:o.objectId,box:o.spatialFragments[0].bbox})),
    ...[...byId.values()].filter(l=>!covered.has(l.sourceLineId)&&/^\(\d{1,3}(?:\.\d+)?[a-z]?\)/.test(tidy(l.text)))
      .map(l=>({id:`source:${l.sourceLineId}`,box:baselineBox(l)}))];
  for(const label of labels){
    const matches=formulas.map(f=>{const b=f.spatialFragments[0].bbox,q=label.box;
      const vertical=Math.abs(midY(q)-midY(b));
      const horizontal=Math.min(Math.abs((q.x+q.width)-b.x),Math.abs(q.x-(b.x+b.width)));
      return {f,score:vertical+horizontal*.05,vertical,horizontal};
    }).filter(x=>x.vertical<=Math.max(18,x.f.spatialFragments[0].bbox.height*.7)&&x.horizontal<=pageWidth*.4)
      .sort((a,b)=>a.score-b.score);
    if(matches.length)result.get(matches[0].f.objectId).add(label.id);
  }
  return result;
}
function proseBetween(a,b,objects,byId){
  const first=a.spatialFragments[0].bbox,second=b.spatialFragments[0].bbox;
  const lo=Math.min(midY(first),midY(second)),hi=Math.max(midY(first),midY(second));
  return objects.some(o=>o.type==="body"&&o.sourceLineIds.some(id=>{
    const line=byId.get(id),q=baselineBox(line),y=midY(q);
    return y>lo+3&&y<hi-3&&overlap(q,union([first,second]))>Math.min(q.width,first.width,second.width)*.2;
  }));
}
function shouldJoin(a,b,context){
  const x=a.spatialFragments[0].bbox,y=b.spatialFragments[0].bbox;
  const ax=context.labels.get(a.objectId)||new Set(),by=context.labels.get(b.objectId)||new Set();
  if(ax.size&&by.size&&![...ax].some(id=>by.has(id)))return false;
  const horizontal=overlap(x,y),ratio=horizontal/Math.min(x.width,y.width);
  if(ratio<.35||Math.abs(center(x)-center(y))>context.pageWidth*.23)return false;
  const gap=Math.max(0,y.y-(x.y+x.height),x.y-(y.y+y.height));
  if(gap>20||proseBetween(a,b,context.objects,context.byId))return false;
  const narrow=Math.min(x.width,y.width)/Math.max(x.width,y.width)<.57;
  const continuation=/^[\s=≤≥≈≃<>+-]/u.test(tidy(b.sourceText));
  return gap<=6||gap<=20&&(continuation||narrow&&Math.abs(center(x)-center(y))<Math.max(x.width,y.width)*.27);
}
function assemble(page,byId,key,ops,pageWidth,glyphById){
  const formulas=page.objects.filter(o=>o.type==="formula");
  const context={objects:page.objects,byId,pageWidth,
    labels:labelsFor(formulas,page.objects.filter(o=>o.type==="equation_number"),byId,pageWidth)};
  const parent=new Map(formulas.map(o=>[o.objectId,o.objectId]));
  const find=x=>parent.get(x)===x?x:(parent.set(x,find(parent.get(x))),parent.get(x));
  const join=(a,b)=>{const x=find(a),y=find(b);if(x!==y)parent.set(y,x)};
  for(let i=0;i<formulas.length;i++)for(let j=i+1;j<formulas.length;j++){
    if(shouldJoin(formulas[i],formulas[j],context))join(formulas[i].objectId,formulas[j].objectId);
  }
  const groups=new Map();for(const f of formulas){const root=find(f.objectId),v=groups.get(root)||[];v.push(f);groups.set(root,v)}
  for(const group of groups.values()){
    if(group.length<2)continue;
    const ids=[...new Set(group.flatMap(o=>o.sourceLineIds))];
    const merged=rebuild(group[0],ids,byId,key,"display_block_assembled_from_formula_components",glyphById);
    merged.sourceCandidateIds=[...new Set(group.flatMap(o=>[...(o.sourceCandidateIds||[]),o.objectId]))];
    merged.evidence=[...new Set([...group.flatMap(o=>o.evidence||[]),"display_block_assembled_from_formula_components"])];
    page.objects=page.objects.filter(o=>!group.includes(o));page.objects.push(merged);
    ops.push({kind:"formula_components_assembled",beforeObjectIds:group.map(o=>o.objectId),afterObjectId:merged.objectId,
      sourceLineIds:ids});
  }
}
function reconstructPage(key,original,inventory,glyphById=new Map()){
  const page=structuredClone(original),byId=new Map(inventory.sourceLines.map(l=>[l.sourceLineId,l])),ops=[];
  detachProseBridges(page,byId,key,ops,glyphById);assemble(page,byId,key,ops,inventory.pageSize.width,glyphById);
  const owned=new Set();for(const o of [...page.objects,...(page.referenceObjectRefs||[])])for(const id of o.sourceLineIds){
    if(!byId.has(id)||owned.has(id))throw Error(`invalid ownership ${key}:${id}`);owned.add(id);
  }
  const pending=new Set(page.pendingMembership.map(x=>x.sourceLineId)),excluded=new Set(page.excludedSourceLines.map(x=>x.sourceLineId));
  for(const l of inventory.sourceLines){const id=l.sourceLineId;
    if(Number(owned.has(id))+Number(pending.has(id))+Number(excluded.has(id))!==1)throw Error(`line coverage ${key}:${id}`);
  }
  const byType={};for(const o of [...page.objects,...(page.referenceObjectRefs||[])])byType[o.type]=(byType[o.type]||0)+1;
  page.summary={...page.summary,objects:page.objects.length+(page.referenceObjectRefs||[]).length,byType,
    assigned:owned.size,pending:pending.size,excluded:excluded.size,duplicateOwnership:0,lostSourceLines:0};
  page.stage45Operations=ops;
  return page;
}
function build(inputs){
  const input=inputs?.input;
  const source=inputs?.source;
  const glyph=inputs?.glyph;
  const glyphById=new Map(glyph.matched.map(x=>[x.sourceLineId,x.visualBox]));
  const pages={},counts={};for(const [key,page] of Object.entries(input.pages)){
  pages[key]=reconstructPage(key,page,source.pages[key],glyphById);
  for(const op of pages[key].stage45Operations)counts[op.kind]=(counts[op.kind]||0)+1;
}
  const summary={...input.summary,pageLocalObjects:0,assigned:0,pending:0,excluded:0,byType:{},stage45Operations:counts};
  for(const p of Object.values(pages)){
    summary.pageLocalObjects+=p.objects.length;summary.assigned+=p.summary.assigned;
    summary.pending+=p.summary.pending;summary.excluded+=p.summary.excluded;
    for(const [type,n] of Object.entries(p.summary.byType))summary.byType[type]=(summary.byType[type]||0)+n;
  }
  if(summary.assigned+summary.pending+summary.excluded!==summary.sourceLines)throw Error("global coverage");
  return {...input,schemaVersion:"OfflineStructuralObjectCandidate/vNext-display-block-assembly",
    status:"machine_diagnostic_not_review_ready",summary,pages,
    stage45:{authority:"none",runtimeModified:false,humanDraftUsedAsMembershipTruth:false}};
}
module.exports={build,reconstructPage,shouldJoin,proseBridge};
