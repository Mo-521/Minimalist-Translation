"use strict";
const crypto=require('node:crypto'),assert=require('node:assert/strict');
function build(inputs){
const before=inputs?.before,source=inputs?.source;
const typo=inputs?.typo,glyph=inputs?.glyph;
const after=structuredClone(before),operations=[],held=[];
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)]||0;
const words=t=>(t.match(/[A-Za-z]{3,}/g)||[]).length;
const terminal=t=>/[.!?](?:["')\]]|\s|□)*$/u.test(t.trim());
const union=bs=>{const x=Math.min(...bs.map(b=>b.x)),y=Math.min(...bs.map(b=>b.y));return{x,y,width:Math.max(...bs.map(b=>b.x+b.width))-x,height:Math.max(...bs.map(b=>b.y+b.height))-y};};
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,24);
const intersect=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
const sameFont=(a,b)=>a&&b&&a.font===b.font&&Math.abs(a.size-b.size)<.5;
for(const[key,page]of Object.entries(after.pages)){
 const lines=new Map(source.pages[key].sourceLines.map(l=>[l.sourceLineId,l])),metrics=typo.pages[key];
 const ordered=o=>o.sourceLineIds.map(id=>lines.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x);
 const visual=l=>glyph.pages[key].lines[l.sourceLineId]?.box||{...l.bbox,y:l.bbox.y-l.bbox.height};
 function create(template,type,ids,reason){const rows=ids.map(id=>lines.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x),o={...structuredClone(template),objectId:'stage69:'+digest([key,type,ids,reason]),type,sourceLineIds:rows.map(l=>l.sourceLineId),sourceText:rows.map(l=>l.text).join('\n'),memberCount:rows.length,memberLineBoxes:rows.map(l=>({sourceLineId:l.sourceLineId,bbox:l.bbox})),spatialFragments:[{bbox:union(rows.map(visual)),sourceLineIds:rows.map(l=>l.sourceLineId)}],evidence:[reason],reconstructionParentObjectIds:[template.objectId],authority:'none',status:'offline_candidate_not_truth'};delete o.internalVisualHints;return o;}
 // A title marker alone is insufficient: typography, centering and vertical
 // separation from ordinary prose must jointly corroborate an embedded heading.
 for(const body of [...page.objects].filter(o=>o.type==='body'&&o.memberCount>=2&&!o.internalVisualHints)){
  const rows=ordered(body),first=rows[0],next=rows[1],f=metrics[first.sourceLineId],n=metrics[next.sourceLineId];
  const marker=/^Appendix\s*[A-Z0-9]*[.:]?\s*[A-Za-z]/iu.test(first.text),lane=median(rows.slice(1).map(l=>l.bbox.x)),width=Math.max(...rows.slice(1).map(l=>l.bbox.width));
  const centered=Math.abs(first.bbox.x+first.bbox.width/2-lane-width/2)<width*.12&&first.bbox.width<width*.85;
  const isolated=f&&n&&n.top-f.bottom>f.size*.6;
  if(!marker||!centered||!isolated||sameFont(f,n)||words(first.text)>12||/[=∑∫]/u.test(first.text))continue;
  const heading=create(body,'heading',[first.sourceLineId],'embedded_section_heading_boundary'),rest=create(body,'body',rows.slice(1).map(l=>l.sourceLineId),'body_after_embedded_heading');
  page.objects.splice(page.objects.indexOf(body),1,heading,rest);operations.push({key,kind:'embedded_heading_separated',beforeObjectId:body.objectId,afterObjectIds:[heading.objectId,rest.objectId],evidence:{centered,fontChange:[f.font,n.font],verticalGap:n.top-f.bottom}});
 }
 // Extend an existing heading over a wrapped title row only with matching
 // typography and a distinct following prose font; do not classify by digits.
 for(const heading of [...page.objects].filter(o=>o.type==='heading')){
  const hs=ordered(heading),last=hs.at(-1),h=metrics[last.sourceLineId];if(!h)continue;
  const candidates=page.objects.filter(o=>o.type==='body'&&o.memberCount>=2&&!o.internalVisualHints).map(body=>({body,rows:ordered(body)})).filter(({rows})=>{
   const first=rows[0],second=rows[1],f=metrics[first.sourceLineId],n=metrics[second.sourceLineId],step=first.bbox.y-last.bbox.y;
   return first.column===last.column&&step>h.size*.6&&step<h.size*1.65&&sameFont(h,f)&&n&&!sameFont(f,n)&&words(first.text)>=2&&words(first.text)<=7&&!terminal(first.text)&&first.bbox.width<=last.bbox.width&&Math.abs(first.bbox.x-last.bbox.x)<h.size*3&&second.bbox.y-first.bbox.y>step*1.15;
  });
  if(candidates.length!==1)continue;
  const{body,rows}=candidates[0],first=rows[0],newHeading=create(heading,'heading',[...heading.sourceLineIds,first.sourceLineId],'wrapped_heading_continuation'),rest=create(body,'body',rows.slice(1).map(l=>l.sourceLineId),'body_after_wrapped_heading');
  page.objects.splice(page.objects.indexOf(heading),1,newHeading);page.objects.splice(page.objects.indexOf(body),1,rest);operations.push({key,kind:'wrapped_heading_completed',beforeObjectIds:[heading.objectId,body.objectId],afterObjectIds:[newHeading.objectId,rest.objectId],sourceLineIds:[first.sourceLineId]});
 }
 // A centered, standalone URL is a real unsupported link block, not generic
 // uncertainty and not author/affiliation content. Inline URLs stay in prose.
 for(const body of [...page.objects].filter(o=>o.type==='body'&&o.memberCount>=3&&!o.internalVisualHints)){
  const rows=ordered(body),i=rows.findIndex(l=>/^https?:\/\/\S+$/u.test(l.text.trim()));if(i<=0||i>=rows.length-1)continue;
  const l=rows[i],a=rows[i-1],b=rows[i+1],lane=median(rows.filter(q=>words(q.text)>=4).map(q=>q.bbox.x)),width=Math.max(...rows.map(q=>q.bbox.width)),h=median(rows.map(q=>q.bbox.height));
  if(l.bbox.x-lane<h*2||l.bbox.width>width*.8||Math.abs(l.bbox.x+l.bbox.width/2-lane-width/2)>width*.15||l.bbox.y-a.bbox.y<h*1.25||b.bbox.y-l.bbox.y<h*1.25)continue;
  const left=create(body,'body',rows.slice(0,i).map(q=>q.sourceLineId),'prose_before_standalone_link'),link=create(body,'unsupported_structured_block',[l.sourceLineId],'isolated_external_link_block'),right=create(body,'body',rows.slice(i+1).map(q=>q.sourceLineId),'prose_after_standalone_link');link.unsupportedKind='standalone_external_link';link.linkTarget=l.text.trim();
  page.objects.splice(page.objects.indexOf(body),1,left,link,right);operations.push({key,kind:'standalone_link_boundary',beforeObjectId:body.objectId,afterObjectIds:[left.objectId,link.objectId,right.objectId],sourceLineIds:[l.sourceLineId]});
 }
 // Same-flow explanatory continuation requires grammar/discourse evidence in
 // addition to lane, typography, rhythm and no independent math region.
 for(let round=0;round<4;round++){
  let joined=false;
  for(const left of [...page.objects].filter(o=>o.type==='body'&&o.memberCount>=2&&!o.internalVisualHints)){
   const ls=ordered(left),last=ls.at(-1),previous=ls.filter(l=>words(l.text)>=3),width=median(previous.map(l=>l.bbox.width));
   // Short paragraphs often have an indented first row and one full-width row;
   // the first-row indent is not the lane's continuation edge.
   const broad=previous.filter(l=>l.bbox.width>=width*.95),lane=Math.min(...(broad.length?broad:previous).map(l=>l.bbox.x));
   for(const right of [...page.objects].filter(o=>o!==left&&o.type==='body'&&o.memberCount>=2&&!o.internalVisualHints)){
    const rs=ordered(right),first=rs[0],a=metrics[last.sourceLineId],b=metrics[first.sourceLineId];if(!sameFont(a,b)||first.column!==last.column)continue;
    const step=first.bbox.y-last.bbox.y,h=median(previous.map(l=>l.bbox.height)),rhythm=median(previous.slice(1).map((l,i)=>l.bbox.y-previous[i].bbox.y).filter(d=>d>h*.6&&d<h*2));
    if(step<=2||step>Math.max(h,rhythm)*1.35||Math.abs(first.bbox.x-lane)>h*.25||b.top-a.bottom>h*.5||words(first.text)<4||ls.length+rs.length>20)continue;
    const continuation=!terminal(last.text)&&/^[a-z]/u.test(first.text.trim());
    const discourse=/^(?:Let\b|Using\b|This\b|These\b|Such\b|The\s+(?:inequality|bound|condition|expression|result|construction|argument)\b)/u.test(first.text.trim());
    if(!continuation&&!(terminal(last.text)&&last.bbox.width>width*.97&&discourse))continue;
    const region=union([...left.spatialFragments,...right.spatialFragments].map(f=>f.bbox));
    const conflict=page.objects.some(o=>o!==left&&o!==right&&o.spatialFragments.some(f=>intersect(region,f.bbox)>1&&(o.type!=='body'||f.bbox.y+f.bbox.height/2>=last.bbox.y&&f.bbox.y+f.bbox.height/2<=first.bbox.y)));if(conflict)continue;
    const hidden=[...ls,...rs].some(l=>l.bbox.x-lane>h*3&&l.bbox.width<width*.8&&/^[A-Za-zΑ-ω][\w_^{}(),\s]*[=≤≥<>]/u.test(l.text.trim())&&words(l.text)<=5);if(hidden){held.push({key,beforeObjectIds:[left.objectId,right.objectId],reason:'isolated_math_source_guard'});continue;}
    const merged=create(left,'body',[...left.sourceLineIds,...right.sourceLineIds],'same_flow_explanatory_continuation');merged.spatialFragments=[{bbox:region,sourceLineIds:[...merged.sourceLineIds]}];
    page.objects.splice(page.objects.indexOf(left),1,merged);page.objects.splice(page.objects.indexOf(right),1);operations.push({key,kind:'explanatory_body_continuation_joined',beforeObjectIds:[left.objectId,right.objectId],afterObjectId:merged.objectId,evidence:{step,rhythm,font:a.font,continuation,discourse,normalLane:true}});joined=true;break;
   }
   if(joined)break;
  }
  if(!joined)break;
 }
 const counts=new Map([...lines.keys()].map(id=>[id,0]));for(const o of [...page.objects,...page.referenceObjectRefs||[]])for(const id of o.sourceLineIds){assert(counts.has(id));counts.set(id,counts.get(id)+1);}for(const x of [...page.pendingMembership,...page.excludedSourceLines])counts.set(x.sourceLineId,counts.get(x.sourceLineId)+1);assert([...counts.values()].every(n=>n===1),key+': ownership');
 if(operations.some(o=>o.key===key)){const byType={};for(const o of [...page.objects,...page.referenceObjectRefs||[]])byType[o.type]=(byType[o.type]||0)+1;page.summary={...page.summary,byType,objects:page.objects.length+(page.referenceObjectRefs||[]).length};}
}
after.stage69={authority:'none',status:'offline_candidate_not_truth',operations,held};return after;
}
module.exports={build};
