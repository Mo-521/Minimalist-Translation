"use strict";

// Offline-only general reconstruction. Human rectangles identify questions,
// never source membership. Every transfer below requires independent evidence.
const crypto = require("node:crypto");
const { validatePage } = require("./region-completeness.cjs");
const hash = x => crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 24);
const box = o => o.spatialFragments[0].bbox;
const end = b => b.y + b.height;
const union = boxes => ({ x: Math.min(...boxes.map(b => b.x)), y: Math.min(...boxes.map(b => b.y)),
  width: Math.max(...boxes.map(b => b.x + b.width)) - Math.min(...boxes.map(b => b.x)),
  height: Math.max(...boxes.map(end)) - Math.min(...boxes.map(b => b.y)) });
const area = (a,b) => Math.max(0, Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)) *
  Math.max(0, Math.min(end(a),end(b))-Math.max(a.y,b.y));
const ink = (e,id,l) => { const chars=e?.lines?.[id]?.chars||[];
  return chars.length ? union(chars.map(c=>c.box)) :
    {x:l.bbox.x,y:l.bbox.y-l.bbox.height,width:l.bbox.width,height:l.bbox.height}; };
const dominant = (e,id) => { const counts=new Map(); for(const c of e?.lines?.[id]?.chars||[])
  if(/[A-Za-z]/u.test(c.text)) counts.set(c.font,(counts.get(c.font)||0)+1);
  return [...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]||null; };
const refresh = (o, lines, b) => {
  o.sourceLineIds.sort((a,b) => lines.get(a).bbox.y-lines.get(b).bbox.y ||
    lines.get(a).bbox.x-lines.get(b).bbox.x);
  o.sourceText=o.sourceLineIds.map(id=>lines.get(id).text.trim()).join("\n");
  o.memberCount=o.sourceLineIds.length;
  o.memberLineBoxes=o.sourceLineIds.map(id=>({sourceLineId:id,bbox:lines.get(id).bbox}));
  o.spatialFragments=[{bbox:b,sourceLineIds:[...o.sourceLineIds]}];
};
const moveMember=(from,to,id,lines,fromBox,toBox)=>{
  from.sourceLineIds.splice(from.sourceLineIds.indexOf(id),1);to.sourceLineIds.push(id);
  refresh(from,lines,fromBox);refresh(to,lines,toBox);
};
const protectedTypes=new Set(["heading","caption","table","figure","reference","page_number",
  "running_header","running_footer","unsupported_structured_block"]);
const barrier=(p,a,b,except=[])=>p.objects.some(o=>!except.includes(o)&&protectedTypes.has(o.type)&&
  o.spatialFragments?.some(f=>area(f.bbox,union([a,b]))>1));

function wrappedHeadings(p,lines,e){const ops=[];
  for(const h of p.objects.filter(o=>o.type==="heading"&&o.sourceLineIds.length===1)){
    const hb=box(h),hl=lines.get(h.sourceLineIds[0]);if(!hl||/[.!?:]\s*$/u.test(hl.text))continue;
    const opts=p.objects.filter(o=>o.type==="body"&&o.sourceLineIds.length>=2).map(o=>{
      const first=lines.get(o.sourceLineIds[0]),second=lines.get(o.sourceLineIds[1]);return{ o,first,second };})
      .filter(({o,first,second})=>first&&second&&first.column===hl.column&&
        first.bbox.y-hl.bbox.y>=8&&first.bbox.y-hl.bbox.y<=17&&
        second.bbox.y-first.bbox.y>=16&&first.text.trim().length<=20&&
        !/[.!?:]\s*$/u.test(first.text)&&
        Math.abs(first.bbox.x-hl.bbox.x)<28&&
        first.bbox.x<hb.x+hb.width+15&&
        /Bold|Medi|CMBX|SFBX|STIXTwoText-Bold/u.test(dominant(e,first.sourceLineId)||"")&&
        !/Bold|Medi|CMBX|SFBX|STIXTwoText-Bold/u.test(dominant(e,second.sourceLineId)||"")&&
        !barrier(p,hb,ink(e,first.sourceLineId,first),[h,o]));
    if(opts.length!==1)continue;
    const {o,first}=opts[0],id=first.sourceLineId,old=box(o);
    const tail=o.sourceLineIds.slice(1).map(x=>ink(e,x,lines.get(x)));
    moveMember(o,h,id,lines,union(tail),union([hb,ink(e,id,first)]));
    ops.push({kind:"wrapped_heading_member_reassigned",headingId:h.objectId,bodyId:o.objectId,sourceLineId:id,
      evidence:["short_bold_continuation","heading_vertical_pitch","body_font_transition"]});
  }return ops;}

