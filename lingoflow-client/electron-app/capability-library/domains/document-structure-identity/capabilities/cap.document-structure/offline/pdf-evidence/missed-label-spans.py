#!/usr/bin/env python
"""PDF-character evidence for missed equation labels; never uses reviewer frames."""
import json
import re
import argparse
from collections import defaultdict
from pathlib import Path

import pdfplumber

parser = argparse.ArgumentParser(description="Extract missed equation labels from the current PDF candidate")
parser.add_argument("--candidate", type=Path, required=True)
parser.add_argument("--source-inventory", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
source = json.loads(args.source_inventory.read_text(encoding="utf-8"))
candidate = json.loads(args.candidate.read_text(encoding="utf-8"))
papers = {p["paper"]: p for p in source["papers"]}
pattern = re.compile(r"^(\(\d{1,3}(?:\.\d+)?[a-z]?\))\s*(.+)$")
relation = re.compile(r"[=≈≃≤≥⩽⩾<>≡:=∑∫√]")
prose_token = re.compile(r"\b[A-Za-z]{3,}\b")
by_paper = defaultdict(list)

for key, page in source["pages"].items():
    owned = {line_id: obj["type"] for obj in candidate["pages"][key]["objects"]
             for line_id in obj["sourceLineIds"]}
    for line in page["sourceLines"]:
        match = pattern.match(line["text"].strip())
        if not match or not relation.search(match.group(2)):
            continue
        # A leading equation number may be accidentally joined to prose in
        # source-line formation (even from the opposite column). Character
        # position alone does not make that prose a display formula.
        natural_words = [word for word in prose_token.findall(match.group(2))
                         if word.lower() not in {"and", "sin", "cos", "dim", "span", "log", "lim", "max", "min"}]
        if len(natural_words) > 3 or re.search(r"\b(?:Assumption|Thus|Wherever|There|The|This|define)\b", match.group(2), re.I):
            continue
        if owned.get(line["sourceLineId"]) in {"formula", "equation_number", "reference", "figure", "table"}:
            continue
        if line["coverageClass"] != "reviewable_content":
            continue
        by_paper[page["paper"]].append((key, page["pageNumber"], line, match.group(1), match.group(2)))

matched, unmatched = [], []
for paper, items in by_paper.items():
    with pdfplumber.open(papers[paper]["sourceFile"]) as pdf:
        cache = {}
        for key, page_number, line, label, rest in items:
            chars = cache.setdefault(page_number, pdf.pages[page_number - 1].chars)
            box = line["bbox"]
            possibilities = []
            for first in chars:
                if first["text"] != "(" or abs(first["x0"] - box["x"]) > 4:
                    continue
                row = sorted((c for c in chars if abs(c["top"] - first["top"]) < 2.5
                              and c["x0"] >= first["x0"] - .2
                              and c["x1"] <= box["x"] + box["width"] + 4), key=lambda c: c["x0"])
                selected = []
                for char in row:
                    if not selected and char is not first:
                        continue
                    if selected and char["x0"] - selected[-1]["x1"] > 2.5:
                        break
                    selected.append(char)
                    text = "".join(c["text"] for c in selected)
                    if text == label or not label.startswith(text):
                        break
                if "".join(c["text"] for c in selected) != label:
                    continue
                label_box = {"x": min(c["x0"] for c in selected), "y": min(c["top"] for c in selected),
                             "width": max(c["x1"] for c in selected) - min(c["x0"] for c in selected),
                             "height": max(c["bottom"] for c in selected) - min(c["top"] for c in selected)}
                vertical_error = abs(label_box["y"] + label_box["height"] / 2 - box["y"])
                if vertical_error <= max(15, box["height"] * 1.4):
                    possibilities.append((abs(label_box["x"] - box["x"]) + vertical_error * .15, label_box))
            possibilities.sort(key=lambda x: x[0])
            if not possibilities or len(possibilities) > 1 and possibilities[1][0] - possibilities[0][0] < 1:
                unmatched.append({"page": key, "sourceLineId": line["sourceLineId"],
                                  "reason": "no_unique_pdf_character_match"})
                continue
            label_box = possibilities[0][1]
            formula_x = label_box["x"] + label_box["width"] + 2
            right = box["x"] + box["width"]
            if right - formula_x < 8:
                unmatched.append({"page": key, "sourceLineId": line["sourceLineId"],
                                  "reason": "no_formula_width_after_label"})
                continue
            matched.append({"page": key, "parentSourceLineId": line["sourceLineId"],
                            "labelText": label, "formulaText": rest.strip(),
                            "labelTextSpan": [0, len(label)], "formulaTextSpan": [len(label), len(line["text"].strip())],
                            "labelBox": label_box,
                            "formulaBox": {"x": formula_x, "y": box["y"] - box["height"],
                                           "width": right - formula_x, "height": box["height"]},
                            "evidence": "unique_pdf_character_label_at_source_line_start"})

result = {"schemaVersion": "OfflineMissedEquationLabelSpanEvidence/v1", "authority": "none",
          "summary": {"candidates": sum(map(len, by_paper.values())), "matched": len(matched),
                      "unmatched": len(unmatched)}, "matched": matched, "unmatched": unmatched}
args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result["summary"]))
