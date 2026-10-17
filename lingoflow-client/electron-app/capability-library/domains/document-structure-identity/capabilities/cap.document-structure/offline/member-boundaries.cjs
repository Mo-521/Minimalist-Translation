"use strict";
const crypto=require('node:crypto');
function build(inputs){
const before=inputs?.before,frozen=inputs?.source,pdf=inputs?.pdf;
const after=structuredClone(before),source=structuredClone(frozen),operations=[],held=[],lineage=[];
const union=bs=>{const x=Math.min(...bs.map(b=>b.x)),y=Math.min(...bs.map(b=>b.y));return{x,y,width:Math.max(...bs.map(b=>b.x+b.width))-x,height:Math.max(...bs.map(b=>b.y+b.height))-y};};
const area=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)]||0;
const norm=t=>t.replace(/[\s_^]+/gu,'').replace(/ﬁ/g,'fi').replace(/ﬂ/g,'fl');
const natural=t=>(t.match(/[A-Za-z]{3,}/gu)||[]).filter(w=>!['sin','cos','log','lim','argmin','Span','dim','max','min','CVaR'].includes(w));
for(const[key,page]of Object.entries(after.pages)){
 const inv=source.pages[key],lines=new Map(inv.sourceLines.map(l=>[l.sourceLineId,l])),glyph=pdf.pages[key].lines;
 const changed=new Set();
 function box(o){return union(o.spatialFragments.map(f=>f.bbox));}
 function refresh(o){o.sourceText=o.sourceLineIds.map(id=>lines.get(id).text).join('\n');o.memberCount=o.sourceLineIds.length;o.memberLineBoxes=o.sourceLineIds.map(id=>({sourceLineId:id,bbox:lines.get(id).bbox}));}
 function ownBox(l){const g=glyph[l.sourceLineId];if(!g)return null;const baseline=l.bbox.y;
  const chars=g.chars.filter(c=>l.sourceSpanKind?c.box.y+c.box.height/2>=baseline-l.bbox.height-1&&c.box.y+c.box.height/2<=baseline+1:Math.abs(c.box.y+c.box.height/2-baseline)<Math.max(8,l.bbox.height*.65)||/CMEX/u.test(c.font));return chars.length?union(chars.map(c=>c.box)):null;}
 function blocked(b,ignore){return page.objects.some(o=>!ignore.includes(o)&&['formula','heading','caption','table','figure','reference','page_number','running_header','running_footer'].includes(o.type)&&o.spatialFragments.some(f=>area(b,f.bbox)>1));}
 function removeMembers(o,ids){const old=box(o);o.sourceLineIds=o.sourceLineIds.filter(id=>!ids.includes(id));if(!o.sourceLineIds.length){page.objects.splice(page.objects.indexOf(o),1);return;}const boxes=o.sourceLineIds.map(id=>ownBox(lines.get(id))).filter(Boolean),remaining=union(boxes);const b=o.type==='formula'?{x:old.x,y:old.y,width:old.width,height:Math.max(...boxes.map(b=>b.y+b.height))-old.y}:remaining;o.spatialFragments=[{bbox:b,sourceLineIds:[...o.sourceLineIds]}];refresh(o);changed.add(o);}
 function attach(o,members,b,kind,previous){o.sourceLineIds.push(...members.map(l=>l.sourceLineId));if(kind!=='standalone_inline_math_prose_owned')o.sourceLineIds.sort((a,z)=>{const x=lines.get(a).bbox,y=lines.get(z).bbox;return x.y-y.y||x.x-y.x;});o.spatialFragments=[{bbox:b,sourceLineIds:[...o.sourceLineIds]}];refresh(o);o.evidence=[...(o.evidence||[]),kind,'native_member_support'];changed.add(o);operations.push({key,kind,objectId:o.objectId,sourceLineIds:members.map(l=>l.sourceLineId),beforeObjectId:previous?.objectId});}
 // Restore physically separated prose prefixes mistakenly owned by a display.
 for(const formula of page.objects.filter(o=>o.type==='formula'))for(const sid of [...formula.sourceLineIds]){
  const l=lines.get(sid),g=glyph[sid];if(!g||l.sourceSpanKind)continue;
  const groups=[];for(const c of [...g.chars].filter(c=>/[A-Za-z:]/u.test(c.text)&&!/^\(cid:/u.test(c.text)&&!/CMMI|CMSY|CMEX/u.test(c.font)).sort((a,b)=>a.box.y-b.box.y)){
   const cy=c.box.y+c.box.height/2,last=groups.at(-1);if(!last||Math.abs(cy-median(last.map(c=>c.box.y+c.box.height/2)))>2.5)groups.push([c]);else last.push(c);
  }
  for(const row of groups){row.sort((a,b)=>a.box.x-b.box.x);const text=row.map(c=>c.text).join(''),proseBox=union(row.map(c=>c.box));if(!/^[A-Za-z]{3,}:?$/u.test(text)||!norm(l.text).startsWith(norm(text))||norm(l.text)===norm(text))continue;
   const preceding=page.objects.filter(o=>o.type==='body'&&Math.abs(box(o).x-proseBox.x)<3&&proseBox.y-box(o).y-box(o).height>=-2&&proseBox.y-box(o).y-box(o).height<proseBox.height*1.4&&!/[.!?]\s*$/u.test(o.sourceText));if(preceding.length!==1)continue;
   const end=Array.from({length:l.text.length},(_,i)=>i+1).find(i=>norm(l.text.slice(0,i))===norm(text)),mathChars=formula.sourceLineIds.flatMap(id=>glyph[id]?.chars||[]).filter(c=>c.box.y+c.box.height/2>proseBox.y+proseBox.height&&c.box.x>proseBox.x+proseBox.width+proseBox.height*2);if(!end||!mathChars.length)continue;
   const mathBox=union(mathChars.map(c=>c.box)),body=preceding[0],newBodyBox=union([box(body),proseBox]);if(blocked(newBodyBox,[body,formula]))continue;
   const spans=[['prose_prefix',proseBox,0,end],['display_suffix',mathBox,end,l.text.length]].map(([kind,b,start,stop])=>({...l,sourceLineId:l.sourceLineId+':stage72:'+kind,text:l.text.slice(start,stop),bbox:{...b,y:b.y+b.height},sourceSpanKind:kind,parentSourceLineId:l.sourceLineId,textSpan:{start,end:stop}}));
   inv.sourceLines.splice(inv.sourceLines.indexOf(l),1,...spans);lines.delete(sid);for(const s of spans)lines.set(s.sourceLineId,s);glyph[spans[0].sourceLineId]={box:proseBox,chars:row};glyph[spans[1].sourceLineId]={box:mathBox,chars:mathChars};
   const oldFormulaBox=box(formula);formula.sourceLineIds=formula.sourceLineIds.map(id=>id===sid?spans[1].sourceLineId:id);const mathExtent=union(formula.sourceLineIds.map(id=>ownBox(lines.get(id))).filter(Boolean));mathExtent.height=Math.max(mathExtent.y+mathExtent.height,oldFormulaBox.y+oldFormulaBox.height)-mathExtent.y;formula.spatialFragments=[{bbox:mathExtent,sourceLineIds:[...formula.sourceLineIds]}];refresh(formula);changed.add(formula);attach(body,[spans[0]],newBodyBox,'formula_owned_prose_prefix_restored',formula);
   const r={key,parentSourceLineId:sid,parentText:l.text,spans:spans.map(s=>({sourceLineId:s.sourceLineId,text:s.text,textSpan:s.textSpan,bbox:s.bbox}))};lineage.push(r);page.sourceSpanLineage=[...(page.sourceSpanLineage||[]),r];break;
  }
 }
 // Case branches require a native extensible glyph, a multi-row conditional
 // assignment, indentation and physical continuation; font em boxes may not
 // express the full rendered height of an extensible glyph.
 for(const body of [...page.objects].filter(o=>o.type==='body'))for(const sid of [...body.sourceLineIds]){
  const l=lines.get(sid),g=glyph[sid];if(!g||!/^\s*(?:[-+]?\d+(?:\.\d+)?|[A-Za-z])\s+(?:otherwise|if\b|for\b)/u.test(l.text)||l.text.length>70)continue;
  const b=ownBox(l),targets=page.objects.filter(o=>o.type==='formula'&&o.sourceText.includes(':=')&&/\b(?:if|for)\b/u.test(o.sourceText)&&o.sourceLineIds.length>=2&&o.sourceLineIds.some(id=>glyph[id]?.chars.some(c=>/CMEX/u.test(c.font)))&&b.y>=box(o).y&&b.y-box(o).y-box(o).height<b.height*1.5&&b.x>box(o).x+b.height*2&&b.x<box(o).x+box(o).width);
  if(targets.length!==1)continue;const target=targets[0],combined=union([box(target),b]);if(blocked(combined,[target,body]))continue;
  removeMembers(body,[sid]);attach(target,[l],combined,'native_piecewise_branch_owned',body);
 }
 // Operators/limits have mathematical glyph evidence, not just short length.
 const candidates=[...page.pendingMembership.map(p=>({line:lines.get(p.sourceLineId),pending:p})),...page.objects.filter(o=>o.type==='body').flatMap(o=>o.sourceLineIds.map(id=>({line:lines.get(id),owner:o})))];
 for(const c of candidates){const l=c.line;if(!l||!/^\s*(?:[ZR∫]\s*(?:[−-]?∞|[A-Za-z\d]+)?|[−-]?∞)\s*$/u.test(l.text))continue;
  const g=glyph[l.sourceLineId];if(!g||!g.chars.some(c=>/CMEX|CMSY/u.test(c.font)||c.text==='∞'))continue;const b=ownBox(l);if(!b)continue;
  const targets=page.objects.filter(o=>o.type==='formula'&&o.sourceText.includes('d')&&o.sourceText.includes('=')&&b.x>=box(o).x-b.height*3&&b.x<=box(o).x+box(o).width&&Math.abs(b.y-box(o).y)<b.height*3).filter(o=>{const region=union([box(o),b]);return !blocked(region,[o,c.owner].filter(Boolean));});
  if(targets.length!==1)continue;const target=targets[0];if(c.pending){page.pendingMembership=page.pendingMembership.filter(p=>p!==c.pending);}else removeMembers(c.owner,[l.sourceLineId]);attach(target,[l],union([box(target),b]),'native_integral_limit_owned',c.owner);
 }
 // Grammatical pending rows retain mathematics inline when margin/font/flow agree.
 for(const pending of [...page.pendingMembership]){
  const l=lines.get(pending.sourceLineId),g=glyph[l.sourceLineId];if(!g||pending.reason!=='math_or_equation_label_pending')continue;
  const words=natural(l.text),binding=/^where\s+[A-Za-zα-ω].*[=:]/iu.test(l.text);if(words.length<2&&!binding)continue;
  if(/^(?:Note[—:]|end\s+for|Université|https?:|:)/iu.test(l.text))continue;
  const english=g.chars.filter(c=>/^[A-Za-z]+$/u.test(c.text)&&!/CMMI|CMSY|CMEX|MSBM/u.test(c.font));if(english.length<4)continue;
  const b=ownBox(l),size=median(english.map(c=>c.size));if(!b||b.width>inv.pageSize.width*.92)continue;
  const nearby=page.objects.filter(o=>o.type==='body'&&Math.abs(box(o).x-b.x)<3&&Math.min(Math.abs(box(o).y+box(o).height-b.y),Math.abs(box(o).y-b.y-b.height))<size*1.8);
  const prev=nearby.filter(o=>box(o).y<b.y).sort((a,z)=>box(z).y-box(a).y)[0];
  if(prev){const combined=union([box(prev),b]);if(blocked(combined,[prev]))continue;
   page.pendingMembership=page.pendingMembership.filter(p=>p!==pending);attach(prev,[l],combined,'grammatical_inline_math_continuation_owned');
   const next=nearby.filter(o=>o!==prev&&box(o).y>=b.y+b.height-2&&box(o).y-b.y-b.height<size*1.2&&Math.abs(box(o).x-b.x)<2&&!/^(?:Proof|Remark|Theorem|Definition|Lemma|For\b|Since\b)/u.test(o.sourceText));
   if(next.length===1&&/[:=,]\s*$/u.test(l.text)&&!blocked(union([box(prev),box(next[0])]),[prev,next[0]])){const n=next[0];page.objects.splice(page.objects.indexOf(n),1);attach(prev,n.sourceLineIds.map(id=>lines.get(id)),union([box(prev),box(n)]),'pending_bridge_paragraph_join',n);}
  }else if(binding&&nearby.length&&page.objects.some(o=>o.type==='formula'&&b.y-box(o).y-box(o).height>-size*1.2&&b.y-box(o).y-box(o).height<size*2)){
   // Own the prose as body, never join it to the nearby display.
   const id='stage72:'+crypto.createHash('sha256').update(key+l.sourceLineId).digest('hex').slice(0,24),o={objectId:id,type:'body',page:l.page,sourceLineIds:[],spatialFragments:[],evidence:['prose_binding_grammar','left_margin_and_native_roman_font'],authority:'none',status:'offline_candidate_not_truth'};
   const checkpoint=operations.length,displaced=page.objects.filter(x=>x.type==='formula').flatMap(x=>x.sourceLineIds.map(id=>({owner:x,snapshot:structuredClone(x),line:lines.get(id),b:ownBox(lines.get(id))}))).filter(x=>x.line.text.length<=3&&x.b&&area(x.b,b)/(x.b.width*x.b.height)>.98);
   for(const x of displaced){removeMembers(x.owner,[x.line.sourceLineId]);operations.push({key,kind:'inline_math_fragment_removed_from_display',objectId:x.owner.objectId,sourceLineIds:[x.line.sourceLineId]});}
   if(blocked(b,[])){held.push({key,sourceLineId:l.sourceLineId,reason:'binding_prose_visual_conflict'});for(const x of displaced){const i=page.objects.indexOf(x.owner);if(i>=0)page.objects[i]=x.snapshot;else page.objects.push(x.snapshot);}operations.splice(checkpoint);continue;}
   page.objects.push(o);page.pendingMembership=page.pendingMembership.filter(p=>p!==pending);attach(o,[l,...displaced.map(x=>x.line)],b,'standalone_inline_math_prose_owned');
  }
 }
 // Trim only tiny font-metric boundary overlap when every owned edge glyph has
 // native raster support. This is display-only, not a membership decision.
 for(const o of page.objects.filter(o=>changed.has(o)&&o.spatialFragments.length===1)){
  const old=box(o),overlapping=page.objects.filter(x=>x!==o&&['body','formula'].includes(x.type)&&x.type!==o.type&&area(old,box(x))>0);if(!overlapping.length)continue;
  const inks=o.sourceLineIds.flatMap(id=>glyph[id]?.chars||[]).filter(c=>c.inkBox&&c.box.y+c.box.height/2>=old.y&&c.box.y+c.box.height/2<=old.y+old.height&&c.box.x>=old.x-.5&&c.box.x<=old.x+old.width+.5).map(c=>c.inkBox);
  if(!inks.length)continue;const end=Math.max(...inks.map(b=>b.y+b.height)),delta=old.y+old.height-end;
  if(delta>0&&delta<3&&end>old.y){const next={...old,height:end-old.y};if(overlapping.every(x=>area(next,box(x))<=.05)){o.spatialFragments[0].bbox=next;o.evidence=[...(o.evidence||[]),'native_visible_ink_edge_calibration'];operations.push({key,kind:'visible_ink_boundary_calibrated',objectId:o.objectId,oldBox:old,newBox:next});}}
  if(o.spatialFragments[0].bbox===old||JSON.stringify(o.spatialFragments[0].bbox)===JSON.stringify(old)){const start=Math.min(...inks.map(b=>b.y)),shift=start-old.y;if(shift>0&&shift<6&&start<old.y+old.height){const next={...old,y:start,height:old.height-shift};if(overlapping.every(x=>area(next,box(x))<=.05)){o.spatialFragments[0].bbox=next;o.evidence=[...(o.evidence||[]),'native_visible_ink_edge_calibration'];operations.push({key,kind:'visible_ink_boundary_calibrated',objectId:o.objectId,oldBox:old,newBox:next});}}}
 }
 if(operations.some(o=>o.key===key)){const byType={};for(const o of [...page.objects,...page.referenceObjectRefs||[]])byType[o.type]=(byType[o.type]||0)+1;page.summary={...page.summary,byType,pending:page.pendingMembership.length,objects:page.objects.length+(page.referenceObjectRefs||[]).length};page.sourceLineCount=inv.sourceLines.length;}
}
after.stage72={authority:'none',status:'offline_candidate_not_truth',operations,held};source.stage72={authority:'none',status:'derived_evidence_not_truth',lineage};
return {candidate:after,source};
}
module.exports={build};