function insetStatement(p,lines,e){const ops=[];
  for(const o of [...p.objects].filter(o=>o.type==="body"&&o.sourceLineIds.length>=6)){
    const members=o.sourceLineIds.map(id=>lines.get(id));if(members.some(x=>!x))continue;
    const firstX=members[0].bbox.x;
    const cut=members.findIndex((l,i)=>i>=3&&firstX-l.bbox.x>12&&
      l.bbox.y-members[i-1].bbox.y>=17&&/[.!?]\s*(?:\d+)?\s*$/u.test(members[i-1].text));
    if(cut<3||cut>6||!members.slice(0,cut).every(l=>Math.abs(l.bbox.x-firstX)<2)||
      !members[0].text.includes(":"))continue;
    const ids=o.sourceLineIds.slice(0,cut),rest=o.sourceLineIds.slice(cut),
      firstBox=union(ids.map(id=>ink(e,id,lines.get(id)))),restBox=union(rest.map(id=>ink(e,id,lines.get(id))));
    if(barrier(p,firstBox,restBox,[o]))continue;
    o.sourceLineIds=rest;refresh(o,lines,restBox);
    const item={objectId:`stage81:${hash(["inset_statement",ids])}`,type:"body",page:o.page,
      sourceLineIds:ids,sourceText:"",memberCount:0,memberLineBoxes:[],spatialFragments:[],
      evidence:["indented_multiline_declaration","terminal_end","following_outdented_paragraph"],
      authority:"none",status:"offline_candidate_not_truth"};
    refresh(item,lines,firstBox);p.objects.push(item);
    ops.push({kind:"indented_statement_separated",sourceObjectId:o.objectId,objectId:item.objectId,sourceLineIds:ids});
  }return ops;}

function figureTitleEnvelope(p,lines){const ops=[];
  for(const f of p.objects.filter(o=>o.type==="figure"&&o.sourceLineIds.length===0)){
    const fb=box(f),up=p.objects.filter(o=>o.type==="table"&&end(box(o))<fb.y&&
      fb.y-end(box(o))>=12&&fb.y-end(box(o))<=55&&
      Math.abs((box(o).x+box(o).width/2)-(fb.x+fb.width/2))<fb.width*.2);
    const down=p.objects.filter(o=>o.type==="caption"&&box(o).y>=end(fb)&&box(o).y-end(fb)<25);
    if(up.length!==1||down.length!==1)continue;
    const top=end(box(up[0]))+5;
    if(p.objects.some(o=>o!==f&&o!==up[0]&&o!==down[0]&&o.spatialFragments?.some(x=>
      area(x.bbox,{x:fb.x,y:top,width:fb.width,height:fb.y-top})>1)))continue;
    f.spatialFragments[0].bbox={...fb,y:top,height:end(fb)-top};
    f.evidence=[...(f.evidence||[]),"image_only_figure_title_envelope_between_table_and_caption"];
    ops.push({kind:"figure_internal_title_region_extended",objectId:f.objectId,oldTop:fb.y,newTop:top,
      membershipUnchanged:true});
  }return ops;}

function inlineBridge(p,lines,e){const ops=[];
  for(const tiny of [...p.objects].filter(o=>o.type==="body"&&o.sourceLineIds.length===1&&
    /^(?:and|or|but|then)$/iu.test(o.sourceText.trim()))){
    const t=lines.get(tiny.sourceLineIds[0]);if(!t)continue;
    const targets=p.objects.filter(o=>o!==tiny&&o.type==="body"&&o.sourceLineIds.length>=2)
      .filter(o=>o.sourceLineIds.some(id=>{const l=lines.get(id);return l&&
        (l.column===t.column||t.column==="single"&&l.column!=="right"&&t.bbox.x<310)&&
        Math.abs(l.bbox.y-t.bbox.y)<8&&l.bbox.x<t.bbox.x&&
        t.bbox.x-(l.bbox.x+l.bbox.width)<15&&dominant(e,id)===dominant(e,t.sourceLineId); }));
    if(targets.length!==1)continue;
    const target=targets[0];if(barrier(p,box(target),box(tiny),[target,tiny]))continue;
    target.sourceLineIds.push(...tiny.sourceLineIds);refresh(target,lines,union([box(target),box(tiny)]));
    p.objects.splice(p.objects.indexOf(tiny),1);
    ops.push({kind:"same_row_prose_connector_attached",objectId:target.objectId,removedObjectId:tiny.objectId});
  }return ops;}

