#!/usr/bin/env node
"use strict";

// Offline Geometry candidate builder. Does not import main.js, Writer, Export, UI, or Column producer.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { validateOracle, hashCanonical } = require("../electron-app/capability-library/geometry-oracle");
const workflow = require("../electron-app/capability-library/candidate-pool");

const ROOT = path.resolve(__dirname, "../..");
const APP = path.resolve(__dirname, "../electron-app");
const TASK_EVIDENCE = path.join(ROOT, ".governance/tasks/layout-geometry-capability-audit/evidence/phase-2-paper-geometry");
const COLUMN_CORPUS = path.join(APP, "capability-library/capabilities/cap.column-recognition/corpus.json");
const COLUMN_BASELINE_DIR = path.join(APP, "capability-library/capabilities/cap.column-recognition/baseline");
const EVIDENCE_ID = "EVD-20260918-LAYOUT-GEOMETRY-PAPER-CANDIDATES";
const ACTOR = "geometry.candidate.builder";
const AT = "2026-09-19T04:00:00.000Z";
const SAFETY_MARGIN = 8;
const BODY_BOUNDARY_MARGIN = 2.5;
const MIN_WRITABLE_WIDTH = 28;
const MIN_WRITABLE_HEIGHT = 28;

const SOURCE_ROOTS = [
  "D:\\PDF测试",
  path.join(APP, "tmp", "pdfs"),
];

function resolvePdfByHash(expectedSha, expectedBytes) {
  for (const root of SOURCE_ROOTS) {
    if (!fs.existsSync(root)) continue;
    const files = fs.readdirSync(root).filter((name) => name.toLowerCase().endsWith(".pdf"));
    for (const name of files) {
      const filePath = path.join(root, name);
      const stat = fs.statSync(filePath);
      if (stat.size !== expectedBytes) continue;
      const digest = sha256(fs.readFileSync(filePath));
      if (digest === expectedSha) return filePath;
    }
  }
  throw new Error(`PDF with sha256 ${expectedSha} not found in source roots`);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function round(value) {
  return Number(Number(value).toFixed(2));
}

function box(x, y, width, height) {
  return {
    x: round(x),
    y: round(y),
    width: round(Math.max(0.01, width)),
    height: round(Math.max(0.01, height)),
  };
}

function itemBox(item) {
  const height = Math.max(item.height || item.fontSize || 1, 1);
  return box(item.x, Math.max(0, item.y - height), item.width || 1, height);
}

function unionBoxes(boxes) {
  const x0 = Math.min(...boxes.map((item) => item.x));
  const y0 = Math.min(...boxes.map((item) => item.y));
  const x1 = Math.max(...boxes.map((item) => item.x + item.width));
  const y1 = Math.max(...boxes.map((item) => item.y + item.height));
  return box(x0, y0, x1 - x0, y1 - y0);
}

function overlapX(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x;
}

function overlap(a, b) {
  return overlapX(a, b) && a.y < b.y + b.height && a.y + a.height > b.y;
}

function centerInside(inner, outer) {
  const cx = inner.x + inner.width / 2;
  const cy = inner.y + inner.height / 2;
  return cx >= outer.x && cx <= outer.x + outer.width && cy >= outer.y && cy <= outer.y + outer.height;
}

function boxArea(item) {
  return Math.max(0, item.width) * Math.max(0, item.height);
}

function intersectBoxes(a, b) {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  if (x1 - x0 < 0.01 || y1 - y0 < 0.01) return null;
  return box(x0, y0, x1 - x0, y1 - y0);
}

function inflateBox(item, pad) {
  return box(item.x - pad, item.y - pad, item.width + pad * 2, item.height + pad * 2);
}

function clusterBoxes(boxes, gap = 14) {
  const items = boxes.map((item) => ({ ...item }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        if (overlap(inflateBox(items[i], gap), items[j])) {
          const merged = unionBoxes([items[i], items[j]]);
          items[i] = merged;
          items.splice(j, 1);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  return items;
}

function reasonableIndependent(geometry, page, type) {
  const pageArea = page.pageSize.width * page.pageSize.height;
  const area = boxArea(geometry);
  if (area < 60) return false;
  const maxRatio = type === "figure" ? 0.78 : type === "table" ? 0.5 : type === "abstract" || type === "other_independent" ? 0.42 : 0.38;
  if (area > pageArea * maxRatio) return false;
  const maxHeight = type === "figure" ? 0.82 : type === "table" ? 0.58 : type === "abstract" ? 0.48 : 0.34;
  if (geometry.height > page.pageSize.height * maxHeight) return false;
  if (Math.min(geometry.width, geometry.height) < 6) return false;
  return true;
}

function loadColumnModels(paperKey) {
  const baseline = JSON.parse(fs.readFileSync(path.join(COLUMN_BASELINE_DIR, `${paperKey}-regression.json`), "utf8"));
  const byPage = new Map();
  baseline.results.forEach((row) => {
    byPage.set(row.pageNumber, row.evidence && row.evidence.columnModel);
  });
  return byPage;
}

function columnPartition(page, layout, columnModel) {
  const geometry = columnModel && columnModel.columnGeometry;
  const pageWidth = page.pageSize.width;
  const pageHeight = page.pageSize.height;
  const pageBox = box(0, 0, pageWidth, pageHeight);
  if (layout !== "double_column") {
    const lane = geometry && geometry.left && geometry.right
      ? box(geometry.left.x, 0, (geometry.right.x + geometry.right.width) - geometry.left.x, pageHeight)
      : box(pageWidth * 0.08, 0, pageWidth * 0.84, pageHeight);
    return { layout: "single", walls: { single: pageBox }, lanes: { single: lane }, gutterMid: null };
  }
  let leftGeom;
  let rightGeom;
  if (geometry && geometry.left && geometry.right) {
    leftGeom = geometry.left;
    rightGeom = geometry.right;
  } else {
    leftGeom = { x: pageWidth * 0.08, width: pageWidth / 2 - 8 - pageWidth * 0.08 };
    rightGeom = { x: pageWidth / 2 + 8, width: pageWidth * 0.92 - (pageWidth / 2 + 8) };
  }
  const mid = (leftGeom.x + leftGeom.width + rightGeom.x) / 2;
  return {
    layout: "double_column",
    gutterMid: mid,
    walls: {
      left: box(0, 0, mid, pageHeight),
      right: box(mid, 0, pageWidth - mid, pageHeight),
    },
    lanes: {
      left: box(leftGeom.x, 0, leftGeom.width, pageHeight),
      right: box(rightGeom.x, 0, rightGeom.width, pageHeight),
    },
  };
}

function columnLanes(page, layout, columnModel) {
  return columnPartition(page, layout, columnModel).lanes;
}

function columnIndependentSeeds(columnModel, page) {
  return ((columnModel && columnModel.independentRegions) || []).filter((region) => {
    if (String(region.source || "") === "paper-page-zone") return false;
    const bbox = region.bbox;
    if (!bbox) return false;
    const geometry = box(bbox.x, bbox.y, bbox.width, bbox.height);
    return reasonableIndependent(geometry, page, region.type);
  }).map((region) => ({
    type: region.type,
    geometry: box(region.bbox.x, region.bbox.y, region.bbox.width, region.bbox.height),
    sourceArtifactId: region.id,
  }));
}

function clipToPage(geometry, page) {
  return intersectBoxes(geometry, box(0, 0, page.pageSize.width, page.pageSize.height));
}

function isBodyLikeLine(line) {
  if (/https?:\/\/|downloaded from|doi\.org/i.test(line.text)) return false;
  const words = String(line.text || "").split(/\s+/).filter(Boolean);
  if (words.length >= 8 && line.maxFont <= 13) return true;
  if (words.length >= 5 && line.width > 120 && line.maxFont <= 12.5) return true;
  return false;
}

function lineBox(line) {
  return box(line.x, line.y, line.width, line.height);
}

function isPageNumberLine(line) {
  return /^\d{1,4}$/.test(String(line.text || "").trim());
}

function isHeaderLikeLine(line, page) {
  if (isBodyLikeLine(line)) return false;
  // A page-local detector must stay conservative: body/reference text can begin
  // high on continuation pages.  The top 5% still covers running heads and
  // page numbers without turning the first reference row into a header.
  if (line.y > page.pageSize.height * 0.05) return false;
  const text = String(line.text || "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (/https?:\/\/|downloaded from|doi\.org/i.test(text)) return true;
  if (isPageNumberLine(line)) {
    const cx = line.x + line.width / 2;
    return cx < page.pageSize.width * 0.16 || cx > page.pageSize.width * 0.84;
  }
  const letters = (text.match(/[A-Za-z]/g) || []);
  const upper = (text.match(/[A-Z]/g) || []).length;
  if (letters.length >= 4 && upper / letters.length >= 0.82 && line.maxFont <= 11 && text.length <= 90) return true;
  if (/^[A-Z][a-z]{3,18}$/.test(text) && line.width < 90) return true;
  if (/^(?:vol\.?|volume|journal|proceedings|supplementary material)\b/i.test(text) && text.length <= 90) return true;
  return false;
}

function isFooterLikeLine(line, page) {
  if (line.y < page.pageSize.height * 0.93) return false;
  if (isBodyLikeLine(line)) return false;
  const text = String(line.text || "").trim();
  if (isPageNumberLine(line)) return true;
  return /(?:https?:\/\/|doi\.org|downloaded from|copyright|©|all rights reserved)/i.test(text)
    || /^[A-Z][^,]{0,32},\s*(?:19|20)\d{2}\s+\d{1,4}$/.test(text);
}

function ownedBySemantic(geometry, semantics) {
  return semantics.some((region) => {
    const hit = intersectBoxes(geometry, region);
    if (!hit) return false;
    if (centerInside(geometry, region)) return true;
    return boxArea(hit) / Math.max(1, boxArea(geometry)) > 0.45;
  });
}

function isCredibleBodySpan(span, page) {
  if (!span) return false;
  if (boxArea(span) < 1200) return false;
  if (span.width < 48 || span.height < 16) return false;
  if (page && span.y < page.pageSize.height * 0.09 && span.height < 40) return false;
  return true;
}

function groupLines(items, tol = 2.8) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  sorted.forEach((item) => {
    const match = [...lines].reverse().find((line) => {
      if (Math.abs(item.y - line.anchorY) > tol) return false;
      const last = line.items[line.items.length - 1];
      const gap = item.x - (last.x + last.width);
      if (gap > 8) return false;
      if (gap > 3 && last.width > 36 && (item.width || 0) > 36) return false;
      return true;
    });
    if (match) match.items.push(item);
    else lines.push({ anchorY: item.y, items: [item] });
  });
  return lines.map((line) => {
    const geometry = unionBoxes(line.items.map(itemBox));
    return {
      ...geometry,
      text: line.items.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim(),
      maxFont: Math.max(...line.items.map((item) => item.fontSize || 0)),
      fontNames: [...new Set(line.items.map((item) => item.fontName).filter(Boolean))],
      fontFamilies: [...new Set(line.items.map((item) => item.fontFamily).filter(Boolean))],
      items: line.items,
    };
  });
}

function identityHash(payload) {
  return sha256(Buffer.from(JSON.stringify(payload)));
}

function reviewEvent(sequence, action, reason, previousHash) {
  const unsigned = {
    sequence,
    action,
    actor: ACTOR,
    at: AT,
    reason,
    previousHash,
  };
  return { ...unsigned, hash: hashCanonical(unsigned) };
}

function relationKind(source, target) {
  if (source.x + source.width <= target.x) return "left_of";
  if (source.x >= target.x + target.width) return "right_of";
  if (source.y + source.height <= target.y) return "above";
  if (source.y >= target.y + target.height) return "below";
  if (source.x <= target.x && source.y <= target.y
    && source.x + source.width >= target.x + target.width
    && source.y + source.height >= target.y + target.height) return "contains";
  if (target.x <= source.x && target.y <= source.y
    && target.x + target.width >= source.x + source.width
    && target.y + target.height >= source.y + source.height) return "inside";
  if (overlap(source, target)) return "overlaps";
  return "disjoint";
}

function gapPoints(source, target, kind) {
  if (kind === "left_of") return round(target.x - (source.x + source.width));
  if (kind === "right_of") return round(source.x - (target.x + target.width));
  if (kind === "above") return round(target.y - (source.y + source.height));
  if (kind === "below") return round(source.y - (target.y + target.height));
  return undefined;
}

function addRelation(region, targetId, sourceBox, targetBox) {
  const kind = relationKind(sourceBox, targetBox);
  const relation = { kind, targetRegionId: targetId };
  const gap = gapPoints(sourceBox, targetBox, kind);
  if (Number.isFinite(gap) && gap >= 0) relation.minimumGapPoints = gap;
  region.relations.push(relation);
}

function mapUserBox(ctm, viewport, x0, y0, x1, y1) {
  const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map((point) => {
    const pagePoint = [
      point[0] * ctm[0] + point[1] * ctm[2] + ctm[4],
      point[0] * ctm[1] + point[1] * ctm[3] + ctm[5],
    ];
    return [
      pagePoint[0] * viewport.transform[0] + pagePoint[1] * viewport.transform[2] + viewport.transform[4],
      pagePoint[0] * viewport.transform[1] + pagePoint[1] * viewport.transform[3] + viewport.transform[5],
    ];
  });
  const left = Math.max(0, Math.min(viewport.width, Math.min(...corners.map((point) => point[0]))));
  const top = Math.max(0, Math.min(viewport.height, Math.min(...corners.map((point) => point[1]))));
  const right = Math.max(0, Math.min(viewport.width, Math.max(...corners.map((point) => point[0]))));
  const bottom = Math.max(0, Math.min(viewport.height, Math.max(...corners.map((point) => point[1]))));
  return box(left, top, right - left, bottom - top);
}

function extractVisuals(operatorList, viewport, pageNumber, pdfjs) {
  const fnArray = Array.isArray(operatorList && operatorList.fnArray) ? operatorList.fnArray : [];
  const argsArray = Array.isArray(operatorList && operatorList.argsArray) ? operatorList.argsArray : [];
  const OPS = pdfjs && pdfjs.OPS || {};
  const identity = [1, 0, 0, 1, 0, 0];
  const multiply = (left, right) => [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
  let ctm = identity.slice();
  const stack = [];
  const images = [];
  const drawings = [];
  const pageArea = viewport.width * viewport.height;
  const accept = (geometry) => {
    if (geometry.width < 8 || geometry.height < 8) return false;
    if (geometry.width > viewport.width * 0.92 && geometry.height < 22) return false;
    if (boxArea(geometry) > pageArea * 0.55) return false;
    return true;
  };
  const appendImage = (operatorIndex, operatorName, imageObjectId, localMatrix, instanceIndex) => {
    const matrix = multiply(ctm, localMatrix || identity);
    const geometry = mapUserBox(matrix, viewport, 0, 0, 1, 1);
    const areaRatio = boxArea(geometry) / Math.max(1, pageArea);
    const compositeRaster = areaRatio > 0.55 && areaRatio <= 0.75
      && geometry.width > viewport.width * 0.65 && geometry.height > viewport.height * 0.5;
    if ((!accept(geometry) && !compositeRaster) || geometry.width < 16 || geometry.height < 16) return;
    images.push({
      sourceArtifactId: `image:p${pageNumber}:op${operatorIndex}:i${instanceIndex}`,
      operatorName,
      imageObjectId: String(imageObjectId || ""),
      geometry,
      compositeRaster,
    });
  };
  const appendDrawing = (operatorIndex, geometry) => {
    if (!accept(geometry)) return;
    drawings.push({
      sourceArtifactId: `draw:p${pageNumber}:op${operatorIndex}`,
      operatorName: "vector-path",
      geometry,
    });
  };
  fnArray.forEach((fn, operatorIndex) => {
    const args = argsArray[operatorIndex] || [];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.length ? stack.pop() : identity.slice();
    else if (fn === OPS.transform && args.length >= 6) ctm = multiply(ctm, args.slice(0, 6).map(Number));
    else if ([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].includes(fn)) {
      appendImage(operatorIndex, "paintImageXObject", args[0], identity, 0);
    } else if (fn === OPS.paintImageXObjectRepeat) {
      const [objectId, scaleX, scaleY, positions] = args;
      for (let index = 0; index < (positions && positions.length || 0); index += 2) {
        appendImage(operatorIndex, "paintImageXObjectRepeat", objectId, [Number(scaleX), 0, 0, Number(scaleY), Number(positions[index]), Number(positions[index + 1])], index / 2);
      }
    } else if (fn === OPS.rectangle && args.length >= 4) {
      const [x, y, width, height] = args.map(Number);
      appendDrawing(operatorIndex, mapUserBox(ctm, viewport, x, y, x + width, y + height));
    } else if (fn === OPS.constructPath && args.length >= 3 && Array.isArray(args[2]) && args[2].length >= 4) {
      const [minX, minY, maxX, maxY] = args[2].map(Number);
      appendDrawing(operatorIndex, mapUserBox(ctm, viewport, minX, minY, maxX, maxY));
    }
  });
  return { images, drawings };
}

async function splitCompositeRasterImages(pdfPage, images) {
  const output = [];
  for (const image of images) {
    if (!image.compositeRaster || !image.imageObjectId) {
      output.push(image);
      continue;
    }
    let bitmap;
    try {
      bitmap = await new Promise((resolve) => pdfPage.objs.get(image.imageObjectId, resolve));
    } catch {
      output.push(image);
      continue;
    }
    const width = Number(bitmap && bitmap.width || 0);
    const height = Number(bitmap && bitmap.height || 0);
    const data = bitmap && bitmap.data;
    const channels = width > 0 && height > 0 && data ? data.length / (width * height) : 0;
    if (!data || ![3, 4].includes(channels) || height < 240) {
      output.push(image);
      continue;
    }
    const rowInk = [];
    const xStep = Math.max(1, Math.floor(width / 480));
    for (let y = 0; y < height; y += 1) {
      let ink = 0;
      let samples = 0;
      for (let x = 0; x < width; x += xStep) {
        const offset = (y * width + x) * channels;
        const brightness = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
        if (brightness < 245) ink += 1;
        samples += 1;
      }
      rowInk.push(ink / Math.max(1, samples));
    }
    const radius = Math.max(6, Math.round(height * 0.012));
    const smooth = rowInk.map((_, y) => {
      let sum = 0;
      let count = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        if (rowInk[y + offset] === undefined) continue;
        sum += rowInk[y + offset];
        count += 1;
      }
      return sum / Math.max(1, count);
    });
    const middle = smooth.slice(Math.floor(height * 0.1), Math.floor(height * 0.9)).sort((a, b) => a - b);
    const median = middle[Math.floor(middle.length / 2)] || 0;
    let split = null;
    for (let y = Math.floor(height * 0.35); y < Math.floor(height * 0.62); y += 1) {
      if (split === null || smooth[y] < smooth[split]) split = y;
    }
    if (split === null || median <= 0 || smooth[split] > median * 0.18) {
      output.push(image);
      continue;
    }
    const splitY = image.geometry.y + image.geometry.height * (split / height);
    const gap = 7;
    const outerX = Math.max(0, image.geometry.x - 16);
    const outerRight = image.geometry.x + image.geometry.width + 16;
    const top = Math.max(0, image.geometry.y - 8);
    const bottom = image.geometry.y + image.geometry.height;
    const panels = [
      box(outerX, top, outerRight - outerX, Math.max(1, splitY - gap - top)),
      box(outerX, splitY + gap, outerRight - outerX, Math.max(1, bottom - (splitY + gap))),
    ];
    panels.forEach((geometry, panelIndex) => output.push({
      ...image,
      sourceArtifactId: `${image.sourceArtifactId}:panel${panelIndex + 1}`,
      operatorName: "composite-raster-panel",
      geometry,
      compositeRaster: false,
      parentImageObjectId: image.imageObjectId,
    }));
  }
  return output;
}

function baselineClusters(items, pageHeight) {
  const bodyItems = items.filter((item) => item.y > pageHeight * 0.08 && item.y < pageHeight * 0.94);
  const groups = [];
  [...bodyItems].sort((a, b) => a.y - b.y || a.x - b.x).forEach((item) => {
    const last = groups[groups.length - 1];
    if (last && Math.abs(item.y - last.anchorY) <= 2.8) last.items.push(item);
    else groups.push({ anchorY: item.y, items: [item] });
  });
  return groups.map((group) => {
    const sorted = [...group.items].sort((a, b) => a.x - b.x);
    const runs = [];
    sorted.forEach((item) => {
      const geometry = itemBox(item);
      const last = runs[runs.length - 1];
      if (last && geometry.x - (last.x + last.width) <= 16) {
        const next = unionBoxes([last, geometry]);
        last.x = next.x;
        last.y = next.y;
        last.width = next.width;
        last.height = next.height;
      } else runs.push({ ...geometry });
    });
    return runs;
  });
}

function classifyBodyLayout(items, pageWidth, pageHeight) {
  const clusters = baselineClusters(items, pageHeight);
  const mid = pageWidth / 2;
  let paired = 0;
  let spanning = 0;
  let singleSide = 0;
  clusters.forEach((runs) => {
    const left = runs.filter((run) => run.x + run.width <= mid - 8);
    const right = runs.filter((run) => run.x >= mid + 8);
    const span = runs.filter((run) => run.x < mid - 8 && run.x + run.width > mid + 8 && run.width > pageWidth * 0.5);
    if (left.length && right.length) paired += 1;
    else if (span.length) spanning += 1;
    else singleSide += 1;
  });
  const total = paired + spanning + singleSide;
  if (total < 8) return { observedLayout: "unknown", confidence: "low", paired, spanning, singleSide, total };
  if (paired >= 10 && paired > spanning * 2) {
    return { observedLayout: "double_column", confidence: "high", paired, spanning, singleSide, total };
  }
  if (spanning >= 10 && spanning > paired * 2) {
    return { observedLayout: "single_column", confidence: "high", paired, spanning, singleSide, total };
  }
  if (paired > spanning && paired >= 6) {
    return { observedLayout: "double_column", confidence: "medium", paired, spanning, singleSide, total };
  }
  return { observedLayout: "single_column", confidence: "medium", paired, spanning, singleSide, total };
}

function findLine(lines, pattern) {
  return lines.find((line) => pattern.test(line.text));
}

function takeBlock(lines, startIndex, stopPattern, maxLines) {
  const block = [];
  for (let index = startIndex; index < lines.length && block.length < maxLines; index += 1) {
    const line = lines[index];
    if (index > startIndex && stopPattern.test(line.text)) break;
    block.push(line);
  }
  return block;
}

function subtractBox(source, blocker) {
  const hit = intersectBoxes(source, blocker);
  if (!hit) return [source];
  const pieces = [];
  const sourceRight = source.x + source.width;
  const sourceBottom = source.y + source.height;
  const hitRight = hit.x + hit.width;
  const hitBottom = hit.y + hit.height;
  if (hit.y > source.y) pieces.push(box(source.x, source.y, source.width, hit.y - source.y));
  if (hitBottom < sourceBottom) pieces.push(box(source.x, hitBottom, source.width, sourceBottom - hitBottom));
  if (hit.x > source.x) pieces.push(box(source.x, hit.y, hit.x - source.x, hit.height));
  if (hitRight < sourceRight) pieces.push(box(hitRight, hit.y, sourceRight - hitRight, hit.height));
  return pieces.filter((item) => item.width >= MIN_WRITABLE_WIDTH && item.height >= MIN_WRITABLE_HEIGHT);
}

function subtractAnyBox(source, blocker) {
  const hit = intersectBoxes(source, blocker);
  if (!hit) return [source];
  const pieces = [];
  const sourceRight = source.x + source.width;
  const sourceBottom = source.y + source.height;
  const hitRight = hit.x + hit.width;
  const hitBottom = hit.y + hit.height;
  if (hit.y > source.y) pieces.push(box(source.x, source.y, source.width, hit.y - source.y));
  if (hitBottom < sourceBottom) pieces.push(box(source.x, hitBottom, source.width, sourceBottom - hitBottom));
  if (hit.x > source.x) pieces.push(box(source.x, hit.y, hit.x - source.x, hit.height));
  if (hitRight < sourceRight) pieces.push(box(hitRight, hit.y, sourceRight - hitRight, hit.height));
  return pieces.filter((item) => item.width >= 0.5 && item.height >= 0.5 && boxArea(item) >= 0.5);
}

function writableSpaces(columnBox, blockers) {
  let spaces = [columnBox];
  blockers.filter((item) => overlap(columnBox, item)).forEach((blocker) => {
    spaces = spaces.flatMap((space) => subtractBox(space, blocker));
  });
  return spaces
    .filter((item) => item.width >= MIN_WRITABLE_WIDTH && item.height >= MIN_WRITABLE_HEIGHT)
    .sort((a, b) => a.y - b.y || a.x - b.x || boxArea(b) - boxArea(a));
}

function safetyMarginStrips(content, page, otherContents = []) {
  const x0 = content.x;
  const y0 = content.y;
  const x1 = content.x + content.width;
  const y1 = content.y + content.height;
  const candidates = {
    top: box(x0 - SAFETY_MARGIN, y0 - SAFETY_MARGIN, content.width + SAFETY_MARGIN * 2, SAFETY_MARGIN),
    bottom: box(x0 - SAFETY_MARGIN, y1, content.width + SAFETY_MARGIN * 2, SAFETY_MARGIN),
    left: box(x0 - SAFETY_MARGIN, y0, SAFETY_MARGIN, content.height),
    right: box(x1, y0, SAFETY_MARGIN, content.height),
  };
  return Object.entries(candidates).flatMap(([side, geometry]) => {
    const clipped = clipToPage(geometry, page);
    if (!clipped) return [];
    let pieces = [clipped];
    otherContents.forEach((blocker) => {
      pieces = pieces.flatMap((piece) => subtractAnyBox(piece, inflateBox(blocker, 0.05)));
    });
    return pieces.map((piece, pieceIndex) => ({ side, pieceIndex, geometry: piece }));
  });
}

function toleranceProfiles() {
  const cannotOverride = ["identity_failure", "structural_failure"];
  return [
    { id: "body-edge", absolutePoints: 3, relativeToPage: 0.005, appliesTo: ["x", "y", "width", "height", "edge_distance"], rationale: "Continuous canonical-column lane with vertical extent measured from body-flow evidence; semantic blockers do not fragment it.", cannotOverride },
    { id: "independent-edge", absolutePoints: 4, relativeToPage: 0.006, appliesTo: ["x", "y", "width", "height", "edge_distance"], rationale: "Independent region boxes from heading/caption/text clusters, not Column bbox copy.", cannotOverride },
    { id: "protected-edge", absolutePoints: 3, relativeToPage: 0.005, appliesTo: ["x", "y", "width", "height"], rationale: "Tight header/footer/page-number/formula/preserve content boxes plus separately identified safety-margin envelopes.", cannotOverride },
    { id: "writable-edge", absolutePoints: 6, relativeToPage: 0.008, appliesTo: ["x", "y", "width", "height"], rationale: "Derived writable rectangles subtract explicit safety-margin envelopes; human must confirm topology before promotion.", cannotOverride },
  ];
}

function columnIdentity(columnSample, pageNumber) {
  const outcome = columnSample.expectedOutcomes.find((item) => item.assertionId === "assert.column.page-region-truth");
  const page = outcome.expected.pages.find((item) => item.pageNumber === pageNumber);
  const independent = (outcome.expected.independentRegions || []).filter((item) => item.pageNumber === pageNumber);
  return {
    layout: page.layout,
    columns: page.layout === "double_column" || page.layout === "mixed" ? ["left", "right"] : ["single"],
    independentTypes: independent.map((item) => item.type),
  };
}

async function extractPdf(pdfjs, filePath) {
  const bytes = fs.readFileSync(filePath);
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), disableWorker: true });
  const pdf = await loadingTask.promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const rotation = page.rotate || 0;
    const viewport = page.getViewport({ scale: 1, rotation });
    const textContent = await page.getTextContent({ includeMarkedContent: false });
    const operatorList = await page.getOperatorList();
    const visuals = extractVisuals(operatorList, viewport, pageNumber, pdfjs);
    visuals.images = await splitCompositeRasterImages(page, visuals.images);
    const items = textContent.items.map((item) => {
      const transform = item.transform || [];
      const x = Number(transform[4] || 0);
      const baselineY = Number(transform[5] || 0);
      const width = Number(item.width || 0);
      const height = Number(item.height || Math.abs(transform[3] || transform[0] || 0) || 0);
      const fontSize = Number(Math.abs(transform[3] || transform[0] || height || 0));
      const str = String(item.str || "");
      if (!str.trim()) return null;
      return {
        str,
        x: round(x),
        y: round(viewport.height - baselineY),
        width: round(width),
        height: round(height),
        fontSize: round(fontSize),
        fontName: String(item.fontName || ""),
        fontFamily: String(textContent.styles && textContent.styles[item.fontName] && textContent.styles[item.fontName].fontFamily || ""),
      };
    }).filter(Boolean);
    const view = page.view || [0, 0, viewport.width, viewport.height];
    const crop = page.cropBox || view;
    pages.push({
      pageNumber,
      rotation,
      pageSize: { width: round(viewport.width), height: round(viewport.height) },
      mediaBox: box(view[0], view[1], view[2] - view[0], view[3] - view[1]),
      cropBox: box(crop[0], crop[1], crop[2] - crop[0], crop[3] - crop[1]),
      items,
      images: visuals.images,
      drawings: visuals.drawings,
    });
  }
  return { bytes, sha256: sha256(bytes), pageCount: pdf.numPages, pages };
}

