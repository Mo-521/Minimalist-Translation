"use strict";
function build(inputs){
const candidate=structuredClone(inputs?.candidate);
const support=inputs?.support;
const operations=[],held=[];
for(const frame of support.frames){
 if(!frame.lineSupport.length||frame.lineSupport.some(l=>!l.glyphCount||l.horizontalCoverage<.75)){held.push({...frame,reason:'incomplete_source_glyph_support'});continue;}
 const object=candidate.pages[frame.key].objects.find(o=>o.objectId===frame.objectId),fragment=object.spatialFragments[frame.fragmentIndex];
 const g=frame.glyphBox,old=structuredClone(fragment.bbox);
 fragment.bbox={x:g.x-1,y:g.y-1,width:g.width+2,height:g.height+2};
 operations.push({key:frame.key,objectId:frame.objectId,fragmentIndex:frame.fragmentIndex,oldBox:old,newBox:fragment.bbox});
}
candidate.stage66.frameAlignment={authority:'none',operations,held};
return candidate;
}
module.exports={build};
