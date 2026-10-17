"""Read-only PDF character evidence for newly reconstructed display objects."""
import argparse
import json
from pathlib import Path

import pdfplumber

parser = argparse.ArgumentParser()
parser.add_argument("--candidate", type=Path, required=True)
parser.add_argument("--source-inventory", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
candidate = json.loads(args.candidate.read_text(encoding="utf-8"))
source = json.loads(args.source_inventory.read_text(encoding="utf-8"))
targets = {}
for key, page in candidate["pages"].items():
    ids = set()
    for obj in page["objects"]:
        if obj["type"] == "formula" and obj["objectId"].startswith("stage56:"):
            ids.update(obj["sourceLineIds"])
    if ids:
        targets[key] = ids

matched, held = [], []
for meta in source["papers"]:
    with pdfplumber.open(meta["sourceFile"]) as pdf:
        for number, page in enumerate(pdf.pages, 1):
            key = f"{meta['paper']}:{number}"
            if key not in targets:
                continue
            for line in source["pages"][key]["sourceLines"]:
                if line["sourceLineId"] not in targets[key]:
                    continue
                b = line["bbox"]
                tolerance = max(7, b["height"] * .8)
                chars = [c for c in page.chars if c["text"].strip()
                         and b["x"] - 2 <= (c["x0"] + c["x1"]) / 2 <= b["x"] + b["width"] + 2
                         and abs((c["top"] + c["bottom"]) / 2 - b["y"]) <= tolerance]
                if not chars:
                    held.append({"key": key, "sourceLineId": line["sourceLineId"], "reason": "no_pdf_glyph_support"})
                    continue
                actual = {"x": min(c["x0"] for c in chars) - 1,
                          "y": min(c["top"] for c in chars) - 1,
                          "width": max(c["x1"] for c in chars) - min(c["x0"] for c in chars) + 2,
                          "height": max(c["bottom"] for c in chars) - min(c["top"] for c in chars) + 2}
                matched.append({"key": key, "sourceLineId": line["sourceLineId"], "box": actual})

args.output.write_text(json.dumps({"authority": "none", "matched": matched, "held": held}, indent=2), encoding="utf-8")
print(json.dumps({"matched": len(matched), "held": len(held)}))