function usableVisuals(page) {
  const pageArea = page.pageSize.width * page.pageSize.height;
  const keep = (geometry) => {
    if (geometry.y < page.pageSize.height * 0.03 || geometry.y > page.pageSize.height * 0.97) return false;
    if (boxArea(geometry) > pageArea * 0.45) return false;
    if (geometry.width > page.pageSize.width * 0.9 && geometry.height < 28) return false;
    return geometry.width >= 14 && geometry.height >= 14;
  };
  return [
    ...(page.images || []).filter((item) => keep(item.geometry)),
    ...(page.drawings || []).filter((item) => keep(item.geometry)),
  ];
}

function visualClusters(page, options = {}) {
  const keepCluster = (geometry) => {
    if (boxArea(geometry) < 400 || Math.min(geometry.width, geometry.height) < 18) return false;
    if (geometry.height > page.pageSize.height * (options.tall ? 0.82 : 0.52)) return false;
    if (geometry.width > page.pageSize.width * 0.9 && geometry.height < 40) return false;
    return true;
  };
  const tight = clusterBoxes(usableVisuals(page).map((item) => item.geometry), 11).filter(keepCluster);
  if (!options.tall) return tight.sort((a, b) => boxArea(b) - boxArea(a));
  const loose = clusterBoxes(usableVisuals(page).map((item) => item.geometry), 28).filter((geometry) => keepCluster(geometry)
    && geometry.width > page.pageSize.width * 0.42
    && geometry.height > page.pageSize.height * 0.28);
  const combined = [...tight];
  loose.forEach((geometry) => {
    const covered = combined.some((item) => {
      const hit = intersectBoxes(item, geometry);
      return hit && boxArea(hit) / Math.max(1, boxArea(geometry)) > 0.85;
    });
    if (!covered) combined.push(geometry);
  });
  return combined.sort((a, b) => boxArea(b) - boxArea(a));
}

function visualWholes(page, lines) {
  // Visual content stays geometrically independent from nearby labels/captions.
  // Semantic text regions are measured by their own detector and never merged here.
  return visualClusters(page);
}

function headingLine(lines, pattern, maxYRatio, page) {
  return lines.find((line) => line.y < page.pageSize.height * maxYRatio && pattern.test(line.text.replace(/\s+/g, " ").trim()));
}

function normalizedLineText(line) {
  return String(line && line.text || "").replace(/\s+/g, " ").trim();
}

function compactPdfSmallCaps(text) {
  let value = String(text || "").replace(/\s+/g, " ").trim();
  // IEEE-style small caps are often emitted as separate PDF runs, e.g.
  // "R EFERENCES" or "III. M AIN R ESULTS".  Join only an isolated
  // uppercase initial followed by an uppercase token; ordinary prose and
  // author initials therefore keep their spaces.
  let previous;
  do {
    previous = value;
    value = value.replace(/\b([A-Z])\s+([A-Z]{2,})\b/g, "$1$2");
  } while (value !== previous);
  return value;
}

function isReferencesHeadingLine(line) {
  return /^(references|bibliography|literature cited)\s*[:.]?$/i.test(compactPdfSmallCaps(normalizedLineText(line)));
}

function isKeywordsLine(line) {
  return /^(keywords?|key words|index terms)\s*[:.—-]/i.test(normalizedLineText(line));
}

function isFigureCaptionLine(line) {
  const text = normalizedLineText(line);
  return /^(figure|fig\.?)\s*\d+\s*[.:|—-]\s*/i.test(text);
}

function isTableCaptionLine(line) {
  return /^table\s*(?:\d+|[ivxlcdm]+)\s*[.:|—-]\s*/i.test(normalizedLineText(line));
}

function lineLooksBold(line) {
  const signature = [...(line.fontNames || []), ...(line.fontFamilies || [])].join(" ");
  return /bold|black|heavy|demi|semibold|medium/i.test(signature);
}

function isAllowedPeriodHeading(text) {
  return /^(?:Proof(?:\s+of\s+(?:Theorem|Lemma|Corollary|Proposition)\s+\d+(?:\.\d+)*)?|Remark|Lemma|Theorem|Corollary|Proposition|Definition|Example|Related work)(?:\s+\d+(?:\.\d+)*)?\.?$/i.test(text)
    || /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\.$/.test(text);
}

function isRunInPeriodProse(text) {
  return /\.$/.test(text) && !isAllowedPeriodHeading(text);
}

function headingPositionCredible(line, page) {
  const compact = compactPdfSmallCaps(normalizedLineText(line));
  if (/^(?:[IVXLCDM]+|[A-D])\.\s+(?:INTRODUCTION|CONCLUSIONS?|REFERENCES|ACKNOWLEDGEMENTS?|APPENDIX|DISCUSSION|RESULTS|METHODS?)\b/i.test(compact)) {
    return true;
  }
  const lanes = page.headingLanes && Object.values(page.headingLanes);
  if (!lanes || !lanes.length) return true;
  return lanes.some((lane) => {
    const lineCenter = line.x + line.width / 2;
    const laneCenter = lane.x + lane.width / 2;
    const leftAligned = Math.abs(line.x - lane.x) <= Math.max(34, lane.width * 0.15);
    const centered = Math.abs(lineCenter - laneCenter) <= lane.width * 0.08 && line.width <= lane.width * 0.82;
    return leftAligned || centered;
  });
}

