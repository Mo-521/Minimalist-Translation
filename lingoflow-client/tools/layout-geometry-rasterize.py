"""Rasterize PDF pages for Geometry human review. No truth mutation."""
import json
import os
import sys

import fitz

src, out_dir, scale_s = sys.argv[1], sys.argv[2], sys.argv[3]
scale = float(scale_s)
os.makedirs(out_dir, exist_ok=True)
doc = fitz.open(src)
meta = []
for index, page in enumerate(doc, start=1):
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False, annots=True)
    name = f"p{index:03d}.jpg"
    pix.save(os.path.join(out_dir, name), jpg_quality=82)
    rect = page.rect
    meta.append({
        "pageNumber": index,
        "image": name,
        "imageWidth": pix.width,
        "imageHeight": pix.height,
        "pageWidth": round(rect.width, 2),
        "pageHeight": round(rect.height, 2),
        "rotation": page.rotation,
    })
json.dump({"scale": scale, "pages": meta}, open(os.path.join(out_dir, "raster-meta.json"), "w"), indent=2)
print(json.dumps({"pages": len(meta), "out": out_dir}))
