"""Read-only PDF character extents for numbered display proposals."""
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
ids = {p["labelId"] for p in proposals} | {p["mathLineId"] for p in proposals}
keys = {p["key"] for p in proposals}
matched, held = [], []
for meta in source["papers"]:
    if not any(k.startswith(f"{meta['paper']}:") for k in keys):
        continue
    with pdfplumber.open(meta["sourceFile"]) as pdf:
        for number, page in enumerate(pdf.pages, 1):
            key = f"{meta['paper']}:{number}"
            if key not in keys:
                continue
            for line in source["pages"][key]["sourceLines"]:
                if line["sourceLineId"] not in ids:
                    continue
                b = line["bbox"]
                tol = max(7, b["height"] * .8)
                chars = [c for c in page.chars if c["text"].strip()
                         and b["x"] - 2 <= (c["x0"] + c["x1"]) / 2 <= b["x"] + b["width"] + 2
                         and abs((c["top"] + c["bottom"]) / 2 - b["y"]) <= tol]
                if not chars:
                    held.append({"key": key, "sourceLineId": line["sourceLineId"], "reason": "no_pdf_glyph_support"})
                    continue
                box = {"x": min(c["x0"] for c in chars) - 1,
                       "y": min(c["top"] for c in chars) - 1,
                       "width": max(c["x1"] for c in chars) - min(c["x0"] for c in chars) + 2,
                       "height": max(c["bottom"] for c in chars) - min(c["top"] for c in chars) + 2}
                matched.append({"key": key, "sourceLineId": line["sourceLineId"], "box": box})
args.output.write_text(json.dumps({"authority": "none", "matched": matched, "held": held}, indent=2), encoding="utf-8")
print(json.dumps({"matched": len(matched), "held": len(held)}))