function dominantTextFont(page) {
  const weights = new Map();
  (page.items || []).forEach((item) => {
    const size = Math.round((item.fontSize || 0) * 2) / 2;
    if (size < 5 || size > 18) return;
    weights.set(size, (weights.get(size) || 0) + Math.max(1, String(item.str || "").trim().length));
  });
  return [...weights.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
}

function dominantTextFontName(page) {
  const weights = new Map();
  (page.items || []).forEach((item) => {
    const letters = (String(item.str || "").match(/[A-Za-z]/g) || []).length;
    if (!item.fontName || letters < 3 || item.fontSize < 6 || item.fontSize > 15) return;
    weights.set(item.fontName, (weights.get(item.fontName) || 0) + letters);
  });
  return [...weights.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function isObviousHeadingAnchor(line, page) {
  const text = compactPdfSmallCaps(normalizedLineText(line)).replace(/\s*\|\s*/g, " ");
  if (!text || text.length > 110 || /[=<>∑∫√≈≤≥α-ωΑ-Ωλρδψημσ]/.test(text)) return false;
  if (/^(?:acknowledg(?:e)?ments?|appendix(?:\s+[a-z0-9]+)?|conclusions?|conflicts? of interest|data availability statement|discussion|endnotes|ethical considerations|introduction|limitations|methods?|results?|references)\s*[:.]?$/i.test(text)) return true;
  if (isStandaloneStructuralLabel(text)) return true;
  const numbered = text.match(/^((?:\d+(?:\.\d+)*|[A-D]|[IVXLCDM]+|[A-Z]\.\d+(?:\.\d+)*))(?:[.)])?\s+([A-Z].*)$/);
  if (!numbered) return false;
  const label = numbered[2];
  return label.split(/\s+/).length <= 12 && !/[,;!?]$/.test(label) && line.width <= page.pageSize.width * 0.75;
}

function deriveHeadingFontNames(extracted) {
  const counts = new Map();
  const documentWeights = new Map();
  extracted.pages.forEach((page) => (page.items || []).forEach((item) => {
    const letters = (String(item.str || "").match(/[A-Za-z]/g) || []).length;
    if (!item.fontName || letters < 3) return;
    documentWeights.set(item.fontName, (documentWeights.get(item.fontName) || 0) + letters);
  }));
  const dominantName = [...documentWeights.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  extracted.pages.forEach((page) => {
    semanticHeadingRows(groupLines(page.items), page).filter((line) => isObviousHeadingAnchor(line, page)).forEach((line) => {
      (line.items || []).filter((item) => (String(item.str || "").match(/[A-Za-z]/g) || []).length >= 2
        && !/[=<>∑∫√≈≤≥α-ωΑ-Ωλρδψημσ]/.test(String(item.str || "")))
        .map((item) => item.fontName).filter((name) => name && name !== dominantName)
        .forEach((name) => counts.set(name, (counts.get(name) || 0) + 1));
    });
  });
  return new Set([...counts.entries()].filter(([, count]) => count >= 2).map(([name]) => name));
}

function semanticHeadingRows(lines, page) {
  const styled = lines.flatMap((line) => {
    if (!Array.isArray(line.items) || line.items.length < 2) return [line];
    const runs = [];
    [...line.items].sort((a, b) => a.x - b.x).forEach((item) => {
      const last = runs[runs.length - 1];
      if (!last || last.fontName !== item.fontName) runs.push({ fontName: item.fontName, items: [item] });
      else last.items.push(item);
    });
    if (runs.length < 2) return [line];
    return runs.map((run) => {
      const geometry = unionBoxes(run.items.map(itemBox));
      return {
        ...geometry,
        text: run.items.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim(),
        maxFont: Math.max(...run.items.map((item) => item.fontSize || 0)),
        fontNames: [...new Set(run.items.map((item) => item.fontName).filter(Boolean))],
        fontFamilies: [...new Set(run.items.map((item) => item.fontFamily).filter(Boolean))],
        items: run.items,
      };
    });
  });
  const expanded = styled.flatMap((line) => {
    const crossesCenter = line.x < page.pageSize.width * 0.45 && line.x + line.width > page.pageSize.width * 0.55;
    if (!crossesCenter || !Array.isArray(line.items) || line.items.length < 2) return [line];
    const halves = [
      line.items.filter((item) => item.x + item.width / 2 < page.pageSize.width / 2),
      line.items.filter((item) => item.x + item.width / 2 >= page.pageSize.width / 2),
    ].filter((items) => items.length);
    if (halves.length < 2) return [line];
    return halves.map((items) => {
      const geometry = unionBoxes(items.map(itemBox));
      return {
        ...geometry,
        text: items.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim(),
        maxFont: Math.max(...items.map((item) => item.fontSize || 0)),
        fontNames: [...new Set(items.map((item) => item.fontName).filter(Boolean))],
        fontFamilies: [...new Set(items.map((item) => item.fontFamily).filter(Boolean))],
        items,
      };
    });
  });
  const bands = [];
  [...expanded].sort((a, b) => a.y - b.y || a.x - b.x).forEach((line) => {
    let band = bands.find((item) => Math.abs(item.y - line.y) <= 2.4);
    if (!band) {
      band = { y: line.y, lines: [] };
      bands.push(band);
    }
    band.lines.push(line);
  });
  return bands.flatMap((band) => {
    const out = [];
    [...band.lines].sort((a, b) => a.x - b.x).forEach((line) => {
      const last = out[out.length - 1];
      const gap = last ? line.x - (last.x + last.width) : Number.POSITIVE_INFINITY;
      const crossesCenter = last && last.x + last.width / 2 < page.pageSize.width / 2
        && line.x + line.width / 2 > page.pageSize.width / 2;
      const numberingPrefix = last && /^(?:\d+(?:\.\d+)*|[A-Z](?:\.\d+)*)(?:[.)])?$/.test(normalizedLineText(last));
      const sharedFont = last && (last.fontNames || []).some((name) => (line.fontNames || []).includes(name));
      const styleBoundary = last && !sharedFont && !numberingPrefix && last.width > 18 && line.width > 18;
      if (!last || gap > 24 || styleBoundary || (crossesCenter && last.width > 48 && line.width > 24)) {
        out.push({ ...line, items: [...line.items] });
      } else {
        const geometry = unionBoxes([lineBox(last), lineBox(line)]);
        Object.assign(last, geometry, {
          text: `${last.text} ${line.text}`.replace(/\s+/g, " ").trim(),
          maxFont: Math.max(last.maxFont, line.maxFont),
          fontNames: [...new Set([...(last.fontNames || []), ...(line.fontNames || [])])],
          fontFamilies: [...new Set([...(last.fontFamilies || []), ...(line.fontFamilies || [])])],
          items: [...last.items, ...line.items],
        });
      }
    });
    return out;
  });
}

function lineFromItems(items) {
  const geometry = unionBoxes(items.map(itemBox));
  return {
    ...geometry,
    text: items.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim(),
    maxFont: Math.max(...items.map((item) => item.fontSize || 0)),
    fontNames: [...new Set(items.map((item) => item.fontName).filter(Boolean))],
    fontFamilies: [...new Set(items.map((item) => item.fontFamily).filter(Boolean))],
    items,
  };
}

function isStandaloneStructuralLabel(text) {
  return /^(?:Problem\.?|(?:Proposition|Lemma|Remark|Theorem|Corollary)\s+\d+(?:\.\d+)*\.?)$/.test(String(text || "").trim());
}

function structuralLabelFragment(line) {
  const text = compactPdfSmallCaps(normalizedLineText(line));
  const match = text.match(/^(?:Problem\.?|(?:Proposition|Lemma|Remark|Theorem|Corollary)\s+\d+(?:\.\d+)*\.?)/);
  if (!match) return line;
  if (isStandaloneStructuralLabel(text)) return line;
  if (!Array.isArray(line.items) || !line.items.length) return line;
  const target = match[0].replace(/\s+/g, "").toLowerCase();
  const selected = [];
  for (const item of [...line.items].sort((a, b) => a.x - b.x)) {
    selected.push(item);
    const joined = compactPdfSmallCaps(selected.map((entry) => entry.str).join(" "))
      .replace(/\s+/g, "").toLowerCase();
    if (joined.length >= target.length) break;
  }
  const joined = compactPdfSmallCaps(selected.map((entry) => entry.str).join(" "))
    .replace(/\s+/g, "").toLowerCase();
  return joined === target ? lineFromItems(selected) : line;
}

function splitCrossColumnLines(lines, page, columnModel) {
  if (!columnModel || columnModel.layoutType !== "double_column") return lines;
  const partition = columnPartition(page, "double_column", columnModel);
  const mid = partition.gutterMid;
  return lines.flatMap((line) => {
    if (!Array.isArray(line.items) || line.items.length < 2) return [line];
    const left = line.items.filter((item) => item.x + item.width / 2 < mid);
    const right = line.items.filter((item) => item.x + item.width / 2 >= mid);
    if (!left.length || !right.length) return [line];
    const leftEnd = Math.max(...left.map((item) => item.x + item.width));
    const rightStart = Math.min(...right.map((item) => item.x));
    return rightStart - leftEnd > 12 ? [lineFromItems(left), lineFromItems(right)] : [line];
  });
}

function splitAtCanonicalGutter(lines, page, columnModel) {
  const geometry = columnModel && columnModel.columnGeometry;
  if (!geometry || !geometry.left || !geometry.right) return lines;
  const mid = (geometry.left.x + geometry.left.width + geometry.right.x) / 2;
  return lines.flatMap((line) => {
    if (!Array.isArray(line.items) || line.items.length < 2) return [line];
    const left = line.items.filter((item) => item.x + item.width / 2 < mid);
    const right = line.items.filter((item) => item.x + item.width / 2 >= mid);
    if (!left.length || !right.length) return [line];
    const leftEnd = Math.max(...left.map((item) => item.x + item.width));
    const rightStart = Math.min(...right.map((item) => item.x));
    return rightStart - leftEnd > 12 ? [lineFromItems(left), lineFromItems(right)] : [line];
  });
}

function isSectionHeadingLine(line, page) {
  const text = compactPdfSmallCaps(normalizedLineText(line)).replace(/\s*\|\s*/g, " ");
  if (!text || text.length > 110 || isReferencesHeadingLine(line) || isKeywordsLine(line) || isFigureCaptionLine(line) || isTableCaptionLine(line)) return false;
  if (/^Prompt\.?$/i.test(text)) return false;
  const knownHeadingTypeface = page.headingFontNames instanceof Set
    && (line.fontNames || []).some((name) => page.headingFontNames.has(name));
  if (/^(acknowledg(?:e)?ments?|appendix(?:\s+[a-z0-9]+)?|conclusions?|conflicts? of interest|data availability statement|discussion|endnotes|ethical considerations|limitations|methods?|results?)\s*[:.]?$/i.test(text)) return true;
  if (isStandaloneStructuralLabel(text)) return true;
  if (/^(?:Problem\.?|(?:Proposition|Lemma|Remark|Theorem|Corollary)\s+\d+(?:\.\d+)*\.?)\b/.test(text)) {
    const fragment = structuralLabelFragment(line);
    return fragment !== line && isStandaloneStructuralLabel(compactPdfSmallCaps(normalizedLineText(fragment)));
  }
  const numbered = text.match(/^((?:\d+(?:\.\d+)*|[A-D]|[IVXLCDM]+|[A-Z]\.\d+(?:\.\d+)*))(?:[.)])?\s+([A-Za-z].*)$/);
  if (numbered) {
    const label = numbered[2].trim();
    const words = label.split(/\s+/).filter(Boolean);
    const mathSignals = (label.match(/[=<>∑∫√≈≤≥α-ωΑ-Ωλρδψημσ]|\b(?:sin|cos|log|exp)\b/gi) || []).length;
    const equationPunctuation = (label.match(/[=+/*()[\]{}]/g) || []).length;
    const proseSignals = (label.match(/[,;!?]|\bet al\.|\b(?:which|that|because|while|however)\b/gi) || []).length;
    const lowercaseLetters = (label.match(/[a-z]/g) || []).length;
    const uppercaseLetters = (label.match(/[A-Z]/g) || []).length;
    const numberedListItem = /^\d+[.)]\s/.test(text) && !/^\d+\.\d+/.test(text);
    const flushWithLane = !(page.headingLanes && Object.values(page.headingLanes).length)
      || Object.values(page.headingLanes).some((lane) => Math.abs(line.x - lane.x) <= 10);
    return line.maxFont >= 8.5
      && (knownHeadingTypeface || /^[A-Z]/.test(label))
      && headingPositionCredible(line, page)
      && (!numberedListItem || flushWithLane)
      && words.length >= 1
      && words.length <= 12
      && label.length <= 88
      && (lowercaseLetters >= 2 || uppercaseLetters >= 3)
      && !/^(?:The|This|That|These|Those|It|We)\b/.test(label)
      && !/:$/.test(label)
      && !isRunInPeriodProse(label)
      && mathSignals === 0
      && equationPunctuation < 2
      && proseSignals === 0
      && line.width <= page.pageSize.width * 0.72;
  }
  const words = text.replace(/[.:]$/, "").split(/\s+/).filter(Boolean);
  if (lineLooksBold(line) && knownHeadingTypeface
    && words.length >= 1 && words.length <= 8
    && text.length <= 72
    && /^[A-Z]/.test(text)
    && (text.match(/[a-z]/g) || []).length >= 4
    && headingPositionCredible(line, page)
    && !/^(?:The|This|That|These|Those|It|We|Our|A|An)\b/.test(text)
    && !/[=<>∑∫√≈≤≥α-ωΑ-Ωλρδψημσ]/.test(text)
    && !isRunInPeriodProse(text)
    && line.width <= page.pageSize.width * 0.48) return true;
  // A bold run-in label ending in a period remains part of its paragraph.
  // Geometry only elevates explicit structural labels and full headings; it
  // must not fragment Body around "Techniques." or similar prose prefixes.
  const plainWords = text.split(/\s+/).filter(Boolean);
  const displayTypeface = page.headingStyleAllowed === true && page.headingFontNames instanceof Set
    && (line.fontNames || []).some((name) => page.headingFontNames.has(name));
  if (displayTypeface
    && plainWords.length >= 1 && plainWords.length <= 10
    && /^[A-Z]/.test(text)
    && (text.match(/[a-z]/g) || []).length >= 4
    && headingPositionCredible(line, page)
    && !/^(?:The|This|That|These|Those|It|We|Our|A|An)\b/.test(text)
    && !/[=<>∑∫√≈≤≥α-ωΑ-Ωλρδψημσ]/.test(text)
    && !/[,;!?]$/.test(text)
    && !isRunInPeriodProse(text)
    && line.width <= page.pageSize.width * 0.52) return true;
  // Uppercase alone is not structural evidence: author names, running heads,
  // table cells and broken title lines are commonly uppercase too.
  return false;
}

function groupRowBands(lines, tolerance = 2.2) {
  const rows = [];
  [...lines].sort((a, b) => a.y - b.y || a.x - b.x).forEach((line) => {
    const row = rows.find((candidate) => Math.abs(candidate.anchorY - line.y) <= tolerance);
    if (row) row.lines.push(line);
    else rows.push({ anchorY: line.y, lines: [line] });
  });
  return rows.map((row) => ({
    ...row,
    geometry: unionBoxes(row.lines.map(lineBox)),
    numericCells: row.lines.filter((line) => /^[-+]?\d+(?:\.\d+)?%?$/.test(normalizedLineText(line))).length,
    numericTokens: row.lines.reduce((count, line) => count + ((normalizedLineText(line).match(/(?:^|\s)[-+]?\d+(?:\.\d+)?%?(?=\s|$)/g) || []).length), 0),
  }));
}

function lineSequence(lines, startIndex, stop, maxLines = 12, maxGap = 22) {
  const block = [];
  let bottom = null;
  for (let index = startIndex; index < lines.length && block.length < maxLines; index += 1) {
    const line = lines[index];
    if (index > startIndex && stop(line)) break;
    if (bottom != null && line.y - bottom > maxGap) break;
    block.push(line);
    bottom = line.y + line.height;
  }
  return block;
}

function isMathHeavy(line) {
  if (isBodyLikeLine(line)) return false;
  const text = line.text;
  if (/https?:\/\/|\b(?:url|www)\s*=|\b[a-z0-9.-]+\.(?:com|org|net|edu)\b/i.test(text)) return false;
  const ops = (text.match(/[=+\-/*()\[\]^_]/g) || []).length;
  const words = text.split(/\s+/).filter(Boolean).length;
  return ops >= 6 && words <= 16 && line.maxFont <= 11.5;
}

function buildIndependentRegions(page, types, lines, columnModel) {
  const regions = [];
  const gaps = [];
  const used = new Set();
  const seeds = columnIndependentSeeds(columnModel, page);
  const clusters = visualClusters(page, { tall: true });
  const usedClusters = new Set();
  page.headingStyleAllowed = columnModel.layoutType === "single_column";
  page.headingLanes = columnPartition(page, columnModel.layoutType, columnModel).lanes;
  const semanticRows = semanticHeadingRows(lines, page);

  const pushMeasured = (type, geometry, provenance) => {
    let clipped = clipToPage(geometry, page) || geometry;
    const maxHeightRatio = type === "abstract" ? 0.48 : type === "figure" ? 0.78 : type === "table" ? 0.58 : type === "other_independent" ? 0.18 : 0.36;
    if (clipped.height > page.pageSize.height * maxHeightRatio) {
      clipped = box(clipped.x, clipped.y, clipped.width, page.pageSize.height * maxHeightRatio);
    }
    if (!reasonableIndependent(clipped, page, type)) return false;
    const duplicate = regions.some((item) => {
      const hit = intersectBoxes(item.geometry, clipped);
      return hit && item.type === type && boxArea(hit) / Math.max(1, Math.min(boxArea(item.geometry), boxArea(clipped))) > 0.82;
    });
    if (duplicate) return false;
    regions.push({ type, geometry: clipped, provenance });
    return true;
  };

  const tryText = (type, block, provenance) => {
    const available = block.filter((line) => !used.has(line));
    if (!available.length) return false;
    const pushed = pushMeasured(type, unionBoxes(available.map(lineBox)), provenance);
    if (pushed) available.forEach((line) => used.add(line));
    return pushed;
  };

  const textProvenance = (type, index) => [{
    sourceArtifactId: `text:p${page.pageNumber}:${type}:${index + 1}`,
    producer: "offline-pdfjs-text-cluster",
    coordinateSpace: "pdf-page-top-left-points",
    transformChain: ["pdfjs-text-content", "baseline-to-page-top-left", "tight-semantic-content-box"],
  }];

  const detectTitle = () => {
    const top = lines.filter((line) => line.y < page.pageSize.height * 0.3 && line.y > page.pageSize.height * 0.04);
    if (!top.length) return [];
    const maxFont = Math.max(...top.map((line) => line.maxFont));
    const seed = top.find((line) => line.maxFont >= maxFont * 0.92);
    if (!seed) return [];
    return takeBlock(lines, lines.indexOf(seed), /^(abstract|keywords|index terms|introduction|1[\.\s])/i, 6)
      .filter((line) => line.y < seed.y + 52 && line.maxFont >= maxFont * 0.94);
  };

  const detectAbstract = () => {
    const canonicalRows = splitAtCanonicalGutter(lines, page, columnModel)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const splitHeading = headingLine(canonicalRows, /\babstract\b/i, 0.58, page);
    const splitHeadingCenter = splitHeading ? splitHeading.x + splitHeading.width / 2 : page.pageSize.width / 2;
    const usesCanonicalLane = Boolean(columnModel && columnModel.columnGeometry && columnModel.columnGeometry.left && columnModel.columnGeometry.right)
      && splitHeading
      && Math.abs(splitHeadingCenter - page.pageSize.width / 2) > page.pageSize.width * 0.12;
    const sourceRows = usesCanonicalLane ? canonicalRows : lines;
    const heading = usesCanonicalLane ? splitHeading : headingLine(lines, /\babstract\b/i, 0.58, page);
    if (heading) {
      const partition = columnPartition(page, usesCanonicalLane ? "double_column" : columnModel.layoutType, columnModel);
      const lane = Object.values(partition.walls).find((wall) => centerInside(lineBox(heading), wall));
      const local = lane ? sourceRows.filter((line) => centerInside(lineBox(line), lane)
        && (!usesCanonicalLane || line.width <= lane.width * 1.18)).sort((a, b) => a.y - b.y || a.x - b.x) : sourceRows;
      const block = lineSequence(local, local.indexOf(heading), (line) => (!usesCanonicalLane && isKeywordsLine(line)) || isSectionHeadingLine(line, page), 36, 24)
        .filter((line) => line.y < heading.y + page.pageSize.height * 0.46);
      if (!usesCanonicalLane) return block;
      const keyword = block.find(isKeywordsLine);
      return keyword ? block.filter((line) => line.y <= keyword.y + 36) : block;
    }
    return [];
  };

  const detectKeywordBlocks = () => lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => isKeywordsLine(line))
    .map(({ line, index }) => lineSequence(lines, index, (next) => isSectionHeadingLine(next, page) || isReferencesHeadingLine(next), 4, 18)
      .filter((next) => next.y < line.y + 60));

  const detectSectionHeadings = () => {
    const rows = [...semanticRows].sort((a, b) => a.y - b.y || a.x - b.x);
    return rows.filter((line) => isSectionHeadingLine(line, page)).map((line) => {
      const compactText = compactPdfSmallCaps(normalizedLineText(line));
      const label = structuralLabelFragment(line);
      const block = [label];
      if (isStandaloneStructuralLabel(compactText)
        || /^(?:Problem\.?|(?:Proposition|Lemma|Remark|Theorem|Corollary)\s+\d+(?:\.\d+)*\.?)\s*/.test(compactText)) return block;
      if (/^algorithm\s+\d+/i.test(compactText)) {
        const sameRow = rows.filter((next) => next !== line
          && Math.abs(next.y - line.y) <= 2.5
          && next.x > line.x + line.width - 2
          && next.x - (line.x + line.width) <= 36
          && (line.fontNames || []).some((name) => (next.fontNames || []).includes(name)));
        if (sameRow.length) block.push(sameRow[0]);
      }
      let bottom = line.y + line.height;
      for (const next of rows) {
        if (next.y <= line.y + 1 || next.y - bottom > 8) continue;
        if (Math.abs(next.x - line.x) > 16) continue;
        const text = normalizedLineText(next).replace(/\s*\|\s*/g, " ");
        const words = text.split(/\s+/).filter(Boolean);
        if (!text || words.length > 8 || text.length > 78 || /[.!?]$/.test(text)) continue;
        const sameTypeface = (line.fontNames || []).some((name) => (next.fontNames || []).includes(name));
        const continuationTypeface = sameTypeface && (lineLooksBold(next)
          || (page.headingFontNames instanceof Set && (next.fontNames || []).some((name) => page.headingFontNames.has(name))));
        if (!continuationTypeface || !headingPositionCredible(next, page)) continue;
        block.push(next);
        break;
      }
      return block;
    });
  };

  const detectAuthorAffiliationBlocks = () => {
    if (page.pageNumber !== 1) return [];
    const title = regions.find((item) => item.type === "title");
    const abstractLine = lines.find((line) => /\babstract\b/i.test(normalizedLineText(line)));
    const keywordsLine = lines.find(isKeywordsLine);
    const y0 = page.pageSize.height * 0.04;
    const y1 = Math.min(...[abstractLine && abstractLine.y, keywordsLine && keywordsLine.y, page.pageSize.height * 0.48].filter(Number.isFinite));
    const anchors = lines.filter((line) => {
      if (line.y < y0 || line.y >= y1 || used.has(line)) return false;
      const text = normalizedLineText(line);
      if (/^(correspondence|received|revised|accepted|funding|conflicts? of interest|copyright)\s*:/i.test(text)) return false;
      return /\b(university|department|institute|institution|school|college|centre|center|laborator|research|faculty|academy|hospital|@|orcid)\b/i.test(text)
        || /@[a-z0-9.-]+\.[a-z]{2,}/i.test(text);
    });
    if (!anchors.length) return [];
    const titleBottom = title ? title.geometry.y + title.geometry.height : y0;
    const candidateLines = lines.filter((line) => line.y >= titleBottom - 1 && line.y < y1 && !used.has(line)
      && !/^(correspondence|received|revised|accepted|funding|conflicts? of interest|copyright)\s*:/i.test(normalizedLineText(line)));
    const anchorTop = Math.min(...anchors.map((line) => line.y));
    const anchorBottom = Math.max(...anchors.map((line) => line.y + line.height));
    const block = candidateLines.filter((line) => line.y >= Math.max(titleBottom, anchorTop - 58) && line.y <= anchorBottom + 34);
    return block.length ? [block] : [];
  };

  const detectMetadataBlocks = () => lines
    .filter((line) => page.pageNumber === 1 && /^(correspondence|received|revised|accepted|funding|conflicts? of interest|copyright)\s*:/i.test(normalizedLineText(line)))
    .map((line) => [line]);

  const captionBlocks = (kind) => {
    const match = kind === "table" ? isTableCaptionLine : isFigureCaptionLine;
    const rows = splitCrossColumnLines(lines, page, columnModel).sort((a, b) => a.y - b.y || a.x - b.x);
    return rows.map((line, index) => ({ line, index })).filter(({ line }) => match(line)).map(({ line, index }) => {
      const block = [line];
      let bottom = line.y + line.height;
      const captionPartition = columnPartition(page, columnModel.layoutType, columnModel);
      const captionSide = captionPartition.layout === "double_column"
        ? (line.x + line.width / 2 < captionPartition.gutterMid ? "left" : "right")
        : "single";
      for (let cursor = index + 1; cursor < rows.length && block.length < 10; cursor += 1) {
        const next = rows[cursor];
        if (captionPartition.layout === "double_column") {
          const nextSide = next.x + next.width / 2 < captionPartition.gutterMid ? "left" : "right";
          if (nextSide !== captionSide) continue;
        }
        const verticalGap = next.y - bottom;
        if (verticalGap > 6 || next.y >= line.y + 96) break;
        if (isSectionHeadingLine(next, page) || isFigureCaptionLine(next) || isTableCaptionLine(next)) break;
        const accumulated = unionBoxes(block.map(lineBox));
        const previous = block[block.length - 1];
        const separatedByGutter = kind === "table" && captionPartition.layout === "double_column"
          && (accumulated.x + accumulated.width / 2 < captionPartition.gutterMid) !== (next.x + next.width / 2 < captionPartition.gutterMid);
        const sameRowAdjacent = !separatedByGutter && Math.abs(next.y - previous.y) <= 2.5
          && next.x <= accumulated.x + accumulated.width + 18
          && next.x + next.width >= accumulated.x - 18;
        const sameLane = line.width > page.pageSize.width * 0.58
          || (next.width > page.pageSize.width * 0.42 && next.x <= line.x + 72)
          || sameRowAdjacent
          || accumulated.width > page.pageSize.width * 0.58
          || Math.abs((next.x + next.width / 2) - (line.x + line.width / 2)) < page.pageSize.width * 0.28;
        if (!sameLane || Math.abs(next.maxFont - line.maxFont) > 1.35) break;
        block.push(next);
        bottom = Math.max(bottom, next.y + next.height);
      }
      return block;
    });
  };

  const captionAnchoredVisualEnvelope = (captionBox) => {
    const canonical = columnPartition(page, columnModel.layoutType, columnModel);
    const spansPage = captionBox.width >= page.pageSize.width * 0.55
      || (canonical.gutterMid && captionBox.x < canonical.gutterMid && captionBox.x + captionBox.width > canonical.gutterMid);
    const wall = spansPage ? box(0, 0, page.pageSize.width, page.pageSize.height)
      : Object.values(canonical.walls).find((candidate) => centerInside(captionBox, candidate))
        || box(0, 0, page.pageSize.width, page.pageSize.height);
    const operators = usableVisuals(page).filter((item) => {
      const geometry = item.geometry;
      const cx = geometry.x + geometry.width / 2;
      return geometry.y + geometry.height <= captionBox.y + 4
        && captionBox.y - (geometry.y + geometry.height) <= page.pageSize.height * 0.68
        && cx >= wall.x && cx <= wall.x + wall.width
        && (spansPage || overlapX(inflateBox(captionBox, 42), geometry));
    }).sort((a, b) => (b.geometry.y + b.geometry.height) - (a.geometry.y + a.geometry.height));
    if (!operators.length || captionBox.y - (operators[0].geometry.y + operators[0].geometry.height) > 96) return null;
    const selected = [operators[0]];
    let top = operators[0].geometry.y;
    for (const item of operators.slice(1)) {
      const geometry = item.geometry;
      const gap = top - (geometry.y + geometry.height);
      if (gap > 62) continue;
      selected.push(item);
      top = Math.min(top, geometry.y);
    }
    let geometry = unionBoxes(selected.map((item) => item.geometry));
    const text = lines.filter((line) => {
      const lineGeometry = lineBox(line);
      const cx = lineGeometry.x + lineGeometry.width / 2;
      return lineGeometry.y >= geometry.y - 34
        && lineGeometry.y + lineGeometry.height <= captionBox.y + 2
        && cx >= wall.x && cx <= wall.x + wall.width
        && (spansPage || (lineGeometry.x >= wall.x - 12 && lineGeometry.x + lineGeometry.width <= wall.x + wall.width + 12))
        && !isBodyLikeLine(line);
    });
    if (text.length) geometry = unionBoxes([geometry, ...text.map(lineBox)]);
    return { geometry, sources: selected };
  };

  if (page.pageNumber === 1 || types.includes("title")) tryText("title", detectTitle(), textProvenance("title", 0));
  detectAuthorAffiliationBlocks().forEach((block, index) => tryText("author_affiliation", block, textProvenance("author_affiliation", index)));
  const abstractBlock = detectAbstract();
  if (abstractBlock.length) tryText("abstract", abstractBlock, textProvenance("abstract", 0));
  detectMetadataBlocks().forEach((block, index) => tryText("other_independent", block, textProvenance("other_independent", index)));
  const abstractContainsKeywords = abstractBlock.some(isKeywordsLine);
  if (!abstractContainsKeywords) detectKeywordBlocks().forEach((block, index) => {
    const geometry = unionBoxes(block.map(lineBox));
    const absorbed = regions.some((item) => item.type === "abstract" && (() => {
      const hit = intersectBoxes(item.geometry, geometry);
      return hit && boxArea(hit) / Math.max(1, boxArea(geometry)) > 0.7;
    })());
    if (!absorbed) tryText("keywords", block, textProvenance("keywords", index));
  });
  lines.filter(isReferencesHeadingLine).forEach((line, index) => tryText("references_section_header", [line], textProvenance("references_section_header", index)));
  detectSectionHeadings().forEach((block, index) => tryText("section_heading", block, textProvenance("section_heading", index)));

  const figureCaptions = captionBlocks("figure");
  figureCaptions.forEach((block, index) => tryText("figure_caption", block, textProvenance("figure_caption", index)));
  figureCaptions.forEach((block, captionIndex) => {
    const captionBox = unionBoxes(block.map(lineBox));
    const envelope = captionAnchoredVisualEnvelope(captionBox);
    const candidates = clusters.map((geometry, clusterIndex) => ({ geometry, clusterIndex }))
      .filter(({ geometry, clusterIndex }) => !usedClusters.has(clusterIndex)
        && geometry.y + geometry.height <= captionBox.y + 4
        && captionBox.y - (geometry.y + geometry.height) <= page.pageSize.height * 0.5
        && overlapX(inflateBox(captionBox, 28), geometry)
        && boxArea(geometry) >= 900
        && Math.min(geometry.width, geometry.height) >= 36)
      .sort((a, b) => (captionBox.y - (a.geometry.y + a.geometry.height)) - (captionBox.y - (b.geometry.y + b.geometry.height)) || boxArea(b.geometry) - boxArea(a.geometry));
    const selected = envelope || candidates[0];
    if (!selected) {
      gaps.push({ pageNumber: page.pageNumber, type: "figure", reason: `caption ${captionIndex + 1} has no credible operator-backed visual object; no box invented` });
      return;
    }
    if (Number.isInteger(selected.clusterIndex)) usedClusters.add(selected.clusterIndex);
    const source = selected.sources || usableVisuals(page).filter((item) => overlap(item.geometry, inflateBox(selected.geometry, 2)));
    pushMeasured("figure", selected.geometry, source.map((item) => ({
      sourceArtifactId: item.sourceArtifactId,
      producer: "offline-pdfjs-operator-list",
      coordinateSpace: "pdf-page-top-left-points",
      transformChain: ["caption-anchored-visual-match", "operator-backed-cluster", "tight-visual-content-box"],
    })));
  });

  // A large raster-backed panel is credible figure evidence even when its
  // caption is absent from the text layer or placed on an adjacent page.
  // Vector-only decoration is intentionally excluded from this fallback.
  clusters.forEach((geometry, clusterIndex) => {
    if (usedClusters.has(clusterIndex)) return;
    const pageArea = page.pageSize.width * page.pageSize.height;
    if (boxArea(geometry) < pageArea * 0.085
      || geometry.width < page.pageSize.width * 0.42
      || geometry.height < page.pageSize.height * 0.12) return;
    const rasterSources = (page.images || []).filter((item) => {
      const hit = intersectBoxes(item.geometry, geometry);
      return hit && boxArea(hit) / Math.max(1, Math.min(boxArea(item.geometry), boxArea(geometry))) > 0.35;
    });
    if (!rasterSources.length) return;
    const alreadyOwned = regions.some((region) => {
      const hit = intersectBoxes(region.geometry, geometry);
      return hit && boxArea(hit) / Math.max(1, boxArea(geometry)) > 0.3;
    });
    if (alreadyOwned) return;
    if (pushMeasured("figure", geometry, rasterSources.map((item) => ({
      sourceArtifactId: item.sourceArtifactId,
      producer: "offline-pdfjs-operator-list",
      coordinateSpace: "pdf-page-top-left-points",
      transformChain: ["large-raster-backed-panel", "operator-backed-cluster", "tight-visual-content-box"],
    })))) usedClusters.add(clusterIndex);
  });

  (page.images || []).forEach((item, index) => {
    const geometry = item.geometry;
    const pageArea = page.pageSize.width * page.pageSize.height;
    if (boxArea(geometry) < pageArea * 0.085 || boxArea(geometry) > pageArea * 0.72
      || geometry.width < page.pageSize.width * 0.42 || geometry.height < page.pageSize.height * 0.12) return;
    const alreadyOwned = regions.some((region) => {
      const hit = intersectBoxes(region.geometry, geometry);
      return hit && boxArea(hit) / Math.max(1, boxArea(geometry)) > 0.65;
    });
    if (alreadyOwned) return;
    pushMeasured("figure", geometry, [{
      sourceArtifactId: item.sourceArtifactId || `image:p${page.pageNumber}:${index + 1}`,
      producer: "offline-pdfjs-operator-list",
      coordinateSpace: "pdf-page-top-left-points",
      transformChain: ["large-embedded-raster", "tight-visual-content-box"],
    }]);
  });

  captionBlocks("table").forEach((block, index) => {
    const caption = block[0];
    const captionBox = unionBoxes(block.map(lineBox));
    const tablePartition = columnPartition(page, columnModel.layoutType, columnModel);
    const captionCenterX = captionBox.x + captionBox.width / 2;
    const fullWidthRule = tablePartition.layout === "double_column" && [...(page.drawings || []), ...(page.images || [])].some((item) => {
      const geometry = item.geometry;
      return geometry.y >= captionBox.y - 6
        && geometry.y <= captionBox.y + page.pageSize.height * 0.3
        && geometry.x < tablePartition.gutterMid - 2
        && geometry.x + geometry.width > tablePartition.gutterMid + 2
        && geometry.width > page.pageSize.width * 0.58;
    });
    const tableWall = tablePartition.layout === "double_column" && !fullWidthRule && captionBox.width < page.pageSize.width * 0.58
      ? Object.values(tablePartition.walls).find((wall) => captionCenterX >= wall.x && captionCenterX <= wall.x + wall.width)
      : null;
    const belongsToTableLane = (geometry) => !tableWall || centerInside(geometry, tableWall);
    // Table rules are often sub-point horizontal strokes and are intentionally
    // filtered out of generic figure visuals.  Inspect the raw drawing stream
    // here, but only when it is caption-anchored and not already owned by a
    // figure.
    const tableOperators = [...(page.drawings || []), ...(page.images || [])].filter((item) => {
      const geometry = item.geometry;
      const overlapsKnownFigure = regions.some((region) => {
        if (region.type !== "figure") return false;
        const hit = intersectBoxes(region.geometry, geometry);
        return hit && boxArea(hit) / Math.max(1, Math.min(boxArea(region.geometry), boxArea(geometry))) > 0.2;
      });
      return geometry.y >= captionBox.y - 6
        && geometry.y <= captionBox.y + page.pageSize.height * 0.3
        && belongsToTableLane(geometry)
        && (tablePartition.layout === "single" || overlapX(inflateBox(captionBox, 32), geometry))
        && (geometry.height <= 8 && geometry.width >= Math.max(70, captionBox.width * 0.35)
          || (page.images || []).includes(item) && geometry.width >= 28 && geometry.height >= 28)
        && !overlapsKnownFigure;
    });
    const visual = tableOperators.length >= 2 ? unionBoxes(tableOperators.map((item) => item.geometry)) : null;
    const blockBottom = Math.max(...block.map((line) => line.y + line.height));
    const nextCaptionY = lines
      .filter((line) => line.y > caption.y + 1 && (isTableCaptionLine(line) || isFigureCaptionLine(line)))
      .reduce((value, line) => Math.min(value, line.y), Number.POSITIVE_INFINITY);
    const singleLane = tablePartition.layout === "single" ? tablePartition.lanes.single : null;
    const horizontalWindow = box(
      tableWall ? tableWall.x : singleLane ? singleLane.x : Math.max(0, captionBox.x - 32),
      blockBottom - 1,
      tableWall ? tableWall.width : singleLane ? singleLane.width : Math.min(page.pageSize.width, captionBox.width + 64),
      Math.max(1, Math.min(caption.y + page.pageSize.height * 0.32, nextCaptionY) - blockBottom)
    );
    const following = lines.filter((line) => line.y >= blockBottom - 0.5
      && line.y < horizontalWindow.y + horizontalWindow.height
      && belongsToTableLane(lineBox(line))
      && overlapX(lineBox(line), horizontalWindow));
    const rowBands = groupRowBands(following);
    const isMathHeavyRow = (row) => row.lines.length > 0
      && row.lines.filter(isMathHeavy).length >= Math.max(1, Math.ceil(row.lines.length / 2));
    const isDisplayMathRow = (row) => {
      const ops = row.lines.reduce((count, line) => count + ((String(line.text || "").match(/[=+\-/*()[\]^_∼~]/g) || []).length), 0);
      const avgWidth = row.lines.reduce((sum, line) => sum + line.width, 0) / Math.max(1, row.lines.length);
      const numericRatio = row.numericCells / Math.max(1, row.lines.length);
      if (numericRatio >= 0.6 && row.numericTokens >= 3) return false;
      return ops >= 4 && avgWidth < 96;
    };
    const isStrongTableRow = (row) => !isMathHeavyRow(row) && !isDisplayMathRow(row)
      && (row.lines.length >= 3 || row.numericCells >= 2
        || (row.numericTokens >= 3 && row.lines.length >= 2 && !row.lines.every(isMathHeavy)));
    const evidenceBands = rowBands.filter(isStrongTableRow);
    const firstEvidence = evidenceBands.find((row) => row.anchorY - blockBottom <= 54);
    let selectedBands = [];
    if (firstEvidence) {
      let lastBottom = firstEvidence.geometry.y + firstEvidence.geometry.height;
      const firstEvidenceFont = Math.max(...firstEvidence.lines.map((line) => line.maxFont || line.height || 0));
      for (const row of rowBands.filter((item) => item.anchorY >= firstEvidence.anchorY)) {
        if (row.geometry.y - lastBottom > 24) break;
        const strongRow = isStrongTableRow(row);
        const alignedContinuation = row.lines.length >= 2
          && row.geometry.width >= captionBox.width * 0.45
          && row.geometry.y - lastBottom <= 8;
        if (!strongRow && !alignedContinuation) {
          const rowFont = Math.max(...row.lines.map((line) => line.maxFont || line.height || 0));
          const hasEstablishedRows = selectedBands.filter(isStrongTableRow).length >= 2;
          if (hasEstablishedRows && rowFont > firstEvidenceFont * 1.2) break;
          selectedBands.push(row);
          lastBottom = Math.max(lastBottom, row.geometry.y + row.geometry.height);
          continue;
        }
        selectedBands.push(row);
        lastBottom = Math.max(lastBottom, row.geometry.y + row.geometry.height);
      }
    }
    let selectedEvidenceCount = selectedBands.filter(isStrongTableRow).length;
    if (selectedEvidenceCount < 2) {
      const preceding = lines.filter((line) => line.y + line.height <= captionBox.y + 1
        && line.y >= Math.max(0, captionBox.y - page.pageSize.height * 0.32)
        && belongsToTableLane(lineBox(line))
        && overlapX(lineBox(line), horizontalWindow));
      const precedingBands = groupRowBands(preceding);
      const lastEvidence = [...precedingBands].reverse().find((row) => isStrongTableRow(row)
        && captionBox.y - (row.geometry.y + row.geometry.height) <= 54);
      if (lastEvidence) {
        const reversed = [];
        let nextTop = lastEvidence.geometry.y;
        for (const row of [...precedingBands].filter((item) => item.anchorY <= lastEvidence.anchorY).reverse()) {
          if (nextTop - (row.geometry.y + row.geometry.height) > 24) break;
          const alignedContinuation = row.lines.length >= 2
            && row.geometry.width >= captionBox.width * 0.45;
          if (!isStrongTableRow(row) && !alignedContinuation && reversed.filter(isStrongTableRow).length >= 2) break;
          reversed.push(row);
          nextTop = Math.min(nextTop, row.geometry.y);
        }
        const precedingSelection = reversed.reverse();
        const precedingEvidenceCount = precedingSelection.filter(isStrongTableRow).length;
        if (precedingEvidenceCount > selectedEvidenceCount) {
          selectedBands = precedingSelection;
          selectedEvidenceCount = precedingEvidenceCount;
        }
      }
    }
    const selectedBottom = selectedBands.length
      ? Math.max(...selectedBands.map((row) => row.geometry.y + row.geometry.height))
      : captionBox.y + captionBox.height;
    const credibleVisual = visual && visual.height <= Math.max(140, selectedBottom - captionBox.y + 30) ? visual : null;
    if (!credibleVisual && selectedEvidenceCount < 2) {
      gaps.push({ pageNumber: page.pageNumber, type: "table", reason: `table caption ${index + 1} has no credible aligned row evidence; no box invented` });
      return;
    }
    const evidence = [captionBox, ...(credibleVisual ? [credibleVisual] : []), ...block.slice(1).map(lineBox), ...selectedBands.flatMap((row) => row.lines.map(lineBox))];
    pushMeasured("table", unionBoxes(evidence), textProvenance("table", index));
  });

  // A table and a figure are separate owners.  When a vector/raster cluster
  // begins inside an already measured table but continues well below it, clip
  // the figure to the first safe point below the table instead of allowing the
  // two rectangles to claim the same page content.
  regions.filter((item) => item.type === "figure").forEach((figure) => {
    regions.filter((item) => item.type === "table").forEach((table) => {
      const hit = intersectBoxes(figure.geometry, table.geometry);
      if (!hit || boxArea(hit) / Math.max(1, boxArea(figure.geometry)) < 0.03) return;
      const tableBottom = table.geometry.y + table.geometry.height;
      const figureBottom = figure.geometry.y + figure.geometry.height;
      if (table.geometry.y > figure.geometry.y + figure.geometry.height * 0.55 || figureBottom - tableBottom < 36) return;
      const safeY = tableBottom + 4;
      figure.geometry = box(figure.geometry.x, safeY, figure.geometry.width, figureBottom - safeY);
      figure.provenance = [...figure.provenance, {
        sourceArtifactId: `table-ownership:p${page.pageNumber}`,
        producer: "geometry-independent-owner-arbitration",
        coordinateSpace: "pdf-page-top-left-points",
        transformChain: ["table-tight-content-owner", "figure-clipped-below-table", "4pt-owner-gap"],
      }];
    });
  });

  ["title", "abstract"].forEach((type) => {
    if (regions.some((item) => item.type === type) || !types.includes(type)) return;
    const seed = seeds.find((item) => item.type === type);
    if (seed && pushMeasured(type, seed.geometry, [{
      sourceArtifactId: seed.sourceArtifactId,
      producer: "column-page-column-model-readonly",
      coordinateSpace: "pdf-page-top-left-points",
      transformChain: ["page-column-model/v1", "semantic-seed-fallback", "tight-semantic-content-box"],
    }])) return;
    gaps.push({ pageNumber: page.pageNumber, type, reason: "declared upstream object has no explicit text block or credible semantic seed" });
  });

  types.filter((type) => ["figure", "figure_caption", "table", "references_section_header"].includes(type)).forEach((type) => {
    if (!regions.some((item) => item.type === type)) gaps.push({ pageNumber: page.pageNumber, type, reason: "declared upstream object is missing from evidence-backed candidate generation" });
  });

  return { regions, gaps, used };
}

function formulaRegions(page, lines, independents) {
  const candidates = lines.filter((line) => isMathHeavy(line) && !independents.some((region) => centerInside(lineBox(line), region.geometry)));
  if (!candidates.length) return [];
  const clustered = clusterBoxes(candidates.map(lineBox), 6)
    .filter((geometry) => geometry.height >= 18 && geometry.width >= 70);
  return clustered.map((geometry) => ({
    kind: "formula",
    geometry,
  }));
}

function emitTightClusters(lines, kind, page) {
  if (!lines.length) return [];
  return clusterBoxes(lines.map(lineBox), 8).map((geometry) => clipToPage(geometry, page)).filter(Boolean).map((geometry) => ({
    kind,
    geometry,
  }));
}

function detectReferenceStartPage(extracted) {
  for (const page of extracted.pages) {
    const lines = groupLines(page.items);
    if (lines.some(isReferencesHeadingLine)) return page.pageNumber;
  }
  const lateThreshold = Math.max(1, Math.floor(extracted.pageCount * 0.65));
  for (const page of extracted.pages.filter((item) => item.pageNumber >= lateThreshold)) {
    const lines = groupLines(page.items);
    const numbered = lines.filter((line) => /^\s*(?:\[\d+\]|\d+\.)\s+/.test(normalizedLineText(line)));
    const citations = lines.filter((line) => /\b(?:doi|arxiv|vol\.|pp?\.|et al\.)\b/i.test(normalizedLineText(line)));
    const years = lines.filter((line) => /(?:\(|\b)(?:19|20)\d{2}[a-z]?(?:\)|\b)/.test(normalizedLineText(line)));
    if (numbered.length >= 4 && citations.length >= 2 && years.length >= 2) return page.pageNumber;
  }
  return null;
}

function isReferenceEntryLead(line) {
  return /^\s*(?:\[\d+\]|\d+\.)\s+/.test(normalizedLineText(line));
}

function hasReferencePageEvidence(lines, heading) {
  if (heading) return true;
  const leads = lines.filter(isReferenceEntryLead);
  const citationDense = lines.filter((line) => /\b(?:doi|arxiv|vol\.|pp?\.|et al\.)\b/i.test(normalizedLineText(line)));
  const years = lines.filter((line) => /(?:\(|\b)(?:19|20)\d{2}[a-z]?(?:\)|\b)/.test(normalizedLineText(line)));
  return (leads.length >= 2 && citationDense.length >= 2)
    || (leads.length >= 3 && years.length >= 2)
    || (citationDense.length >= 3 && years.length >= 3);
}

function referenceAnchorY(page, lines, heading, referenceStartPage) {
  if (heading) {
    const geometry = heading.geometry || heading.expectedGeometry;
    if (geometry) return geometry.y + geometry.height;
  }
  const leads = lines
    .filter((line) => !isHeaderLikeLine(line, page) && !isFooterLikeLine(line, page) && isReferenceEntryLead(line))
    .sort((a, b) => a.y - b.y);
  if (leads.length < 2) return null;
  const first = leads[0];
  const nearbySecond = leads.find((line, index) => index > 0 && line.y - first.y <= page.pageSize.height * 0.32);
  if (!nearbySecond) return null;
  return first.y;
}

function referenceEntryRegions(page, lines, independents, referenceStartPage, layout, columnModel) {
  if (!referenceStartPage || page.pageNumber < referenceStartPage) return [];
  const heading = independents.find((item) => item.type === "references_section_header");
  if (!hasReferencePageEvidence(lines, heading)) return [];
  let partition = columnPartition(page, layout, columnModel);
  const sourcePartitionLayout = partition.layout;
  const canonicalGeometry = columnModel && columnModel.columnGeometry;
  if (partition.layout === "single" && canonicalGeometry && canonicalGeometry.left && canonicalGeometry.right) {
    const doublePartition = columnPartition(page, "double_column", columnModel);
    const mid = doublePartition.gutterMid;
    const continuousWideEvidence = lines.filter((line) => {
      const evidence = isReferenceEntryLead(line)
        || /\b(?:doi|arxiv|vol\.|pp?\.|et al\.)\b/i.test(normalizedLineText(line))
        || /(?:\(|\b)(?:19|20)\d{2}[a-z]?(?:\)|\b)/.test(normalizedLineText(line));
      if (!evidence || line.width < page.pageSize.width * 0.62 || !Array.isArray(line.items)) return false;
      const left = line.items.filter((item) => item.x + item.width / 2 < mid);
      const right = line.items.filter((item) => item.x + item.width / 2 >= mid);
      if (!left.length || !right.length) return false;
      const leftEnd = Math.max(...left.map((item) => item.x + item.width));
      const rightStart = Math.min(...right.map((item) => item.x));
      return rightStart - leftEnd <= 12;
    }).length;
    const evidenceIn = (wall) => lines.filter((line) => {
      if (Array.isArray(line.items) && line.items.length) {
        return line.items.some((item) => {
          const cx = item.x + item.width / 2;
          return cx >= wall.x && cx <= wall.x + wall.width;
        });
      }
      const cx = line.x + line.width / 2;
      return cx >= wall.x && cx <= wall.x + wall.width;
    }).filter((line) => isReferenceEntryLead(line)
      || /\b(?:doi|arxiv|vol\.|pp?\.|et al\.)\b/i.test(normalizedLineText(line))
      || /(?:\(|\b)(?:19|20)\d{2}[a-z]?(?:\)|\b)/.test(normalizedLineText(line))).length;
    if (continuousWideEvidence < 2
      && evidenceIn(doublePartition.walls.left) >= 2
      && evidenceIn(doublePartition.walls.right) >= 2) partition = doublePartition;
  }
  const wallEntries = Object.entries(partition.walls);
  const headingGeometry = heading && (heading.geometry || heading.expectedGeometry);
  const headingColumnIndex = headingGeometry ? wallEntries.findIndex(([, wall]) => {
    const hit = intersectBoxes(headingGeometry, wall);
    return hit && boxArea(hit) / Math.max(1, boxArea(headingGeometry)) >= 0.2;
  }) : -1;
  const regions = wallEntries.flatMap(([columnId, wall], columnIndex) => {
    const laneLines = lines.flatMap((line) => {
      const items = (line.items || []).filter((item) => {
        const cx = item.x + item.width / 2;
        return cx >= wall.x && cx <= wall.x + wall.width;
      });
      if (!items.length) {
        const geometry = lineBox(line);
        const cx = geometry.x + geometry.width / 2;
        return cx >= wall.x && cx <= wall.x + wall.width ? [line] : [];
      }
      const geometry = unionBoxes(items.map(itemBox));
      return [{
        ...geometry,
        text: items.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim(),
        maxFont: Math.max(...items.map((item) => item.fontSize || 0)),
        fontNames: [...new Set(items.map((item) => item.fontName).filter(Boolean))],
        fontFamilies: [...new Set(items.map((item) => item.fontFamily).filter(Boolean))],
        items,
      }];
    }).filter((line) => !isReferencesHeadingLine(line)
      && !isHeaderLikeLine(line, page)
      && !isFooterLikeLine(line, page)
      && line.y < page.pageSize.height * 0.95
      && Boolean(normalizedLineText(line)))
      .sort((a, b) => a.y - b.y);
    const leads = laneLines.filter(isReferenceEntryLead);
    const citations = laneLines.filter((line) => /\b(?:doi|arxiv|vol\.|pp?\.|et al\.)\b/i.test(normalizedLineText(line)));
    const years = laneLines.filter((line) => /(?:\(|\b)(?:19|20)\d{2}[a-z]?(?:\)|\b)/.test(normalizedLineText(line)));
    const followsHeadingLane = page.pageNumber === referenceStartPage && headingColumnIndex >= 0 && columnIndex > headingColumnIndex;
    const ownsHeading = page.pageNumber === referenceStartPage && headingColumnIndex === columnIndex;
    const trustedLane = leads.length >= 1
      || (citations.length >= 2 && years.length >= 2)
      || ((ownsHeading || followsHeadingLane) && years.length >= 2)
      || (page.pageNumber > referenceStartPage && (citations.length >= 1 || years.length >= 1));
    if (!trustedLane) return [];
    let laneY0 = page.pageNumber > referenceStartPage
      ? laneLines[0]?.y ?? null
      : leads[0]?.y ?? citations[0]?.y ?? years[0]?.y ?? null;
    if (headingGeometry) {
      const wallHit = intersectBoxes(headingGeometry, wall);
      if (wallHit && boxArea(wallHit) / Math.max(1, boxArea(headingGeometry)) >= 0.2) {
        laneY0 = headingGeometry.y + headingGeometry.height;
      }
    }
    if (laneY0 === null) return [];
    const owned = laneLines.filter((line) => line.y >= laneY0 - 0.5);
    if (!owned.length) return [];
    return [{ kind: "reference_entries", columnId, geometry: unionBoxes(owned.map(lineBox)) }];
  });
  if (sourcePartitionLayout === "single" && partition.layout === "double_column" && regions.length > 1) {
    const mutuallyOverlapping = regions.some((region, index) => regions.slice(index + 1).some((other) => {
      const hit = intersectBoxes(region.geometry, other.geometry);
      return hit && boxArea(hit) / Math.max(1, Math.min(boxArea(region.geometry), boxArea(other.geometry))) > 0.55;
    }));
    if (mutuallyOverlapping) {
      const y0 = referenceAnchorY(page, lines, heading, referenceStartPage);
      if (y0 !== null) {
        const owned = lines.filter((line) => !isReferencesHeadingLine(line)
          && !isHeaderLikeLine(line, page)
          && !isFooterLikeLine(line, page)
          && line.y >= y0 - 0.5
          && line.y < page.pageSize.height * 0.95
          && Boolean(normalizedLineText(line)));
        if (owned.length) return [{ kind: "reference_entries", columnId: "single", geometry: unionBoxes(owned.map(lineBox)) }];
      }
    }
  }
  return regions;
}

function protectedRegionsFromSemantics(page, lines, independents, referenceStartPage, layout, columnModel) {
  const title = independents.find((item) => item.type === "title");
  const headerLines = lines.filter((line) => {
    if (!isHeaderLikeLine(line, page)) return false;
    if (title && overlap(lineBox(line), title.geometry) && line.maxFont >= 12) return false;
    return true;
  });
  const pageNumberLines = headerLines.filter(isPageNumberLine);
  const runningHeaders = headerLines.filter((line) => !isPageNumberLine(line));
  const footerNumberLines = lines.filter((line) => isFooterLikeLine(line, page) && isPageNumberLine(line));
  const footerLines = lines.filter((line) => isFooterLikeLine(line, page) && !isPageNumberLine(line));
  const regions = [
    ...emitTightClusters(runningHeaders, "header", page),
    ...emitTightClusters(pageNumberLines, "page_number", page),
    ...emitTightClusters(footerNumberLines, "page_number", page),
    ...emitTightClusters(footerLines, "footer", page),
  ];
  const referenceRegions = referenceEntryRegions(page, lines, independents, referenceStartPage, layout, columnModel);
  referenceRegions.forEach((item) => regions.push(item));
  formulaRegions(page, lines, [...independents, ...referenceRegions]).forEach((item) => regions.push(item));
  visualWholes(page, lines).forEach((cluster) => {
    if (Math.min(cluster.width, cluster.height) < 36 || boxArea(cluster) < 900) return;
    const covered = [...independents, ...regions].some((item) => {
      const hit = intersectBoxes(cluster, item.geometry);
      return hit && boxArea(hit) / Math.max(1, boxArea(cluster)) > 0.3;
    });
    if (covered) return;
    for (let index = regions.length - 1; index >= 0; index -= 1) {
      const existing = regions[index];
      if (existing.kind !== "formula") continue;
      const hit = intersectBoxes(cluster, existing.geometry);
      if (hit && boxArea(hit) / Math.max(1, boxArea(existing.geometry)) > 0.6) regions.splice(index, 1);
    }
    regions.push({
      kind: "authoritative_preserve",
      geometry: cluster,
    });
  });
  return regions;
}

function regionOwnsLine(region, line, margin = 1) {
  const geometry = lineBox(line);
  const grown = inflateBox(region.geometry, margin);
  if (centerInside(geometry, grown)) return true;
  const hit = intersectBoxes(geometry, region.geometry);
  return Boolean(hit && boxArea(hit) / Math.max(1, boxArea(geometry)) > 0.2);
}

function blocksBodyEvidence(region) {
  const kind = region.type || region.kind;
  return !["section_heading", "formula"].includes(kind);
}

function isBodyContinuationLine(line) {
  const text = normalizedLineText(line);
  if (!text || line.maxFont > 13 || isMathHeavy(line)) return false;
  if (isFigureCaptionLine(line) || isTableCaptionLine(line) || isReferencesHeadingLine(line) || isKeywordsLine(line)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  const numeric = (text.match(/\d+(?:\.\d+)?/g) || []).length;
  return words.length >= 2 && line.width >= 32 && numeric < Math.max(2, words.length * 0.55);
}

function laneLocalTextLines(page, lane, wall) {
  const items = page.items.filter((item) => {
    const geometry = itemBox(item);
    const cx = geometry.x + geometry.width / 2;
    if (cx < wall.x || cx > wall.x + wall.width) return false;
    if (geometry.width > lane.width * 1.5) return false;
    return overlapX(geometry, inflateBox(lane, 12));
  });
  return groupLines(items).filter((line) => {
    const geometry = lineBox(line);
    const cx = geometry.x + geometry.width / 2;
    return cx >= wall.x && cx <= wall.x + wall.width && geometry.width <= lane.width * 1.12;
  });
}

function laneEvidenceGeometry(line, lane) {
  return intersectBoxes(lineBox(line), lane);
}

function isBodyExcludedTopMatterLine(line, page) {
  if (page.pageNumber !== 1 || line.y >= page.pageSize.height * 0.48) return false;
  const text = normalizedLineText(line);
  return /\b(university|department|institute|institution|school|college|centre|center|laborator|faculty|academy|hospital|@|orcid)\b/i.test(text)
    || /^(correspondence|received|revised|accepted|funding|conflicts? of interest|copyright)\s*:/i.test(text);
}

function isSemanticUnresolvedBridge(line, page) {
  const text = normalizedLineText(line);
  if (!text || isHeaderLikeLine(line, page) || isFooterLikeLine(line, page)) return false;
  if (isFigureCaptionLine(line) || isTableCaptionLine(line) || isReferencesHeadingLine(line) || isKeywordsLine(line)) return false;
  return line.width >= 18 && line.maxFont <= 14.5;
}

function credibleLaneBodyLines(page, lane, wall, semanticRegions) {
  const blockers = semanticRegions.filter(blocksBodyEvidence);
  return laneLocalTextLines(page, lane, wall).filter((line) => {
    if (isHeaderLikeLine(line, page) || isFooterLikeLine(line, page)) return false;
    if (blockers.some((region) => regionOwnsLine(region, line, 1))) return false;
    if (isBodyExcludedTopMatterLine(line, page)) return false;
    if (isFigureCaptionLine(line) || isTableCaptionLine(line) || isReferencesHeadingLine(line) || isKeywordsLine(line)) return false;
    return isBodyLikeLine(line) || isMathHeavy(line);
  });
}

function bodyColumnSegmentsFromFlow(page, lane, wall, semanticRegions) {
  const blockers = semanticRegions.filter(blocksBodyEvidence);
  const laneLines = laneLocalTextLines(page, lane, wall).filter((line) => {
    if (isHeaderLikeLine(line, page) || isFooterLikeLine(line, page)) return false;
    return !blockers.some((region) => regionOwnsLine(region, line, 1));
  });
  const anchors = credibleLaneBodyLines(page, lane, wall, semanticRegions);
  if (!anchors.length) return [];

  // A Body region is the continuous lane-local main reading flow. Formula-like
  // lines and unresolved-but-readable lines remain members of that flow and do
  // not acquire truncation authority. The extent is derived only from observed
  // text evidence; there is deliberately no page/lane-interior fallback.
  const evidence = anchors;
  const tight = unionBoxes(evidence.map((line) => laneEvidenceGeometry(line, lane)).filter(Boolean));
  const padded = box(
    lane.x,
    Math.max(0, tight.y - BODY_BOUNDARY_MARGIN),
    lane.width,
    Math.min(page.pageSize.height, tight.y + tight.height + BODY_BOUNDARY_MARGIN) - Math.max(0, tight.y - BODY_BOUNDARY_MARGIN),
  );
  const evidenceBacked = padded.width >= 48 && padded.height >= 4 && boxArea(padded) >= 180;
  return evidenceBacked ? [padded] : [];
}

function bodyBoxes(page, layout, semanticRegions, columnModel) {
  const partition = columnPartition(page, layout, columnModel);
  if (layout === "double_column") {
    return {
      left: bodyColumnSegmentsFromFlow(page, partition.lanes.left, partition.walls.left, semanticRegions),
      right: bodyColumnSegmentsFromFlow(page, partition.lanes.right, partition.walls.right, semanticRegions),
    };
  }
  return { single: bodyColumnSegmentsFromFlow(page, partition.lanes.single, partition.walls.single, semanticRegions) };
}

function makeRegion({ regionId, regionClass, owner, geometry, profile, provenance, extra }) {
  return {
    regionId,
    regionClass,
    owner,
    expectedGeometry: geometry,
    toleranceProfileId: profile,
    relations: [],
    sourceProvenance: provenance,
    evidenceRefs: [EVIDENCE_ID],
    ...extra,
  };
}

function buildOracle(paperKey, columnSample, extracted, columnModelsByPage, identityChecks, gaps) {
  const sourceDocumentId = `doc.layout-geometry.${paperKey}`;
  const sampleId = `sample.layout-geometry.${paperKey}`;
  const referenceStartPage = detectReferenceStartPage(extracted);
  const pages = extracted.pages.map((page) => {
    const column = columnIdentity(columnSample, page.pageNumber);
    const columnModel = columnModelsByPage.get(page.pageNumber);
    if (!columnModel) {
      throw new Error(`${paperKey} p${page.pageNumber} missing frozen Column PageColumnModel`);
    }
    if (columnModel.layoutType !== column.layout || JSON.stringify(columnModel.columns) !== JSON.stringify(column.columns)) {
      throw Object.assign(new Error(`${paperKey} p${page.pageNumber} Column baseline layout diverges from frozen corpus identity`), { code: "COLUMN_IDENTITY_CONFLICT" });
    }
    const lines = groupLines(page.items);
    const layoutCheck = classifyBodyLayout(page.items, page.pageSize.width, page.pageSize.height);
    identityChecks.push({
      sampleId: columnSample.id,
      paperKey,
      pageNumber: page.pageNumber,
      columnLayout: column.layout,
      observedLayout: layoutCheck.observedLayout,
      confidence: layoutCheck.confidence,
      counts: {
        paired: layoutCheck.paired,
        spanning: layoutCheck.spanning,
        singleSide: layoutCheck.singleSide,
        total: layoutCheck.total,
      },
      heuristicDisagrees: layoutCheck.confidence === "high" && layoutCheck.observedLayout !== "unknown" && layoutCheck.observedLayout !== column.layout,
      conflict: false,
      note: "Heuristic body-flow check is observation only. Column layout remains the identity source; Geometry does not reclassify.",
    });
    const independent = buildIndependentRegions(page, column.independentTypes, lines, columnModel);
    independent.gaps.forEach((gap) => gaps.push({ paperKey, ...gap }));
    const protectedRegions = protectedRegionsFromSemantics(page, lines, independent.regions, referenceStartPage, column.layout, columnModel);
    const semanticRegions = [...independent.regions, ...protectedRegions];
    const bodies = bodyBoxes(page, column.layout, semanticRegions, columnModel);
    const pageColumnModelRef = `page-column-model/v1:page-${page.pageNumber}`;
    const pageColumnModelHash = identityHash({
      schemaVersion: "page-column-model/v1",
      authority: "AA-COLUMN-001",
      sourceDocumentId: columnSample.id,
      pageNumber: page.pageNumber,
      pageSize: page.pageSize,
      layoutType: column.layout,
      columns: column.columns,
      independentRegionTypes: column.independentTypes,
    });
    const regions = [];
    const columnRef = (columnId) => ({ pageColumnModelRef, authority: "AA-COLUMN-001", columnId });
    const emitBodies = (columnId, geometries) => {
      if (!geometries || !geometries.length) {
        gaps.push({ paperKey, pageNumber: page.pageNumber, type: "body_column", reason: `No credible lane-local body-flow member in canonical ${columnId} column; no page-interior fallback emitted` });
        return;
      }
      geometries.forEach((geometry, bandIndex) => regions.push(makeRegion({
        regionId: `p${page.pageNumber}.body.${columnId}.${bandIndex + 1}`,
        regionClass: "body_column",
        owner: `column:${columnId}`,
        geometry,
        profile: "body-edge",
        extra: { canonicalColumnRef: columnRef(columnId) },
        provenance: [{
          sourceArtifactId: `text:p${page.pageNumber}:body-flow:${columnId}:band-${bandIndex + 1}`,
          producer: "offline-body-column-envelope",
          coordinateSpace: "pdf-page-top-left-points",
          transformChain: ["frozen-canonical-lane", "lane-local-text-flow-chain", "credible-main-reading-flow", "formula-has-no-truncation-authority", "semantic-unresolved-bridge", "tight-evidence-envelope", "fixed-body-boundary-margin:2.5pt"],
        }],
      })));
    };
    if (column.layout === "double_column") {
      emitBodies("left", bodies.left);
      emitBodies("right", bodies.right);
    } else {
      emitBodies("single", bodies.single);
    }
    independent.regions.forEach((item, index) => {
      regions.push(makeRegion({
        regionId: `p${page.pageNumber}.independent.${item.type}.${index + 1}`,
        regionClass: "independent_region",
        owner: `independent:${item.type}`,
        geometry: item.geometry,
        profile: "independent-edge",
        extra: { semanticRegionType: item.type },
        provenance: item.provenance,
      }));
    });
    protectedRegions.forEach((item, index) => {
      regions.push(makeRegion({
        regionId: `p${page.pageNumber}.protected.${item.kind}.${index + 1}`,
        regionClass: "protected_region",
        owner: `protected:${item.kind}`,
        geometry: item.geometry,
        profile: "protected-edge",
        extra: { protectedKind: item.kind },
        provenance: [{
          sourceArtifactId: `text:p${page.pageNumber}:protected:${item.kind}:${index + 1}`,
          producer: "offline-pdfjs-text-cluster",
          coordinateSpace: "pdf-page-top-left-points",
          transformChain: ["pdfjs-text-content", "baseline-to-page-top-left", "tight-protected-content-box"],
        }],
      }));
    });
    const contentBlockers = regions.filter((region) => ["independent_region", "protected_region"].includes(region.regionClass));
    contentBlockers.forEach((source, index) => {
      const otherContents = contentBlockers.filter((item) => item.regionId !== source.regionId).map((item) => item.expectedGeometry);
      safetyMarginStrips(source.expectedGeometry, page, otherContents).forEach(({ side, pieceIndex, geometry }) => regions.push(makeRegion({
        regionId: `p${page.pageNumber}.protected.margin.${index + 1}.${side}.${pieceIndex + 1}`,
        regionClass: "protected_region",
        owner: `protected:margin:${source.regionId}:${side}`,
        geometry,
        profile: "protected-edge",
        extra: { protectedKind: "margin" },
        provenance: [{
          sourceArtifactId: source.regionId,
          producer: "offline-safety-margin-envelope",
          coordinateSpace: "pdf-page-top-left-points",
          transformChain: ["tight-source-box", `margin-side:${side}`, `clearance-${SAFETY_MARGIN}pt`, "clip-to-page", "subtract-neighbor-content", "disjoint-from-content-geometry"],
        }],
      })));
    });
    const subtractBlockers = regions
      .filter((region) => region.regionClass === "independent_region" || region.regionClass === "protected_region")
      .map((region) => region.expectedGeometry);
    regions.filter((region) => region.regionClass === "body_column").forEach((body) => {
      const columnId = body.canonicalColumnRef.columnId;
      writableSpaces(body.expectedGeometry, subtractBlockers).forEach((writable, index) => {
        regions.push(makeRegion({
          regionId: `p${page.pageNumber}.writable.${columnId}.${index + 1}`,
          regionClass: "writable_space_expectation",
          owner: `writable:${columnId}`,
          geometry: writable,
          profile: "writable-edge",
          extra: { canonicalColumnRef: columnRef(columnId) },
          provenance: [{
            sourceArtifactId: `${body.regionId}->writable:${index + 1}`,
            producer: "offline-writable-subtraction",
            coordinateSpace: "pdf-page-top-left-points",
            transformChain: ["continuous-body-column", "subtract-explicit-safety-margin-regions", "retain-all-viable-rectangles"],
          }],
        }));
      });
    });
    const byId = Object.fromEntries(regions.map((region) => [region.regionId, region]));
    regions.forEach((region) => {
      regions.forEach((other) => {
        if (region.regionId === other.regionId) return;
        if (region.regionClass === "body_column" && other.regionClass === "body_column") addRelation(region, other.regionId, region.expectedGeometry, other.expectedGeometry);
        else if (region.regionClass === "writable_space_expectation" && other.regionClass === "body_column" && other.canonicalColumnRef.columnId === region.canonicalColumnRef.columnId) {
          addRelation(region, other.regionId, region.expectedGeometry, other.expectedGeometry);
        } else if (region.regionClass === "independent_region" && other.regionClass === "body_column") {
          addRelation(region, other.regionId, region.expectedGeometry, other.expectedGeometry);
        } else if (region.regionClass === "protected_region" && other.regionClass === "body_column") {
          addRelation(region, other.regionId, region.expectedGeometry, other.expectedGeometry);
        } else if (region.semanticRegionType === "figure_caption" && other.semanticRegionType === "figure") {
          addRelation(region, other.regionId, region.expectedGeometry, other.expectedGeometry);
        }
      });
    });
    Object.values(byId);
    return {
      identity: {
        sourceDocumentId,
        pageNumber: page.pageNumber,
        pageId: `page-${page.pageNumber}`,
        pageColumnModelRef,
        pageColumnModelHash,
      },
      pageSize: page.pageSize,
      rotation: page.rotation,
      cropBox: page.cropBox,
      mediaBox: page.mediaBox,
      regions,
    };
  });
  const first = extracted.pages[0];
    const created = reviewEvent(1, "created", "Geometry candidate clipped to frozen Column lanes and identity; Column layout was not reclassified.", null);
    const reviewing = { ...reviewEvent(2, "review_started", "Candidate overlay contact sheets are ready for named human review. Not accepted and not promoted.", created.hash), at: "2026-09-19T04:00:30.000Z" };
    reviewing.hash = hashCanonical({
      sequence: 2,
      action: "review_started",
      actor: ACTOR,
      at: reviewing.at,
      reason: reviewing.reason,
      previousHash: created.hash,
    });
  return {
    schemaVersion: "layout-geometry-oracle/v1",
    capabilityId: "cap.layout-geometry",
    catalogRole: "regression_oracle",
    runtimeDecisionUse: "forbidden",
    sample: {
      sampleId,
      sourceDocumentId,
      fileName: columnSample.source.fileName,
      mediaType: "application/pdf",
      sha256: columnSample.source.sha256,
      bytes: columnSample.source.bytes,
      pageCount: columnSample.source.pageCount,
      provenance: {
        kind: "user_provided",
        reference: `${columnSample.id}; ${columnSample.provenance.reference}`,
      },
    },
    coordinateContract: {
      coordinateSpace: "pdf-page-top-left-points",
      unit: "point",
      origin: "top_left",
      xDirection: "right",
      yDirection: "down",
      rotationApplied: first.rotation,
      cropBoxBaseline: first.cropBox,
      mediaBoxBaseline: first.mediaBox,
    },
    toleranceProfiles: toleranceProfiles(),
    pages,
    failureClasses: ["identity_failure", "structural_failure", "tolerance_deviation"],
    evidenceRefs: [
      EVIDENCE_ID,
      "EVD-20260916-COLUMN-PILOT-CURRENT-CAPTURE",
      "EVD-20260916-COLUMN-PILOT-TEXT-FLOW-REVIEW",
    ],
    reviewHistory: [created, reviewing],
    authorityBoundary: {
      geometryOwner: "AA-GEOMETRY-001",
      columnDependency: "AA-COLUMN-001",
      columnDependencyMode: "read_only_reference",
      runtimeDecisionUse: "forbidden",
      forbiddenActions: [
        "reclassify_column",
        "mutate_column_truth",
        "auto_repair_runtime",
        "auto_promote_candidate",
        "override_identity_or_structure_with_tolerance",
      ],
    },
  };
}

function overlayHtml(paperKey, oracle) {
  const colors = {
    body_column: "#2563eb",
    independent_region: "#d97706",
    protected_region: "#dc2626",
    writable_space_expectation: "#059669",
  };
  const pages = oracle.pages.map((page) => {
    const scale = 140 / page.pageSize.width;
    const height = page.pageSize.height * scale;
    const shapes = page.regions.map((region) => {
      const box = region.expectedGeometry;
      return `<rect x="${box.x * scale}" y="${box.y * scale}" width="${box.width * scale}" height="${box.height * scale}" fill="${colors[region.regionClass]}" fill-opacity="0.18" stroke="${colors[region.regionClass]}" stroke-width="0.8"><title>${region.regionId}</title></rect>`;
    }).join("");
    const legend = page.regions.map((region) => `<li><span style="color:${colors[region.regionClass]}">${region.regionClass}</span> ${region.regionId} ${JSON.stringify(region.expectedGeometry)}</li>`).join("");
    return `<section><h3>${paperKey} p${page.identity.pageNumber}</h3><svg width="${140}" height="${height}" viewBox="0 0 ${140} ${height}" style="background:#f8fafc;border:1px solid #cbd5e1">${shapes}</svg><ul>${legend}</ul></section>`;
  }).join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${paperKey} geometry overlay</title><style>body{font:13px/1.4 sans-serif;margin:16px}section{margin-bottom:28px}ul{font-size:11px}</style></head><body><p>Candidate overlay only. Compare with the source PDF. Not accepted, not promoted, not runtime truth.</p>${pages}</body></html>`;
}

function autoCheck(oracles, columnCorpus, extractedByPaper) {
  const bodyColumnCountMismatches = [];
  const fragmentedBodyColumnIds = [];
  const mixedSemanticBoxes = [];
  const contentBoxesWithSafetyInflation = [];
  const writableSafetyViolations = [];
  const unprotectedPeripheralLines = [];
  const incompleteCoveragePages = [];
  const hugeBoxes = [];
  const missedLargeVisuals = [];
  const missingSemanticObjects = [];
  const ownershipConflicts = [];
  const missingSafetyMargins = [];
  const invalidSafetyMargins = [];
  const ghostObjectBoxes = [];
  const writableContentViolations = [];
  const referenceBoundaryFailures = [];
  const bodyVerticalOverextensions = [];
  const bodyPrematureTruncations = [];
  const bodyCrossesCrossColumnObjects = [];
  const headingFalsePositiveSuspects = [];
  const safetyMarginContentConflicts = [];
  const bodyCoverageFailures = [];
  const bodyCoverageEvidence = [];
  oracles.forEach((oracle) => {
    const paperKey = oracle.sample.sampleId.replace("sample.layout-geometry.", "");
    const columnSample = columnCorpus.samples.find((sample) => sample.id === `sample.column-pilot.${paperKey}`);
    const extracted = extractedByPaper[paperKey];
    const columnModelsByPage = loadColumnModels(paperKey);
    const referenceStartPage = extracted ? detectReferenceStartPage(extracted) : null;
    oracle.pages.forEach((page) => {
      const identity = columnIdentity(columnSample, page.identity.pageNumber);
      const bodies = page.regions.filter((region) => region.regionClass === "body_column");
      const independents = page.regions.filter((region) => region.regionClass === "independent_region");
      const protecteds = page.regions.filter((region) => region.regionClass === "protected_region");
      const margins = protecteds.filter((region) => region.protectedKind === "margin");
      const writables = page.regions.filter((region) => region.regionClass === "writable_space_expectation");
      const contentRegions = [...independents, ...protecteds.filter((region) => region.protectedKind !== "margin")];
      const pageArea = page.pageSize.width * page.pageSize.height;
      const loc = `${paperKey}.p${page.identity.pageNumber}`;
      const expectedColumns = identity.layout === "double_column" ? ["left", "right"] : ["single"];
      const actualColumns = [...new Set(bodies.map((region) => region.canonicalColumnRef.columnId))].sort();
      if (actualColumns.some((columnId) => !expectedColumns.includes(columnId))) {
        bodyColumnCountMismatches.push({ page: loc, expectedColumns, actualColumns });
      }
      expectedColumns.forEach((columnId) => {
        const bands = bodies.filter((region) => region.canonicalColumnRef.columnId === columnId).sort((a, b) => a.expectedGeometry.y - b.expectedGeometry.y);
        bands.forEach((region, index) => {
          if (!/\.(?:left|right|single)\.\d+$/.test(region.regionId)) fragmentedBodyColumnIds.push({ page: loc, regionId: region.regionId, reason: "body band lacks stable band identity" });
          if (index > 0 && intersectBoxes(bands[index - 1].expectedGeometry, region.expectedGeometry)) {
            fragmentedBodyColumnIds.push({ page: loc, regionId: region.regionId, reason: "body bands overlap instead of representing disjoint evidence spans" });
          }
        });
      });
      [...independents, ...protecteds].forEach((region) => {
        if (region.protectedKind === "margin") return;
        const ratio = boxArea(region.expectedGeometry) / pageArea;
        const limit = region.semanticRegionType === "figure" || region.semanticRegionType === "table" || region.protectedKind === "authoritative_preserve" ? 0.5
          : region.protectedKind === "reference_entries" ? 0.75 : 0.42;
        if (ratio > limit) hugeBoxes.push({ page: loc, regionId: region.regionId, pageAreaRatio: Number(ratio.toFixed(3)) });
        if (region.protectedKind !== "margin" && region.sourceProvenance.some((source) => source.transformChain.some((step) => /char-pad|equal-char-pad|inflate/i.test(step)))) {
          contentBoxesWithSafetyInflation.push({ page: loc, regionId: region.regionId });
        }
      });
      independents.forEach((region, index) => {
        independents.slice(index + 1).forEach((other) => {
          if (region.semanticRegionType === other.semanticRegionType) return;
          const hit = intersectBoxes(region.expectedGeometry, other.expectedGeometry);
          if (!hit) return;
          const ratio = boxArea(hit) / Math.max(1, Math.min(boxArea(region.expectedGeometry), boxArea(other.expectedGeometry)));
          if (ratio > 0.35) mixedSemanticBoxes.push({ page: loc, first: region.regionId, second: other.regionId, overlapRatio: Number(ratio.toFixed(3)) });
        });
      });
      writables.forEach((writable) => margins.forEach((margin) => {
        const hit = intersectBoxes(writable.expectedGeometry, margin.expectedGeometry);
        if (hit && boxArea(hit) > 0.5) writableSafetyViolations.push({ page: loc, writable: writable.regionId, margin: margin.regionId });
      }));
      contentRegions.forEach((source) => {
        const ownedMargins = margins.filter((margin) => margin.sourceProvenance.some((provenance) => provenance.sourceArtifactId === source.regionId));
        const sides = new Set(ownedMargins.flatMap((margin) => margin.sourceProvenance.flatMap((provenance) => provenance.transformChain.filter((step) => step.startsWith("margin-side:")).map((step) => step.slice("margin-side:".length)))));
        ["top", "bottom", "left", "right"].forEach((side) => {
          const geometry = source.expectedGeometry;
          const closedByPageBoundary = (side === "top" && geometry.y <= 0.5)
            || (side === "bottom" && geometry.y + geometry.height >= page.pageSize.height - 0.5)
            || (side === "left" && geometry.x <= 0.5)
            || (side === "right" && geometry.x + geometry.width >= page.pageSize.width - 0.5);
          if (!sides.has(side) && !closedByPageBoundary) missingSafetyMargins.push({ page: loc, regionId: source.regionId, side });
        });
        ownedMargins.forEach((margin) => {
          const hit = intersectBoxes(source.expectedGeometry, margin.expectedGeometry);
          if (hit && boxArea(hit) > 0.5) invalidSafetyMargins.push({ page: loc, regionId: source.regionId, margin: margin.regionId, overlapArea: round(boxArea(hit)) });
        });
      });
      writables.forEach((writable) => contentRegions.forEach((content) => {
        const hit = intersectBoxes(writable.expectedGeometry, content.expectedGeometry);
        if (hit && boxArea(hit) > 0.5) writableContentViolations.push({ page: loc, writable: writable.regionId, content: content.regionId });
      }));
      const extractedPage = extracted && extracted.pages[page.identity.pageNumber - 1];
      if (!extractedPage) return;
      const lines = groupLines(extractedPage.items);
      const lineCoveredBy = (line, predicate) => {
        const geometry = lineBox(line);
        return page.regions.some((region) => predicate(region) && (centerInside(geometry, inflateBox(region.expectedGeometry, 1)) || (intersectBoxes(geometry, region.expectedGeometry) && boxArea(intersectBoxes(geometry, region.expectedGeometry)) / Math.max(1, boxArea(geometry)) > 0.55)));
      };
      const requireSemantic = (line, type, reason) => {
        if (!lineCoveredBy(line, (region) => region.regionClass === "independent_region" && region.semanticRegionType === type)) {
          missingSemanticObjects.push({ page: loc, type, text: normalizedLineText(line).slice(0, 120), reason });
        }
      };
      lines.filter(isKeywordsLine).forEach((line) => requireSemantic(line, "keywords", "explicit keywords marker"));
      lines.filter((line) => isSectionHeadingLine(line, extractedPage) && !/^abstract\s*[:.]?$/i.test(normalizedLineText(line))).forEach((line) => requireSemantic(line, "section_heading", "section-heading signature"));
      lines.filter(isReferencesHeadingLine).forEach((line) => requireSemantic(line, "references_section_header", "explicit References/Bibliography heading"));
      lines.filter(isFigureCaptionLine).forEach((line) => requireSemantic(line, "figure_caption", "explicit figure caption"));
      lines.filter(isTableCaptionLine).forEach((line) => requireSemantic(line, "table", "explicit table caption"));
      lines.filter((line) => {
        const text = normalizedLineText(line);
        return page.identity.pageNumber === 1
          && line.y < extractedPage.pageSize.height * 0.5
          && !/^(correspondence|received|revised|accepted|funding|conflicts? of interest|copyright)\s*:/i.test(text)
          && /\b(university|department|institute|institution|school|college|centre|center|laborator|faculty|academy|hospital|@|orcid)\b/i.test(text);
      }).forEach((line) => requireSemantic(line, "author_affiliation", "first-page affiliation signature"));

      const contentOwnsLine = (line, options = {}) => contentRegions.some((region) => {
        if (options.allowSectionHeading && region.semanticRegionType === "section_heading") return false;
        const geometry = lineBox(line);
        const hit = intersectBoxes(geometry, region.expectedGeometry);
        return centerInside(geometry, inflateBox(region.expectedGeometry, 1))
          || Boolean(hit && boxArea(hit) / Math.max(1, boxArea(geometry)) > 0.2);
      });
      const columnModel = columnModelsByPage.get(page.identity.pageNumber);
      const partition = columnPartition(extractedPage, identity.layout, columnModel);
      const bodySemantics = [
        ...independents.map((region) => ({ type: region.semanticRegionType, geometry: region.expectedGeometry })),
        ...protecteds.filter((region) => region.protectedKind !== "margin").map((region) => ({ kind: region.protectedKind, geometry: region.expectedGeometry })),
      ];
      const credibleByColumn = Object.fromEntries(expectedColumns.map((columnId) => [
        columnId,
        credibleLaneBodyLines(extractedPage, partition.lanes[columnId], partition.walls[columnId], bodySemantics),
      ]));
      bodies.forEach((body) => {
        const bodyBox = body.expectedGeometry;
        const columnId = body.canonicalColumnRef.columnId;
        const laneEvidence = credibleByColumn[columnId] || [];
        const covered = laneEvidence.filter((line) => line.y + line.height > bodyBox.y && line.y < bodyBox.y + bodyBox.height);
        if (!covered.length) {
          bodyVerticalOverextensions.push({ page: loc, regionId: body.regionId, reason: "body band has no credible text-flow evidence" });
          return;
        }
        const evidenceTop = Math.min(...covered.map((line) => line.y));
        const evidenceBottom = Math.max(...covered.map((line) => line.y + line.height));
        const topExcess = evidenceTop - bodyBox.y;
        const bottomExcess = bodyBox.y + bodyBox.height - evidenceBottom;
        if (topExcess > 24 || bottomExcess > 24) {
          bodyVerticalOverextensions.push({ page: loc, regionId: body.regionId, topExcess: round(topExcess), bottomExcess: round(bottomExcess) });
        }
      });
      Object.entries(credibleByColumn).forEach(([columnId, credibleLines]) => {
        let coveredCount = 0;
        credibleLines.forEach((line) => {
          const geometry = laneEvidenceGeometry(line, partition.lanes[columnId]);
          if (!geometry) return;
          const matchedBody = bodies.find((body) => {
            if (body.canonicalColumnRef.columnId !== columnId) return false;
            const hit = intersectBoxes(geometry, inflateBox(body.expectedGeometry, 0.75));
            return Boolean(hit && boxArea(hit) / Math.max(1, boxArea(geometry)) >= 0.985);
          });
          if (matchedBody) {
            coveredCount += 1;
            return;
          }
          const finding = {
            page: loc,
            columnId,
            text: normalizedLineText(line).slice(0, 100),
            geometry,
            mathHeavy: isMathHeavy(line),
            reason: "high-confidence lane-local main-reading-flow line is not fully covered by a body_column in the same frozen canonical lane",
          };
          bodyCoverageFailures.push(finding);
          bodyPrematureTruncations.push(finding);
        });
        bodyCoverageEvidence.push({
          page: loc,
          columnId,
          highConfidenceLineCount: credibleLines.length,
          coveredLineCount: coveredCount,
          uncoveredLineCount: credibleLines.length - coveredCount,
        });
      });

      independents.filter((region) => ["figure", "table"].includes(region.semanticRegionType)
        && region.expectedGeometry.width >= page.pageSize.width * 0.55).forEach((objectRegion) => {
        bodies.forEach((body) => {
          const hit = intersectBoxes(objectRegion.expectedGeometry, body.expectedGeometry);
          if (hit && hit.height > 0.5 && hit.width > 0.5) {
            bodyCrossesCrossColumnObjects.push({ page: loc, body: body.regionId, object: objectRegion.regionId, overlapArea: round(boxArea(hit)) });
          }
        });
      });

      independents.filter((region) => region.semanticRegionType === "section_heading").forEach((heading) => {
        const owned = lines.filter((line) => centerInside(lineBox(line), inflateBox(heading.expectedGeometry, 1)));
        const valid = owned.some((line) => isSectionHeadingLine(line, extractedPage));
        const suspicious = !valid || owned.some((line) => isMathHeavy(line)
          || normalizedLineText(line).length > 100
          || /[,;]|\b(?:which|that|because|while|however)\b/i.test(normalizedLineText(line)));
        if (suspicious) headingFalsePositiveSuspects.push({ page: loc, regionId: heading.regionId, text: owned.map(normalizedLineText).join(" ").slice(0, 140) });
      });

      margins.forEach((margin) => contentRegions.forEach((content) => {
        const ownsMargin = margin.sourceProvenance.some((source) => source.sourceArtifactId === content.regionId);
        if (ownsMargin) return;
        const hit = intersectBoxes(margin.expectedGeometry, content.expectedGeometry);
        if (hit && boxArea(hit) > 0.5) safetyMarginContentConflicts.push({ page: loc, margin: margin.regionId, content: content.regionId, overlapArea: round(boxArea(hit)) });
      }));

      lines.forEach((line) => {
        const geometry = lineBox(line);
        const owners = contentRegions.filter((region) => centerInside(geometry, inflateBox(region.expectedGeometry, 0.5)));
        const identities = [...new Set(owners.map((region) => `${region.regionClass}:${region.semanticRegionType || region.protectedKind}`))];
        if (identities.length > 1) ownershipConflicts.push({ page: loc, text: normalizedLineText(line).slice(0, 100), regionIds: owners.map((region) => region.regionId), identities });
      });

      independents.forEach((region) => {
        let supported = false;
        if (region.semanticRegionType === "figure") {
          supported = usableVisuals(extractedPage).some((visual) => {
            const hit = intersectBoxes(visual.geometry, region.expectedGeometry);
            return hit && boxArea(hit) / Math.max(1, Math.min(boxArea(visual.geometry), boxArea(region.expectedGeometry))) > 0.18;
          });
        } else {
          supported = lines.some((line) => centerInside(lineBox(line), inflateBox(region.expectedGeometry, 1)));
        }
        if (!supported) ghostObjectBoxes.push({ page: loc, regionId: region.regionId, type: region.semanticRegionType });
      });

      const referenceHeading = independents.find((region) => region.semanticRegionType === "references_section_header");
      if (referenceStartPage && page.identity.pageNumber >= referenceStartPage && hasReferencePageEvidence(lines, referenceHeading)) {
        const y0 = referenceAnchorY(extractedPage, lines, referenceHeading);
        if (y0 === null) {
          referenceBoundaryFailures.push({ page: loc, reason: "reference page lacks a credible References heading or repeated entry anchors" });
        } else {
          const referenceRegions = protecteds.filter((region) => region.protectedKind === "reference_entries");
          referenceRegions.forEach((region) => {
            if (region.expectedGeometry.y < y0 - 2) referenceBoundaryFailures.push({ page: loc, regionId: region.regionId, reason: "reference_entries begins above the credible References anchor" });
          });
          const referenceLines = lines.filter((line) => line.y >= y0 - 0.5 && line.y < extractedPage.pageSize.height * 0.95 && !isHeaderLikeLine(line, extractedPage) && !isFooterLikeLine(line, extractedPage) && !isReferencesHeadingLine(line));
          referenceLines.forEach((line) => {
            if (!lineCoveredBy(line, (region) => region.regionClass === "protected_region" && region.protectedKind === "reference_entries")) {
              referenceBoundaryFailures.push({ page: loc, text: normalizedLineText(line).slice(0, 100), reason: "reference-mode line is not owned by reference_entries" });
            }
          });
        }
      }
      lines.filter((line) => isHeaderLikeLine(line, extractedPage) || isFooterLikeLine(line, extractedPage)).forEach((line) => {
        const geometry = clipToPage(lineBox(line), extractedPage);
        if (!geometry) return;
        const protectedByPeripheralKind = protecteds.some((region) => ["header", "footer", "page_number"].includes(region.protectedKind) && centerInside(geometry, inflateBox(region.expectedGeometry, 1)));
        if (!protectedByPeripheralKind) unprotectedPeripheralLines.push({ page: loc, text: line.text.slice(0, 80), geometry });
      });
      visualWholes(extractedPage, lines).forEach((cluster) => {
        if (Math.min(cluster.width, cluster.height) < 40 || boxArea(cluster) < 1200) return;
        const hit = [...independents, ...protecteds].some((region) => {
          const overlapBox = intersectBoxes(cluster, region.expectedGeometry);
          return overlapBox && boxArea(overlapBox) / boxArea(cluster) > 0.3;
        });
        if (!hit) missedLargeVisuals.push({ page: loc, geometry: cluster });
      });
    });
  });
  bodyCoverageFailures.forEach((finding) => incompleteCoveragePages.push(finding.page));
  const unique = (list) => [...new Set(list)];
  return {
    schemaVersion: "layout-geometry-generation-check/v8",
    runtimeDecisionUse: "forbidden",
    promotion: "not_performed",
    coverageFirst: {
      status: bodyCoverageFailures.length ? "fail" : "pass",
      rule: "every high-confidence lane-local main-reading-flow line, including formula-like lines, must be geometrically covered by a body_column in the same frozen canonical lane",
      failureCount: bodyCoverageFailures.length,
      highConfidenceLineCount: bodyCoverageEvidence.reduce((sum, item) => sum + item.highConfidenceLineCount, 0),
      coveredLineCount: bodyCoverageEvidence.reduce((sum, item) => sum + item.coveredLineCount, 0),
      bodyBoundaryMarginPoints: BODY_BOUNDARY_MARGIN,
    },
    totals: {
      pages: oracles.reduce((sum, oracle) => sum + oracle.pages.length, 0),
      bodyColumnCountMismatches: bodyColumnCountMismatches.length,
      fragmentedBodyColumnIds: fragmentedBodyColumnIds.length,
      mixedSemanticBoxes: mixedSemanticBoxes.length,
      contentBoxesWithSafetyInflation: contentBoxesWithSafetyInflation.length,
      writableSafetyViolations: writableSafetyViolations.length,
      unprotectedPeripheralLines: unprotectedPeripheralLines.length,
      incompleteCoveragePages: unique(incompleteCoveragePages).length,
      hugeBoxes: hugeBoxes.length,
      missedLargeVisuals: missedLargeVisuals.length,
      missingSemanticObjects: missingSemanticObjects.length,
      ownershipConflicts: ownershipConflicts.length,
      missingSafetyMargins: missingSafetyMargins.length,
      invalidSafetyMargins: invalidSafetyMargins.length,
      ghostObjectBoxes: ghostObjectBoxes.length,
      writableContentViolations: writableContentViolations.length,
      referenceBoundaryFailures: referenceBoundaryFailures.length,
      bodyVerticalOverextensions: bodyVerticalOverextensions.length,
      bodyPrematureTruncations: bodyPrematureTruncations.length,
      bodyCrossesCrossColumnObjects: bodyCrossesCrossColumnObjects.length,
      headingFalsePositiveSuspects: headingFalsePositiveSuspects.length,
      safetyMarginContentConflicts: safetyMarginContentConflicts.length,
      bodyCoverageFailures: bodyCoverageFailures.length,
    },
    bodyColumnCountMismatches,
    fragmentedBodyColumnIds,
    mixedSemanticBoxes,
    contentBoxesWithSafetyInflation,
    writableSafetyViolations,
    unprotectedPeripheralLines,
    incompleteCoveragePages: unique(incompleteCoveragePages),
    hugeBoxes,
    missedLargeVisuals,
    missingSemanticObjects,
    ownershipConflicts,
    missingSafetyMargins,
    invalidSafetyMargins,
    ghostObjectBoxes,
    writableContentViolations,
    referenceBoundaryFailures,
    bodyVerticalOverextensions,
    bodyPrematureTruncations,
    bodyCrossesCrossColumnObjects,
    headingFalsePositiveSuspects,
    safetyMarginContentConflicts,
    bodyCoverageFailures,
    bodyCoverageEvidence,
  };
}

function knownIssuesMarkdown(checks, gaps) {
  const pages = new Map();
  const add = (page, reason) => {
    if (!page) return;
    if (!pages.has(page)) pages.set(page, new Set());
    pages.get(page).add(reason);
  };
  checks.bodyColumnCountMismatches.forEach((item) => add(item.page, "正文栏数量与冻结 Column identity 不一致"));
  checks.fragmentedBodyColumnIds.forEach((item) => add(item.page, "仍存在碎片化 body_column ID"));
  checks.mixedSemanticBoxes.forEach((item) => add(item.page, "不同语义 independent region 明显重叠，需人工确认边界"));
  checks.contentBoxesWithSafetyInflation.forEach((item) => add(item.page, "内容框仍混入安全余量"));
  checks.writableSafetyViolations.forEach((item) => add(item.page, "可写区侵入安全余量"));
  checks.unprotectedPeripheralLines.forEach((item) => add(item.page, "疑似 Header/Footer/页码尚未被独立保护"));
  checks.incompleteCoveragePages.forEach((page) => add(page, "正文文本未被任何候选区域覆盖"));
  checks.missedLargeVisuals.forEach((item) => add(item.page, "大型视觉对象缺少 independent/protected 覆盖"));
  checks.missingSemanticObjects.forEach((item) => add(item.page, `对象缺失：${item.type}（${item.reason}）`));
  checks.ownershipConflicts.forEach((item) => add(item.page, "同一文本证据被多个不同对象归属"));
  checks.missingSafetyMargins.forEach((item) => add(item.page, `安全余量缺失：${item.regionId} ${item.side}`));
  checks.invalidSafetyMargins.forEach((item) => add(item.page, `安全余量与内容框相交：${item.regionId}`));
  checks.ghostObjectBoxes.forEach((item) => add(item.page, `伪框风险：${item.regionId} 缺少同类证据`));
  checks.writableContentViolations.forEach((item) => add(item.page, `可写区吞入对象：${item.content}`));
  checks.referenceBoundaryFailures.forEach((item) => add(item.page, "References 边界内文本未归属于 reference_entries"));
  checks.bodyVerticalOverextensions.forEach((item) => add(item.page, `正文框纵向缺少可信边界：${item.regionId}`));
  checks.bodyPrematureTruncations.forEach((item) => add(item.page, "正文证据未被 body_column 覆盖，疑似提前截断"));
  checks.bodyCrossesCrossColumnObjects.forEach((item) => add(item.page, `正文穿过跨栏对象：${item.object}`));
  checks.headingFalsePositiveSuspects.forEach((item) => add(item.page, `疑似 section heading 误判：${item.regionId}`));
  checks.safetyMarginContentConflicts.forEach((item) => add(item.page, `安全余量与相邻内容冲突：${item.margin}`));
  checks.bodyCoverageFailures.forEach((item) => add(item.page, `coverage-first 失败：${item.columnId} 栏可信正文行未被覆盖`));
  gaps.forEach((item) => add(`${item.paperKey}.p${item.pageNumber}`, `测量缺口：${item.type} — ${item.reason}`));
  const lines = [...pages.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  return `# Layout Geometry Phase 2 已知问题摘要

状态：paper1–7 候选均为 \`under_review\`；未 accept、未 promote、未进入 runtime。

## 本轮已系统修正

- \`body_column\` 从冻结 canonical lane 内重建 lane-local text flow chain；正文成员决定范围，semantic unresolved 可作为桥接，formula 或疑似 heading 不会单独截断正文。
- 新增 coverage-first 反向检查：每条可信 lane-local 正文行必须由同一冻结 canonical lane 的 \`body_column\` 覆盖，有任何遗漏即记录 \`fail\`。正文仍不得使用 page-interior fallback。
- 本轮未改 Figure、Table、References、安全距离或其他对象逻辑；这些既有 finding 继续保留供后续处理。

## 仍需人工复核的页面

${lines.length ? lines.map(([page, reasons]) => `- **${page}**：${[...reasons].join("；")}`).join("\n") : "- 自动检查未发现待定页；仍需逐页人工确认 overlay 后才能 acceptance。"}

## 审核边界

本摘要只定位候选不确定性。自动检查不能判定根因，也不能触发 acceptance、promotion、runtime 修复或 Column 真值变更。
`;
}

function capabilityCatalog() {
  return {
    schemaVersion: "capability-library/v1",
    catalogRole: "evidence_and_regression_only",
    runtimeDecisionUse: "forbidden",
    capabilities: [{
      id: "cap.layout-geometry",
      name: "Layout Geometry",
      description: "验证正文栏、independent/protected region 与候选可写空间的独立几何真值；不重判栏型。",
      architectureRecord: "AA-GEOMETRY-001",
      relatedArchitectureRecords: ["AA-COLUMN-001", "AA-EVIDENCE-001"],
      decisionAuthority: {
        owner: "Layout Geometry Authority",
        statement: "本库只保存离线 Geometry 候选真值；runtime 几何决策仍未授权。",
      },
      status: "defined",
      boundaries: [
        { id: "boundary.geometry.body-column", description: "正文栏稳定页面坐标。", featureTags: ["body-column", "gutter"] },
        { id: "boundary.geometry.independent-region", description: "title/abstract/figure/table/references 等独立区域几何。", featureTags: ["independent-region"] },
        { id: "boundary.geometry.protected-region", description: "header/footer/image 等保护区域。", featureTags: ["protected-region"] },
        { id: "boundary.geometry.writable-space", description: "从栏与保护区推导的候选可写空间。", featureTags: ["writable-space"] },
      ],
      expectedOutcomes: [
        { id: "assert.geometry.identity-structure-tolerance", assertion: "几何比较按 identity、structure、tolerance 三类失败分开，且容差不能覆盖前两类。", evidenceLevel: "artifact" },
      ],
      evidenceRequirements: ["unit_contract", "artifact", "pixel_visual"],
      regressionSampleIds: [],
    }],
  };
}

function emptyCorpus() {
  return {
    schemaVersion: "capability-corpus/v1",
    catalogRole: "regression_only",
    runtimeDecisionUse: "forbidden",
    samples: [],
  };
}

function coverageMatrix(oracles, gaps, identityChecks) {
  const features = {
    "single column": [],
    "double column": [],
    "different gutter widths": [],
    "first-page title": [],
    "first-page abstract": [],
    figure: [],
    "figure caption": [],
    table: [],
    "References header": [],
    "protected region": [],
    "independent region close to body boundary": [],
    "writable-space expectation": [],
  };
  const gutters = [];
  oracles.forEach((oracle) => {
    const key = oracle.sample.sampleId.replace("sample.layout-geometry.", "");
    oracle.pages.forEach((page) => {
      const bodies = page.regions.filter((region) => region.regionClass === "body_column");
      const columnIds = [...new Set(bodies.map((region) => region.canonicalColumnRef.columnId))].sort();
      if (columnIds.length === 1 && columnIds[0] === "single") features["single column"].push(`${key} p${page.identity.pageNumber}`);
      if (columnIds.includes("left") && columnIds.includes("right")) {
        features["double column"].push(`${key} p${page.identity.pageNumber}`);
        const left = bodies.find((region) => region.canonicalColumnRef.columnId === "left");
        const right = bodies.find((region) => region.canonicalColumnRef.columnId === "right");
        if (left && right) {
          const gutter = round(right.expectedGeometry.x - (left.expectedGeometry.x + left.expectedGeometry.width));
          gutters.push(gutter);
          if (gutter <= 0) {
            gaps.push({
              paperKey: key,
              pageNumber: page.identity.pageNumber,
              type: "gutter",
              reason: "left/right body clusters overlap or invert; overlay review required",
            });
          }
        } else {
          gaps.push({
            paperKey: key,
            pageNumber: page.identity.pageNumber,
            type: "body_column",
            reason: "double-column identity but only one measured body cluster",
          });
        }
      }
      page.regions.forEach((region) => {
        if (region.semanticRegionType === "title" && page.identity.pageNumber === 1) features["first-page title"].push(`${key} p1`);
        if (region.semanticRegionType === "abstract" && page.identity.pageNumber === 1) features["first-page abstract"].push(`${key} p1`);
        if (region.semanticRegionType === "figure") features.figure.push(`${key} p${page.identity.pageNumber}`);
        if (region.semanticRegionType === "figure_caption") features["figure caption"].push(`${key} p${page.identity.pageNumber}`);
        if (region.semanticRegionType === "table") features.table.push(`${key} p${page.identity.pageNumber}`);
        if (region.semanticRegionType === "references_section_header") features["References header"].push(`${key} p${page.identity.pageNumber}`);
        if (region.regionClass === "protected_region") features["protected region"].push(`${key} p${page.identity.pageNumber}`);
        if (region.regionClass === "writable_space_expectation") features["writable-space expectation"].push(`${key} p${page.identity.pageNumber}`);
        if (region.regionClass === "independent_region") {
          const body = bodies[0];
          if (body && region.relations.some((rel) => ["above", "below", "left_of", "right_of"].includes(rel.kind) && rel.minimumGapPoints <= 8)) {
            features["independent region close to body boundary"].push(`${key} p${page.identity.pageNumber}:${region.regionId}`);
          }
        }
      });
    });
  });
  const positiveGutters = [...new Set(gutters.filter((value) => value > 0).map((value) => value.toFixed(1)))];
  features["different gutter widths"] = positiveGutters.length >= 2
    ? positiveGutters.map((value) => `measured:${value}pt`)
    : [];
  return {
    schemaVersion: "layout-geometry-coverage/v1",
    runtimeDecisionUse: "forbidden",
    status: "candidate_only",
    features: Object.fromEntries(Object.entries(features).map(([name, pages]) => [name, {
      pages: [...new Set(pages)],
      covered: pages.length > 0,
      gap: pages.length ? null : "no independently measured candidate region yet",
    }])),
    measurementGaps: gaps,
    identityChecks,
    notes: [
      "This matrix records candidate measurements, not accepted Geometry truth.",
      "Column layout is referenced, never rewritten.",
      "mixed body flow and scanned pages remain corpus gaps.",
    ],
  };
}

async function main() {
  fs.mkdirSync(path.join(TASK_EVIDENCE, "oracles"), { recursive: true });
  fs.mkdirSync(path.join(TASK_EVIDENCE, "overlays"), { recursive: true });
  fs.mkdirSync(path.join(TASK_EVIDENCE, "manifests"), { recursive: true });
  const localRequire = createRequire(path.join(APP, "main.js"));
  const pdfjs = await import(pathToFileURL(localRequire.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
  const columnCorpus = JSON.parse(fs.readFileSync(COLUMN_CORPUS, "utf8"));
  const identityChecks = [];
  const gaps = [];
  const oracles = [];
  const extractedByPaper = {};
  const precheckReports = [];
  const paperKeys = ["paper1", "paper2", "paper3", "paper4", "paper5", "paper6", "paper7"];
  for (const paperKey of paperKeys) {
    const columnSample = columnCorpus.samples.find((sample) => sample.id === `sample.column-pilot.${paperKey}`);
    const columnModelsByPage = loadColumnModels(paperKey);
    const filePath = resolvePdfByHash(columnSample.source.sha256, columnSample.source.bytes);
    const extracted = await extractPdf(pdfjs, filePath);
    if (extracted.pageCount !== columnSample.source.pageCount) {
      throw new Error(`${paperKey} page count diverges from Column identity`);
    }
    extractedByPaper[paperKey] = extracted;
    const oracle = buildOracle(paperKey, columnSample, extracted, columnModelsByPage, identityChecks, gaps);
    validateOracle(oracle);
    oracles.push(oracle);
    fs.writeFileSync(path.join(TASK_EVIDENCE, "oracles", `${paperKey}-geometry-oracle.json`), `${JSON.stringify(oracle, null, 2)}\n`);
    fs.writeFileSync(path.join(TASK_EVIDENCE, "overlays", `${paperKey}.html`), overlayHtml(paperKey, oracle));
  }
  const conflicts = identityChecks.filter((item) => item.conflict);
  fs.writeFileSync(path.join(TASK_EVIDENCE, "column-identity-check.json"), `${JSON.stringify({ conflicts, checks: identityChecks }, null, 2)}\n`);
  const conflictPath = path.join(TASK_EVIDENCE, "COLUMN_CONFLICT.md");
  if (conflicts.length) {
    fs.writeFileSync(conflictPath, `# Column identity conflict\n\nGeometry intake stopped. Column truth was not modified.\n\n${JSON.stringify(conflicts, null, 2)}\n`);
    throw Object.assign(new Error("Column layout identity conflicts with independently observed body flow"), { code: "COLUMN_IDENTITY_CONFLICT", conflicts });
  }
  if (fs.existsSync(conflictPath)) fs.unlinkSync(conflictPath);

  let state = {
    capabilities: capabilityCatalog(),
    corpus: emptyCorpus(),
    pool: { schemaVersion: "capability-candidate-pool/v1", catalogRole: "candidate_evidence_only", runtimeDecisionUse: "forbidden", candidates: [] },
  };
  oracles.forEach((oracle, index) => {
    const paperKey = oracle.sample.sampleId.replace("sample.layout-geometry.", "");
    const sample = {
      id: oracle.sample.sampleId,
      displayName: `Layout geometry candidate ${paperKey}`,
      source: {
        fileName: oracle.sample.fileName,
        mediaType: "application/pdf",
        sha256: oracle.sample.sha256,
        bytes: oracle.sample.bytes,
        pageCount: oracle.sample.pageCount,
      },
      provenance: { kind: "user_provided", reference: oracle.sample.provenance.reference },
      rights: { status: "metadata_only", canStoreMetadata: true, canStoreBinary: false },
      boundaryFeatureIds: [
        "boundary.geometry.body-column",
        "boundary.geometry.independent-region",
        "boundary.geometry.protected-region",
        "boundary.geometry.writable-space",
      ],
      expectedOutcomes: [{
        capabilityId: "cap.layout-geometry",
        assertionId: "assert.geometry.identity-structure-tolerance",
        oracleType: "manual",
        expected: {
          schemaVersion: "layout-geometry-oracle/v1",
          oracleFile: `oracles/${paperKey}-geometry-oracle.json`,
          oracleHash: sha256(Buffer.from(JSON.stringify(oracle))),
          pageCount: oracle.sample.pageCount,
          regionCount: oracle.pages.reduce((sum, page) => sum + page.regions.length, 0),
        },
        notes: "Candidate Geometry oracle. Not accepted. Not promoted. Do not use at runtime.",
      }],
      evidenceRefs: [EVIDENCE_ID],
      storage: { binaryCommitted: false, externalSourceRequiredForRun: true },
      authorityBoundary: {
        catalogRole: "regression_oracle",
        runtimeDecisionUse: "forbidden",
        finalDecisionsOwnedBy: ["AA-GEOMETRY-001"],
      },
    };
    const submission = {
      id: `candidate.layout-geometry.${paperKey}`,
      capabilityIds: ["cap.layout-geometry"],
      sample,
    };
    const report = workflow.precheck(state, submission);
    precheckReports.push({ id: submission.id, ...report });
    const submittedAt = `2026-09-19T04:${String(1 + index * 2).padStart(2, "0")}:00.000Z`;
    const reviewedAt = `2026-09-19T04:${String(2 + index * 2).padStart(2, "0")}:00.000Z`;
    fs.writeFileSync(path.join(TASK_EVIDENCE, "manifests", `${paperKey}.json`), `${JSON.stringify({ candidateId: submission.id, capabilityIds: submission.capabilityIds, ...sample, audit: { actor: ACTOR, reason: "Independent Geometry candidate intake", at: submittedAt } }, null, 2)}\n`);
    state = workflow.submitCandidate(state, submission, { actor: ACTOR, reason: "Independent Geometry candidate intake; overlays require human review.", at: submittedAt, evidenceRefs: [EVIDENCE_ID] });
    state = workflow.reviewCandidate(state, submission.id, "under_review", {
      actor: ACTOR,
      reason: "Moved to under_review with schema-valid candidate oracle and overlay contact sheet. Waiting for named human confirmation. No acceptance or promotion.",
      at: reviewedAt,
      evidenceRefs: [EVIDENCE_ID, `overlay:${paperKey}`],
      expectedOutcomes: sample.expectedOutcomes,
    });
  });
  const snapshot = path.join(TASK_EVIDENCE, "revision-under-review");
  if (fs.existsSync(snapshot)) fs.rmSync(snapshot, { recursive: true, force: true });
  workflow.saveState(state, snapshot);

  const index = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Geometry candidate overlays</title></head><body><h1>paper1–7 Geometry candidate overlays</h1><p>Not accepted, not promoted.</p><p><a href="../KNOWN_ISSUES.md">已知问题摘要</a></p><ol>${oracles.map((oracle) => { const key = oracle.sample.sampleId.replace("sample.layout-geometry.", ""); return `<li><a href="${key}.html">${key}</a></li>`; }).join("")}</ol></body></html>`;
  fs.writeFileSync(path.join(TASK_EVIDENCE, "overlays", "index.html"), index);
  fs.writeFileSync(path.join(TASK_EVIDENCE, "coverage-matrix.json"), `${JSON.stringify(coverageMatrix(oracles, gaps, identityChecks), null, 2)}\n`);
  const generationChecks = autoCheck(oracles, columnCorpus, extractedByPaper);
  fs.writeFileSync(path.join(TASK_EVIDENCE, "geometry-generation-checks.json"), `${JSON.stringify(generationChecks, null, 2)}\n`);
  const bodyCoverageReport = {
    schemaVersion: "layout-geometry-body-coverage-report/v1",
    generatedFrom: generationChecks.schemaVersion,
    scope: "body_column_only",
    status: generationChecks.coverageFirst.status,
    rule: generationChecks.coverageFirst.rule,
    bodyBoundaryMarginPoints: generationChecks.coverageFirst.bodyBoundaryMarginPoints,
    papers: oracles.length,
    pages: generationChecks.totals.pages,
    highConfidenceLineCount: generationChecks.coverageFirst.highConfidenceLineCount,
    coveredLineCount: generationChecks.coverageFirst.coveredLineCount,
    uncoveredLineCount: generationChecks.coverageFirst.failureCount,
    pageLaneEvidence: generationChecks.bodyCoverageEvidence,
    failures: generationChecks.bodyCoverageFailures,
    constraints: {
      columnTruthModified: false,
      runtimeDecisionUse: "forbidden",
      accepted: false,
      promoted: false,
      formulaTruncationAuthority: "forbidden",
      pageInteriorFallback: "forbidden",
    },
  };
  fs.writeFileSync(path.join(TASK_EVIDENCE, "body-coverage-report.json"), `${JSON.stringify(bodyCoverageReport, null, 2)}\n`);
  fs.writeFileSync(path.join(TASK_EVIDENCE, "KNOWN_ISSUES.md"), knownIssuesMarkdown(generationChecks, gaps));
  fs.writeFileSync(path.join(TASK_EVIDENCE, "precheck.json"), `${JSON.stringify({ formatValid: precheckReports.every((item) => item.formatValid), reports: precheckReports, snapshot: "revision-under-review", promotion: "not_performed", runtimeDecisionUse: "forbidden" }, null, 2)}\n`);
  console.log(JSON.stringify({
    papers: oracles.length,
    pages: oracles.reduce((sum, oracle) => sum + oracle.pages.length, 0),
    conflicts: conflicts.length,
    snapshot,
    generationChecks: generationChecks.totals,
    runtimeDecisionUse: "forbidden",
    promotion: "not_performed",
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`${error.code || "GEOMETRY_CANDIDATE_FAILED"}: ${error.message}`);
    process.exitCode = error.code === "COLUMN_IDENTITY_CONFLICT" ? 2 : 1;
  });
}

// Read-only extraction primitives for isolated offline Body candidate revisions.
// Importing this module does not run the full multi-region candidate intake.
module.exports = {
  resolvePdfByHash,
  loadColumnModels,
  columnPartition,
  columnIdentity,
  extractPdf,
  groupLines,
  lineBox,
  isHeaderLikeLine,
  isFooterLikeLine,
  isReferencesHeadingLine,
  isSectionHeadingLine,
  isTableCaptionLine,
  compactPdfSmallCaps,
  semanticHeadingRows,
  visualClusters,
  deriveHeadingFontNames,
  buildIndependentRegions,
  protectedRegionsFromSemantics,
  detectReferenceStartPage,
};
