#!/usr/bin/env node
"use strict";
// One offline consumer-facing candidate pass. Source-line splitting is backed
// by PDF character geometry; figure internals become opaque figure members.
const crypto=require("node:crypto");
const hash=x=>crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0,24);
const tidy=s=>String(s||"").replace(/\s+/g," ").trim();
const top=l=>l.bbox.y-l.bbox.height;
const order=(a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x;
const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
const extent=ls=>{const x=Math.min(...ls.map(l=>l.bbox.x)),y=Math.min(...ls.map(top));return {x,y,width:Math.max(...ls.map(l=>l.bbox.x+l.bbox.width))-x,height:Math.max(...ls.map(l=>l.bbox.y))-y}};
const baseline=b=>({x:b.x,y:b.y+b.height,width:b.width,height:b.height});
const boxUnion=boxes=>({x:Math.min(...boxes.map(b=>b.x)),y:Math.min(...boxes.map(b=>b.y)),
  width:Math.max(...boxes.map(b=>b.x+b.width))-Math.min(...boxes.map(b=>b.x)),
  height:Math.max(...boxes.map(b=>b.y+b.height))-Math.min(...boxes.map(b=>b.y))});
function make(type,ids,byId,key,tag,frame=null){
  const ls=ids.map(id=>byId.get(id)).sort(order),sorted=ls.map(l=>l.sourceLineId);
  if(ids.length!==ls.length)throw Error(`missing member ${key}:${tag}`);
  const bbox=frame||extent(ls);
  return {objectId:`stage44:${hash([key,type,sorted,tag,frame])}`,type,page:Number(key.split(":")[1]),sourceLineIds:sorted,
    sourceText:ls.map(l=>tidy(l.text)).join("\n"),memberCount:ls.length,
    memberLineBoxes:ls.map(l=>({sourceLineId:l.sourceLineId,bbox:l.bbox})),
    spatialFragments:[{bbox,sourceLineIds:sorted}],evidence:[tag],authority:"none",status:"offline_candidate_not_truth"};
}
function rebuild(o,ids,byId,key,tag){
  const next=make(o.type,ids,byId,key,tag);
  return {...o,...next,evidence:[...(o.evidence||[]),tag],sourceCandidateIds:[...(o.sourceCandidateIds||[]),o.objectId]};
}
function imageCaptionNear(frame,objects){
  return objects.some(o=>o.type==="caption"&&o.spatialFragments?.some(f=>{
    const b=f.bbox,gap=b.y-(frame.y+frame.height);
    return gap>=-2&&gap<=55&&overlap(frame,b)>Math.min(frame.width,b.width)*.45;
  }));
}
function insideFigure(line,frame){
  const b={x:line.bbox.x,y:top(line),width:line.bbox.width,height:line.bbox.height};
  const mx=b.x+b.width/2,my=b.y+b.height/2;
  const center=mx>=frame.x&&mx<=frame.x+frame.width&&my>=frame.y&&my<=frame.y+frame.height;
  const vertical=Math.max(0,Math.min(b.y+b.height,frame.y+frame.height)-Math.max(b.y,frame.y));
  return center&&vertical>=b.height*.45&&overlap(b,frame)>=b.width*.65;
}
function fragmentBody(o,byId,formulaBoxes){
  if(o.type!=="body"||o.sourceLineIds.length<2)return o;
  const lines=o.sourceLineIds.map(id=>byId.get(id)).sort(order),groups=[[lines[0]]];
  for(const line of lines.slice(1)){
    const group=groups.at(-1),prev=group.at(-1),gap=top(line)-prev.bbox.y;
    const crossedFormula=formulaBoxes.some(b=>{
      const middle=b.y+b.height/2;
      return middle>prev.bbox.y-2&&middle<top(line)+2&&
        overlap(b,{x:Math.min(prev.bbox.x,line.bbox.x),width:Math.max(prev.bbox.x+prev.bbox.width,line.bbox.x+line.bbox.width)-Math.min(prev.bbox.x,line.bbox.x)})>0;
    });
    if(line.column!==prev.column||crossedFormula&&gap>2||gap>Math.max(16,prev.bbox.height*1.8))groups.push([line]);
    else group.push(line);
  }
  if(groups.length===1)return o;
  return {...o,spatialFragments:groups.map(ls=>({bbox:extent(ls),sourceLineIds:ls.map(l=>l.sourceLineId)})),
    evidence:[...(o.evidence||[]),"body_visual_fragments_respect_formula_breaks"]};
}
function attachEdgeMathFragments(out,byId,key,operations){
  const math=/[α-ωΑ-Ω∑∫√∂∈⊂⊆∞≈≃≤≥_^]/u;
  const boxGap=(a,b)=>Math.max(0,a.y-(b.y+b.height),b.y-(a.y+a.height));
  for(const body of [...out.objects]){
    if(body.type!=="body"||body.sourceLineIds.length<2)continue;
    const ls=body.sourceLineIds.map(id=>byId.get(id)).sort(order);
    for(const [edge,neighbor] of [[ls[0],ls[1]],[ls.at(-1),ls.at(-2)]]){
      if(!body.sourceLineIds.includes(edge.sourceLineId))continue;
      const s=tidy(edge.text);
      if(!s||s.length>4||/^(?:and|or|by|we|of|to|in|is)$/i.test(s)||!(/^[A-Za-z]$/.test(s)||math.test(s)))continue;
      const outdent=Math.abs(edge.bbox.x-neighbor.bbox.x);
      if(outdent<(/^[A-Za-z]$/.test(s)?120:60))continue;
      const a={x:edge.bbox.x,y:top(edge),width:edge.bbox.width,height:edge.bbox.height};
      const matches=out.objects.filter(o=>o.type==="formula"&&o.spatialFragments.some(f=>
        overlap(a,f.bbox)>=a.width*.7&&boxGap(a,f.bbox)<=Math.max(20,edge.bbox.height*1.8)));
      if(matches.length!==1)continue;
      const formula=matches[0],rest=body.sourceLineIds.filter(id=>id!==edge.sourceLineId);
      out.objects.splice(out.objects.indexOf(body),1,rebuild(body,rest,byId,key,"edge_math_fragment_removed_from_prose"));
      out.objects.splice(out.objects.indexOf(formula),1,rebuild(formula,[...formula.sourceLineIds,edge.sourceLineId],byId,key,"edge_math_fragment_attached_to_display"));
      operations.push({kind:"edge_math_fragment_attached",sourceLineId:edge.sourceLineId});
      break;
    }
  }
}
function reconstructPage(key,page,source,region,spans,glyphById=new Map()){
  const out=structuredClone(page),inventory=structuredClone(source),operations=[];
  const byId=new Map(inventory.sourceLines.map(l=>[l.sourceLineId,l]));
  const applied=[];
  // Replace one frozen parent with two non-overlapping virtual source units.
  // Parent IDs remain in provenance, but can no longer be owned directly.
  for(const span of spans){
    const parent=byId.get(span.parentSourceLineId);
    if(!parent||!out.objects.some(o=>o.type==="formula"&&o.sourceLineIds.includes(parent.sourceLineId)))continue;
    const formulaId=`${parent.sourceLineId}:span:formula`,numberId=`${parent.sourceLineId}:span:equation_number`;
    const formula={...parent,sourceLineId:formulaId,text:span.formulaText,bbox:baseline(span.formulaBox),
      parentSourceLineId:parent.sourceLineId,textSpan:span.formulaTextSpan,sourceSpanKind:"formula"};
    const number={...parent,sourceLineId:numberId,text:span.labelText,bbox:baseline(span.labelBox),
      parentSourceLineId:parent.sourceLineId,textSpan:span.labelTextSpan,sourceSpanKind:"equation_number"};
    const index=inventory.sourceLines.findIndex(l=>l.sourceLineId===parent.sourceLineId);
    inventory.sourceLines.splice(index,1,...[formula,number].sort((a,b)=>a.textSpan[0]-b.textSpan[0]));
    byId.delete(parent.sourceLineId);byId.set(formulaId,formula);byId.set(numberId,number);
    const owner=out.objects.find(o=>o.type==="formula"&&o.sourceLineIds.includes(parent.sourceLineId));
    owner.sourceLineIds=owner.sourceLineIds.map(id=>id===parent.sourceLineId?formulaId:id);
    const rebuilt=rebuild(owner,owner.sourceLineIds,byId,key,"pdf_character_equation_label_span_split");
    out.objects.splice(out.objects.indexOf(owner),1,rebuilt);
    out.objects.push(make("equation_number",[numberId],byId,key,"pdf_character_equation_label_span"));
    applied.push({parentSourceLineId:parent.sourceLineId,formulaSourceLineId:formulaId,numberSourceLineId:numberId,
      formulaTextSpan:span.formulaTextSpan,labelTextSpan:span.labelTextSpan});
    operations.push({kind:"mixed_source_line_label_split",parentSourceLineId:parent.sourceLineId});
  }
  const pending=new Map(out.pendingMembership.map(x=>[x.sourceLineId,x]));
  const excluded=new Set(out.excludedSourceLines.map(x=>x.sourceLineId));
  // A caption-adjacent Figure proposal is an opaque container. Its internal
  // text is member evidence, not independent body/formula Objects. Geometry
  // remains a proposal and never becomes accepted truth by this pass.
  for(const proposal of region?.figures||[]){
    if(!proposal.frame||!imageCaptionNear(proposal.frame,out.objects))continue;
    const members=inventory.sourceLines.filter(l=>l.coverageClass==="reviewable_content"&&!excluded.has(l.sourceLineId)&&insideFigure(l,proposal.frame)&&
      !out.objects.some(o=>["caption","reference","table"].includes(o.type)&&o.sourceLineIds.includes(l.sourceLineId)));
    const ids=members.map(l=>l.sourceLineId);
    if(ids.some(id=>out.objects.some(o=>o.type==="figure"&&o.sourceLineIds.includes(id))))continue;
    const caught=new Set(ids);
    out.objects=out.objects.flatMap(o=>{
      const rest=o.sourceLineIds.filter(id=>!caught.has(id));
      if(rest.length===o.sourceLineIds.length)return [o];
      if(!rest.length)return [];
      return [rebuild(o,rest,byId,key,"opaque_figure_membership_removed")];
    });
    for(const id of ids)pending.delete(id);
    const figure=make("figure",ids,byId,key,"caption_adjacent_opaque_figure_container",proposal.frame);
    figure.internalSourceText=figure.sourceText;figure.sourceText="";
    figure.internalTextOpaque=true;figure.geometryProposalId=proposal.proposalId;
    out.objects.push(figure);
    operations.push({kind:"opaque_figure_created",proposalId:proposal.proposalId,sourceLineIds:ids});
  }
  out.pendingMembership=[...pending.values()];
  attachEdgeMathFragments(out,byId,key,operations);
  let glyphCorrected=0;
  out.objects=out.objects.map(o=>{
    if(o.type!=="formula")return o;
    const fragments=o.spatialFragments.map(fragment=>{
      const boxes=fragment.sourceLineIds.map(id=>glyphById.get(id)||{
        x:byId.get(id).bbox.x,y:top(byId.get(id)),width:byId.get(id).bbox.width,height:byId.get(id).bbox.height});
      glyphCorrected+=fragment.sourceLineIds.filter(id=>glyphById.has(id)).length;
      return {...fragment,bbox:boxUnion(boxes)};
    });
    return {...o,spatialFragments:fragments,evidence:[...(o.evidence||[]),"pdf_character_formula_visual_extent"]};
  });
  if(glyphCorrected)operations.push({kind:"formula_glyph_boxes_applied",count:glyphCorrected});
  const formulaBoxes=out.objects.filter(o=>o.type==="formula").flatMap(o=>o.spatialFragments.map(f=>f.bbox));
  out.objects=out.objects.map(o=>fragmentBody(o,byId,formulaBoxes));
  const owned=new Set();for(const o of [...out.objects,...(out.referenceObjectRefs||[])])for(const id of o.sourceLineIds){
    if(!byId.has(id))throw Error(`unknown member ${key}:${id}`);
    if(owned.has(id))throw Error(`duplicate ${key}:${id}`);owned.add(id);
  }
  for(const l of inventory.sourceLines){const id=l.sourceLineId;
    if(Number(owned.has(id))+Number(pending.has(id))+Number(excluded.has(id))!==1)throw Error(`source ownership ${key}:${id}`);
  }
  const byType={};for(const o of [...out.objects,...(out.referenceObjectRefs||[])])byType[o.type]=(byType[o.type]||0)+1;
  out.summary={...out.summary,objects:out.objects.length+(out.referenceObjectRefs||[]).length,byType,
    assigned:owned.size,pending:pending.size,excluded:excluded.size,duplicateOwnership:0,lostSourceLines:0};
  out.sourceLineCount=inventory.sourceLines.length;
  out.reviewableLineCount=inventory.sourceLines.filter(l=>l.coverageClass==="reviewable_content"&&!excluded.has(l.sourceLineId)).length;
  out.stage44Operations=operations;out.sourceSpanLineage=applied;
  return {page:out,source:inventory};
}
function build(inputs){
  const input=inputs?.input;
  const frozen=inputs?.frozen;
  const regions=inputs?.regions;
  const spanEvidence=inputs?.spanEvidence;
  const glyphEvidence=inputs?.glyphEvidence;
  const glyphById=new Map(glyphEvidence.matched.map(x=>[x.sourceLineId,x.visualBox]));
  const spanMap=new Map();for(const span of spanEvidence.matched){const v=spanMap.get(span.page)||[];v.push(span);spanMap.set(span.page,v)}
  const pages={},sourcePages={},counts={};
  for(const [key,page] of Object.entries(input.pages)){
    const result=reconstructPage(key,page,frozen.pages[key],regions.pages[key],spanMap.get(key)||[],glyphById);
    pages[key]=result.page;sourcePages[key]=result.source;
    for(const op of result.page.stage44Operations)counts[op.kind]=(counts[op.kind]||0)+(op.count||1);
  }
  const summary={...input.summary,originalFrozenSourceLines:input.summary.sourceLines,sourceLines:0,reviewable:0,
    assigned:0,pending:0,excluded:0,pageLocalObjects:0,byType:{},stage44Operations:counts};
  for(const p of Object.values(pages)){
    summary.sourceLines+=p.sourceLineCount;summary.reviewable+=p.reviewableLineCount;
    summary.assigned+=p.summary.assigned;summary.pending+=p.summary.pending;summary.excluded+=p.summary.excluded;
    summary.pageLocalObjects+=p.objects.length;
    for(const [type,n] of Object.entries(p.summary.byType))summary.byType[type]=(summary.byType[type]||0)+n;
  }
  if(summary.assigned+summary.pending+summary.excluded!==summary.sourceLines)throw Error("global source-unit loss");
  return {candidate:{...input,schemaVersion:"OfflineStructuralObjectCandidate/vNext-opaque-figure-and-source-spans",
      status:"machine_diagnostic_not_review_ready",summary,pages,stage44:{authority:"none",runtimeModified:false,sourceSpanEvidence:spanEvidence.schemaVersion}},
    sourceInventory:{...frozen,schemaVersion:"OfflineStructureDerivedSourceSpanInventory/v1",authority:"none",status:"producer_input_not_structure_truth",
      parentSchemaVersion:frozen.schemaVersion,pages:sourcePages,summary:{...frozen.summary,originalFrozenSourceLines:input.summary.sourceLines,derivedSourceUnits:summary.sourceLines}}};
}
module.exports={build,reconstructPage,insideFigure,fragmentBody};
