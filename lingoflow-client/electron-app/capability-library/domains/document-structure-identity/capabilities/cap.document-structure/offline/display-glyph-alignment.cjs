"use strict";
const assert=require('node:assert/strict');
function build(inputs){
const candidate=structuredClone(inputs?.candidate);
const supports=inputs?.supports;
const byId=new Map(supports.matched.map(x=>[x.sourceLineId,x.box]));
const union=boxes=>{const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));return{x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,height:Math.max(...boxes.map(b=>b.y+b.height))-y};};
let refined=0;
for(const page of Object.values(candidate.pages))for(const object of page.objects){
 if(object.type!=='formula'||!object.objectId.startsWith('stage56:'))continue;
 const support=object.sourceLineIds.map(id=>byId.get(id));
 if(support.some(b=>!b))continue;
 object.spatialFragments=[{bbox:union(support),sourceLineIds:[...object.sourceLineIds]}];
 object.evidence=[...(object.evidence||[]),'original_pdf_glyph_visual_extent'];
 refined++;
}
candidate.stage56={...candidate.stage56,glyphAlignedFormulaObjects:refined,glyphHeld:supports.held};
return candidate;
}
module.exports={build};
