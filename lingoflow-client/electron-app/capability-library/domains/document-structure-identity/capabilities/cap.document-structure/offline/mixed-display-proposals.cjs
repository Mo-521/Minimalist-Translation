"use strict";
// Offline proposal only. A short natural-language connector inside a displayed
// math row is not by itself a prose bridge or a reason to leave the row pending.
function build(inputs){
const candidate=inputs?.candidate;
const source=inputs?.source;
const median=xs=>{const a=[...xs].sort((x,y)=>x-y);return a[Math.floor(a.length/2)]||0;};
const top=l=>({x:l.bbox.x,y:l.bbox.y-l.bbox.height,width:l.bbox.width,height:l.bbox.height});
const intersection=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*
 Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
const relation=t=>(t.match(/[=<>≤≥≈≃≡≲≳∼]/g)||[]).length;
const words=t=>t.match(/[A-Za-z]{3,}/g)||[];
const proseOpening=t=>/^(?:where|and|but|which|therefore|hence|since|because|thus|then|we|the|this|that|define|let|with|for)\b/i.test(t.trim());
const proseEnding=t=>/\b(?:define|let|where|therefore|because|since|then|hence)\s*$/i.test(t.trim());
const proposals=[],held=[];
for(const [key,page] of Object.entries(candidate.pages)){
 const sourcePage=source.pages[key],byId=new Map(sourcePage.sourceLines.map(l=>[l.sourceLineId,l]));
 const prose=page.objects.filter(o=>o.type==='body').flatMap(o=>o.sourceLineIds.map(id=>byId.get(id)))
  .filter(l=>l&&l.bbox.width>sourcePage.pageSize.width*.48&&words(l.text).length>=4);
 const bodyWidth=median(prose.map(l=>l.bbox.width));
 for(const item of page.pendingMembership){
  const line=byId.get(item.sourceLineId);if(!line)continue;
  const text=line.text.trim(),reason=[];
  if(relation(text)<2||words(text).length>4||proseOpening(text)||proseEnding(text))continue;
  if(!/^[A-Za-zΑ-Ωα-ω][^.!?;:]*[=<>≤≥≈≃≡≲≳∼]/.test(text))continue;
  if(!bodyWidth||line.bbox.width>bodyWidth*.82)reason.push('not_narrower_than_prose');
  const pageCenter=sourcePage.pageSize.width/2,lineCenter=line.bbox.x+line.bbox.width/2;
  if(Math.abs(lineCenter-pageCenter)>sourcePage.pageSize.width*.12)reason.push('not_centered');
  const b=top(line),sameRowProse=prose.some(p=>{
   const q=top(p);return intersection(b,q)>b.width*b.height*.1;
  });
  if(sameRowProse)reason.push('same_row_prose');
  const blockers=page.objects.filter(o=>['figure','table','caption','unsupported_structured_block','reference'].includes(o.type))
   .some(o=>(o.spatialFragments||[]).some(f=>intersection(b,f.bbox)>b.width*b.height*.1));
  if(blockers)reason.push('protected_region');
  const nearbyProse=prose.filter(p=>p.bbox.y<line.bbox.y).sort((a,b)=>b.bbox.y-a.bbox.y)[0];
  if(!nearbyProse||line.bbox.y-nearbyProse.bbox.y<Math.max(10,nearbyProse.bbox.height*1.3))reason.push('no_display_break_above');
  const evidence={key,lineId:line.sourceLineId,text,relations:relation(text),longWords:words(text).length,
   lineWidth:line.bbox.width,localProseWidth:bodyWidth,centerOffset:+(lineCenter-pageCenter).toFixed(2),
   previousProseGap:nearbyProse?+(line.bbox.y-nearbyProse.bbox.y).toFixed(2):null};
  if(reason.length)held.push({...evidence,reasons:reason});else proposals.push(evidence);
 }
}
return {authority:'none',proposals,held};
}
module.exports={build};
