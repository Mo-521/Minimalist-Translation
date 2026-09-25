"""Rasterize paper PDFs for Geometry human review. Does not modify oracle JSON."""
import json
import sys
from pathlib import Path

import fitz

SCALE = 2.0


def render_paper(pdf_path: str, out_dir: str, expected_pages: int) -> list[dict]:
    doc = fitz.open(pdf_path)
    if doc.page_count != expected_pages:
        raise SystemExit(f"page count {doc.page_count} != {expected_pages}")
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    info = []
    matrix = fitz.Matrix(SCALE, SCALE)
    for index in range(doc.page_count):
        page = doc[index]
        rect = page.rect
        pix = page.get_pixmap(matrix=matrix, alpha=False, annots=True)
        dest = Path(out_dir) / f"p{index + 1:03d}.jpg"
        pix.save(dest.as_posix(), jpg_quality=82)
        info.append({
            "pageNumber": index + 1,
            "rectWidth": round(rect.width, 2),
            "rectHeight": round(rect.height, 2),
            "rotation": page.rotation,
            "imageWidth": pix.width,
            "imageHeight": pix.height,
            "file": dest.name,
        })
    return info


def main() -> None:
    job = json.loads(sys.stdin.read())
    report = []
    for item in job["papers"]:
        report.append({
            "paperKey": item["paperKey"],
            "pages": render_paper(item["pdfPath"], item["outDir"], item["pageCount"]),
        })
    json.dump({"scale": SCALE, "papers": report}, sys.stdout)


if __name__ == "__main__":
    main()