function figureProseTail(p,lines,e){const ops=[];
  for(const fig of p.objects.filter(o=>o.type==="figure"&&o.sourceLineIds.length>=5)){
    const first=lines.get(fig.sourceLineIds[0]);if(!first||!/[.!?]\s*$/u.test(first.text)||
      (first.text.match(/[A-Za-z]{3,}/gu)||[]).length<5)continue;
    const targets=p.objects.filter(o=>o.type==="body"&&o.sourceLineIds.length>=2).filter(o=>{
      const last=lines.get(o.sourceLineIds.at(-1));return last&&last.column===first.column&&
        first.bbox.y-last.bbox.y>8&&first.bbox.y-last.bbox.y<17&&
        Math.abs(first.bbox.x-last.bbox.x)<3&&
        !/[.!?:]\s*$/u.test(last.text)&&
        (!dominant(e,first.sourceLineId)||dominant(e,last.sourceLineId)===dominant(e,first.sourceLineId));
    });if(targets.length!==1)continue;
    const body=targets[0],next=lines.get(fig.sourceLineIds[1]);if(!next||next.bbox.y-first.bbox.y<20)continue;
    const remaining=fig.sourceLineIds.slice(1),newFigureTop=Math.min(...remaining.map(id=>
      ink(e,id,lines.get(id)).y));
    if(newFigureTop<=first.bbox.y||newFigureTop>=end(box(fig)))continue;
    const newFig={...box(fig),y:newFigureTop,height:end(box(fig))-newFigureTop};
    moveMember(fig,body,first.sourceLineId,lines,newFig,union([box(body),ink(e,first.sourceLineId,first)]));
    ops.push({kind:"prose_tail_removed_from_figure",figureId:fig.objectId,bodyId:body.objectId,
      sourceLineId:first.sourceLineId});
  }return ops;}

function paragraphContinuity(p,lines,e){const ops=[];
  const bodies=p.objects.filter(o=>o.type==="body"&&o.spatialFragments.length===1);
  for(const a of [...bodies]){if(!p.objects.includes(a))continue;
    const last=lines.get(a.sourceLineIds.at(-1));if(!last)continue;
    if(a.sourceLineIds.length>3||!/[.!?]\s*$/u.test(last.text)||
      /^(?:Algorithm\s+\d|Input:|Initialization:|Remark\s*\d|\d+\.)/iu.test(a.sourceText.trim()))continue;
    const candidates=bodies.filter(b=>b!==a&&p.objects.includes(b)).map(b=>({b,first:lines.get(b.sourceLineIds[0])}))
      .filter(({b,first})=>first&&first.column===last.column&&first.bbox.y>last.bbox.y&&
        first.bbox.y-last.bbox.y<17&&box(b).y-end(box(a))<3&&
        !/^(?:Algorithm\s+\d|Input:|Initialization:|Remark\s*\d|\d+\.)/iu.test(b.sourceText.trim())&&
        Math.abs(first.bbox.x-last.bbox.x)<3&&
        dominant(e,last.sourceLineId)&&dominant(e,last.sourceLineId)===dominant(e,first.sourceLineId)&&
        !barrier(p,box(a),box(b),[a,b])&&
        p.objects.filter(o=>o.type==="body"&&o!==a&&o!==b&&box(o).y>box(a).y&&
          box(o).y<box(b).y&&Math.abs(box(o).x-box(a).x)<20).length===0);
    if(candidates.length!==1)continue;
    const {b}=candidates[0],joined=union([box(a),box(b)]);
    if(p.objects.some(o=>o!==a&&o!==b&&o.type!=="body"&&o.spatialFragments?.some(f=>
      area(f.bbox,joined)>Math.max(area(f.bbox,box(a)),area(f.bbox,box(b)))+1)))continue;
    a.sourceLineIds.push(...b.sourceLineIds);refresh(a,lines,joined);p.objects.splice(p.objects.indexOf(b),1);
    ops.push({kind:"same_flow_paragraph_join",objectId:a.objectId,removedObjectId:b.objectId});
  }return ops;}

