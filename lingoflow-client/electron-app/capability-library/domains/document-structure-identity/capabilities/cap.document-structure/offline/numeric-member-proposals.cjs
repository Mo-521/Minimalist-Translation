"use strict";
// Offline-only: nominate isolated numeric math fragments owned by prose.
function build(inputs){
const candidate=inputs?.candidate;
const source=inputs?.source;
const top=l=>({x:l.bbox.x,y:l.bbox.y-l.bbox.height,width:l.bbox.width,height:l.bbox.height});
const gap=(a,b)=>({x:Math.max(0,a.x-b.x-b.width,b.x-a.x-a.width),y:Math.max(0,a.y-b.y-b.height,b.y-a.y-a.height)});
const numericMath=t=>/^(?:[0-9]+\s*\/\s*[0-9]+|[0-9]+(?:[.][0-9]+)?|[A-Za-z][0-9]+)$/.test(t.trim());
const proposals=[],held=[];
for(const [key,page] of Object.entries(candidate.pages)){
 const byId=new Map(source.pages[key].sourceLines.map(l=>[l.sourceLineId,l]));
 const formulas=page.objects.filter(o=>o.type==='formula');
 for(const body of page.objects.filter(o=>o.type==='body')){
  const members=body.sourceLineIds.map(id=>byId.get(id)).sort((a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x);
  for(const line of [members[0],members.at(-1)]){
   if(!line||!numericMath(line.text)||line.bbox.width>35||line.bbox.height>14)continue;
   const box=top(line),hits=[];
   for(const formula of formulas)for(const fragment of formula.spatialFragments||[]){
    const d=gap(box,fragment.bbox),edge=Math.max(8,Math.min(16,fragment.bbox.height*.65));
    const sameBand=box.y<fragment.bbox.y+fragment.bbox.height+2&&box.y+box.height>fragment.bbox.y-2;
    if(sameBand&&d.x<=edge&&d.y<=2)hits.push({formula,fragment,d});
   }
   const unique=[...new Map(hits.map(h=>[h.formula.objectId,h])).values()];
   if(unique.length!==1){held.push({key,lineId:line.sourceLineId,text:line.text,reason:unique.length?'multiple_formula_hosts':'no_close_formula_host'});continue;}
   const host=unique[0];
   const proseSameBand=page.objects.filter(o=>o.type==='body'&&o!==body).some(o=>o.sourceLineIds.some(id=>{
    const p=top(byId.get(id));return p.width>50&&gap(p,box).y<3&&p.x<box.x+box.width&&p.x+p.width>box.x;
   }));
   if(proseSameBand){held.push({key,lineId:line.sourceLineId,text:line.text,reason:'same_band_prose'});continue;}
   proposals.push({key,lineId:line.sourceLineId,text:line.text,bodyId:body.objectId,formulaId:host.formula.objectId,
    spatialGap:+host.d.x.toFixed(2),bodyMemberCount:body.sourceLineIds.length});
  }
 }
}
const result={authority:'none',status:'proposal_not_truth',proposals,held};
return result;
}
module.exports={build};
