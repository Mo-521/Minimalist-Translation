#!/usr/bin/env node
"use strict";
// Versioned offline repair. No human rectangles, runtime, Oracle or Geometry edits.
const crypto=require("node:crypto");
const hash=x=>crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0,24);
const clean=s=>String(s||"").replace(/\s+/g," ").trim();
const top=l=>l.bbox.y-l.bbox.height;
const box=l=>({x:l.bbox.x,y:top(l),width:l.bbox.width,height:l.bbox.height});
const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
const union=ls=>{const bs=ls.map(box),x=Math.min(...bs.map(b=>b.x)),y=Math.min(...bs.map(b=>b.y));return {x,y,width:Math.max(...bs.map(b=>b.x+b.width))-x,height:Math.max(...bs.map(b=>b.y+b.height))-y}};
const boxUnion=bs=>{const x=Math.min(...bs.map(b=>b.x)),y=Math.min(...bs.map(b=>b.y));return {x,y,width:Math.max(...bs.map(b=>b.x+b.width))-x,height:Math.max(...bs.map(b=>b.y+b.height))-y}};
const order=(a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x;
function captionReadingOrder(lines){
  const rows=[];for(const line of lines.slice().sort(order)){
    const row=rows.find(r=>Math.abs(r[0].bbox.y-line.bbox.y)<=5);
    if(row)row.push(line);else rows.push([line]);
  }
  return rows.flatMap(row=>row.sort((a,b)=>a.bbox.x-b.bbox.x));
}
const mathMarks=s=>(clean(s).match(/[=≈≃≤≥⩽⩾<>≡∑∫√^_{}⟨⟩⊙∈∉⊂⊆∪∩∨∞α-ωΑ-Ωλ−±∂∥÷×]/gu)||[]).length;
const relation=s=>/[=≈≃≤≥⩽⩾<>≡:][=<>]?/u.test(s);
const proseWords=s=>(clean(s).match(/\b[a-zA-Z]{3,}\b/g)||[]).filter(x=>!/^(?:and|sin|cos|dim|span|max|min|log|exp|lim)$/i.test(x)).length;
const strongProse=s=>/\b(?:the|this|that|these|those|where|which|we|our|their|with|from|into|using|thus|hence|therefore|however|also|let|for|by|of|in|to|is|are|was|were|gives|implies|yields|assume|defined|denotes|shows|consider)\b/i.test(s);
const labelOnly=s=>/^\(\d{1,3}(?:\.\d+)?[a-z]?\)$/.test(clean(s));
function make(type,ids,byId,key,reason,frame,glyphById){
  const found=ids.map(id=>byId.get(id));if(found.some(x=>!x))throw Error(`missing member ${key}:${reason}`);
  const ls=type==="caption"?captionReadingOrder(found):found.sort(order);
  const sorted=ls.map(l=>l.sourceLineId),visual=frame||(type==="formula"?
    boxUnion(ls.map(l=>glyphById.get(l.sourceLineId)||box(l))):union(ls));
  return {objectId:`stage48:${hash([key,type,sorted,reason])}`,type,page:Number(key.split(":")[1]),sourceLineIds:sorted,
    sourceText:ls.map(l=>clean(l.text)).join("\n"),memberCount:ls.length,
    memberLineBoxes:ls.map(l=>({sourceLineId:l.sourceLineId,bbox:l.bbox})),
    spatialFragments:[{bbox:visual,sourceLineIds:sorted}],evidence:[reason],authority:"none",status:"offline_candidate_not_truth"};
}
function remake(old,ids,byId,key,reason,glyphById){
  const fresh=make(old.type,ids,byId,key,reason,null,glyphById);
  return {...old,...fresh,sourceCandidateIds:[...(old.sourceCandidateIds||[]),old.objectId],evidence:[...(old.evidence||[]),reason]};
}
function removeIds(page,ids,byId,key,reason,glyphById){
  const blocked=new Set(ids);page.objects=page.objects.flatMap(o=>{
    const remaining=o.sourceLineIds.filter(id=>!blocked.has(id));
    return remaining.length===o.sourceLineIds.length?[o]:remaining.length?[remake(o,remaining,byId,key,reason,glyphById)]:[];
  });
  page.pendingMembership=page.pendingMembership.filter(x=>!blocked.has(x.sourceLineId));
}
function splitMissedLabelSpans(page,inventory,key,proposals,ops,glyphById){
  const byId=new Map(inventory.sourceLines.map(l=>[l.sourceLineId,l]));
  for(const item of proposals){
    const parent=byId.get(item.parentSourceLineId);if(!parent)continue;
    const formulaId=`${parent.sourceLineId}:stage48:formula`,numberId=`${parent.sourceLineId}:stage48:equation_number`;
    const convert=(id,text,visual,kind,span)=>({...parent,sourceLineId:id,text,
      bbox:{x:visual.x,y:visual.y+visual.height,width:visual.width,height:visual.height},
      parentSourceLineId:parent.sourceLineId,sourceSpanKind:kind,textSpan:span});
    const formula=convert(formulaId,item.formulaText,item.formulaBox,"formula",item.formulaTextSpan);
    const number=convert(numberId,item.labelText,item.labelBox,"equation_number",item.labelTextSpan);
    removeIds(page,[parent.sourceLineId],byId,key,"pdf_character_missed_label_parent_replaced",glyphById);
    const pos=inventory.sourceLines.findIndex(l=>l.sourceLineId===parent.sourceLineId);
    inventory.sourceLines.splice(pos,1,number,formula);
    byId.delete(parent.sourceLineId);byId.set(formulaId,formula);byId.set(numberId,number);
    page.objects.push(make("equation_number",[numberId],byId,key,"pdf_character_missed_label_split",item.labelBox,glyphById));
    page.objects.push(make("formula",[formulaId],byId,key,"pdf_character_missed_display_recall",item.formulaBox,glyphById));
    page.sourceSpanLineage=[...(page.sourceSpanLineage||[]),{parentSourceLineId:parent.sourceLineId,
      formulaSourceLineId:formulaId,numberSourceLineId:numberId,evidence:item.evidence}];
    ops.push({kind:"missed_formula_and_number_recalled",sourceLineIds:[formulaId,numberId]});
  }
}
function recoverMixedReferencePage(page,inventory,key,ops,glyphById){
  const byId=new Map(inventory.sourceLines.map(l=>[l.sourceLineId,l]));
  const refs=(page.referenceObjectRefs||[]).flatMap(o=>o.sourceLineIds.map(id=>byId.get(id))).filter(Boolean);
  for(const lane of [...new Set(inventory.sourceLines.map(l=>l.column))]){
    const firstRef=Math.min(Infinity,...refs.filter(l=>l.column===lane).map(l=>l.bbox.y));
    if(!Number.isFinite(firstRef))continue;
    const prior=page.pendingMembership.filter(p=>p.reason==="reference_region_pending")
      .map(p=>byId.get(p.sourceLineId)).filter(l=>l&&l.column===lane&&l.bbox.y<firstRef-30).sort(order);
    if(prior.length<4)continue;
    const last=prior.at(-1),first=prior[0];
    const doiCount=prior.filter(l=>/\bdoi\s*:|doi\.org|\barxiv\s*:/i.test(l.text)).length;
    const proseCount=prior.filter(l=>proseWords(l.text)>=5).length;
    const bibliographicStart=/^(?:[A-Z][a-z]+,\s+[A-Z]\.|\[\d+\]|\d{4},?\s+doi)/.test(clean(first.text));
    if(doiCount||bibliographicStart||proseCount/prior.length<.6||firstRef-last.bbox.y<45)continue;
    const ids=prior.map(l=>l.sourceLineId);removeIds(page,ids,byId,key,"mixed_body_reference_region_corrected",glyphById);
    page.objects.push(make("body",ids,byId,key,"prose_before_bibliography_not_reference",null,glyphById));
    ops.push({kind:"body_recovered_before_references",sourceLineIds:ids});
  }
}
function mergeFalseListSplits(page,inventory,key,ops,glyphById){
  const byId=new Map(inventory.sourceLines.map(l=>[l.sourceLineId,l]));
  let changed=true;
  while(changed){changed=false;
    const bodies=page.objects.filter(o=>o.type==="body"&&o.sourceLineIds.length).sort((a,b)=>{
      const x=byId.get(a.sourceLineIds[0]),y=byId.get(b.sourceLineIds[0]);return x.column.localeCompare(y.column)||order(x,y);
    });
    for(let i=0;i<bodies.length-1;i++){
      const a=bodies[i],b=bodies[i+1];
      if(!a.evidence?.includes("list_item_start"))continue;
      const last=byId.get(a.sourceLineIds.at(-1)),first=byId.get(b.sourceLineIds[0]);
      if(last.column!==first.column||/^\s*(?:[•●▪]|\[\d+\])/.test(first.text)||
        a.sourceLineIds.length+b.sourceLineIds.length>20)continue;
      const gap=top(first)-last.bbox.y,dx=Math.abs(first.bbox.x-last.bbox.x);
      if(gap>Math.max(7,last.bbox.height*.9)||gap< -3||dx>Math.max(12,last.bbox.height*1.2))continue;
      if(/[.!?。！？:]\s*$/.test(clean(last.text)))continue;
      if(!/^(?:\d+(?:\.\d+)*|[A-Za-z])\s*[.)]\s+/.test(clean(first.text)))continue;
      const merged=remake(a,[...a.sourceLineIds,...b.sourceLineIds],byId,key,"false_list_prefix_paragraph_continuation",glyphById);
      page.objects=page.objects.filter(o=>o!==a&&o!==b);page.objects.push(merged);
      ops.push({kind:"false_list_split_rejoined",beforeObjectIds:[a.objectId,b.objectId],sourceLineIds:merged.sourceLineIds});
      changed=true;break;
    }
  }
}
function extendCaptionAcrossVisualRows(page,inventory,key,region,ops,glyphById){
  const byId=new Map(inventory.sourceLines.map(l=>[l.sourceLineId,l]));
  for(const caption of [...page.objects.filter(o=>o.type==="caption")]){
    const label=caption.sourceLineIds.map(id=>byId.get(id)).find(l=>/^(?:fig(?:ure)?\.?|table)\s*\d+/i.test(clean(l.text)));
    if(!label)continue;
    const figure=(region?.figures||[]).filter(f=>f.frame&&f.frame.y+f.frame.height<label.bbox.y&&
      label.bbox.y-(f.frame.y+f.frame.height)<70&&label.bbox.x<f.frame.x+f.frame.width+55&&label.bbox.x+label.bbox.width>f.frame.x-55)
      .sort((a,b)=>label.bbox.y-(a.frame.y+a.frame.height)-(label.bbox.y-(b.frame.y+b.frame.height)))[0];
    if(!figure)continue;
    const frame=figure.frame,wide=frame.width>inventory.pageSize.width*.62;
    // This repair addresses captions under a full-width figure whose PDF
    // lines carry mixed lane labels. Narrow-column captions retain the
    // previous proposal until a separate continuity contract is validated.
    if(!wide)continue;
    const lower=Math.max(frame.y+frame.height+1,label.bbox.y-5),upper=label.bbox.y+72;
    const candidates=inventory.sourceLines.filter(l=>l.coverageClass==="reviewable_content"&&l.bbox.y>=lower&&l.bbox.y<=upper&&
      (wide?l.bbox.x<frame.x+frame.width+55&&l.bbox.x+l.bbox.width>frame.x-55:
        l.column===label.column||overlap(l.bbox,label.bbox)>0)).sort(order);
    if(!candidates.some(l=>l.sourceLineId===label.sourceLineId))continue;
    const rows=[];for(const line of candidates){
      if(rows.length&&line.bbox.y-rows.at(-1).bbox.y>Math.max(16,label.bbox.height*1.65))break;
      rows.push(line);
    }
    if(rows.length<2)continue;
    const ids=rows.map(l=>l.sourceLineId),added=ids.filter(id=>!caption.sourceLineIds.includes(id));
    if(!added.length)continue;
    if(added.some(id=>page.objects.some(o=>["figure","table","reference","heading","formula"].includes(o.type)&&o.sourceLineIds.includes(id))))continue;
    removeIds(page,added,byId,key,"caption_continuation_detached_from_body",glyphById);
    const old=page.objects.find(o=>o.objectId===caption.objectId);if(!old)continue;
    page.objects.splice(page.objects.indexOf(old),1,remake(old,[...old.sourceLineIds,...added],byId,key,"figure_caption_visual_reading_flow",glyphById));
    ops.push({kind:"caption_continuation_attached",sourceLineIds:added});
  }
}
function detachFormulaProse(page,inventory,key,ops,glyphById){
  const byId=new Map(inventory.sourceLines.map(l=>[l.sourceLineId,l]));
  for(const formula of [...page.objects.filter(o=>o.type==="formula"&&o.sourceLineIds.length>1)]){
    const lines=formula.sourceLineIds.map(id=>byId.get(id)).sort(order);
    for(const line of [lines[0],lines.at(-1)]){
      const s=clean(line.text);
      if(mathMarks(s)>1||relation(s)||proseWords(s)<2||
        !/^(?:Lemma|Theorem|Proposition|Proof|Remark|where|hence|therefore|then|we|let|for|and)\b/i.test(s))continue;
      const mathRest=lines.filter(l=>l.sourceLineId!==line.sourceLineId);
      if(!mathRest.some(l=>mathMarks(l.text)>=2))continue;
      removeIds(page,[line.sourceLineId],byId,key,"prose_lead_in_detached_from_formula",glyphById);
      page.objects.push(make("body",[line.sourceLineId],byId,key,"prose_lead_in_not_math_member",null,glyphById));
      ops.push({kind:"formula_prose_boundary_restored",sourceLineIds:[line.sourceLineId]});
      break;
    }
  }
}
function displayMath(line,inventory,protectedIds){
  const s=clean(line.text);if(!s||protectedIds.has(line.sourceLineId)||labelOnly(s)||s.length>200||!relation(s))return false;
  const marks=mathMarks(s),words=proseWords(s);
  if(marks<2||words>1)return false;
  if(strongProse(s)&&!(marks>=6&&words===0))return false;
  if(/^(?:and|where|if|using|define|put|thus|hence|therefore|so|for|we)\b/i.test(s))return false;
  if(!/[=≈≃≤≥⩽⩾≡]/u.test(s)&&
    !/(?:[\w∨)])\s*[<>]\s*(?:[\w∨(])/u.test(s.replace(/\([^)]*\)/g,"")))return false;
  if(/https?:|\bdoi\b|\barxiv\b|(?:^|\s)Fig(?:ure)?\.?\s*\d/i.test(s))return false;
  const columnWidth=inventory.pageSize.width*(line.column==="single"?.83:.47);
  if(line.bbox.width>columnWidth&&marks<5)return false;
  const lane=inventory.sourceLines.filter(l=>l.column===line.column&&l.coverageClass==="reviewable_content"&&l.sourceLineId!==line.sourceLineId);
  const before=lane.filter(l=>l.bbox.y<line.bbox.y-1).sort((a,b)=>b.bbox.y-a.bbox.y)[0];
  const after=lane.filter(l=>l.bbox.y>line.bbox.y+1).sort(order)[0];
  const isolated=(before&&top(line)-before.bbox.y>Math.max(3,line.bbox.height*.22))||
    (after&&top(after)-line.bbox.y>Math.max(3,line.bbox.height*.22));
  const inset=before&&Math.abs(line.bbox.x-before.bbox.x)>Math.max(14,line.bbox.height*1.3);
  return Boolean(isolated||inset||marks>=5&&words===0);
}
function recallDisplayMath(page,inventory,key,ops,glyphById){
  const byId=new Map(inventory.sourceLines.map(l=>[l.sourceLineId,l]));
  const protectedIds=new Set([...page.objects,...(page.referenceObjectRefs||[])].filter(o=>["figure","table","caption","heading","reference","equation_number"].includes(o.type)).flatMap(o=>o.sourceLineIds));
  const excluded=new Set(page.excludedSourceLines.map(x=>x.sourceLineId));
  for(const line of inventory.sourceLines){
    if(line.coverageClass!=="reviewable_content"||excluded.has(line.sourceLineId)||!displayMath(line,inventory,protectedIds))continue;
    const prior=page.objects.find(o=>o.sourceLineIds.includes(line.sourceLineId));
    if(prior&&prior.type!=="body")continue;
    if(prior&&prior.sourceLineIds.length>1){
      const rest=prior.sourceLineIds.filter(id=>id!==line.sourceLineId);
      // A prose line above or below a tall display equation is not inline
      // prose. Only a genuinely shared text row can veto extraction.
      const near=rest.map(id=>byId.get(id)).filter(l=>
        Math.abs(l.bbox.y-line.bbox.y)<=Math.max(4,Math.min(l.bbox.height,line.bbox.height)*.35));
      if(near.some(l=>proseWords(l.text)>=5&&overlap(l.bbox,line.bbox)>line.bbox.width*.35))continue;
    }
    removeIds(page,[line.sourceLineId],byId,key,"display_math_extracted_from_body",glyphById);
    page.objects.push(make("formula",[line.sourceLineId],byId,key,"isolated_relational_display_math_recalled",null,glyphById));
    ops.push({kind:"display_formula_recalled",sourceLineIds:[line.sourceLineId],from:prior?.type||"pending"});
  }
}
function attachResidualMath(page,inventory,key,ops,glyphById){
  const byId=new Map(inventory.sourceLines.map(l=>[l.sourceLineId,l]));
  const mathFragment=s=>{const value=clean(s);return value.length>0&&value.length<=35&&
    !/^(?:and|where|thus|hence|therefore|we)\b/i.test(value)&&
    (mathMarks(value)>=1||/^\d{1,3}[A-Za-z]?$/.test(value)||/^[!|()\[\]]\s*\d{1,3}$/.test(value))&&proseWords(value)===0&&
    !labelOnly(value)&&!/^\d{1,3}$/.test(value)};
  for(const line of inventory.sourceLines){
    if(line.coverageClass!=="reviewable_content"||!mathFragment(line.text))continue;
    const prior=page.objects.find(o=>o.sourceLineIds.includes(line.sourceLineId));
    if(prior&&prior.type!=="body")continue;
    const b=box(line);
    const possible=page.objects.filter(o=>o.type==="formula").map(o=>({o,q:o.spatialFragments[0].bbox}))
      .filter(x=>overlap(b,x.q)>=b.width*.5&&
        Math.max(0,b.y-(x.q.y+x.q.height),x.q.y-(b.y+b.height))<=14)
      .filter(x=>{
        const memberYs=x.o.sourceLineIds.map(id=>byId.get(id)?.bbox.y).filter(Number.isFinite);
        const nearest=memberYs.reduce((best,y)=>Math.abs(y-line.bbox.y)<Math.abs(best-line.bbox.y)?y:best,memberYs[0]);
        if(!Number.isFinite(nearest))return false;
        return !inventory.sourceLines.some(mid=>mid.sourceLineId!==line.sourceLineId&&
          !x.o.sourceLineIds.includes(mid.sourceLineId)&&mid.column===line.column&&
          mid.bbox.y>Math.min(line.bbox.y,nearest)+2&&mid.bbox.y<Math.max(line.bbox.y,nearest)-2&&
          (proseWords(mid.text)>=2||/^(?:where|and|hence|thus|therefore)$/i.test(clean(mid.text))));
      })
      .sort((a,c)=>Math.abs(b.y+b.height/2-(a.q.y+a.q.height/2))-
        Math.abs(b.y+b.height/2-(c.q.y+c.q.height/2)));
    if(!possible.length)continue;
    const distance=x=>Math.abs(b.y+b.height/2-(x.q.y+x.q.height/2));
    if(possible.length>1&&distance(possible[1])-distance(possible[0])<6)continue;
    const target=possible[0].o;
    removeIds(page,[line.sourceLineId],byId,key,"math_fragment_removed_from_body",glyphById);
    const current=page.objects.find(o=>o.objectId===target.objectId);if(!current)continue;
    page.objects.splice(page.objects.indexOf(current),1,
      remake(current,[...current.sourceLineIds,line.sourceLineId],byId,key,"residual_math_fragment_attached",glyphById));
    ops.push({kind:"residual_math_fragment_attached",sourceLineIds:[line.sourceLineId]});
  }
}
function recallStandaloneNumbers(page,inventory,key,ops,glyphById){
  const byId=new Map(inventory.sourceLines.map(l=>[l.sourceLineId,l]));
  const owned=new Set([...page.objects,...(page.referenceObjectRefs||[])].flatMap(o=>o.sourceLineIds));
  for(const line of inventory.sourceLines){
    if(!labelOnly(line.text)||owned.has(line.sourceLineId)||line.coverageClass!=="reviewable_content")continue;
    const b=box(line),formula=page.objects.filter(o=>o.type==="formula").map(o=>({o,q:o.spatialFragments[0].bbox})).filter(x=>{
      const center=Math.abs((b.y+b.height/2)-(x.q.y+x.q.height/2));
      const horizontal=Math.min(Math.abs((b.x+b.width)-x.q.x),Math.abs(b.x-(x.q.x+x.q.width)));
      return center<=Math.max(20,x.q.height*.8)&&horizontal<inventory.pageSize.width*.37;
    }).sort((a,c)=>Math.abs(b.y+b.height/2-(a.q.y+a.q.height/2))-
      Math.abs(b.y+b.height/2-(c.q.y+c.q.height/2)));
    if(!formula.length)continue;
    removeIds(page,[line.sourceLineId],byId,key,"printed_equation_label_recalled",glyphById);
    page.objects.push(make("equation_number",[line.sourceLineId],byId,key,"standalone_number_near_display",null,glyphById));
    ops.push({kind:"equation_number_recalled",sourceLineIds:[line.sourceLineId]});owned.add(line.sourceLineId);
  }
}
function fragmentBodyVisualExtents(page,inventory){
  const byId=new Map(inventory.sourceLines.map(l=>[l.sourceLineId,l]));
  const formulas=page.objects.filter(o=>o.type==="formula").flatMap(o=>o.spatialFragments.map(f=>f.bbox));
  page.objects=page.objects.map(o=>{
    if(o.type!=="body"||o.sourceLineIds.length<2)return o;
    const lines=o.sourceLineIds.map(id=>byId.get(id)).sort(order),groups=[[lines[0]]];
    for(const line of lines.slice(1)){
      const prev=groups.at(-1).at(-1),gap=top(line)-prev.bbox.y;
      const crossed=formulas.some(f=>{
        const y=f.y+f.height/2;
        return y>prev.bbox.y-2&&y<top(line)+2&&overlap(f,union([prev,line]))>0;
      });
      if(line.column!==prev.column||gap>Math.max(16,prev.bbox.height*1.8)||crossed&&gap>2)groups.push([line]);
      else groups.at(-1).push(line);
    }
    if(groups.length===1)return o;
    return {...o,spatialFragments:groups.map(ls=>({bbox:union(ls),sourceLineIds:ls.map(l=>l.sourceLineId)})),
      evidence:[...(o.evidence||[]),"body_visual_fragments_respect_display_breaks"]};
  });
}
function splitFormulaAcrossProse(page,inventory,key,ops,glyphById){
  const byId=new Map(inventory.sourceLines.map(l=>[l.sourceLineId,l]));
  const bodyLines=page.objects.filter(o=>o.type==="body").flatMap(o=>o.sourceLineIds.map(id=>byId.get(id))).filter(Boolean);
  for(const formula of [...page.objects.filter(o=>o.type==="formula"&&o.sourceLineIds.length>1)]){
    const lines=formula.sourceLineIds.map(id=>byId.get(id)).sort(order),groups=[[lines[0]]];
    for(const line of lines.slice(1)){
      const prior=groups.at(-1).at(-1);
      const between=bodyLines.some(b=>b.column===line.column&&b.bbox.y>prior.bbox.y+2&&
        b.bbox.y<line.bbox.y-2&&proseWords(b.text)>=2&&
        overlap(box(b),boxUnion([box(prior),box(line)]))>0);
      if(between)groups.push([line]);else groups.at(-1).push(line);
    }
    if(groups.length<2)continue;
    page.objects.splice(page.objects.indexOf(formula),1,...groups.map(group=>
      remake(formula,group.map(l=>l.sourceLineId),byId,key,"prose_separated_display_blocks",glyphById)));
    ops.push({kind:"formula_overmerge_split_at_prose",beforeObjectId:formula.objectId,
      afterSourceLineIds:groups.map(g=>g.map(l=>l.sourceLineId))});
  }
}
function validate(page,inventory,key){
  const byId=new Map(inventory.sourceLines.map(l=>[l.sourceLineId,l]));if(byId.size!==inventory.sourceLines.length)throw Error(`duplicate source unit ${key}`);
  const states=new Map(inventory.sourceLines.map(l=>[l.sourceLineId,0]));
  for(const o of [...page.objects,...(page.referenceObjectRefs||[])])for(const id of o.sourceLineIds){if(!states.has(id))throw Error(`missing source ${key}:${id}`);states.set(id,states.get(id)+1)}
  for(const p of page.pendingMembership){if(!states.has(p.sourceLineId))throw Error(`missing pending ${key}`);states.set(p.sourceLineId,states.get(p.sourceLineId)+1)}
  for(const e of page.excludedSourceLines){if(!states.has(e.sourceLineId))throw Error(`missing excluded ${key}`);states.set(e.sourceLineId,states.get(e.sourceLineId)+1)}
  for(const [id,count] of states)if(count!==1)throw Error(`ownership ${key}:${id}=${count}`);
  const types={};for(const o of [...page.objects,...(page.referenceObjectRefs||[])])types[o.type]=(types[o.type]||0)+1;
  page.sourceLineCount=inventory.sourceLines.length;
  page.reviewableLineCount=inventory.sourceLines.filter(l=>l.coverageClass==="reviewable_content").length;
  page.summary={...page.summary,assigned:[...page.objects,...(page.referenceObjectRefs||[])].reduce((n,o)=>n+o.sourceLineIds.length,0),
    pending:page.pendingMembership.length,excluded:page.excludedSourceLines.length,objects:page.objects.length+(page.referenceObjectRefs||[]).length,
    byType:types,duplicateOwnership:0,lostSourceLines:0};
}
function reconstructPage(key,old,source,region,spanItems=[],glyphById=new Map()){
  const page=structuredClone(old),inventory=structuredClone(source),ops=[];
  splitMissedLabelSpans(page,inventory,key,spanItems,ops,glyphById);
  recoverMixedReferencePage(page,inventory,key,ops,glyphById);
  mergeFalseListSplits(page,inventory,key,ops,glyphById);
  extendCaptionAcrossVisualRows(page,inventory,key,region,ops,glyphById);
  detachFormulaProse(page,inventory,key,ops,glyphById);
  recallDisplayMath(page,inventory,key,ops,glyphById);
  attachResidualMath(page,inventory,key,ops,glyphById);
  recallStandaloneNumbers(page,inventory,key,ops,glyphById);
  splitFormulaAcrossProse(page,inventory,key,ops,glyphById);
  fragmentBodyVisualExtents(page,inventory);
  validate(page,inventory,key);page.stage48Operations=ops;
  return {page,source:inventory};
}
function build(inputs){
  const base=inputs?.base;
  const original=inputs?.source;
  const regions=inputs?.regions;
  const glyph=inputs?.glyph;
  const spans=inputs?.spans;
  const glyphById=new Map(glyph.matched.map(x=>[x.sourceLineId,x.visualBox]));
  const spanMap=new Map();for(const x of spans.matched){const a=spanMap.get(x.page)||[];a.push(x);spanMap.set(x.page,a)}
  const pages={},sourcePages={},counts={};
  for(const [key,old] of Object.entries(base.pages)){
    const result=reconstructPage(key,old,original.pages[key],regions.pages[key],spanMap.get(key)||[],glyphById);
    pages[key]=result.page;sourcePages[key]=result.source;
    for(const op of result.page.stage48Operations)counts[op.kind]=(counts[op.kind]||0)+1;
  }
  const summary={...base.summary,sourceLines:0,reviewable:0,assigned:0,pending:0,excluded:0,pageLocalObjects:0,byType:{},stage48Operations:counts};
  for(const page of Object.values(pages)){
    summary.sourceLines+=page.sourceLineCount;summary.reviewable+=page.reviewableLineCount;
    summary.assigned+=page.summary.assigned;summary.pending+=page.summary.pending;summary.excluded+=page.summary.excluded;
    summary.pageLocalObjects+=page.objects.length;
    for(const [type,n] of Object.entries(page.summary.byType))summary.byType[type]=(summary.byType[type]||0)+n;
  }
  if(summary.sourceLines!==summary.assigned+summary.pending+summary.excluded)throw Error("global source conservation");
  const candidate={...base,schemaVersion:"OfflineStructuralObjectCandidate/vNext-batch-a-boundary-repair",status:"machine_candidate_pending_human_review",summary,pages,
    stage48:{authority:"none",humanReviewIsProducerInput:false,runtimeModified:false}};
  const source={...original,schemaVersion:"DerivedSourceSpanInventory/vNext-batch-a-boundary-repair",pages:sourcePages};
  return {candidate,source};
}
module.exports={build,reconstructPage,displayMath};
