"""Read-only PDF-glyph triage of body/formula frame intersections, not a producer patch."""
import json
import argparse
import re
from pathlib import Path
import pdfplumber

parser = argparse.ArgumentParser()
parser.add_argument('--candidate', type=Path, required=True)
parser.add_argument('--source-inventory', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--min-overlap', type=float, default=.2)
parser.add_argument('--span-aware', action='store_true')
parser.add_argument('--changed-body-from', type=Path)
args = parser.parse_args()
candidate = json.loads(args.candidate.read_text(encoding="utf-8"))
source = json.loads(args.source_inventory.read_text(encoding="utf-8"))

def area(box):
    return box["width"] * box["height"]

def intersect(a, b):
    width = max(0, min(a["x"] + a["width"], b["x"] + b["width"]) - max(a["x"], b["x"]))
    height = max(0, min(a["y"] + a["height"], b["y"] + b["height"]) - max(a["y"], b["y"]))
    return width * height

def union(boxes):
    return {"x": min(b["x"] for b in boxes), "y": min(b["y"] for b in boxes),
            "width": max(b["x"] + b["width"] for b in boxes) - min(b["x"] for b in boxes),
            "height": max(b["y"] + b["height"] for b in boxes) - min(b["y"] for b in boxes)}

def glyph_support(obj, by_id, chars, prose=None, edge_math=False):
    native_indices, span_indices = set(), set()
    native_lines = 0
    per_line = []
    for line_id in obj["sourceLineIds"]:
        line = by_id[line_id]
        b = line["bbox"]
        tolerance = max(8, min(14, b["height"] * .55))
        is_span = args.span_aware and line.get('sourceSpanKind')
        selected = {i for i, c in enumerate(chars) if c["text"].strip()
                       and b["x"] - 1 <= (c["x0"] + c["x1"]) / 2 <= b["x"] + b["width"] + 1
                       and ((b['y'] - b['height'] - 1 <= (c['top'] + c['bottom']) / 2 <= b['y'] + 1)
                            if is_span
                            else abs((c["top"] + c["bottom"]) / 2 - b["y"]) <= tolerance)}
        if is_span:
            span_indices.update(selected)
        else:
            native_indices.update(selected)
            native_lines += 1
        per_line.append((line_id, b, selected))
    excluded = 0
    # A derived glyph-span rectangle can include nearby prose from an earlier
    # overly wide character window. Independently anchored native display rows
    # permit rejecting only those span glyphs owned by a separated prose region.
    if prose and native_lines >= 2 and native_indices and prose['box']:
        top = min(chars[i]['top'] for i in native_indices)
        bottom = max(chars[i]['bottom'] for i in native_indices)
        p = prose['box']
        if top - p['y'] - p['height'] > 2 or p['y'] - bottom > 2:
            excluded = len(span_indices & prose['indices'])
            span_indices -= prose['indices']
    indices = native_indices | span_indices
    edge_indices = set()
    if args.span_aware and edge_math and indices:
        for side in ('left', 'right'):
            total_width = 0
            for _ in range(3):
                x0 = min(chars[i]['x0'] for i in indices)
                x1 = max(chars[i]['x1'] for i in indices)
                top = min(chars[i]['top'] for i in indices)
                bottom = max(chars[i]['bottom'] for i in indices)
                options = []
                for i, c in enumerate(chars):
                    if i in indices or (prose and i in prose['indices']):
                        continue
                    known_delimiter = c['text'] in '()[]{}⟨⟩⌈⌉⌊⌋|'
                    mapped_math = re.fullmatch(r'\(cid:\d+\)', c['text']) and re.search(r'CMEX|CMSY|STIX|Symbol', c['fontname'])
                    if not (known_delimiter or mapped_math):
                        continue
                    gap = c['x0'] - x1 if side == 'right' else x0 - c['x1']
                    height = max(1, c['bottom'] - c['top'])
                    vertical = max(0, min(bottom, c['bottom']) - max(top, c['top'])) / min(bottom-top, height)
                    if -.1 <= gap <= max(1, c['size']*.2) and vertical >= .6 and total_width+c['x1']-c['x0'] <= c['size']*1.5:
                        options.append((gap, i))
                if not options:
                    break
                _, i = min(options)
                indices.add(i); edge_indices.add(i)
                total_width += chars[i]['x1'] - chars[i]['x0']
    if not indices:
        return {"glyphCount": 0, "box": None, "indices": indices, "excludedProseGlyphs": excluded}
    selected = [chars[i] for i in indices]
    line_support = []
    for line_id, b, candidate_indices in per_line:
        matched = candidate_indices & indices
        width = max(chars[i]['x1'] for i in matched) - min(chars[i]['x0'] for i in matched) if matched else 0
        line_support.append({'sourceLineId': line_id, 'glyphCount': len(matched),
                             'horizontalCoverage': round(width / max(1, b['width']), 3)})
    return {"glyphCount": len(indices),
            "box": {"x": min(c["x0"] for c in selected), "y": min(c["top"] for c in selected),
                    "width": max(c["x1"] for c in selected) - min(c["x0"] for c in selected),
                    "height": max(c["bottom"] for c in selected) - min(c["top"] for c in selected)},
            "indices": indices, "excludedProseGlyphs": excluded, "lineSupport": line_support,
            "edgeGlyphs": [{k: chars[i][k] for k in ('text', 'fontname', 'x0', 'x1', 'top', 'bottom')} for i in sorted(edge_indices)]}

if args.changed_body_from:
    previous = json.loads(args.changed_body_from.read_text(encoding='utf-8'))
    frames, held = [], []
    meta = {p['paper']: p for p in source['papers']}
    for key, page in candidate['pages'].items():
        old = {o['objectId']: o for o in previous['pages'][key]['objects']}
        changed = [o for o in page['objects'] if o['type'] == 'body' and o != old.get(o['objectId']) and not o.get('internalVisualHints')]
        if not changed:
            continue
        paper, number = map(int, key.split(':'))
        with pdfplumber.open(meta[paper]['sourceFile']) as pdf:
            chars = pdf.pages[number-1].chars
        lines = {l['sourceLineId']: l for l in source['pages'][key]['sourceLines']}
        for obj in changed:
            for index, fragment in enumerate(obj['spatialFragments']):
                support = glyph_support({'sourceLineIds': fragment['sourceLineIds']}, lines, chars)
                record = {'key': key, 'objectId': obj['objectId'], 'fragmentIndex': index,
                          'sourceLineIds': fragment['sourceLineIds'], 'glyphBox': support['box'],
                          'lineSupport': support.get('lineSupport', [])}
                (frames if support['box'] else held).append(record)
    output = Path(args.output); output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({'authority': 'none', 'frames': frames, 'held': held}, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'bodyFragmentSupports': len(frames), 'held': len(held)}))
    raise SystemExit(0)

