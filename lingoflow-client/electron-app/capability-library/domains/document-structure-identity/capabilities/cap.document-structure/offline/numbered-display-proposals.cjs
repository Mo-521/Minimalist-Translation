"use strict";
function build(inputs){
const candidate=inputs?.candidate;
const source=inputs?.source;
const median=xs=>{const a=[...xs].sort((x,y)=>x-y);return a[Math.floor(a.length/2)]||0;};
const intersects=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
const box=l=>({x:l.bbox.x,y:l.bbox.y-l.bbox.height,width:l.bbox.width,height:l.bbox.height});
const math=t=>/[=<>≤≥≈≃≡≲≳∑∫√]/.test(t)&&
  (t.match(/[A-Za-z]{3,}/g)||[]).length<=2&&
  !/\b(?:where|which|then|thus|the|this|and|for|with|from|since)\b/i.test(t);
const proposals=[],held=[];
for(const [key,page] of Object.entries(candidate.pages)){
 const lines=new Map(source.pages[key].sourceLines.map(l=>[l.sourceLineId,l]));
 const pending=page.pendingMembership.filter(p=>/^\(\d{1,3}(?:\.\d+)?[a-z]?\)$/.test(p.text.trim()));
 for(const item of pending){
  const label=lines.get(item.sourceLineId);
  const candidates=[];
  for(const body of page.objects.filter(o=>o.type==='body')){
   const members=body.sourceLineIds.map(id=>lines.get(id));
   const columns=[...new Set(members.map(l=>l.column))];
   for(const column of columns){
    const prose=page.objects.filter(o=>o.type==='body').flatMap(o=>o.sourceLineIds.map(id=>lines.get(id)))
     .filter(l=>l.column===column&&l.bbox.width>90&&(l.text.match(/[A-Za-z]{3,}/g)||[]).length>=3);
    if(prose.length<3)continue;
    const left=median(prose.map(l=>l.bbox.x)),width=median(prose.map(l=>l.bbox.width));
    if(label.bbox.x<left+width*.86||label.bbox.x>left+width+width*.15)continue;
    for(const line of members.filter(l=>l.column===column&&math(l.text))){
     const b=line.bbox,n=label.bbox;
     if(Math.abs(b.y-n.y)>Math.max(3,b.height*.45)||b.x+b.width>n.x-4||n.x-b.x-b.width>width*.4)continue;
     if(b.width>width*.67||Math.abs(b.x+b.width/2-(left+width/2))>width*.22)continue;
     const blockers=page.objects.filter(o=>['figure','table','unsupported_structured_block'].includes(o.type))
      .some(o=>o.spatialFragments.some(f=>intersects(f.bbox,box(line))>b.width*b.height*.15));
     if(blockers)continue;
     const sameRowProse=page.objects.filter(o=>o.type==='body'&&o!==body).some(o=>o.sourceLineIds.some(id=>{
      const l=lines.get(id);return l.column===column&&Math.abs(l.bbox.y-b.y)<Math.min(l.bbox.height,b.height)*.5&&
       l.bbox.x<left+width&&l.bbox.x+l.bbox.width>left&&(l.text.match(/[A-Za-z]{3,}/g)||[]).length>=3;
     }));
     if(sameRowProse)continue;
     candidates.push({body,line,column,left,width});
    }
   }
  }
  const unique=[...new Map(candidates.map(c=>[c.line.sourceLineId,c])).values()];
  if(unique.length!==1){held.push({key,labelId:label.sourceLineId,labelText:label.text,reason:unique.length?'ambiguous_math_hosts':'no_supported_display_row'});continue;}
  const {body,line,column}=unique[0];
  proposals.push({key,labelId:label.sourceLineId,labelText:label.text,mathLineId:line.sourceLineId,mathText:line.text,
   bodyId:body.objectId,column,sourceLaneConflict:label.column!==column});
 }
}
return {authority:'none',proposals,held};
}
module.exports={build};
