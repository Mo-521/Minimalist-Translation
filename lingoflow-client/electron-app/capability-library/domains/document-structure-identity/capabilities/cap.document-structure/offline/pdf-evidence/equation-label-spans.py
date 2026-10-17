#!/usr/bin/env python
"""Read-only PDF character audit for equation labels sharing a formula line.

Produces explicit-input proposals. No PDF is modified and no reviewer box is used.
"""
import json
import re
import argparse
from collections import defaultdict
from pathlib import Path

import pdfplumber

parser = argparse.ArgumentParser(description="Extract equation-label character spans from the current PDF candidate")
parser.add_argument("--candidate", type=Path, required=True)
parser.add_argument("--source-inventory", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
candidate = json.loads(args.candidate.read_text(encoding="utf-8"))
frozen = json.loads(args.source_inventory.read_text(encoding="utf-8"))
papers = {p["paper"]: p for p in frozen["papers"]}
pattern = re.compile(r"(\(\d{1,3}(?:\.\d+)?[a-z]?\))$")
prefix_pattern = re.compile(r"^(\(\d{1,3}(?:\.\d+)?[a-z]?\))")
output = []
unmatched = []
by_paper = defaultdict(list)
for key, page in candidate["pages"].items():
    lines = {line["sourceLineId"]: line for line in frozen["pages"][key]["sourceLines"]}
    for evidence in page.get("mixedLineEquationNumberEvidence", []):
        by_paper[page["paper"]].append((key, page["pageNumber"], lines[evidence["sourceLineId"]], "suffix"))
    formula_ids = {source_id for obj in page["objects"] if obj["type"] == "formula"
                   for source_id in obj["sourceLineIds"]}
    for source_id in formula_ids:
        line = lines[source_id]
        match = prefix_pattern.match(line["text"].strip())
        rest = line["text"].strip()[match.end():] if match else ""
        if match and len(rest) >= 3 and re.search(r"[=<>≤≥≈∑∫√+−-]", rest):
            by_paper[page["paper"]].append((key, page["pageNumber"], line, "prefix"))

for paper, items in by_paper.items():
    with pdfplumber.open(papers[paper]["sourceFile"]) as pdf:
        page_cache = {}
        for key, page_number, line, placement in items:
            if page_number not in page_cache:
                page_cache[page_number] = pdf.pages[page_number - 1].chars
            chars = page_cache[page_number]
            match = (prefix_pattern.match(line["text"].strip()) if placement == "prefix"
                     else pattern.search(line["text"].strip()))
            if not match:
                continue
            label = match.group(1)
            box = line["bbox"]
            right = box["x"] + box["width"]
            candidates = []
            for first in chars:
                if first["text"] != "(" or (placement == "suffix" and first["x0"] < box["x"] + box["width"] * 0.55) or (placement == "prefix" and abs(first["x0"]-box["x"]) > 5):
                    continue
                row = [c for c in chars if abs(c["top"] - first["top"]) < 2.5
                       and c["x0"] >= first["x0"] - 0.2 and c["x1"] <= right + 4]
                row.sort(key=lambda c: c["x0"])
                selected = []
                for char in row:
                    if not selected and char is not first:
                        continue
                    if selected and char["x0"] - selected[-1]["x1"] > 2.5:
                        break
                    selected.append(char)
                    text = "".join(c["text"] for c in selected)
                    if text == label:
                        break
                    if not label.startswith(text):
                        break
                if "".join(c["text"] for c in selected) != label:
                    continue
                label_box = {
                    "x": min(c["x0"] for c in selected),
                    "y": min(c["top"] for c in selected),
                    "width": max(c["x1"] for c in selected) - min(c["x0"] for c in selected),
                    "height": max(c["bottom"] for c in selected) - min(c["top"] for c in selected),
                }
                right_error = (abs(label_box["x"] - box["x"]) if placement == "prefix"
                               else abs(label_box["x"] + label_box["width"] - right))
                vertical_error = abs((label_box["y"] + label_box["height"] / 2) - box["y"])
                if right_error <= 4 and vertical_error <= max(15, box["height"] * 1.4):
                    candidates.append((right_error + vertical_error * 0.15, label_box))
            candidates.sort(key=lambda item: item[0])
            if not candidates or (len(candidates) > 1 and candidates[1][0] - candidates[0][0] < 1):
                unmatched.append({"page": key, "sourceLineId": line["sourceLineId"],
                                  "text": line["text"], "reason": "no_unique_pdf_character_label_match"})
                continue
            label_box = candidates[0][1]
            formula_text = (line["text"].strip()[match.end():].strip() if placement == "prefix"
                            else line["text"].strip()[: match.start()].rstrip())
            if not formula_text:
                unmatched.append({"page": key, "sourceLineId": line["sourceLineId"],
                                  "text": line["text"], "reason": "empty_formula_span"})
                continue
            # The source line's visual box is kept as immutable evidence. The
            # proposed formula box excludes the independently located label.
            formula_x = (label_box["x"] + label_box["width"] + 2 if placement == "prefix" else box["x"])
            formula_right = (right if placement == "prefix" else label_box["x"] - 2)
            formula_box = {"x": formula_x, "y": box["y"] - box["height"],
                           "width": max(1, formula_right - formula_x), "height": box["height"]}
            output.append({"page": key, "paper": paper, "pageNumber": page_number,
                           "parentSourceLineId": line["sourceLineId"], "parentText": line["text"],
                           "formulaText": formula_text, "labelText": label,
                           "formulaTextSpan": ([match.end(), len(line["text"].strip())] if placement == "prefix" else [0, match.start()]),
                           "labelTextSpan": ([0, match.end()] if placement == "prefix" else [match.start(), len(line["text"].strip())]),
                           "formulaBox": formula_box, "labelBox": label_box,
                           "placement": placement,
                           "evidence": "unique_pdf_character_sequence_at_frozen_line_edge"})

result = {"schemaVersion": "OfflineEquationLabelSpanEvidence/v1", "authority": "none",
          "status": "machine_span_proposals_not_truth",
          "summary": {"mixedLineCandidates": sum(len(v) for v in by_paper.values()),
                      "matched": len(output), "unmatched": len(unmatched)},
          "matched": output, "unmatched": unmatched}
args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result["summary"]))
