#!/usr/bin/env node
"use strict";
// Offline-only, source-line based display-formula reconstruction. The human
// draft is evidence for the audit, never a producer input or membership truth.
const crypto=require("node:crypto");
const clean=s=>String(s||"").replace(/\s+/g," ").trim();
const label=s=>/^\(\d{1,3}(?:\.\d+)?[a-z]?\)$/.test(clean(s));
const trailingLabel=/\(\d{1,3}(?:\.\d+)?[a-z]?\)$/;
const marks=s=>(clean(s).match(/[=≈≃≤≥<>∑∫√^_{}⟨⟩⊙∈∉⊂⊆∪∩∞α-ωΑ-Ωλ−±∂∥÷×≡]/gu)||[]).length;
const relation=s=>/[=≈≃≤≥≡]/u.test(s)||/(?:^|\s)[<>](?:\s|$)/u.test(s);
const words=s=>(clean(s).match(/\b[A-Za-z]{3,}\b/g)||[]).length;
const prose=s=>/\b(?:the|this|that|these|those|where|which|we|our|their|with|from|into|using|thus|hence|therefore|then|however|also|let|for|and|or|by|of|in|to|is|are|was|were|gives|implies|yields|assume|defined|denotes|shows|consider)\b/i.test(s);
const hash=x=>crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0,24);
const top=l=>l.bbox.y-l.bbox.height,center=l=>l.bbox.x+l.bbox.width/2;
const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
const order=(a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x;
function lane(l,page){const mid=center(l),w=page.pageSize.width;return mid<w*.48?"left":mid>w*.52?"right":"middle"}
function sameArea(a,b,page){
  if(a.column===b.column)return true;
  if(a.column==="single"||b.column==="single")return Math.abs(center(a)-center(b))<page.pageSize.width*.3;
  return lane(a,page)===lane(b,page);
}
function inProtectedRegion(line,page,region){
  const b={x:line.bbox.x,y:top(line),width:line.bbox.width,height:line.bbox.height};
  if((page.objects||[]).some(o=>["table","figure","caption","reference"].includes(o.type)&&o.spatialFragments?.some(f=>{
    const q=f.bbox;return q&&Math.max(0,Math.min(b.y+b.height,q.y+q.height)-Math.max(b.y,q.y))>b.height*.5&&overlap(b,q)>b.width*.55;
  })))return true;
  return (region?.figures||[]).some(f=>f.frame&&Math.max(0,Math.min(b.y+b.height,f.frame.y+f.frame.height)-Math.max(b.y,f.frame.y))>b.height*.6&&overlap(b,f.frame)>b.width*.65);
}
function displayCore(line,page,region){
  const s=clean(line.text),b=line.bbox;
  if(!s||label(s)||s.length>160||words(s)>4||prose(s)||inProtectedRegion(line,page,region))return false;
  if(/<\/?[A-Za-z][\w-]*\b|<\/|(?:class|style|href)\s*=/.test(s))return false;
  if(!relation(s)||marks(s)<2)return false;
  // Extraction can yield a long but genuine display. Full-column sentence
  // widths require unusually strong math evidence; symbol count alone never
  // promotes a prose line containing inline math.
  const maxWidth=page.pageSize.width*(line.column==="single"?.8:.48);
  if(b.width>maxWidth&&marks(s)<5)return false;
  return true;
}
function formulaCompatible(line,anchor,page){
  if(!sameArea(line,anchor,page))return false;
  const a=anchor.bbox,b=line.bbox,dy=Math.abs(b.y-a.y);
  const xNear=overlap(a,b)>Math.min(a.width,b.width)*.18||Math.abs(center(line)-center(anchor))<page.pageSize.width*.14;
  return xNear&&dy<=Math.max(24,a.height*2.4,b.height*2.4);
}
function fragmentCompatible(line,anchor,page,region){
  const s=clean(line.text);
  if(!s||label(s)||prose(s)||words(s)>2||inProtectedRegion(line,page,region))return false;
  if(!formulaCompatible(line,anchor,page))return false;
  const dy=Math.abs(line.bbox.y-anchor.bbox.y);
  if(dy>Math.max(21,anchor.bbox.height*2.1))return false;
  // A bare character is membership evidence only inside the horizontal
  // footprint of a mathematical anchor, never a new formula anchor.
  if(s.length<=2&&overlap(line.bbox,anchor.bbox)<line.bbox.width*.45)return false;
  return marks(s)>0||/^[\w\d()~,.'\s+−-]{1,80}$/.test(s);
}
function equationLabelNear(line,anchor,page){
  if(!label(line.text)||!sameArea(line,anchor,page))return false;
  const b=line.bbox,a=anchor.bbox;
  const vertical=Math.abs((top(line)+b.height/2)-(top(anchor)+a.height/2));
  return vertical<=Math.max(13,a.height*1.15)&&b.x>a.x+a.width*.5&&b.x-a.x<page.pageSize.width*.52;
}
function extent(lines){return {x:Math.min(...lines.map(l=>l.bbox.x)),y:Math.min(...lines.map(top)),width:Math.max(...lines.map(l=>l.bbox.x+l.bbox.width))-Math.min(...lines.map(l=>l.bbox.x)),height:Math.max(...lines.map(l=>l.bbox.y))-Math.min(...lines.map(top))}}
function make(type,ids,byId,key,tag,origin){
  const ls=ids.map(id=>byId.get(id)).sort(order),ordered=ls.map(l=>l.sourceLineId),box=extent(ls);
  return {objectId:`stage43:${hash([key,type,ordered,tag])}`,type,page:ls[0].page,sourceLineIds:ordered,
    sourceText:ls.map(l=>clean(l.text)).join("\n"),memberCount:ls.length,
    memberLineBoxes:ls.map(l=>({sourceLineId:l.sourceLineId,bbox:l.bbox})),
    spatialFragments:[{bbox:box,sourceLineIds:ordered}],evidence:[tag],sourceCandidateIds:origin,
    authority:"none",status:"offline_candidate_not_truth"};
}
function rebuildOriginal(o,ids,byId,key,tag){return {...o,...make(o.type,ids,byId,key,tag,[o.objectId]),evidence:[...(o.evidence||[]),tag]}}
function reconstructPage(key,page,source,region){
  const out=structuredClone(page),byId=new Map(source.sourceLines.map(l=>[l.sourceLineId,l]));
  const context={...source,objects:out.objects};
  const pending=new Map(out.pendingMembership.map(x=>[x.sourceLineId,x]));
  const excluded=new Set(out.excludedSourceLines.map(x=>x.sourceLineId));
  const owner=new Map(out.objects.flatMap(o=>o.sourceLineIds.map(id=>[id,o])));
  const operations=[];
  const coreLines=source.sourceLines.filter(l=>l.coverageClass==="reviewable_content"&&!excluded.has(l.sourceLineId)&&
    (!owner.has(l.sourceLineId)||owner.get(l.sourceLineId).type==="body")&&displayCore(l,context,region));
  const existing=out.objects.filter(o=>o.type==="formula");
  // A new mathematical anchor may have been pending or mislabelled body.
  // Reject a candidate that is simply a second extracted line adjacent to a
  // known formula; it is handled as membership below.
  const anchors=coreLines.filter(l=>!existing.some(o=>o.sourceLineIds.some(id=>formulaCompatible(l,byId.get(id),source)&&
    Math.abs(l.bbox.y-byId.get(id).bbox.y)<Math.max(15,l.bbox.height*1.5))));
  const clusters=existing.map(o=>({old:o,ids:new Set(o.sourceLineIds),anchors:o.sourceLineIds.map(id=>byId.get(id))}));
  for(const line of anchors){clusters.push({old:null,ids:new Set([line.sourceLineId]),anchors:[line]});}
  const consumed=new Set();
  const available=source.sourceLines.filter(l=>l.coverageClass==="reviewable_content"&&!excluded.has(l.sourceLineId)&&
    (!owner.has(l.sourceLineId)||owner.get(l.sourceLineId).type==="body")&&!anchors.includes(l));
  for(const line of available){
    if(label(line.text))continue;
    const matches=clusters.filter(c=>c.anchors.some(a=>fragmentCompatible(line,a,context,region)));
    if(matches.length!==1)continue;
    const c=matches[0],current=owner.get(line.sourceLineId);
    // Do not extract a small symbol out of a multi-line paragraph unless it
    // is vertically superposed on the formula; leave ambiguous prose intact.
    if(current?.type==="body"&&current.sourceLineIds.length>1&&
      !c.anchors.some(a=>Math.abs(a.bbox.y-line.bbox.y)<=Math.max(a.bbox.height,line.bbox.height)*.8))continue;
    c.ids.add(line.sourceLineId);consumed.add(line.sourceLineId);
  }
  for(const c of clusters){for(const id of c.ids){pending.delete(id);const previous=owner.get(id);if(previous&&previous!==c.old){
    previous.sourceLineIds=previous.sourceLineIds.filter(x=>x!==id);owner.delete(id);
  }} }
  out.objects=out.objects.filter(o=>o.sourceLineIds.length).map(o=>{
    if(clusters.some(c=>c.old===o))return o;
    const original=page.objects.find(x=>x.objectId===o.objectId);
    return original&&o.sourceLineIds.length!==original.sourceLineIds.length?rebuildOriginal(o,o.sourceLineIds,byId,key,"formula_membership_extracted"):o;
  });
  for(const c of clusters){
    const ids=[...c.ids];if(c.old){const index=out.objects.indexOf(c.old);if(index<0)throw Error(`missing formula ${key}`);
      if(ids.length!==c.old.sourceLineIds.length)out.objects[index]=rebuildOriginal(c.old,ids,byId,key,"display_formula_fragment_attached");
    }else{out.objects.push(make("formula",ids,byId,key,"source_line_display_math_anchor",[]));
      operations.push({kind:"formula_anchor_recalled",sourceLineIds:ids});}
    if(ids.length>(c.old?.sourceLineIds.length||1))operations.push({kind:"formula_members_attached",sourceLineIds:ids});
  }
  // A label is a separate semantic object. It can be found even when the
  // frozen Column hint says `single` and the equation lives in a side column.
  const formulaLines=out.objects.filter(o=>o.type==="formula").flatMap(o=>o.sourceLineIds.map(id=>byId.get(id)));
  for(const l of source.sourceLines){if(l.coverageClass!=="reviewable_content"||excluded.has(l.sourceLineId)||!label(l.text))continue;
    if(!formulaLines.some(a=>equationLabelNear(l,a,source)))continue;
    const prior=out.objects.find(o=>o.sourceLineIds.includes(l.sourceLineId));
    if(prior?.type==="equation_number")continue;
    if(prior&&prior.type!=="body"&&prior.type!=="formula")continue;
    if(prior){prior.sourceLineIds=prior.sourceLineIds.filter(id=>id!==l.sourceLineId);
      if(!prior.sourceLineIds.length)out.objects.splice(out.objects.indexOf(prior),1);
      else out.objects[out.objects.indexOf(prior)]=rebuildOriginal(prior,prior.sourceLineIds,byId,key,"equation_label_extracted");}
    pending.delete(l.sourceLineId);out.objects.push(make("equation_number",[l.sourceLineId],byId,key,"spatially_aligned_equation_label",prior?[prior.objectId]:[]));
    operations.push({kind:"equation_number_recalled",sourceLineIds:[l.sourceLineId]});
  }
  out.pendingMembership=[...pending.values()];
  // A frozen source line can contain both the formula and its printed label.
  // Without character-span/text-item boxes there is no defensible way to
  // assign two whole-line owners or estimate a separate label rectangle.
  out.mixedLineEquationNumberEvidence=out.objects.filter(o=>o.type==="formula")
    .flatMap(o=>o.sourceLineIds.map(id=>byId.get(id)))
    .filter(l=>l&&!label(l.text)&&trailingLabel.test(clean(l.text)))
    .map(l=>({sourceLineId:l.sourceLineId,text:l.text,bbox:l.bbox,reason:"formula_and_label_share_frozen_source_line_span_required"}));
  const ids=new Set();for(const o of [...out.objects,...(out.referenceObjectRefs||[])])for(const id of o.sourceLineIds){if(ids.has(id))throw Error(`duplicate ${key}:${id}`);ids.add(id)}
  for(const id of pending.keys())if(ids.has(id))throw Error(`owned pending ${key}:${id}`);
  if(ids.size+pending.size+out.excludedSourceLines.length!==source.sourceLines.length)throw Error(`line loss ${key}: assigned=${ids.size} pending=${pending.size} excluded=${out.excludedSourceLines.length} source=${source.sourceLines.length} missing=${source.sourceLines.filter(l=>!ids.has(l.sourceLineId)&&!pending.has(l.sourceLineId)&&!out.excludedSourceLines.some(x=>x.sourceLineId===l.sourceLineId)).map(l=>l.text).slice(0,5).join('|')}`);
  const byType={};for(const o of [...out.objects,...(out.referenceObjectRefs||[])])byType[o.type]=(byType[o.type]||0)+1;
  out.summary={...out.summary,objects:out.objects.length+(out.referenceObjectRefs||[]).length,byType,assigned:ids.size,pending:pending.size,duplicateOwnership:0,lostSourceLines:0};
  out.stage43Operations=operations;return out;
}
function build(inputs){
  const input=inputs?.input;
  const frozen=inputs?.frozen;
  const regions=inputs?.regions;
  const pages={},counts={};for(const [key,page] of Object.entries(input.pages)){
  pages[key]=reconstructPage(key,page,frozen.pages[key],regions.pages[key]);
  for(const op of pages[key].stage43Operations)counts[op.kind]=(counts[op.kind]||0)+1;
}
  const summary={...input.summary,assigned:0,pending:0,excluded:0,pageLocalObjects:0,byType:{},stage43Operations:counts,mixedLineEquationNumberEvidence:0};
  for(const p of Object.values(pages)){summary.assigned+=p.summary.assigned;summary.pending+=p.summary.pending;summary.excluded+=p.excludedSourceLines.length;summary.pageLocalObjects+=p.objects.length;
    summary.mixedLineEquationNumberEvidence+=p.mixedLineEquationNumberEvidence.length;
    for(const [t,n] of Object.entries(p.summary.byType))summary.byType[t]=(summary.byType[t]||0)+n;}
  if(summary.assigned+summary.pending+summary.excluded!==summary.sourceLines)throw Error("global line loss");
  return {...input,schemaVersion:"OfflineStructuralObjectCandidate/vNext-display-formula-reconstruction",status:"machine_diagnostic_not_review_ready",summary,pages,
    stage43:{authority:"none",humanReviewIsProducerInput:false,runtimeModified:false}};
}
module.exports={build,reconstructPage,displayCore,fragmentCompatible,equationLabelNear};
