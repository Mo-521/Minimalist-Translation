#!/usr/bin/env node
"use strict";
// Generic, offline-only semantic-boundary reconstruction. Human frames are
// regression evidence only and are never read by this producer.
const crypto=require("node:crypto");
const tidy=s=>String(s||"").replace(/\s+/g," ").trim();
const top=l=>l.bbox.y-l.bbox.height;
const median=a=>{const x=a.filter(Number.isFinite).sort((p,q)=>p-q);return x[Math.floor(x.length/2)]||10};
const extent=ls=>{const x=Math.min(...ls.map(l=>l.bbox.x)),y=Math.min(...ls.map(top));return {x,y,width:Math.max(...ls.map(l=>l.bbox.x+l.bbox.width))-x,height:Math.max(...ls.map(l=>l.bbox.y))-y}};
const sha=x=>crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0,24);
const label=s=>/^\(\d{1,3}(?:\.\d+)?[a-z]?\)$/.test(tidy(s));
const mathMarks=s=>(tidy(s).match(/[=≈≃≤≥⩽⩾∑∫√^_{}⟨⟩⊙∈∉⊂⊆∪∩∞α-ωΑ-Ωλ−±∂∥]/gu)||[]).length;
const proseWords=s=>(tidy(s).match(/\b[A-Za-z]{2,}\b/g)||[]).length;
const lexicalMath=s=>mathMarks(s)>=2&&proseWords(s)<=3;
const shortProse=s=>/^[a-z][a-z\s,;:.'’-]{0,28}$/i.test(tidy(s))&&proseWords(s)>=1&&proseWords(s)<=3&&!mathMarks(s)&&!label(s);
const discourseConnector=s=>/^(?:and|or|but|where|then|thus|hence|therefore|moreover|however|accordingly|consequently|likewise|similarly)(?:\s+(?:so|equivalently))?[,:;.]?$/i.test(tidy(s));
const terminal=s=>/[.!?。！？][\s"'”’)]*$/.test(tidy(s));
const order=(a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x;
const sourceLines=o=>o.sourceLineIds||[];
function rebuild(o,ids,byId,tag){
  const ls=ids.map(id=>byId.get(id)).filter(Boolean).sort(order);
  if(ls.length!==ids.length||!ls.length)throw Error(`invalid rebuild ${o.objectId}`);
  return {...o,objectId:`stage42:${sha([o.objectId,o.type,ls.map(l=>l.sourceLineId),tag])}`,
    sourceLineIds:ls.map(l=>l.sourceLineId),sourceText:ls.map(l=>tidy(l.text)).join("\n"),memberCount:ls.length,
    memberLineBoxes:ls.map(l=>({sourceLineId:l.sourceLineId,bbox:l.bbox})),
    spatialFragments:[{bbox:extent(ls),sourceLineIds:ls.map(l=>l.sourceLineId)}],
    evidence:[...(o.evidence||[]),tag],authority:"none",status:"offline_candidate_not_truth"};
}
function make(type,ids,byId,tag,key){return rebuild({objectId:`stage42:${key}:${type}`,type},ids,byId,tag)}
function neighbors(line,source){
  const lane=source.filter(l=>l.column===line.column).sort(order),i=lane.findIndex(l=>l.sourceLineId===line.sourceLineId);
  return {prev:lane[i-1],next:lane[i+1]};
}
function likelyHeading(line,page,source){
  const text=tidy(line.text);
  if(!text||text.length>82||/[.!?。！？:]$/.test(text)||mathMarks(text)>0||/^(?:fig(?:ure)?|table)\s*\d/i.test(text))return false;
  // A visually short line that trails into the next line is not a heading.
  if(/(?:,|\b(?:which|have|our|of|the|a|an|in|with|to|and|for|from|that|is|are|was|were))$/i.test(text))return false;
  if(/^[a-z]/.test(text)&&!/^\d/.test(text))return false;
  const words=proseWords(text);if(words<1||words>8)return false;
  // Plain numeric prefixes are also footnote markers. A section-number shape
  // needs its own separator; typography alone is not enough to promote it.
  if(/^\d+\s/.test(text))return false;
  if(top(line)>page.pageSize.height*.84)return false;
  const normal=median(source.filter(l=>l.column===line.column&&proseWords(l.text)>=5).map(l=>l.bbox.height));
  const {prev,next}=neighbors(line,source);
  const above=prev?top(line)-prev.bbox.y:Infinity;
  const below=next?top(next)-line.bbox.y:Infinity;
  const size=line.bbox.height>=normal*1.08;
  const separated=above>=Math.max(3,normal*.35)||below>=Math.max(3,normal*.35);
  const narrow=line.bbox.width<=page.pageSize.width*.66;
  const numbered=/^(?:\d+\.(?:\d+\.)*|[A-Z]\.\d+(?:\.\d+)*)(?:\s|[.:])/.test(text);
  const named=/^[A-Z][A-Za-z–—\-\s,]+$/.test(text)&&words<=8;
  return narrow&&separated&&(size&&(named||numbered)||numbered&&above>=normal*.5&&below>=normal*.3);
}
function nearMath(line,formula,byId,page){
  const b=formula.spatialFragments?.[0]?.bbox;if(!b)return false;
  const midY=top(line)+line.bbox.height/2;
  const overlapX=Math.max(0,Math.min(line.bbox.x+line.bbox.width,b.x+b.width)-Math.max(line.bbox.x,b.x));
  const closeY=midY>=b.y-Math.max(8,line.bbox.height)&&midY<=b.y+b.height+Math.max(8,line.bbox.height);
  const sameLane=formula.sourceLineIds.some(id=>byId.get(id)?.column===line.column);
  const insideBand=line.bbox.x>=b.x-page.pageSize.width*.16&&line.bbox.x<=b.x+b.width+page.pageSize.width*.16;
  return sameLane&&closeY&&insideBand&&(overlapX>0||line.bbox.width<=page.pageSize.width*.13);
}
function reconstructPage(key,page,source){
  const byId=new Map(source.sourceLines.map(l=>[l.sourceLineId,l]));
  const out=structuredClone(page),ops=[];
  const pending=new Map(out.pendingMembership.map(x=>[x.sourceLineId,x]));
  // A heading can be a first line swallowed by a paragraph. Require an
  // independent typography/spacing/shape conjunction, never a keyword alone.
  for(let i=0;i<out.objects.length;i++){
    const o=out.objects[i];if(o.type!=="body"||o.sourceLineIds.length<2)continue;
    const first=byId.get(o.sourceLineIds[0]);if(!first||!likelyHeading(first,source,source.sourceLines))continue;
    if(Number(key.split(":")[1])===1)continue;
    const rest=o.sourceLineIds.slice(1),h=make("heading",[first.sourceLineId],byId,"typographic_semantic_heading_boundary",key);
    out.objects.splice(i,1,h,rebuild(o,rest,byId,"body_after_heading_boundary"));
    ops.push({kind:"heading_split_from_body",sourceObjectId:o.objectId,sourceLineIds:[first.sourceLineId]});i++;
  }
  // Standalone candidate headings left pending are emitted only with the same
  // multi-signal test; no fixed section-word whitelist.
  for(const [id] of [...pending]){
    const l=byId.get(id);if(!l||!likelyHeading(l,source,source.sourceLines))continue;
    // A first-page standalone line is more likely title/author/front matter;
    // those roles require a separate document-level check.
    if(Number(key.split(":")[1])===1&&!/^references$/i.test(tidy(l.text)))continue;
    out.objects.push(make("heading",[id],byId,"typographic_semantic_heading_boundary",key));
    pending.delete(id);ops.push({kind:"heading_from_pending",sourceLineIds:[id]});
  }
  // Caption continuations are attached only when immediately following the
  // label, same lane and typography, and clearly not a fresh body paragraph.
  for(let i=0;i<out.objects.length;i++){
    const cap=out.objects[i];if(cap.type!=="caption")continue;
    const last=byId.get(cap.sourceLineIds.at(-1));if(!last)continue;
    let target=null,first=null;
    for(const candidate of out.objects){if(candidate.type!=="body")continue;
      const start=byId.get(candidate.sourceLineIds[0]);if(!start||start.column!==last.column)continue;
      const gap=top(start)-last.bbox.y;
      if(gap<-.5||gap>Math.max(5,last.bbox.height*.85)||terminal(last.text)&&/^[A-Z]/.test(tidy(start.text)))continue;
      if(start.bbox.height<last.bbox.height*.86||start.bbox.height>last.bbox.height*1.16)continue;
      if(!target||gap<top(first)-last.bbox.y){target=candidate;first=start}
    }
    if(!target)continue;
    // A continuation may occupy a paragraph candidate. Stop at a strong
    // within-block gap/indent rather than swallowing all downstream prose.
    const take=[target.sourceLineIds[0]];
    for(const id of target.sourceLineIds.slice(1)){
      const prev=byId.get(take.at(-1)),l=byId.get(id);if(l.column!==prev.column)break;
      const gap=top(l)-prev.bbox.y;
      if(gap>Math.max(5,prev.bbox.height*.85)||terminal(prev.text)&&l.bbox.x-prev.bbox.x>Math.max(8,prev.bbox.height*.8))break;
      take.push(id);
    }
    if(take.length>12)continue;
    out.objects[i]=rebuild(cap,[...cap.sourceLineIds,...take],byId,"caption_immediate_typographic_continuation");
    const remaining=target.sourceLineIds.filter(id=>!take.includes(id));
    const index=out.objects.indexOf(target);
    if(remaining.length)out.objects[index]=rebuild(target,remaining,byId,"body_after_caption_continuation");
    else out.objects.splice(index,1);
    ops.push({kind:"caption_continuation",sourceObjectId:cap.objectId,sourceLineIds:take});
  }
  // A short prose connector is a member/evidence, never a math symbol. Join
  // the nearest preceding paragraph only with same-lane reading-flow evidence;
  // if it sits between displays without a paragraph, retain a small prose
  // bridge Object so the visible word is not lost.
  for(const [id] of [...pending]){
    const l=byId.get(id);if(!l||!shortProse(l.text))continue;
    const prior=out.objects.filter(o=>o.type==="body").map(o=>({o,last:byId.get(o.sourceLineIds.at(-1))}))
      .filter(x=>x.last&&x.last.column===l.column&&x.last.bbox.y<=l.bbox.y)
      .sort((a,b)=>b.last.bbox.y-a.last.bbox.y)[0];
    const gap=prior?top(l)-prior.last.bbox.y:Infinity;
    if(prior&&gap>=-1&&gap<=Math.max(5,l.bbox.height*.85)&&Math.abs(l.bbox.x-prior.last.bbox.x)<source.pageSize.width*.16){
      const index=out.objects.indexOf(prior.o);
      out.objects[index]=rebuild(prior.o,[...prior.o.sourceLineIds,id],byId,"short_prose_continuation_member");
      pending.delete(id);ops.push({kind:"short_prose_attached",sourceLineIds:[id]});continue;
    }
    const nearbyFormula=out.objects.some(o=>o.type==="formula"&&nearMath(l,o,byId,source));
    if(nearbyFormula){out.objects.push(make("body",[id],byId,"isolated_prose_bridge_between_displays",key));
      pending.delete(id);ops.push({kind:"prose_bridge_preserved",sourceLineIds:[id]});}
    else if(discourseConnector(l.text)&&top(l)>source.pageSize.height*.06&&l.bbox.y<source.pageSize.height*.92){
      // This remains a prose Object, even when a formula is elsewhere on the
      // page. It is never inferred to be a formula member by lexical proximity.
      out.objects.push(make("body",[id],byId,"isolated_discourse_connector",key));
      pending.delete(id);ops.push({kind:"discourse_connector_preserved",sourceLineIds:[id]});
    }
  }
  // Equation labels are kept distinct when their frozen line is independent.
  // Broader formula membership/recall is deliberately not changed here:
  // source-only symbol density promoted prose and isolated glyphs in audit.
  const formulas=()=>out.objects.filter(o=>o.type==="formula");
  for(const [id] of [...pending]){
    const l=byId.get(id);if(!l)continue;
    if(label(l.text)){
      const near=formulas().some(o=>nearMath(l,o,byId,source));
      if(near){out.objects.push(make("equation_number",[id],byId,"isolated_equation_label_near_display",key));
        pending.delete(id);ops.push({kind:"equation_label_separated",sourceLineIds:[id]});}
    }
  }
  out.pendingMembership=[...pending.values()];
  const seen=new Set();for(const o of [...out.objects,...(out.referenceObjectRefs||[])])for(const id of o.sourceLineIds){
    if(seen.has(id))throw Error(`duplicate owner ${key}:${id}`);seen.add(id)}
  for(const id of pending.keys())if(seen.has(id))throw Error(`owned pending ${key}:${id}`);
  if(seen.size+pending.size+out.excludedSourceLines.length!==source.sourceLines.length)
    throw Error(`source line loss ${key}`);
  const byType={};for(const o of [...out.objects,...(out.referenceObjectRefs||[])])byType[o.type]=(byType[o.type]||0)+1;
  out.summary={...out.summary,objects:out.objects.length+(out.referenceObjectRefs||[]).length,byType,
    assigned:seen.size,pending:pending.size,excluded:out.excludedSourceLines.length,duplicateOwnership:0,lostSourceLines:0};
  out.stage42Operations=ops;return out;
}
function build(inputs){
  const input=inputs?.input;
  const frozen=inputs?.frozen;
  const pages={},counts={};
  for(const [key,page] of Object.entries(input.pages)){
    pages[key]=reconstructPage(key,page,frozen.pages[key]);
    for(const op of pages[key].stage42Operations)counts[op.kind]=(counts[op.kind]||0)+1;
  }
  const summary={...input.summary,assigned:0,pending:0,excluded:0,pageLocalObjects:0,byType:{},stage42Operations:counts};
  for(const page of Object.values(pages)){
    summary.assigned+=page.summary.assigned;summary.pending+=page.summary.pending;summary.excluded+=page.summary.excluded;
    summary.pageLocalObjects+=page.objects.length;
    for(const [type,n] of Object.entries(page.summary.byType))summary.byType[type]=(summary.byType[type]||0)+n;
  }
  if(summary.assigned+summary.pending+summary.excluded!==summary.sourceLines)throw Error("global line conservation");
  return {...input,schemaVersion:"OfflineStructuralObjectCandidate/vNext-semantic-reconstruction",summary,pages,
    status:"machine_diagnostic_not_review_ready",stage42:{authority:"none",sourceOnlyRules:true,humanDraftIsProducerInput:false}};
}
module.exports={build,reconstructPage,likelyHeading,shortProse,lexicalMath};
