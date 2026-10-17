"use strict";
function build(inputs){
const before=inputs?.before,frozen=inputs?.source,native=inputs?.native;
const after=structuredClone(before),source=structuredClone(frozen),operations=[],held=[],lineage=[];
const union=bs=>{const x=Math.min(...bs.map(b=>b.x)),y=Math.min(...bs.map(b=>b.y));return{x,y,width:Math.max(...bs.map(b=>b.x+b.width))-x,height:Math.max(...bs.map(b=>b.y+b.height))-y};};
const area=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)]||0;
const norm=t=>t.replace(/[\s_^]+/gu,'').replace(/ﬁ/gu,'fi').replace(/ﬂ/gu,'fl');
for(const[key,page]of Object.entries(after.pages)){
 const inv=source.pages[key],lines=new Map(inv.sourceLines.map(l=>[l.sourceLineId,l])),g=native.pages[key].lines,changed=new Set();
 const box=o=>union(o.spatialFragments.map(f=>f.bbox));
 function refresh(o){o.sourceText=o.sourceLineIds.map(id=>lines.get(id).text).join('\n');o.memberCount=o.sourceLineIds.length;o.memberLineBoxes=o.sourceLineIds.map(id=>({sourceLineId:id,bbox:lines.get(id).bbox}));}
 function chars(id){const l=lines.get(id),b=l.bbox;return(g[id]?.chars||[]).filter(c=>c.box.x>=b.x-1&&c.box.x<=b.x+b.width+1&&(l.sourceSpanKind?c.box.y+c.box.height/2>=b.y-b.height-1&&c.box.y+c.box.height/2<=b.y+1:Math.abs(c.box.y+c.box.height/2-b.y)<Math.max(8,b.height*.65)||/CMEX/u.test(c.font)));}
 function font(id){const a=chars(id).filter(c=>/^[A-Za-z]+$/u.test(c.text)&&!/CMMI|CMSY|CMEX|MSBM/u.test(c.font)),counts=new Map();for(const c of a)counts.set(c.font,(counts.get(c.font)||0)+1);return{size:median(a.map(c=>c.size)),name:[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0],count:a.length};}
 function blocked(b,ignore){return page.objects.some(o=>!ignore.includes(o)&&['formula','heading','caption','table','figure','reference','page_number','running_header','running_footer','unsupported_structured_block'].includes(o.type)&&o.spatialFragments.some(f=>area(b,f.bbox)>1))||(page.referenceObjectRefs||[]).some(o=>o.spatialFragments?.some(f=>area(b,f.bbox)>1));}
 function setBox(o,b){o.spatialFragments=[{bbox:b,sourceLineIds:[...o.sourceLineIds]}];refresh(o);changed.add(o);}
 // Fraction denominators need two native bars + centered function-expression
 // rows; small inline brackets in the following prose remain body members.
 for(const body of page.objects.filter(o=>o.type==='body'))for(const id of [...body.sourceLineIds]){
  const l=lines.get(id);if(!/^(?:\s*(?:ln|log)\s*[A-Za-zα-ω][\wα-ω]*\s*){2,}$/u.test(l.text))continue;
  const cs=chars(id),b=cs.length?union(cs.map(c=>c.box)):null;if(!b)continue;
  const bars=native.pages[key].fractionRules.filter(r=>r.y<=b.y+2&&b.y-r.y<l.bbox.height&&r.x+r.width>=b.x&&r.x<=b.x+b.width);if(bars.length<2)continue;
  const targets=page.objects.filter(o=>o.type==='formula'&&/[=≤≥<⩽⩾]/u.test(o.sourceText)&&b.y>=box(o).y&&b.y-box(o).y-box(o).height<l.bbox.height&&b.x>=box(o).x-l.bbox.height&&b.x+b.width<=box(o).x+box(o).width+l.bbox.height);
  if(targets.length!==1)continue;const formula=targets[0],formulaBox=union([box(formula),b,...bars]);if(blocked(formulaBox,[body,formula]))continue;
  const rest=body.sourceLineIds.filter(x=>x!==id),restBoxes=rest.flatMap(id=>chars(id).map(c=>c.box));if(!restBoxes.length)continue;
  const bodyBox=union(restBoxes);if(area(bodyBox,formulaBox)>1){held.push({key,sourceLineId:id,reason:'fraction_vs_inline_body_glyph_conflict'});continue;}
  body.sourceLineIds=rest;setBox(body,bodyBox);formula.sourceLineIds.push(id);setBox(formula,formulaBox);formula.evidence=[...(formula.evidence||[]),'native_fraction_bars_and_denominator_alignment'];operations.push({key,kind:'fraction_denominator_membership_restored',objectId:formula.objectId,beforeObjectId:body.objectId,sourceLineIds:[id]});
 }
 // Recover short lexical paragraph tails fused with following display glyphs.
 for(const pending of [...page.pendingMembership]){
  const l=lines.get(pending.sourceLineId);if(!l||l.sourceSpanKind)continue;const c=g[l.sourceLineId]?.chars||[];
  const groups=[];for(const a of c.filter(c=>/^[A-Za-z]+$/u.test(c.text)&&!/CMMI|CMSY|CMEX|MSBM/u.test(c.font)).sort((a,b)=>a.box.y-b.box.y)){const cy=a.box.y+a.box.height/2,old=groups.at(-1);if(!old||Math.abs(cy-median(old.map(a=>a.box.y+a.box.height/2)))>2.8)groups.push([a]);else old.push(a);}
  for(const row of groups){row.sort((a,b)=>a.box.x-b.box.x);const text=row.map(c=>c.text).join(''),prefix=norm(text);if(!/^[A-Za-z]{2,24}$/u.test(prefix)||!norm(l.text).startsWith(prefix)||norm(l.text)===prefix)continue;
   const pb=union(row.map(c=>c.box)),h=median(row.map(c=>c.size)),math=c.filter(c=>c.box.x>pb.x+pb.width+h*3&&c.box.y+c.box.height/2>pb.y+pb.height*.7&&/CMMI|CMSY|CMEX/u.test(c.font));if(!math.length)continue;
   const mb=union(math.map(c=>c.box)),targets=page.objects.filter(o=>o.type==='formula'&&/[=≤≥⟨∑]/u.test(o.sourceText)&&area(box(o),mb)>0),prev=page.objects.filter(o=>o.type==='body'&&Math.abs(box(o).x-pb.x)<3&&pb.y-box(o).y-box(o).height>=-1&&pb.y-box(o).y-box(o).height<h*1.4&&!/[.!?:]\s*$/u.test(o.sourceText));
   if(targets.length!==1||prev.length!==1)continue;const formula=targets[0],body=prev[0],bb=union([box(body),pb]),fb=union([box(formula),mb]);
   if(area(bb,fb)>1){const inks=[...math,...formula.sourceLineIds.flatMap(id=>chars(id))].filter(c=>c.inkBox&&c.box.y+c.box.height/2>=fb.y&&c.box.y+c.box.height/2<=fb.y+fb.height).map(c=>c.inkBox);if(inks.length){const start=Math.min(...inks.map(b=>b.y));if(start>fb.y&&start-fb.y<6){fb.height-=start-fb.y;fb.y=start;}}}
   if(blocked(bb,[body,formula])||blocked(fb,[body,formula])||area(bb,fb)>1)continue;
   const splitAt=Array.from({length:l.text.length},(_,i)=>i+1).find(i=>norm(l.text.slice(0,i))===prefix);if(!splitAt)continue;
   const spans=[['prose_tail',pb,0,splitAt],['display_member',mb,splitAt,l.text.length]].map(([kind,b,start,end])=>({...l,sourceLineId:l.sourceLineId+':stage73:'+kind,text:l.text.slice(start,end),bbox:{...b,y:b.y+b.height},sourceSpanKind:kind,parentSourceLineId:l.sourceLineId,textSpan:{start,end}}));
   inv.sourceLines.splice(inv.sourceLines.indexOf(l),1,...spans);lines.delete(l.sourceLineId);for(const [i,s]of spans.entries()){lines.set(s.sourceLineId,s);g[s.sourceLineId]={box:i?mb:pb,chars:i?math:row};}page.pendingMembership=page.pendingMembership.filter(p=>p!==pending);body.sourceLineIds.push(spans[0].sourceLineId);formula.sourceLineIds.unshift(spans[1].sourceLineId);setBox(body,bb);setBox(formula,fb);
   const r={key,parentSourceLineId:l.sourceLineId,parentText:l.text,spans:spans.map(s=>({sourceLineId:s.sourceLineId,text:s.text,textSpan:s.textSpan,bbox:s.bbox}))};lineage.push(r);page.sourceSpanLineage=[...(page.sourceSpanLineage||[]),r];operations.push({key,kind:'pending_prose_display_tail_partition',objectId:body.objectId,beforeObjectId:formula.objectId,sourceLineIds:spans.map(s=>s.sourceLineId)});break;
  }
 }
 // Conservative prose flow reconstruction. A continuation cue never suffices:
 // compatible typography, row spacing, indentation, order and no hard barrier.
 let repeat=true;while(repeat){repeat=false;const bodies=page.objects.filter(o=>o.type==='body'&&o.spatialFragments.length===1).sort((a,b)=>box(a).y-box(b).y);
  for(const a of bodies){const ab=box(a),last=lines.get(a.sourceLineIds.at(-1)),af=font(last.sourceLineId);if(!af.name||af.count<4||a.sourceLineIds.length>15)continue;
   const next=bodies.filter(b=>b!==a&&box(b).y>ab.y&&box(b).y-ab.y-ab.height>=-1&&box(b).y-ab.y-ab.height<af.size*.65).sort((a,b)=>box(a).y-box(b).y);
   for(const b of next){const bb=box(b),first=lines.get(b.sourceLineIds[0]),bf=font(first.sourceLineId);if(bf.name!==af.name||Math.abs(bf.size-af.size)>.7||bf.count<4||a.sourceLineIds.length+b.sourceLineIds.length>20)continue;
    const left=Math.abs(ab.x-bb.x)<2.5,firstIndent=a.sourceLineIds.length===1&&ab.x-bb.x>0&&ab.x-bb.x<af.size*2&&Math.abs(ab.x+ab.width-bb.x-bb.width)<3;
    if(!left&&!firstIndent)continue;if(/^(?:Proof\b|Remark\b|Theorem\b|Lemma\b|Definition\b|Proposition\b|Example\b|[•●▪]|\(?\d+[.)])/u.test(b.sourceText))continue;
    const unfinished=!/[.!?:]\s*$/u.test(a.sourceText)&&b.sourceText.match(/^([a-z])\.\s+[A-Z]/u),discursive=/^(?:Moreover|Furthermore|Consequently|Hence|Thus|Applying|Using|Substituting|Differentiating|Integrating|Taking|Combining|In particular|It follows)\b/u.test(b.sourceText)&&/[.!?]\s*$/u.test(a.sourceText);
    if(!unfinished&&!discursive)continue;const combined=union([ab,bb]);if(blocked(combined,[a,b])||page.objects.some(o=>o!==a&&o!==b&&o.type==='body'&&area(box(o),combined)>1))continue;
    if(page.pendingMembership.some(p=>{const l=lines.get(p.sourceLineId);return l&&l.bbox.x>=combined.x&&l.bbox.x<combined.x+combined.width&&l.bbox.y>ab.y+ab.height&&l.bbox.y<bb.y;}))continue;
    a.sourceLineIds.push(...b.sourceLineIds);setBox(a,combined);page.objects.splice(page.objects.indexOf(b),1);a.evidence=[...(a.evidence||[]),'native_typography_reading_flow_paragraph_continuation'];operations.push({key,kind:'semantic_prose_continuation_join',objectId:a.objectId,beforeObjectId:b.objectId,signals:{unfinished:!!unfinished,discursive,left,firstIndent,gap:bb.y-ab.y-ab.height,font:af.name}});repeat=true;break;
   }if(repeat)break;
  }
 }
 if(operations.some(o=>o.key===key)){const byType={};for(const o of [...page.objects,...page.referenceObjectRefs||[]])byType[o.type]=(byType[o.type]||0)+1;page.summary={...page.summary,byType,pending:page.pendingMembership.length,objects:page.objects.length+(page.referenceObjectRefs||[]).length};page.sourceLineCount=inv.sourceLines.length;}
}
after.stage73={authority:'none',status:'offline_candidate_not_truth',operations,held};source.stage73={authority:'none',status:'derived_evidence_not_truth',lineage};
return {candidate:after,source};
}
module.exports={build};
