"use strict";
// Offline display adapter. No source membership or Object type may change.
const assert=require("node:assert/strict");
function build(inputs){
const before=inputs?.before;
const glyph=inputs?.glyph;
const after=structuredClone(before),operations=[],held=[];
const area=b=>b.width*b.height;
function overlap(a,b){return Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y))/Math.min(area(a),area(b));}
const pad=b=>({x:b.x-1,y:b.y-1,width:b.width+2,height:b.height+2});
function supported(lines){return lines.length&&lines.every(l=>l.glyphCount>0&&l.horizontalCoverage>=.8);}
function local(old,next){return Math.abs(old.x-next.x)<=old.width*.05+2&&Math.abs(old.y-next.y)<=old.height*.6+2&&area(next)<=area(old)*1.25;}
const groups=new Map();for(const hit of glyph.hits){const id=hit.key+'|'+hit.formulaId;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(hit);}
for(const hits of groups.values()){
 const first=hits[0],page=after.pages[first.key],formula=page.objects.find(o=>o.objectId===first.formulaId);
 const reject=reason=>held.push({key:first.key,formulaId:first.formulaId,bodyIds:hits.map(h=>h.bodyId),reason});
 if(hits.some(h=>h.sharedGlyphCount||h.glyphBoxOverlap!==0)){reject('glyph_or_membership_conflict');continue;}
 if(formula.spatialFragments.length!==1||hits.some(h=>h.formulaGlyphCount<8||!supported(h.formulaLineSupport))){reject('incomplete_spatial_glyph_support');continue;}
 const nextFormula=pad(first.formulaGlyphBox),oldFormula=structuredClone(formula.spatialFragments[0].bbox);
 if(!local(oldFormula,nextFormula)){reject('large_frame_displacement');continue;}
 const changes=[{objectId:formula.objectId,fragmentIndex:0,oldBox:oldFormula,newBox:nextFormula}];
 let valid=true;
 for(const hit of hits){
  const body=page.objects.find(o=>o.objectId===hit.bodyId);
  for(let i=0;i<body.spatialFragments.length;i++){
   const fragment=body.spatialFragments[i];
   if(overlap(fragment.bbox,nextFormula)<=.01)continue;
   const evidence=hit.bodyFragmentSupport[i];
   if(!evidence?.glyphBox||!supported(evidence.lineSupport)){valid=false;break;}
   const next=pad(evidence.glyphBox);
   if(overlap(next,nextFormula)>.01||!local(fragment.bbox,next)){valid=false;break;}
   changes.push({objectId:body.objectId,fragmentIndex:i,oldBox:structuredClone(fragment.bbox),newBox:next});
  }
  if(!valid)break;
 }
 if(!valid){reject('body_fragment_boundary_ambiguous');continue;}
 const baseline=structuredClone(page.objects);
 for(const change of changes)page.objects.find(o=>o.objectId===change.objectId).spatialFragments[change.fragmentIndex].bbox=change.newBox;
 // An adjustment must not create a new significant overlap with any other type.
 for(const change of changes){
  const obj=page.objects.find(o=>o.objectId===change.objectId),previous=baseline.find(o=>o.objectId===change.objectId);
  for(const other of page.objects.filter(o=>o.objectId!==obj.objectId)){
   const oldOther=baseline.find(o=>o.objectId===other.objectId);
   const oldRatio=Math.max(...previous.spatialFragments.flatMap(a=>oldOther.spatialFragments.map(b=>overlap(a.bbox,b.bbox))));
   const newRatio=Math.max(...obj.spatialFragments.flatMap(a=>other.spatialFragments.map(b=>overlap(a.bbox,b.bbox))));
   if(newRatio>.05&&newRatio>oldRatio+.03){valid=false;break;}
  }
  if(!valid)break;
 }
 if(!valid){page.objects=baseline;reject('new_object_overlap');continue;}
 operations.push({key:first.key,formulaId:formula.objectId,bodyIds:hits.map(h=>h.bodyId),
  reason:'member_glyph_extent_with_source_span_coordinates',excludedProseGlyphs:first.excludedProseGlyphs,
  visualOnlyEdgeGlyphs:first.visualEdgeGlyphs,
  beforePairRatios:hits.map(h=>h.candidateFrameOverlap),changes,
  afterPairRatios:hits.map(h=>{const b=page.objects.find(o=>o.objectId===h.bodyId);return Math.max(...b.spatialFragments.map(f=>overlap(f.bbox,nextFormula)));})});
}
for(const [key,page] of Object.entries(after.pages)){
 const old=before.pages[key];assert.equal(page.objects.length,old.objects.length);
 for(let i=0;i<page.objects.length;i++){
  const a=structuredClone(page.objects[i]),b=structuredClone(old.objects[i]);
  for(const f of a.spatialFragments)delete f.bbox;for(const f of b.spatialFragments)delete f.bbox;
  assert.deepEqual(a,b,key+': semantic Object changed');
 }
}
after.stage65={authority:'none',status:'offline_candidate_not_truth',operations,held};
return after;
}
module.exports={build};
