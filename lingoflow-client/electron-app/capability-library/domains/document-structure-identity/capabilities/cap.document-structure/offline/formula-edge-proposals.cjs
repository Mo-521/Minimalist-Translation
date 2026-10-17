"use strict";
function build(inputs){
const candidate=inputs?.candidate;
const source=inputs?.source;
const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
const intersection=(a,b)=>overlap(a,b)*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
const area=b=>b.width*b.height;
const box=l=>({x:l.bbox.x,y:l.bbox.y-l.bbox.height,width:l.bbox.width,height:l.bbox.height});
const words=t=>t.match(/[A-Za-z]{3,}/g)||[];
const mathMarks=t=>(t.match(/[=<>≤≥≈≃≡∑∫√∞⊙^_+−±α-ω]/g)||[]).length;
function isMathOnly(line){
 const t=line.text.trim();
 if(!t||t.length>95||/^\d+[.)]\s+[A-Za-z]/.test(t)||/[.!?;:]\s*$/.test(t)||/\b(?:where|then|thus|since|therefore|which|this|that|when|because|we|is|are|for|from|and|or|with)\b/i.test(t))return false;
 if(words(t).length>4||words(t).length>2&&mathMarks(t)<3)return false;
 return mathMarks(t)>=1||/^[A-Za-z][A-Za-z0-9_]{0,11}$/.test(t);
}
const proposals=[];
for(const [key,page] of Object.entries(candidate.pages)){
 const lines=new Map(source.pages[key].sourceLines.map(l=>[l.sourceLineId,l]));
 const formulas=page.objects.filter(o=>o.type==='formula');
 for(const body of page.objects.filter(o=>o.type==='body')){
  const ordered=body.sourceLineIds.map(id=>lines.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x);
  for(const line of [ordered[0],ordered.at(-1)]){
   if(!line||!isMathOnly(line))continue;
   if(ordered.length>1){
    const other=line===ordered[0]?ordered[1]:ordered.at(-2);
    if(Math.abs(other.bbox.y-line.bbox.y)<line.bbox.height*1.5)continue;
   }
   const b=box(line);
   const hits=formulas.map(o=>({o,ratio:Math.max(...o.spatialFragments.map(f=>intersection(b,f.bbox)/Math.min(area(b),area(f.bbox)))),
    nearMath:Math.max(...o.spatialFragments.map(f=>{
     const q=f.bbox,gap=Math.max(0,q.y-b.y-b.height,b.y-q.y-q.height);
     return gap<=Math.max(10,line.bbox.height*.6)&&overlap(b,q)/Math.min(b.width,q.width)>.7&&mathMarks(line.text)>=2?1:0;
    })),
    nearest:Math.min(...o.sourceLineIds.map(id=>Math.abs(lines.get(id).bbox.y-line.bbox.y)))}))
    .filter(x=>(x.ratio>.15||x.nearMath)&&x.nearest<=Math.max(26,line.bbox.height*2.2))
    .sort((a,b)=>b.ratio-a.ratio||a.nearest-b.nearest);
   if(hits.length!==1)continue;
   const sameRowProse=page.objects.filter(o=>o!==body&&o.type==='body').some(o=>o.sourceLineIds.some(id=>{
    const l=lines.get(id),q=box(l);return Math.abs(l.bbox.y-line.bbox.y)<Math.min(l.bbox.height,line.bbox.height)*.5&&
      overlap(b,q)>Math.min(b.width,q.width)*.15&&words(l.text).length>=3;
   }));
   if(sameRowProse)continue;
   proposals.push({key,lineId:line.sourceLineId,lineText:line.text,oldBodyId:body.objectId,formulaId:hits[0].o.objectId,
    overlapRatio:+hits[0].ratio.toFixed(3),baselineDistance:+hits[0].nearest.toFixed(2),bodyMemberCount:body.sourceLineIds.length});
  }
 }
}
const unique=[...new Map(proposals.map(p=>[p.key+':'+p.lineId,p])).values()];
return {authority:'none',proposals:unique};
}
module.exports={build};
