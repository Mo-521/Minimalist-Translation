"use strict";

// Offline-only, input-driven terminal prose/display repair. No Task paths,
// runtime authority, human rectangles as truth, or filesystem writes.
function validatePage(key, page, source) {
  const ids = source.sourceLines.map(l => l.sourceLineId), count = new Map(ids.map(id => [id, 0]));
  for (const object of [...page.objects, ...(page.referenceObjectRefs || [])])
    for (const id of object.sourceLineIds) {
      if (!count.has(id)) throw Error(`${key}: unknown Object member ${id}`);
      count.set(id, count.get(id) + 1);
    }
  for (const entry of [...page.pendingMembership, ...page.excludedSourceLines]) {
    if (!count.has(entry.sourceLineId)) throw Error(`${key}: unknown residual ${entry.sourceLineId}`);
    count.set(entry.sourceLineId, count.get(entry.sourceLineId) + 1);
  }
  if ([...count.values()].some(n => n !== 1)) throw Error(`${key}: source ownership failure`);
}
const bottom = b => b.y + b.height;
const union = boxes => ({x: Math.min(...boxes.map(b => b.x)), y: Math.min(...boxes.map(b => b.y)),
  width: Math.max(...boxes.map(b => b.x + b.width)) - Math.min(...boxes.map(b => b.x)),
  height: Math.max(...boxes.map(bottom)) - Math.min(...boxes.map(b => b.y))});
