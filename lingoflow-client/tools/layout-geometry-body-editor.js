"use strict";

// Offline annotation helpers. PDF top-left points are the only stored coordinates.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BodyGeometryEditor = api;
})(typeof globalThis === "object" ? globalThis : null, function () {
  const MIN_SIZE = 3;
  const round = (value) => Math.round(value * 100) / 100;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const copyBox = (box) => ({ x: box.x, y: box.y, width: box.width, height: box.height });

  function normalizeBox(a, b, pageSize) {
    const x0 = clamp(Math.min(a.x, b.x), 0, pageSize.width);
    const y0 = clamp(Math.min(a.y, b.y), 0, pageSize.height);
    const x1 = clamp(Math.max(a.x, b.x), 0, pageSize.width);
    const y1 = clamp(Math.max(a.y, b.y), 0, pageSize.height);
    if (x1 - x0 < MIN_SIZE || y1 - y0 < MIN_SIZE) return null;
    return { x: round(x0), y: round(y0), width: round(x1 - x0), height: round(y1 - y0) };
  }

  function pointFromClient(clientX, clientY, rect, pageSize) {
    return {
      x: round(clamp((clientX - rect.left) * pageSize.width / rect.width, 0, pageSize.width)),
      y: round(clamp((clientY - rect.top) * pageSize.height / rect.height, 0, pageSize.height)),
    };
  }

  function moveBox(box, delta, pageSize) {
    return {
      x: round(clamp(box.x + delta.x, 0, pageSize.width - box.width)),
      y: round(clamp(box.y + delta.y, 0, pageSize.height - box.height)),
      width: box.width, height: box.height,
    };
  }

  function resizeBox(box, handle, delta, pageSize) {
    let left = box.x, top = box.y, right = box.x + box.width, bottom = box.y + box.height;
    if (handle.includes("w")) left = clamp(left + delta.x, 0, right - MIN_SIZE);
    if (handle.includes("e")) right = clamp(right + delta.x, left + MIN_SIZE, pageSize.width);
    if (handle.includes("n")) top = clamp(top + delta.y, 0, bottom - MIN_SIZE);
    if (handle.includes("s")) bottom = clamp(bottom + delta.y, top + MIN_SIZE, pageSize.height);
    return { x: round(left), y: round(top), width: round(right - left), height: round(bottom - top) };
  }

  function predictedCopy(predicted) {
    return predicted.map((item) => ({
      id: item.id,
      sourceRegionId: item.id,
      canonicalColumnId: item.canonicalColumnId,
      geometry: copyBox(item.geometry),
    }));
  }

  function initialPage(paper, pageNumber, pageSize, predicted) {
    return {
      paper, pageNumber, pageSize: { width: pageSize.width, height: pageSize.height },
      predicted: predicted.map((item) => ({ ...item, geometry: copyBox(item.geometry) })),
      corrected: predictedCopy(predicted),
      confirmed: false,
    };
  }

  function validBox(box, pageSize) {
    return box && [box.x, box.y, box.width, box.height].every(Number.isFinite)
      && box.x >= 0 && box.y >= 0 && box.width >= MIN_SIZE && box.height >= MIN_SIZE
      && box.x + box.width <= pageSize.width + 0.01
      && box.y + box.height <= pageSize.height + 0.01;
  }

  function exportGroundTruth(paper, pages, sourcePdfSha256) {
    return {
      schemaVersion: "layout-geometry-body-ground-truth-draft/v1",
      capabilityId: "cap.layout-geometry",
      scope: "body_column_only",
      paper,
      sourcePdfSha256,
      coordinateSpace: "pdf-page-top-left-points",
      runtimeDecisionUse: "forbidden",
      candidateAcceptance: "not_performed",
      promotion: "not_performed",
      pages: pages.map((page) => ({
        pageNumber: page.pageNumber,
        pageSize: { ...page.pageSize },
        predicted: page.predicted.map((item) => ({ ...item, geometry: copyBox(item.geometry) })),
        corrected: page.corrected.map((item) => ({ ...item, geometry: copyBox(item.geometry) })),
        confirmed: Boolean(page.confirmed),
      })),
    };
  }

  function restoreGroundTruth(document, paper, sourcePdfSha256, machinePages) {
    if (!document || document.schemaVersion !== "layout-geometry-body-ground-truth-draft/v1"
      || document.scope !== "body_column_only" || document.paper !== paper
      || document.sourcePdfSha256 !== sourcePdfSha256
      || document.coordinateSpace !== "pdf-page-top-left-points"
      || !Array.isArray(document.pages) || document.pages.length !== machinePages.length) {
      throw new Error("Ground Truth JSON does not match this paper and source PDF");
    }
    return machinePages.map((machine) => {
      const saved = document.pages.find((item) => item.pageNumber === machine.pageNumber);
      if (!saved || saved.pageSize.width !== machine.pageSize.width
        || saved.pageSize.height !== machine.pageSize.height
        || JSON.stringify(saved.predicted) !== JSON.stringify(machine.predicted)
        || !Array.isArray(saved.corrected)
        || !saved.corrected.every((item) => typeof item.id === "string" && validBox(item.geometry, machine.pageSize))) {
        throw new Error(`Ground Truth JSON page ${machine.pageNumber} has stale predictions or invalid corrected boxes`);
      }
      return { ...machine, corrected: saved.corrected.map((item) => ({ ...item, geometry: copyBox(item.geometry) })), confirmed: saved.confirmed === true };
    });
  }

  return { MIN_SIZE, normalizeBox, pointFromClient, moveBox, resizeBox, predictedCopy, initialPage, validBox, exportGroundTruth, restoreGroundTruth };
});
