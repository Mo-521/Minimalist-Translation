#!/usr/bin/env python
"""Propose visible glyph extents for formula member source units, read-only PDFs."""
import json
import argparse
from collections import defaultdict
from pathlib import Path

import pdfplumber

parser = argparse.ArgumentParser(description="Extract formula glyph extents from the current PDF candidate")
parser.add_argument("--candidate", type=Path, required=True)
parser.add_argument("--source-inventory", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
candidate = json.loads(args.candidate.read_text(encoding="utf-8"))
inventory = json.loads(args.source_inventory.read_text(encoding="utf-8"))
papers = {p["paper"]: p for p in inventory["papers"]}
by_paper = defaultdict(lambda: defaultdict(dict))
owners = defaultdict(lambda: defaultdict(dict))
for key, page in candidate["pages"].items():
    lines = {line["sourceLineId"]: line for line in inventory["pages"][key]["sourceLines"]}
    for object_ in page["objects"]:
        if object_["type"] != "formula":
            continue
        for source_id in object_["sourceLineIds"]:
            by_paper[page["paper"]][page["pageNumber"]][source_id] = lines[source_id]
            owners[page["paper"]][page["pageNumber"]][source_id] = object_["objectId"]

matched = []
unmatched = []
for paper, pages in by_paper.items():
    with pdfplumber.open(papers[paper]["sourceFile"]) as pdf:
        for number, lines in pages.items():
            chars = pdf.pages[number - 1].chars
            for source_id, line in lines.items():
                box = line["bbox"]
                lower = box["y"] - box["height"] * 1.2
                upper = box["y"] + box["height"] * 1.1
                # Adjacent independent equations can occupy nearly identical
                # x ranges. The broad default window must not collect glyphs
                # from the next equation. Partition by the midpoint between
                # their frozen baselines; do not partition members of the same
                # formula Object (fractions may overlap vertically).
                for other_id, other in lines.items():
                    if other_id == source_id or owners[paper][number][other_id] == owners[paper][number][source_id]:
                        continue
                    peer = other["bbox"]
                    horizontal = max(0, min(box["x"] + box["width"], peer["x"] + peer["width"]) - max(box["x"], peer["x"]))
                    if horizontal < min(box["width"], peer["width"]) * 0.4 or abs(peer["y"] - box["y"]) > 32:
                        continue
                    boundary = (box["y"] + peer["y"]) / 2
                    if peer["y"] > box["y"]:
                        upper = min(upper, boundary)
                    else:
                        lower = max(lower, boundary)
                hits = [c for c in chars if c["x0"] >= box["x"] - 1.5
                        and c["x1"] <= box["x"] + box["width"] + 1.5
                        and lower <= (c["top"] + c["bottom"]) / 2 <= upper]
                if not hits or len(hits) > max(18, len(line["text"]) * 2.6):
                    unmatched.append({"page": f"{paper}:{number}", "sourceLineId": source_id,
                                      "reason": "no_unambiguous_glyph_extent"})
                    continue
                visual = {"x": min(c["x0"] for c in hits), "y": min(c["top"] for c in hits),
                          "width": max(c["x1"] for c in hits) - min(c["x0"] for c in hits),
                          "height": max(c["bottom"] for c in hits) - min(c["top"] for c in hits)}
                # A wildly larger glyph union signals another overlapping
                # text block. Keep the frozen box in that case.
                if visual["height"] > max(56, box["height"] * 3.2):
                    unmatched.append({"page": f"{paper}:{number}", "sourceLineId": source_id,
                                      "reason": "glyph_union_too_tall"})
                    continue
                matched.append({"page": f"{paper}:{number}", "sourceLineId": source_id,
                                "visualBox": visual, "glyphCount": len(hits),
                                "frozenBox": {"x": box["x"], "y": box["y"] - box["height"],
                                              "width": box["width"], "height": box["height"]}})

result = {"schemaVersion": "OfflineFormulaGlyphBoxEvidence/v1", "authority": "none",
          "status": "visual_evidence_not_membership_truth",
          "summary": {"formulaMemberUnits": sum(len(lines) for pages in by_paper.values() for lines in pages.values()),
                      "matched": len(matched), "unmatched": len(unmatched)},
          "matched": matched, "unmatched": unmatched}
args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result["summary"]))