const visual = o => o.spatialFragments[0].bbox;
const lineTop = l => l.bbox.y - l.bbox.height;
const lineBox = l => ({x:l.bbox.x,y:lineTop(l),width:l.bbox.width,height:l.bbox.height});
const chars = (e,id) => e?.lines?.[id]?.chars || [];
function refresh(o, lines, bbox) {
  o.sourceLineIds.sort((a,b) => lines.get(a).bbox.y-lines.get(b).bbox.y ||
    lines.get(a).bbox.x-lines.get(b).bbox.x);
  o.sourceText=o.sourceLineIds.map(id=>lines.get(id).text.trim()).join("\n");
  o.memberCount=o.sourceLineIds.length;
  o.memberLineBoxes=o.sourceLineIds.map(id=>({sourceLineId:id,bbox:lines.get(id).bbox}));
  o.spatialFragments=[{bbox,sourceLineIds:[...o.sourceLineIds]}];
}
function followingDisplay(page, body, last, maxDistance) {
  const options=page.objects.filter(o=>o.type==="formula").filter(o=>{
    const b=visual(o);return b.y>last.bbox.y && b.y-last.bbox.y<maxDistance &&
      b.x>visual(body).x+50 && b.x+b.width<visual(body).x+visual(body).width+15;
  }).sort((a,b)=>visual(a).y-visual(b).y);
  return options[0] || null;
}
function pendingProseTail(page, lines, e) {
  const operations=[];
  for(const body of page.objects.filter(o=>o.type==="body"&&o.sourceLineIds.length>=2)) {
    const last=lines.get(body.sourceLineIds.at(-1));if(!last)continue;
    const display=followingDisplay(page,body,last,46);if(!display)continue;
    const pending=page.pendingMembership.map(p=>lines.get(p.sourceLineId)).filter(Boolean)
      .filter(l=>l.column===last.column&&l.bbox.y>last.bbox.y&&
        l.bbox.y<visual(display).y+2&&Math.abs(l.bbox.x-last.bbox.x)<18)
      .sort((a,b)=>a.bbox.y-b.bbox.y);
    if(!pending.length||pending[0].bbox.y-last.bbox.y<7||pending[0].bbox.y-last.bbox.y>20||
      visual(display).y-pending.at(-1).bbox.y<3||visual(display).y-pending.at(-1).bbox.y>24||
      !pending.some(l=>/[A-Za-z]{4,}\s*[.,;:]?\s*$/u.test(l.text)))continue;
    // A prose-font terminal word and left-margin alignment must both be present.
    const textLine=pending.find(l=>/[A-Za-z]{4,}\s*[.,;:]?\s*$/u.test(l.text));
    if(!chars(e,textLine.sourceLineId).some(c=>/SFRM|CMR|Times|Nimbus/u.test(c.font)&&
      /[A-Za-z]/u.test(c.text)))continue;
    if(page.objects.some(o=>o!==body&&o!==display&&o.spatialFragments.some(f=>
      f.bbox.y<visual(display).y&&bottom(f.bbox)>lineTop(pending[0])&&
      f.bbox.x<last.bbox.x+120&&bottom(f.bbox)>visual(body).y)))continue;
    const ids=pending.map(l=>l.sourceLineId);
    body.sourceLineIds.push(...ids);
    const ownedInk=pending.flatMap(l=>chars(e,l.sourceLineId).filter(c=>
      c.box.y>=lineTop(l)-1&&c.box.y<=l.bbox.y+1&&
      c.box.x>=l.bbox.x-2&&c.box.x<=l.bbox.x+l.bbox.width+2).map(c=>c.box));
    const attachedBox=union([...pending.map(lineBox),...ownedInk]);
    refresh(body,lines,union([visual(body),{...attachedBox,height:attachedBox.height+1}]));
    page.pendingMembership=page.pendingMembership.filter(p=>!ids.includes(p.sourceLineId));
    operations.push({kind:"terminal_prose_math_members_attached",bodyId:body.objectId,
      followingFormulaId:display.objectId,sourceLineIds:ids,
      evidence:["left_aligned_same_column","terminal_prose_word","adjacent_display_stays_separate"]});
  }
  return operations;
}
function mixedSourceBeforeDisplay(page, inventory, e) {
  const operations=[];
  const lines=new Map(inventory.sourceLines.map(l=>[l.sourceLineId,l]));
  for(const formula of page.objects.filter(o=>o.type==="formula"&&o.sourceLineIds.length>=3)) {
    const first=lines.get(formula.sourceLineIds[0]);if(!first||first.sourceSpanKind)continue;
    const next=lines.get(formula.sourceLineIds[1]);if(!next||next.bbox.x-first.bbox.x<100||
      next.bbox.y-first.bbox.y<7||next.bbox.y-first.bbox.y>24)continue;
    const bodies=page.objects.filter(o=>o.type==="body"&&o.sourceLineIds.length>=2).filter(o=>{
      const last=lines.get(o.sourceLineIds.at(-1));return last&&last.column===first.column&&
        first.bbox.y-last.bbox.y>=8&&first.bbox.y-last.bbox.y<=18&&
        Math.abs(first.bbox.x-last.bbox.x)<8&&!/[.!?]\s*$/u.test(last.text);
    });if(bodies.length!==1)continue;
    const body=bodies[0],row=chars(e,first.sourceLineId).filter(c=>
      c.box.y>=first.bbox.y-first.bbox.height*.72&&c.box.y<=first.bbox.y+1&&
      c.box.x<first.bbox.x+65).sort((a,b)=>a.box.x-b.box.x);
    const printed=row.map(c=>c.text).join("");
    if(row.length<3||!first.text.startsWith(printed)||!/[,:;]$/u.test(printed)||
      !row.some(c=>/SFRM|CMR|Times|Nimbus/u.test(c.font)))continue;
    const cut=printed.length,proseBox=union(row.map(c=>c.box));
    const remainder=formula.sourceLineIds.slice(1).map(id=>lines.get(id));
    const ink=remainder.flatMap(l=>chars(e,l.sourceLineId).map(c=>c.box));
    if(ink.length<5)continue;
    const ib=union(ink),rb=union(remainder.map(lineBox));
    const displayX=Math.min(ib.x,rb.x+2);
    const displayBox={x:displayX,y:ib.y-.5,
      width:Math.max(ib.x+ib.width,rb.x+rb.width)-displayX,
      height:bottom(ib)-ib.y+1};
    const prefix={...first,sourceLineId:`${first.sourceLineId}:stage82:prose_tail`,
      text:first.text.slice(0,cut),bbox:{...proseBox,y:bottom(proseBox)},
      sourceSpanKind:"prose_tail",parentSourceLineId:first.sourceLineId,textSpan:{start:0,end:cut}};
    const suffix={...first,sourceLineId:`${first.sourceLineId}:stage82:display_residual`,
      text:first.text.slice(cut),bbox:{x:displayBox.x,y:next.bbox.y-.01,
        width:displayBox.width,height:Math.max(1,next.bbox.y-.01-displayBox.y)},
      sourceSpanKind:"display_residual",parentSourceLineId:first.sourceLineId,
      textSpan:{start:cut,end:first.text.length}};
    inventory.sourceLines.splice(inventory.sourceLines.indexOf(first),1,prefix,suffix);
    lines.delete(first.sourceLineId);lines.set(prefix.sourceLineId,prefix);lines.set(suffix.sourceLineId,suffix);
    formula.sourceLineIds.splice(0,1,suffix.sourceLineId);
    refresh(formula,lines,displayBox);
    body.sourceLineIds.push(prefix.sourceLineId);
    refresh(body,lines,union([visual(body),proseBox]));
    const lineage={parentSourceLineId:first.sourceLineId,parentText:first.text,
      spans:[prefix,suffix].map(s=>({sourceLineId:s.sourceLineId,text:s.text,textSpan:s.textSpan,bbox:s.bbox}))};
    page.sourceSpanLineage=[...(page.sourceSpanLineage||[]),lineage];
    operations.push({kind:"mixed_terminal_prose_display_source_partitioned",bodyId:body.objectId,
      formulaId:formula.objectId,...lineage,
      evidence:["native_prose_row","following_centered_display","nonterminal_body_continuity"]});
  }
  return operations;
}
function build({prior, frozen, native}) {
  if (!prior?.pages || !frozen?.pages || !native?.pages) throw Error("Terminal prose repair requires candidate, source and native evidence pages");
  const candidate=structuredClone(prior),source=structuredClone(frozen),operations=[];
  for(const [key,page] of Object.entries(candidate.pages)) {
    const inventory=source.pages[key],lines=new Map(inventory.sourceLines.map(l=>[l.sourceLineId,l]));
    const start=operations.length;
    for(const op of pendingProseTail(page,lines,native.pages[key]))operations.push({key,...op});
    for(const op of mixedSourceBeforeDisplay(page,inventory,native.pages[key]))operations.push({key,...op});
    if(operations.length>start){
      const counts={};for(const o of [...page.objects,...(page.referenceObjectRefs||[])])
        counts[o.type]=(counts[o.type]||0)+1;
      page.sourceLineCount=inventory.sourceLines.length;
      page.summary={...page.summary,objects:page.objects.length+(page.referenceObjectRefs||[]).length,
        assigned:[...page.objects,...(page.referenceObjectRefs||[])].reduce((n,o)=>n+o.sourceLineIds.length,0),
        pending:page.pendingMembership.length,byType:counts};
    }
    validatePage(key,page,inventory);
  }
  candidate.summary={...candidate.summary,sourceLines:Object.values(source.pages).reduce((n,p)=>n+p.sourceLines.length,0),
    reviewable:Object.values(source.pages).reduce((n,p)=>n+p.sourceLines.filter(l=>l.coverageClass==="reviewable_content").length,0),
    assigned:Object.values(candidate.pages).reduce((n,p)=>n+
      [...p.objects,...(p.referenceObjectRefs||[])].reduce((m,o)=>m+o.sourceLineIds.length,0),0),
    pending:Object.values(candidate.pages).reduce((n,p)=>n+p.pendingMembership.length,0)};
  if(candidate.summary.assigned+candidate.summary.pending+candidate.summary.excluded!==candidate.summary.sourceLines)
    throw Error("Stage 82 source conservation failure");
  candidate.schemaVersion="OfflineStructuralObjectCandidate/vNext-terminal-prose-display";
  candidate.stage82={authority:"none",status:"offline_candidate_not_truth",operations};
  source.stage82={authority:"none",status:"derived_evidence_not_truth",operations};
  return {candidate,source};
}
module.exports={build,validatePage};
