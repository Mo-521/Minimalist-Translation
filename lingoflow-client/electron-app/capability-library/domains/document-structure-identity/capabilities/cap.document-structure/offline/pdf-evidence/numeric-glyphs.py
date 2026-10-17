"""Read-only PDF glyph support for numeric formula-member proposals."""
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
by_page = {}
for proposal in proposals:
    by_page.setdefault(proposal["key"], set()).add(proposal["lineId"])
matched, held = [], []
for meta in source["papers"]:
    keys = {key for key in by_page if key.startswith(f'{meta["paper"]}:')}
    if not keys:
        continue
    with pdfplumber.open(meta["sourceFile"]) as pdf:
        for key in keys:
            page = pdf.pages[int(key.split(":")[1]) - 1]
            for line in source["pages"][key]["sourceLines"]:
                if line["sourceLineId"] not in by_page[key]:
                    continue
                b = line["bbox"]
                tolerance = max(5, b["height"] * .8)
                chars = [c for c in page.chars if c["text"].strip()
                         and b["x"] - 1 <= (c["x0"] + c["x1"]) / 2 <= b["x"] + b["width"] + 1
                         and abs((c["top"] + c["bottom"]) / 2 - b["y"]) <= tolerance]
                if not chars:
                    held.append({"key": key, "sourceLineId": line["sourceLineId"], "reason": "no_pdf_glyph_support"})
                    continue
                box = {"x": min(c["x0"] for c in chars) - 1,
                       "y": min(c["top"] for c in chars) - 1,
                       "width": max(c["x1"] for c in chars) - min(c["x0"] for c in chars) + 2,
                       "height": max(c["bottom"] for c in chars) - min(c["top"] for c in chars) + 2}
                matched.append({"key": key, "sourceLineId": line["sourceLineId"], "box": box})
args.output.write_text(
    json.dumps({"authority": "none", "matched": matched, "held": held}, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"matched": len(matched), "held": len(held)}))