function inlineMathTail(p,lines,e){const ops=[];
  for(const f of [...p.objects].filter(o=>o.type==="formula"&&o.sourceLineIds.length===1&&
    /[.)]\s*$/u.test(o.sourceText)&&box(o).x<120&&box(o).width<100)){
    const line=lines.get(f.sourceLineIds[0]);if(!line)continue;
    const targets=p.objects.filter(o=>o.type==="body"&&o.sourceLineIds.length>=1).filter(o=>{
      const last=lines.get(o.sourceLineIds.at(-1));return last&&last.column===line.column&&
        line.bbox.y-last.bbox.y>8&&line.bbox.y-last.bbox.y<17&&
        line.bbox.x<=last.bbox.x&&last.bbox.x-line.bbox.x<25&&
        /[≥≤=(]\s*$/u.test(last.text)&&
        (e?.lines?.[line.sourceLineId]?.chars||[]).some(c=>/SFRM|CMR/u.test(c.font));
    });if(targets.length!==1||p.objects.some(o=>o.type==="equation_number"&&
      Math.abs(box(o).y-box(f).y)<15))continue;
    const body=targets[0];if(barrier(p,box(body),box(f),[body,f]))continue;
    body.sourceLineIds.push(...f.sourceLineIds);refresh(body,lines,union([box(body),box(f)]));
    p.objects.splice(p.objects.indexOf(f),1);
    ops.push({kind:"inline_math_sentence_tail_restored",bodyId:body.objectId,removedFormulaId:f.objectId});
  }return ops;}

function build(inputs={}){
  const prior=inputs.prior;
  const inventory=inputs.inventory;
  const native=inputs.native;
  const output=structuredClone(prior),operations=[];
  for(const [key,p] of Object.entries(output.pages)){
    const lines=new Map(inventory.pages[key].sourceLines.map(l=>[l.sourceLineId,l]));
    const e=native.pages[key];
    const start=operations.length;
    for(const fn of [wrappedHeadings,insetStatement,figureTitleEnvelope,inlineBridge,
      figureProseTail,paragraphContinuity,inlineMathTail])
      for(const op of fn(p,lines,e))operations.push({key,...op});
    if(operations.length>start){
      const byType={};for(const o of [...p.objects,...(p.referenceObjectRefs||[])])byType[o.type]=(byType[o.type]||0)+1;
      p.summary={...p.summary,objects:p.objects.length+(p.referenceObjectRefs||[]).length,byType,
        assigned:[...p.objects,...(p.referenceObjectRefs||[])].reduce((n,o)=>n+o.sourceLineIds.length,0),
        pending:p.pendingMembership.length};
    }
    validatePage(key,p,inventory.pages[key]);
  }
  output.summary={...output.summary,assigned:Object.values(output.pages).reduce((n,p)=>n+
    [...p.objects,...(p.referenceObjectRefs||[])].reduce((m,o)=>m+o.sourceLineIds.length,0),0),
    pending:Object.values(output.pages).reduce((n,p)=>n+p.pendingMembership.length,0),
    pageLocalObjects:Object.values(output.pages).reduce((n,p)=>n+p.objects.length,0),byType:{}};
  for(const p of Object.values(output.pages))for(const o of [...p.objects,...(p.referenceObjectRefs||[])])
    output.summary.byType[o.type]=(output.summary.byType[o.type]||0)+1;
  if(output.summary.assigned+output.summary.pending+output.summary.excluded!==output.summary.sourceLines)
    throw Error("Global source conservation failure");
  output.schemaVersion="OfflineStructuralObjectCandidate/vNext-reviewed-boundaries";
  output.stage81={authority:"none",status:"offline_candidate_not_truth",operations};return output;
}
module.exports={build};
