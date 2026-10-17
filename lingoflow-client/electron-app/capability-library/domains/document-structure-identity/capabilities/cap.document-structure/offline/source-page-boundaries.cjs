#!/usr/bin/env node
"use strict";
// Offline page-boundary diagnostic. No previous Candidate or human frame is an input.
// Formula membership, figures/tables and references are deliberately deferred.
const crypto=require("node:crypto");
const tidy=s=>String(s||"").replace(/\s+/g," ").trim();
const words=s=>(tidy(s).match(/\b[A-Za-z]{2,}\b/g)||[]).length;
const terminal=s=>/[.!?。！？][\s"'”’)]*$/.test(tidy(s));
const listStart=s=>/^(?:[•●▪]|\[\d{1,3}\]|(?:\d+(?:\.\d+)*|[a-z])\s*[.)])\s+\S/i.test(tidy(s));
const equationLabel=s=>/^\(\d{1,3}(?:\.\d+)?[a-z]?\)$/.test(tidy(s));
const mathLike=s=>{
  const t=tidy(s),marks=(t.match(/[=≈≃≤≥⩽⩾∑∫√^_{}⟨⟩⊙∈∉⊂⊆∪∩∞α-ωΑ-Ωλ−±]/gu)||[]).length;
  // This pass is about prose boundaries, not formula recall. A prose line
  // containing inline math must not be cut merely because symbols occur.
  return marks>=2&&words(t)<=2;
};
const headingShape=s=>{
  const t=tidy(s);
  if(t.length<3||t.length>95||/[.!?。！？]$/.test(t)||words(t)>12||mathLike(t))return false;
  const barSection=/^(?:(?:\d+(?:\.\d+){0,3})\s*)?\|\s+[A-Z][A-Za-z\s:-]+$/.test(t)||
    /^\d+(?:\.\d+){0,3}\s+\|\s+[A-Z][A-Za-z\s:-]+$/.test(t);
  const conventionalSection=/^(?:abstract|references|acknowledg(?:e)?ments|conclusion|introduction)$/i.test(t);
  if(!barSection&&/[=≈≃≤≥⩽⩾∑∫√^_{}⟨⟩⊙∈∉⊂⊆∪∩∞α-ωΑ-Ωλ−±∂∥|]/u.test(t))return false;
  const numbered=/^\d+(?:\.\d+){0,3}\s*[.)]?\s+[A-Z][A-Za-z\s:-]+$/.test(t);
  const uppercase=words(t)>=1&&t.replace(/[^A-Za-z]/g,"")===t.replace(/[^A-Za-z]/g,"").toUpperCase();
  return numbered||uppercase||barSection||conventionalSection;
};
const captionStart=s=>/^(?:fig(?:ure)?\.?|table)\s*\d+[A-Za-z]?(?:[.:-](?:\s+\S.*)?|$)/i.test(tidy(s));
const median=values=>{if(!values.length)return 0;const sorted=values.slice().sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)]};
const top=l=>l.bbox.y-l.bbox.height;
const stableText=s=>tidy(s).replace(/\b\d+\b/g,"#").toLowerCase();
function repeatedFurnishings(pages){
  const map=new Map();
  for(const page of pages)for(const line of page.sourceLines){
    const edge=top(line)<page.pageSize.height*.085?"top":line.bbox.y>page.pageSize.height*.92?"bottom":null;
    if(!edge||words(line.text)<2)continue;
    const key=`${page.paper}:${edge}:${stableText(line.text)}`;
    if(!map.has(key))map.set(key,new Set());map.get(key).add(page.pageNumber);
  }
  return new Set([...map].filter(([,seen])=>seen.size>=2).map(([key])=>key));
}
function pageFurniture(line,page,repeated){
  const s=tidy(line.text),b=line.bbox,edge=top(line)<page.pageSize.height*.085?"top":b.y>page.pageSize.height*.92?"bottom":null;
  if(!edge)return null;
  if(/^\d{1,3}$/.test(s)&&Number(s)===page.pageNumber&&b.width<page.pageSize.width*.1)
    return {kind:"page_number",basis:["page_edge","pure_number","agrees_with_pdf_page_index"]};
  if(repeated.has(`${page.paper}:${edge}:${stableText(s)}`))
    return {kind:edge==="top"?"running_header":"running_footer",basis:["page_edge","recurs_on_distinct_pages"]};
  return null;
}
function captionOrHeading(line,prev,page,step){
  const s=tidy(line.text);
  if(captionStart(s))return {kind:"caption_start_candidate",basis:["numbered_caption_prefix"],confidence:"medium"};
  if(!headingShape(s))return null;
  const gap=prev?top(line)-prev.bbox.y:Infinity;
  const isolated=gap>Math.max(2.5,step*.28);
  const narrow=line.bbox.width<page.pageSize.width*.74;
  if(!isolated||!narrow)return null;
  return {kind:"heading_candidate",basis:["short_heading_shape","preceding_vertical_separation","bounded_line_width"],confidence:"medium"};
}
function gapDecision(a,b,step){
  if(a.column!==b.column)return {split:true,reason:"column_transition"};
  const gap=top(b)-a.bbox.y,dy=b.bbox.y-a.bbox.y,shift=b.bbox.x-a.bbox.x;
  if(dy<step*.32)return {split:false,reason:"same_visual_row_fragment"};
  if(gap>Math.max(16,step*1.35))return {split:true,reason:"large_vertical_gap"};
  if(listStart(b.text)&&gap>0)return {split:true,reason:"list_item_start"};
  if(/^\d{1,3}\s+[A-Z]/.test(tidy(b.text))&&b.bbox.x<a.bbox.x-Math.max(4,step*.35)&&gap>0)
    return {split:true,reason:"numbered_note_plus_hanging_indent"};
  const sentenceStart=/^["'“‘(]?[A-Z]/.test(tidy(b.text));
  if(terminal(a.text)&&sentenceStart&&(gap>Math.max(2,step*.25)||shift>Math.max(7,step*.6)))
    return {split:true,reason:"sentence_terminal_plus_spacing_or_indent"};
  if(gap>Math.max(4,step*.44)&&shift>Math.max(8,step*.75)&&sentenceStart)
    return {split:true,reason:"gap_plus_indent_plus_sentence_start"};
  return {split:false,reason:"same_lane_reading_flow_continuity"};
}
function auditPage(page,repeated,referenceCarryover=false){
  const lanes=[...new Set(page.sourceLines.map(l=>l.column))],excluded=[],reserved=[],blocks=[],unresolved=[],pendingGroups=[];
  const memberships=new Map();
  const abstractAnchor=page.pageNumber===1?page.sourceLines.filter(l=>/^abstract(?:\s*$|\s*[—:-])/i.test(tidy(l.text)))
    .sort((a,b)=>a.bbox.y-b.bbox.y)[0]:null;
  const firstY=Math.min(...page.sourceLines.map(l=>l.bbox.y));
  const unlabelledAbstractStart=page.pageNumber===1&&!abstractAnchor?page.sourceLines
    .filter(l=>l.bbox.y>firstY+45&&l.bbox.y<page.pageSize.height*.5&&words(l.text)>=8&&l.bbox.width>page.pageSize.width*.45)
    .sort((a,b)=>a.bbox.y-b.bbox.y)[0]?.bbox.y:null;
  const abstractStart=abstractAnchor?.bbox.y??unlabelledAbstractStart;
  for(const lane of lanes){
    const lines=page.sourceLines.filter(l=>l.column===lane&&l.coverageClass==="reviewable_content")
      .sort((a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x);
    const diffs=lines.slice(1).map((l,i)=>l.bbox.y-lines[i].bbox.y).filter(d=>d>2&&d<28),step=median(diffs)||median(lines.map(l=>l.bbox.height))||10;
    const referenceHeading=lines.find(l=>/^references(?:\s|$)/i.test(tidy(l.text)));
    const numberedRefs=lines.filter(l=>/^\[\d{1,3}\]\s+\S/.test(tidy(l.text)));
    const doiLines=lines.filter(l=>/\bdoi\s*:\s*10\.|doi\.org\/10\./i.test(l.text));
    const unnumberedReferenceContinuation=doiLines.length>=4&&lines.length>=16;
    const referenceReset=lines.find(l=>/^(?:supplementary(?:\s+material)?|appendix|appendices)\b/i.test(tidy(l.text)))?.bbox.y??Infinity;
    const uiCue=l=>/^\[\d+\]\s*(?:link|listitem|button|textbox|img|generic|heading)\b|\burl\s*=|https?:\/\//i.test(tidy(l.text));
    const uiDump=lines.filter(uiCue).length>=3;
    const uiStart=uiDump?lines.find(l=>/^\[\d+\]\s*(?:link|listitem|button|textbox|img|generic|heading)\b/i.test(tidy(l.text)))?.bbox.y??
      lines.find(uiCue)?.bbox.y:null;
    const bibliography=lines.filter(l=>/\b(?:19|20)\d{2}\b|\bdoi\s*:\s*10\.|\barxiv\s*:/i.test(l.text)).length>=2;
    const numberedReferenceEvidence=numberedRefs.length>=2&&bibliography&&!uiDump;
    const referenceStart=referenceHeading?.bbox.y??(referenceReset===Infinity&&numberedReferenceEvidence?numberedRefs[0].bbox.y:
      referenceReset===Infinity&&(unnumberedReferenceContinuation||referenceCarryover)?lines[0]?.bbox.y:null);
    let current=[];const flush=reason=>{if(!current.length)return;
      const ids=current.map(l=>l.sourceLineId),text=current.map(l=>tidy(l.text)).join(" "),
        averageWords=current.reduce((n,l)=>n+words(l.text),0)/current.length,
        numericLines=current.filter(l=>/[0-9=≈∑∫]/.test(l.text)).length,
        tableLike=current.length>=10&&averageWords<=3.5&&numericLines/current.length>=.6;
      if(tableLike){const groupId=`${page.paper}:${page.pageNumber}:table-pending:${pendingGroups.length+1}`;
        pendingGroups.push({groupId,kind:"table_region_pending",sourceLineIds:ids,basis:["multiple_sparse_rows","numeric_cell_density"],
          note:"not accepted table truth; caption and cell graph not inferred"});
        for(const line of current){reserved.push({sourceLineId:line.sourceLineId,text:line.text,kind:"table_region_pending",groupId,
          basis:["multiple_sparse_rows","numeric_cell_density"]});memberships.set(line.sourceLineId,(memberships.get(line.sourceLineId)||0)+1)}
        current=[];return}
      const kind=words(text)>=3?"body_boundary_candidate":"unresolved_membership";
      const unit={id:`${page.paper}:${page.pageNumber}:block:${blocks.length+1}`,kind,column:lane,sourceLineIds:ids,
        firstLine:tidy(current[0].text),lastLine:tidy(current.at(-1).text),lineCount:ids.length,breakReason:reason};
      if(kind==="body_boundary_candidate")blocks.push(unit);else unresolved.push(unit);
      for(const id of ids)memberships.set(id,(memberships.get(id)||0)+1);current=[]};
    for(let i=0;i<lines.length;i++){
      const line=lines[i],furniture=pageFurniture(line,page,repeated);
      if(furniture){flush("page_furniture_boundary");excluded.push({sourceLineId:line.sourceLineId,text:line.text,...furniture});memberships.set(line.sourceLineId,1);continue}
      if(uiStart!==null&&line.bbox.y>=uiStart){
        flush("structured_block_boundary");reserved.push({sourceLineId:line.sourceLineId,text:line.text,
          kind:"unsupported_structured_block_pending",basis:["repeated_ui_element_or_url_lines_in_lane"]});
        memberships.set(line.sourceLineId,1);continue;
      }
      if(abstractStart!==null&&line.bbox.y<abstractStart){
        flush("front_matter_boundary");reserved.push({sourceLineId:line.sourceLineId,text:line.text,kind:"front_matter_pending",
          basis:["first_page","precedes_abstract_anchor"],note:"title_author_affiliation_or_publication_furniture_not_yet_disambiguated"});
        memberships.set(line.sourceLineId,1);continue;
      }
      if(referenceStart!==null&&line.bbox.y>=referenceStart&&line.bbox.y<referenceReset){
        flush("reference_region_boundary");reserved.push({sourceLineId:line.sourceLineId,text:line.text,kind:"reference_region_pending",
          basis:[referenceHeading?"reference_heading_in_lane":numberedRefs.length>=2?"multiple_numbered_entries_in_lane":
            unnumberedReferenceContinuation?"repeated_doi_lines_in_lane":"reference_section_continues_from_previous_page"]});
        memberships.set(line.sourceLineId,1);continue;
      }
      // Existing source-only formula proposals are not used as truth here. Math-like
      // lines are only a pending boundary, protecting prose from forced absorption.
      if(equationLabel(line.text)||mathLike(line.text)){
        flush("math_pending_boundary");reserved.push({sourceLineId:line.sourceLineId,text:line.text,kind:"math_or_equation_label_pending",basis:["non_prose_math_shape"]});
        memberships.set(line.sourceLineId,1);continue;
      }
      const prior=current.at(-1)||lines.slice(0,i).reverse().find(l=>!pageFurniture(l,page,repeated));
      const semantic=captionOrHeading(line,prior,page,step);
      if(semantic){flush("strong_semantic_boundary");reserved.push({sourceLineId:line.sourceLineId,text:line.text,...semantic});memberships.set(line.sourceLineId,1);continue}
      if(current.length){const decision=gapDecision(current.at(-1),line,step);if(decision.split)flush(decision.reason)}
      current.push(line);
    }
    flush("lane_end");
  }
  for(const line of page.sourceLines.filter(l=>l.coverageClass!=="reviewable_content"))
    excluded.push({sourceLineId:line.sourceLineId,text:line.text,kind:"upstream_excluded",basis:[line.coverageClass]});
  const lineById=new Map(page.sourceLines.map(l=>[l.sourceLineId,l]));
  const tableCaptions=page.sourceLines.filter(l=>/^table\s*\d+[A-Za-z]?[.:-]\s+/i.test(tidy(l.text)))
    .sort((a,b)=>a.bbox.y-b.bbox.y);
  for(const group of pendingGroups){
    const ys=group.sourceLineIds.map(id=>lineById.get(id).bbox.y),firstY=Math.min(...ys),lastY=Math.max(...ys);
    const prior=tableCaptions.filter(l=>l.bbox.y<=firstY).at(-1);
    if(prior&&firstY-prior.bbox.y<page.pageSize.height*.5){
      group.relatedCaptionSourceLineId=prior.sourceLineId;
      group.tableClusterHint=`${page.paper}:${page.pageNumber}:table-after:${prior.sourceLineId}`;
      group.riskFlags=firstY-prior.bbox.y<Math.max(18,prior.bbox.height*2)?["caption_continuation_may_be_inside_sparse_rows"]:[];
    }else group.riskFlags=["table_region_without_caption_anchor"];
    group.extentY={first:firstY,last:lastY};
  }
  const reviewable=page.sourceLines.filter(l=>l.coverageClass==="reviewable_content"),lost=reviewable.filter(l=>!memberships.has(l.sourceLineId)).map(l=>l.sourceLineId),
    duplicates=[...memberships].filter(([,count])=>count>1).map(([id])=>id);
  if(lost.length||duplicates.length)throw Error(`Source ownership invariant ${page.paper}:${page.pageNumber}: lost ${lost.length}, duplicate ${duplicates.length}`);
  return {paper:page.paper,pageNumber:page.pageNumber,sourceLineCount:page.sourceLines.length,reviewableLineCount:reviewable.length,
    bodyBoundaryCandidates:blocks,reservedSemanticLines:reserved,pendingSemanticGroups:pendingGroups,
    unresolvedMembership:unresolved,excludedSourceLines:excluded,
    summary:{bodyBlocks:blocks.length,shortUnresolved:unresolved.length,reserved:reserved.length,excluded:excluded.length,
      longBodyBlocks:blocks.filter(b=>b.lineCount>=20).length,maxBodyLines:Math.max(0,...blocks.map(b=>b.lineCount)),lost:lost.length,duplicates:duplicates.length}};
}
function build(input,inputSha256){if(!input?.pages||typeof inputSha256!=="string")throw Error("Source pages and input hash required");
  const pages=Object.values(input.pages),repeated=repeatedFurnishings(pages),out={schemaVersion:"OfflinePageSemanticBoundaryDiagnostic/v1",
  authority:"none",status:"machine_boundaries_not_review_ready",inputSha256,
  producerInputRule:"frozen_source_lines_only_no_old_object_labels",caution:"Boundaries and provisional types are not accepted human truth",pages:{}};
  const referenceHeadingPages=new Map();
  for(const page of pages)if(page.sourceLines.some(l=>/^references(?:\s|$)/i.test(tidy(l.text)))){
    if(!referenceHeadingPages.has(page.paper))referenceHeadingPages.set(page.paper,[]);
    referenceHeadingPages.get(page.paper).push(page.pageNumber);
  }
  for(const page of pages){const prior=(referenceHeadingPages.get(page.paper)||[]).filter(n=>n<page.pageNumber).at(-1),
      intervening=pages.filter(p=>p.paper===page.paper&&p.pageNumber>prior&&p.pageNumber<=page.pageNumber),
      reset=intervening.some(p=>p.sourceLines.some(l=>/^(?:supplementary(?:\s+material)?|appendix|appendices)\b/i.test(tidy(l.text))));
    out.pages[`${page.paper}:${page.pageNumber}`]=auditPage(page,repeated,prior!==undefined&&!reset);
  }
  out.summary=Object.values(out.pages).reduce((sum,page)=>{for(const [key,value] of Object.entries(page.summary))
    sum[key]=key==="maxBodyLines"?Math.max(sum[key]||0,value):(sum[key]||0)+value;return sum},{pages:pages.length});
  return out}
module.exports={pageFurniture,captionOrHeading,gapDecision,auditPage,build};
