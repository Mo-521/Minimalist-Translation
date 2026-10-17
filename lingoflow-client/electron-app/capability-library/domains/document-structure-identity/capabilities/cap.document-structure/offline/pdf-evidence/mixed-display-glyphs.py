"""Read-only PDF glyph extent check for isolated mixed-notation display proposals."""
import argparse
import json
from pathlib import Path
import pdfplumber

parser = argparse.ArgumentParser()
parser.add_argument("--source-inventory", type=Path, required=True)
parser.add_argument("--proposals", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
source = json.loads(args.source_inventory.read_text(encoding="utf-8"))
proposals = json.loads(args.proposals.read_text(encoding="utf-8"))["proposals"]
matched, held = [], []
for proposal in proposals:
    key = proposal["key"]
    paper, number = map(int, key.split(":"))
    meta = next(x for x in source["papers"] if x["paper"] == paper)
    line = next(x for x in source["pages"][key]["sourceLines"] if x["sourceLineId"] == proposal["lineId"])
    b = line["bbox"]
    baseline_tolerance = max(8, b["height"] * .55)
    with pdfplumber.open(meta["sourceFile"]) as pdf:
        chars = [c for c in pdf.pages[number - 1].chars if c["text"].strip()
                 and b["x"] - 1 <= (c["x0"] + c["x1"]) / 2 <= b["x"] + b["width"] + 1
                 and abs((c["top"] + c["bottom"]) / 2 - b["y"]) <= baseline_tolerance]
    if not chars:
        held.append({"key": key, "lineId": proposal["lineId"], "reason": "no_pdf_glyph_support"})
        continue
    box = {"x": min(c["x0"] for c in chars) - 1,
           "y": min(c["top"] for c in chars) - 1,
           "width": max(c["x1"] for c in chars) - min(c["x0"] for c in chars) + 2,
           "height": max(c["bottom"] for c in chars) - min(c["top"] for c in chars) + 2}
    matched.append({"key": key, "lineId": proposal["lineId"], "box": box, "glyphCount": len(chars)})
args.output.write_text(
    json.dumps({"authority": "none", "matched": matched, "held": held}, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"matched": len(matched), "held": len(held)}))
