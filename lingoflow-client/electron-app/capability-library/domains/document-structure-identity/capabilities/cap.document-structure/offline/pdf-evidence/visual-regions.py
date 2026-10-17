"""Conservative table/figure regions from current-PDF vectors and captions.

No reviewed rectangles or old Geometry oracle are read. Each result remains a
spatial prior; semantic ownership is decided by the downstream producer.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

import pdfplumber

parser = argparse.ArgumentParser()
parser.add_argument("--source-inventory", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
source = json.loads(args.source_inventory.read_text(encoding="utf-8"))
caption = re.compile(r"^(fig(?:ure)?\.?|table)\s*([0-9]+|[IVXLCDM]+)\s*[:.|\-]", re.I)


def bounds(item):
    return (float(item["x0"]), float(item["top"]),
            float(item["x1"]), float(item["bottom"]))


def overlap_x(a, b):
    return max(0, min(a[2], b[2]) - max(a[0], b[0]))


def frame(items, pad=0):
    return {"x": min(b[0] for b in items) - pad,
            "y": min(b[1] for b in items) - pad,
            "width": max(b[2] for b in items) - min(b[0] for b in items) + pad * 2,
            "height": max(b[3] for b in items) - min(b[1] for b in items) + pad * 2}


def table_region(page, cap, others, source_lines):
    capbox = cap["box"]
    later = [item for item in others if item["kind"] == "table" and
             item["box"][1] > capbox[1] and
             overlap_x(item["box"], capbox) > min(item["box"][2] - item["box"][0],
                                                    capbox[2] - capbox[0]) * .25]
    stop = min((item["box"][1] for item in later), default=page.height)
    rules = [bounds(edge) for edge in page.edges
             if edge.get("orientation") == "h" and edge["x1"] - edge["x0"] >= 100 and
             capbox[1] <= edge["top"] <= min(stop, capbox[1] + 350)]
    groups = []
    for rule in rules:
        group = next((g for g in groups if abs(g[0][0] - rule[0]) <= 9 and
                      abs(g[0][2] - rule[2]) <= 9), None)
        if group is None:
            groups.append([rule])
        else:
            group.append(rule)
    groups = [g for g in groups if len(g) >= 2 and
              max(b[1] for b in g) - min(b[1] for b in g) >= 10 and
              min(b[1] for b in g) - capbox[1] <= 75]
    if not groups:
        # Borderless tables are common in papers. Require a caption directly
        # below a vertically regular run of wide, number-dense rows; a lone
        # equation or an ordinary prose line cannot create a table region.
        dense = []
        for line in source_lines:
            b = line["bbox"]
            if not (capbox[1] - 250 <= b["y"] <= capbox[1] - 2):
                continue
            if b["width"] < page.width * .3:
                continue
            if len(re.findall(r"\d+(?:\.\d+)?", line["text"])) < 3:
                continue
            dense.append((b["x"], b["y"] - b["height"],
                          b["x"] + b["width"], b["y"]))
        dense.sort(key=lambda b: b[1], reverse=True)
        if not dense or capbox[1] - dense[0][3] > 35:
            return None
        run = [dense[0]]
        for b in dense[1:]:
            if run[-1][1] - b[3] > 18:
                break
            run.append(b)
        if len(run) < 4:
            return None
        return frame(run, 4), {"nativeDenseRows": len(run),
                               "captionAnchor": cap["text"][:80]}
    group = max(groups, key=lambda g: len(g) * (g[0][2] - g[0][0]))
    box = frame(group, 4)
    box["y"] = max(0, min(box["y"], capbox[1] - 4))
    box["height"] = max(b[3] for b in group) + 7 - box["y"]
    current = (box["x"], box["y"], box["x"] + box["width"],
               box["y"] + box["height"])
    text_band = []
    for line in source_lines:
        b = line["bbox"]
        lb = (b["x"], b["y"] - b["height"], b["x"] + b["width"], b["y"])
        if lb[1] < capbox[1] or lb[3] > current[3] + 4:
            continue
        if overlap_x(lb, current) <= min(lb[2] - lb[0], box["width"]) * .05:
            continue
        text_band.append(lb)
    if text_band:
        left = min(capbox[0], current[0], *(b[0] for b in text_band))
        right = max(capbox[2], current[2], *(b[2] for b in text_band))
        box["x"], box["width"] = left, right - left
    return box, {"nativeHorizontalRules": len(group), "captionAnchor": cap["text"][:80]}


def full_width_figure_expansion(page, cap, records, source_lines, original):
    """Expand a tiled cross-column figure only with independent PDF evidence."""
    if original[1].get("nativeImage") and original[0]["width"] >= page.width * .75:
        # One wide raster is already a stronger boundary than nearby vectors
        # (which may belong to a preceding table on the same page).
        return original
    capbox = cap["box"]
    caption_row = []
    for line in source_lines:
        b = line["bbox"]
        top = b["y"] - b["height"]
        if capbox[1] - 3 <= top <= capbox[1] + 3:
            caption_row.append((b["x"], b["x"] + b["width"]))
    connected = [(capbox[0], capbox[2])]
    remaining = list(caption_row)
    while True:
        added = [span for span in remaining if any(
            span[0] <= parent[1] + 12 and parent[0] <= span[1] + 12
            for parent in connected)]
        if not added:
            break
        connected.extend(added)
        remaining = [span for span in remaining if span not in added]
    if min(span[0] for span in connected) >= page.width * .3 or \
            max(span[1] for span in connected) <= page.width * .7:
        return original
    earlier = [record["box"][3] for record in records
               if record is not cap and record["box"][3] < capbox[1]]
    search_top = max(35, max(earlier, default=35) + 3, capbox[1] - 550)
    graphics = []
    for item in [*page.images, *page.rects, *page.curves, *page.lines]:
        b = bounds(item)
        if b[1] < search_top or b[3] > capbox[1] - 3:
            continue
        if b[2] - b[0] > page.width * .84 and b[3] - b[1] < 2:
            continue
        graphics.append(b)
    if len(graphics) < 4:
        return original
    graphics.sort(key=lambda b: b[1])
    bands = []
    for b in graphics:
        if not bands or b[1] - max(x[3] for x in bands[-1]) > 120:
            bands.append([])
        bands[-1].append(b)
    bands = [group for group in bands if len(group) >= 4]
    if not bands:
        return original
    group = max(bands, key=lambda g: (max(x[3] for x in g), len(g)))
    graphic_box = frame(group)
    if graphic_box["width"] < page.width * .68 or \
            graphic_box["height"] < 100 or \
            capbox[1] - graphic_box["y"] - graphic_box["height"] > 75:
        return original
    box = {"x": page.width * .075, "y": max(45, graphic_box["y"] - 15),
           "width": page.width * .85,
           "height": min(capbox[1] - 3, graphic_box["y"] + graphic_box["height"] + 15)
                     - max(45, graphic_box["y"] - 15)}
    if box["height"] <= 0:
        return original
    return box, {"nativeGraphicMarks": len(group),
                 "crossColumnGraphicEvidence": True,
                 "captionAnchor": cap["text"][:80]}


def figure_region(page, cap, records, source_lines):
    capbox = cap["box"]
    mid = (capbox[0] + capbox[2]) / 2
    lane = "right" if mid > page.width * .6 else "left" if mid < page.width * .4 else "full"
    direct_images = [bounds(item) for item in page.images
                     if item["bottom"] <= capbox[1] - 1]
    direct_images = [b for b in direct_images
                     if b[0] - capbox[2] <= 24 and capbox[0] - b[2] <= 24 and
                     (b[2] - b[0]) * (b[3] - b[1]) >= 5000 and capbox[1] - b[3] <= 75]
    if direct_images:
        chosen = max(direct_images, key=lambda b: (b[3], (b[2] - b[0]) * (b[3] - b[1])))
        original = frame([chosen]), {"nativeImage": True, "captionAnchor": cap["text"][:80]}
        return full_width_figure_expansion(page, cap, records, source_lines, original)
    graphics = []
    for item in [*page.images, *page.rects, *page.curves, *page.lines]:
        b = bounds(item)
        if b[1] < capbox[1] - 350 or b[3] > capbox[1] - 3:
            continue
        if lane == "right" and (b[0] < page.width * .48 or b[2] - b[0] > page.width * .55):
            continue
        if lane == "left" and (b[2] > page.width * .52 or b[2] - b[0] > page.width * .55):
            continue
        if b[2] - b[0] > page.width * .84 and b[3] - b[1] < 2:
            continue
        graphics.append(b)
    if len(graphics) < 4:
        return None
    # Keep the nearest coherent graphic band, not earlier tables or page rules.
    graphics.sort(key=lambda b: b[1])
    bands = []
    for b in graphics:
        if not bands or b[1] - max(x[3] for x in bands[-1]) > 35:
            bands.append([])
        bands[-1].append(b)
    bands = [g for g in bands if len(g) >= 4]
    if not bands:
        return None
    group = max(bands, key=lambda g: (max(x[3] for x in g), len(g)))
    # Vector labels can sit a few points above the first graphical mark;
    # retain that top ink without turning the entire neighboring prose row
    # into figure ownership (the downstream edge-prose guard still applies).
    box = frame(group, 15)
    if box["width"] < 65 or box["height"] < 45 or box["width"] * box["height"] < 5000:
        return None
    if capbox[1] - (box["y"] + box["height"]) > 75:
        return None
    original = box, {"nativeGraphicMarks": len(group), "captionAnchor": cap["text"][:80]}
    return full_width_figure_expansion(page, cap, records, source_lines, original)


pages = {}
paper_files = {item["paper"]: item["sourceFile"] for item in source["papers"]}
for paper, filename in paper_files.items():
    paper_record = next(item for item in source["papers"] if item["paper"] == paper)
    actual_hash = hashlib.sha256(Path(filename).read_bytes()).hexdigest()
    if actual_hash != paper_record["sourcePdfSha256"]:
        raise ValueError(f"PDF hash differs from source inventory: paper {paper}")
    with pdfplumber.open(filename) as pdf:
        if len(pdf.pages) != paper_record["pageCount"]:
            raise ValueError(f"PDF page count differs from source inventory: paper {paper}")
        for number, pdfpage in enumerate(pdf.pages, 1):
            key = f"{paper}:{number}"
            records = []
            for line in source["pages"][key]["sourceLines"]:
                text = " ".join(line["text"].split())
                match = caption.match(text)
                if not match:
                    continue
                b = line["bbox"]
                records.append({"kind": "table" if match.group(1).lower() == "table" else "figure",
                                "text": text,
                                "box": (b["x"], b["y"] - b["height"],
                                        b["x"] + b["width"], b["y"])})
            hints = []
            for index, record in enumerate(records):
                proposed = (table_region(pdfpage, record, records,
                                         source["pages"][key]["sourceLines"])
                            if record["kind"] == "table"
                            else figure_region(pdfpage, record, records,
                                               source["pages"][key]["sourceLines"]))
                if proposed is None:
                    continue
                box, evidence = proposed
                hints.append({"kind": record["kind"], "regionId": f"native:{key}:{index}",
                              "box": box, "source": "current_pdf_visual_evidence",
                              "usage": "prior_only", "evidence": evidence})
            pages[key] = hints

result = {"authority": "none", "status": "native_visual_region_proposals_not_truth",
          "pages": pages,
          "summary": {"tables": sum(h["kind"] == "table" for items in pages.values() for h in items),
                      "figures": sum(h["kind"] == "figure" for items in pages.values() for h in items)}}
args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result["summary"]))
