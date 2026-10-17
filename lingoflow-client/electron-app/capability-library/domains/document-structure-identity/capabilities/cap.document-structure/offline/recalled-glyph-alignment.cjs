"use strict";
const crypto=require('node:crypto');
function build(inputs){
const candidate=structuredClone(inputs?.candidate);
const source=inputs?.source;
const supports=inputs?.supports;
const byId=new Map(supports.matched.map(x=>[x.sourceLineId,x.box]));
const union=bs=>{const x=Math.min(...bs.map(b=>b.x)),y=Math.min(...bs.map(b=>b.y));return{x,y,width:Math.max(...bs.map(b=>b.x+b.width))-x,height:Math.max(...bs.map(b=>b.y+b.height))-y};};
let refined=0,headingsRecovered=0;
const outline=s=>s.match(/^([A-Z]|\d+)(?:\.\d+){1,3}\s+\S/);
const headingEvidence=[];
for(const [key,page] of Object.entries(candidate.pages))for(const o of page.objects.filter(o=>o.type==='heading'&&o.sourceLineIds.length===1)){
 const line=source.pages[key].sourceLines.find(l=>l.sourceLineId===o.sourceLineIds[0]);if(line&&outline(line.text))headingEvidence.push({paper:page.paper,line});
}
for(const [key,page] of Object.entries(candidate.pages)){
 const lines=new Map(source.pages[key].sourceLines.map(l=>[l.sourceLineId,l]));
 for(const o of page.objects.filter(o=>o.type==='unsupported_structured_block'&&o.sourceLineIds.length===1)){
  const line=lines.get(o.sourceLineIds[0]),m=line&&outline(line.text);if(!m)continue;
  const peers=headingEvidence.filter(h=>h.paper===page.paper&&outline(h.line.text)?.[1]===m[1]&&
   Math.abs(h.line.bbox.height-line.bbox.height)<1.2);
  if(peers.length<2)continue;
  o.sourceCandidateIds=[...(o.sourceCandidateIds||[]),o.objectId];o.objectId='stage53:'+crypto.createHash('sha256').update(JSON.stringify([key,o.sourceLineIds,'outline_heading_peer_recovery'])).digest('hex').slice(0,24);
  o.type='heading';o.evidence=[...(o.evidence||[]),'document_outline_sibling_typography'];headingsRecovered++;
 }
 for(const o of page.objects.filter(o=>o.type==='formula'&&o.sourceLineIds.some(id=>byId.has(id)))){
  const boxes=o.sourceLineIds.map(id=>byId.get(id)||{...lines.get(id).bbox,y:lines.get(id).bbox.y-lines.get(id).bbox.height});
  o.spatialFragments=[{bbox:union(boxes),sourceLineIds:[...o.sourceLineIds]}];
  o.evidence=[...(o.evidence||[]),'original_pdf_glyph_extent_for_recalled_display'];refined++;
 }
}
for(const page of Object.values(candidate.pages)){
 const byType={};for(const o of [...page.objects,...page.referenceObjectRefs||[]])byType[o.type]=(byType[o.type]||0)+1;
 page.summary={...page.summary,byType};
}
candidate.stage53={authority:'none',status:'offline_candidate_not_truth',refinedFormulaObjects:refined,headingsRecovered,held:supports.held};
return candidate;
}
module.exports={build};