hits = []
for key, page in candidate["pages"].items():
    bodies = [o for o in page["objects"] if o["type"] == "body"]
    formulas = [o for o in page["objects"] if o["type"] == "formula"]
    for body in bodies:
        for formula in formulas:
            ratio = max((intersect(bf["bbox"], ff["bbox"]) / min(area(bf["bbox"]), area(ff["bbox"]))
                         for bf in body["spatialFragments"] for ff in formula["spatialFragments"]), default=0)
            if ratio >= args.min_overlap:
                hits.append({"key": key, "bodyId": body["objectId"], "formulaId": formula["objectId"],
                             "candidateFrameOverlap": round(ratio, 3)})

by_key = {}
for hit in hits:
    by_key.setdefault(hit["key"], []).append(hit)
meta_by_paper = {p["paper"]: p for p in source["papers"]}
for key, page_hits in by_key.items():
    paper, number = map(int, key.split(":"))
    with pdfplumber.open(meta_by_paper[paper]["sourceFile"]) as pdf:
        chars = pdf.pages[number - 1].chars
    by_id = {line["sourceLineId"]: line for line in source["pages"][key]["sourceLines"]}
    objects = {o["objectId"]: o for o in candidate["pages"][key]["objects"]}
    for hit in page_hits:
        body = glyph_support(objects[hit["bodyId"]], by_id, chars)
        formula = glyph_support(objects[hit["formulaId"]], by_id, chars, body if args.span_aware else None, edge_math=True)
        shared = body["indices"] & formula["indices"]
        hit["bodyText"] = objects[hit["bodyId"]]["sourceText"][:150]
        hit["formulaText"] = objects[hit["formulaId"]]["sourceText"][:120]
        hit["bodyGlyphCount"] = body["glyphCount"]
        hit["formulaGlyphCount"] = formula["glyphCount"]
        hit["bodyLineSupport"] = body.get('lineSupport', [])
        hit["formulaLineSupport"] = formula.get('lineSupport', [])
        hit['bodyFragmentSupport'] = []
        for fragment in objects[hit['bodyId']]['spatialFragments']:
            support = glyph_support({'sourceLineIds': fragment['sourceLineIds']}, by_id, chars)
            hit['bodyFragmentSupport'].append({'sourceLineIds': fragment['sourceLineIds'],
                                               'glyphBox': support['box'],
                                               'lineSupport': support.get('lineSupport', [])})
        hit["sharedGlyphCount"] = len(shared)
        hit["excludedProseGlyphs"] = formula['excludedProseGlyphs']
        hit['visualEdgeGlyphs'] = formula.get('edgeGlyphs', [])
        hit["bodyGlyphBox"] = body["box"]
        hit["formulaGlyphBox"] = formula["box"]
        hit["glyphBoxOverlap"] = round(intersect(body["box"], formula["box"]) /
                                       min(area(body["box"]), area(formula["box"])), 3) if body["box"] and formula["box"] else None
        text_length = len(''.join(objects[hit["formulaId"]]["sourceText"].split()))
        hit["formulaGlyphToTextRatio"] = round(formula["glyphCount"] / text_length, 3) if text_length else None
        hit["triage"] = ("insufficient_glyph_support" if not body["box"] or not formula["box"]
                         else "possible_member_or_extraction_conflict" if shared
                         else "single_glyph_boundary_ambiguous" if formula["glyphCount"] < 8
                         else "partial_formula_glyph_support" if formula["glyphCount"] / max(1, text_length) < .85
                         else "frame_extent_candidate" if hit["glyphBoxOverlap"] == 0
                         else "distinct_glyphs_but_geometry_ambiguous")

result = {"authority": "none", "status": "diagnostic_not_truth", "matchingMode": "span_aware" if args.span_aware else "baseline_window", "summary": {
    "pages": len(candidate["pages"]), "visualOverlapSignals": len(hits),
    "frameExtentCandidates": sum(h["triage"] == "frame_extent_candidate" for h in hits),
    "sharedGlyphSupport": sum(h["triage"] == "possible_member_or_extraction_conflict" for h in hits),
    "insufficientGlyphSupport": sum(h["triage"] == "insufficient_glyph_support" for h in hits),
    "heldAmbiguous": sum(h["triage"] in {"single_glyph_boundary_ambiguous", "partial_formula_glyph_support", "distinct_glyphs_but_geometry_ambiguous"} for h in hits)}, "hits": hits}
output = Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result["summary"]))
