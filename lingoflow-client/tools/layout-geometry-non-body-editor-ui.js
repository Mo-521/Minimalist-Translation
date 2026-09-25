"use strict";

(function () {
  const core = globalThis.NonBodyGeometryEditor;
  if (!core) throw new Error("Non-Body Geometry editor core is missing");
  const SVG_NS = "http://www.w3.org/2000/svg";
  const cards = [...document.querySelectorAll(".editable-page")];
  if (!cards.length) return;
  const paper = cards[0].dataset.paper;
  const sourceSha = cards[0].dataset.sourceSha;
  const predictionKey = cards[0].dataset.predictionKey || "original";
  const storageKey = `non-body-geometry-draft/v1:${sourceSha}:${paper}:${predictionKey}`;
  const machinePages = cards.map((card) => core.initialPage(
    paper,
    Number(card.dataset.page),
    JSON.parse(card.querySelector(".page-size").textContent),
    JSON.parse(card.querySelector(".machine-predicted").textContent),
  ));
  let pages = machinePages;
  const selected = new Map();
  const drawing = new Set();
  const cardFor = (number) => cards.find((card) => Number(card.dataset.page) === number);
  const stateFor = (number) => pages.find((page) => page.pageNumber === number);
  const svgNode = (tag, attributes) => {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  };
  const status = (card, message) => { card.querySelector(".edit-status").textContent = message; };
  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(core.exportGroundTruth(paper, pages, sourceSha)));
      return true;
    } catch { return false; }
  }
  function markEdited(page) { page.confirmed = false; persist(); renderCard(cardFor(page.pageNumber)); }
  function renderCard(card) {
    const page = stateFor(Number(card.dataset.page));
    const svg = card.querySelector(".correction-overlay");
    svg.replaceChildren();
    page.corrected.forEach((item, index) => {
      const box = item.geometry;
      const active = selected.get(page.pageNumber) === item.id;
      const group = svgNode("g", {
        "data-box-id": item.id,
        class: `${item.regionClass === "protected_region" ? "protected" : "independent"}${active ? " selected" : ""}`,
      });
      group.append(svgNode("rect", { x: box.x, y: box.y, width: box.width, height: box.height, "data-box-id": item.id, class: "corrected-rect" }));
      const label = svgNode("text", { x: box.x + 2, y: Math.max(9, box.y - 2), class: "corrected-label" });
      label.textContent = `${item.objectType} ${index + 1}`;
      group.append(label);
      if (active) {
        ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach((handle) => {
          const x = handle.includes("w") ? box.x : handle.includes("e") ? box.x + box.width : box.x + box.width / 2;
          const y = handle.includes("n") ? box.y : handle.includes("s") ? box.y + box.height : box.y + box.height / 2;
          group.append(svgNode("circle", { cx: x, cy: y, r: 5, "data-box-id": item.id, "data-handle": handle, class: "resize-handle" }));
        });
      }
      svg.append(group);
    });
    svg.append(svgNode("rect", { x: 0, y: 0, width: 0, height: 0, class: "creation-preview", style: "display:none" }));
    const selectedItem = page.corrected.find((item) => item.id === selected.get(page.pageNumber));
    card.querySelector(".delete-box").disabled = !selectedItem;
    card.querySelector(".object-type").value = selectedItem ? selectedItem.objectType : card.querySelector(".object-type").value;
    card.querySelector(".new-box").setAttribute("aria-pressed", String(drawing.has(page.pageNumber)));
    card.querySelector(".confirm-page").textContent = page.confirmed ? "已确认当前页" : "确认当前页标注";
    card.querySelector(".confirm-page").classList.toggle("confirmed", page.confirmed);
    card.querySelector(".box-count").textContent = `机器 ${page.predicted.length} · 人工 ${page.corrected.length}`;
    if (!card.querySelector(".edit-status").textContent) status(card, "橙色为独立对象，红色为受保护对象；选择框后可改类型、移动或缩放。");
  }
  function dragEditor(card) {
    const svg = card.querySelector(".correction-overlay");
    let gesture = null;
    const pageNumber = Number(card.dataset.page);
    const point = (event) => core.pointFromClient(event.clientX, event.clientY, svg.getBoundingClientRect(), stateFor(pageNumber).pageSize);
    svg.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const page = stateFor(pageNumber);
      const target = event.target.closest("[data-box-id]");
      const start = point(event);
      if (target && !drawing.has(pageNumber)) {
        const id = target.getAttribute("data-box-id");
        const item = page.corrected.find((box) => box.id === id);
        if (!item) return;
        selected.set(pageNumber, id);
        gesture = { kind: target.getAttribute("data-handle") ? "resize" : "move", handle: target.getAttribute("data-handle"), id, start, original: { ...item.geometry }, changed: false };
      } else if (drawing.has(pageNumber) && !target) {
        gesture = { kind: "new", start, changed: false };
      } else {
        selected.delete(pageNumber);
        renderCard(card);
        return;
      }
      svg.setPointerCapture(event.pointerId);
      event.preventDefault();
      renderCard(card);
    });
    svg.addEventListener("pointermove", (event) => {
      if (!gesture) return;
      const page = stateFor(pageNumber);
      const current = point(event);
      const delta = { x: current.x - gesture.start.x, y: current.y - gesture.start.y };
      if (gesture.kind === "new") {
        const draft = core.normalizeBox(gesture.start, current, page.pageSize);
        const overlay = card.querySelector(".creation-preview");
        if (draft) Object.entries(draft).forEach(([key, value]) => overlay.setAttribute(key, value));
        overlay.style.display = draft ? "block" : "none";
        gesture.changed = Boolean(draft);
      } else {
        const item = page.corrected.find((box) => box.id === gesture.id);
        if (!item) return;
        item.geometry = gesture.kind === "move"
          ? core.moveBox(gesture.original, delta, page.pageSize)
          : core.resizeBox(gesture.original, gesture.handle, delta, page.pageSize);
        gesture.changed = JSON.stringify(item.geometry) !== JSON.stringify(gesture.original);
        renderCard(card);
      }
    });
    const finish = (event) => {
      if (!gesture) return;
      const page = stateFor(pageNumber);
      if (gesture.kind === "new") {
        const made = core.normalizeBox(gesture.start, point(event), page.pageSize);
        card.querySelector(".creation-preview").style.display = "none";
        if (made) {
          const objectType = card.querySelector(".object-type").value;
          const id = `manual-${pageNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          page.corrected.push({ id, sourceRegionId: null, objectType, ...core.descriptorForType(objectType), geometry: made });
          selected.set(pageNumber, id);
          drawing.delete(pageNumber);
          markEdited(page);
          status(card, `已新建 ${objectType} 对象框；此页确认状态已清除。`);
        }
      } else if (gesture.changed) {
        markEdited(page);
        status(card, "人工框已修改；机器预测保持不变，请重新确认当前页。");
      }
      gesture = null;
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    };
    svg.addEventListener("pointerup", finish);
    svg.addEventListener("pointercancel", (event) => {
      card.querySelector(".creation-preview").style.display = "none";
      gesture = null;
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
      renderCard(card);
    });
  }
  cards.forEach((card) => {
    const number = Number(card.dataset.page);
    card.querySelector(".new-box").addEventListener("click", () => {
      if (drawing.has(number)) drawing.delete(number); else drawing.add(number);
      selected.delete(number);
      renderCard(card);
      status(card, drawing.has(number) ? `在页面上拖动以创建 ${card.querySelector(".object-type").value} 框。` : "已退出新建模式。");
    });
    card.querySelector(".object-type").addEventListener("change", (event) => {
      const page = stateFor(number);
      const item = page.corrected.find((box) => box.id === selected.get(number));
      if (!item) return;
      core.setObjectType(item, event.target.value);
      markEdited(page);
      status(card, `选中框已改为 ${event.target.value}；请重新确认当前页。`);
    });
    card.querySelector(".delete-box").addEventListener("click", () => {
      const page = stateFor(number);
      const id = selected.get(number);
      if (!id) return;
      page.corrected = page.corrected.filter((item) => item.id !== id);
      selected.delete(number);
      markEdited(page);
      status(card, "已删除选中的人工框；机器预测仍保留。");
    });
    card.querySelector(".reset-page").addEventListener("click", () => {
      const page = stateFor(number);
      page.corrected = core.predictedCopy(page.predicted);
      page.confirmed = false;
      selected.delete(number); drawing.delete(number);
      persist(); renderCard(card); status(card, "当前页已恢复机器预测，确认状态已清除。");
    });
    card.querySelector(".confirm-page").addEventListener("click", () => {
      const page = stateFor(number);
      page.confirmed = true;
      persist(); renderCard(card); status(card, "当前页非正文标注已确认；这不是 Candidate Accept 或 Promote。");
    });
    card.querySelector(".zoom-page").addEventListener("change", (event) => {
      const page = stateFor(number);
      const zoom = Number(event.target.value);
      card.querySelector(".stage").style.width = `${Math.round(page.pageSize.width * zoom)}px`;
      status(card, `页面缩放到 ${Math.round(zoom * 100)}%；编辑坐标仍为 PDF points。`);
    });
    card.querySelector(".stage").style.width = `${Math.round(stateFor(number).pageSize.width * 1.4)}px`;
    dragEditor(card);
  });
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) pages = core.restoreGroundTruth(JSON.parse(saved), paper, sourceSha, machinePages);
  } catch { /* Explicit JSON import remains available for file:// sessions. */ }
  cards.forEach(renderCard);
  document.getElementById("export-ground-truth").addEventListener("click", () => {
    const groundTruth = core.exportGroundTruth(paper, pages, sourceSha);
    const blob = new Blob([JSON.stringify(groundTruth, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `${paper}-non-body-ground-truth-draft.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.getElementById("import-ground-truth").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      pages = core.restoreGroundTruth(JSON.parse(await file.text()), paper, sourceSha, machinePages);
      selected.clear(); drawing.clear(); persist(); cards.forEach(renderCard);
      cards.forEach((card) => status(card, "Non-Body Ground Truth JSON 已还原；机器预测保持原始值。"));
    } catch (error) { alert(error.message); }
    event.target.value = "";
  });
})();
