const launcherIcon = document.getElementById("launcher-icon");
const launcherMenu = document.getElementById("launcher-menu");
const app = document.querySelector(".app");
const toggleBtn = document.getElementById("toggle-btn");
const quitBtn = document.getElementById("quit-btn");
const statusLabel = document.getElementById("status-label");

const LAUNCHER_STATE = {
  FULL: "full",
  SNAP_LEFT: "snap-left",
  SNAP_RIGHT: "snap-right",
};
const DRAG_THRESHOLD_PX = 5;
const AUTO_RESNAP_DELAY_MS = 1500;
const HOVER_OPEN_DELAY_MS = 1500;
const MENU_CLOSE_DELAY_MS = 380;

let running = false;
let busy = false;
let actionError = "";
let menuOpen = false;
let menuSide = "right";
let menuTransitioning = false;
let menuTransitionTimer = null;
let launcherState = LAUNCHER_STATE.FULL;
let launcherBounds = null;
let dragging = false;
let dragStartMouse = null;
let dragStartBounds = null;
let autoResnapTimer = null;
let hoverOpenTimer = null;
let menuCloseTimer = null;
let latestDragPosition = null;
let dragRafId = null;

function clearTimer(timerId) {
  if (timerId) window.clearTimeout(timerId);
  return null;
}

function clearAutoResnapTimer() {
  autoResnapTimer = clearTimer(autoResnapTimer);
}

function clearHoverOpenTimer() {
  hoverOpenTimer = clearTimer(hoverOpenTimer);
}

function clearMenuCloseTimer() {
  menuCloseTimer = clearTimer(menuCloseTimer);
}

function markMenuTransition() {
  menuTransitioning = true;
  menuTransitionTimer = clearTimer(menuTransitionTimer);
  menuTransitionTimer = window.setTimeout(() => {
    menuTransitioning = false;
    menuTransitionTimer = null;
  }, 180);
}

function scheduleAutoResnapIfNearEdge() {
  clearAutoResnapTimer();
  autoResnapTimer = window.setTimeout(async () => {
    autoResnapTimer = null;
    if (launcherState !== LAUNCHER_STATE.FULL || menuOpen) return;
    const nextState = await window.desktopApi.snapLauncherIfNearEdge();
    applyLauncherPayload(nextState);
  }, AUTO_RESNAP_DELAY_MS);
}

function scheduleMenuOpenFromHover() {
  clearMenuCloseTimer();
  clearHoverOpenTimer();
  if (dragging || launcherState !== LAUNCHER_STATE.FULL || menuOpen) return;
  hoverOpenTimer = window.setTimeout(() => {
    hoverOpenTimer = null;
    openMenu();
  }, HOVER_OPEN_DELAY_MS);
}

function scheduleMenuClose() {
  clearHoverOpenTimer();
  clearMenuCloseTimer();
  menuCloseTimer = window.setTimeout(() => {
    menuCloseTimer = null;
    closeMenu();
  }, MENU_CLOSE_DELAY_MS);
}

function describeBackendActionError(result, error) {
  const code = result && typeof result.error === "string" ? result.error : "";
  if (code === "backend-port-occupied") {
    return "启动失败：桌面翻译端口被其他进程占用";
  }
  if (code === "backend-entry-missing") {
    return "启动失败：桌面翻译后台文件缺失";
  }
  if (code === "backend spawn failed") {
    return "启动失败：无法运行桌面翻译后台";
  }
  const message = error && typeof error.message === "string" ? error.message.trim() : "";
  return message ? `启动失败：${message}` : "启动失败：请查看终端错误信息";
}

function scheduleLauncherPositionUpdate(position) {
  latestDragPosition = position;
  if (dragRafId) return;
  dragRafId = window.requestAnimationFrame(() => {
    const nextPosition = latestDragPosition;
    dragRafId = null;
    if (!nextPosition) return;
    window.desktopApi.setLauncherBallPosition(nextPosition);
  });
}

function applyLauncherStateClass() {
  app.classList.toggle("state-snap-left", launcherState === LAUNCHER_STATE.SNAP_LEFT);
  app.classList.toggle("state-snap-right", launcherState === LAUNCHER_STATE.SNAP_RIGHT);
  app.classList.toggle("state-full", launcherState === LAUNCHER_STATE.FULL);
  app.classList.toggle("menu-open", menuOpen);
  app.classList.toggle("menu-left", menuSide === "left");
  app.classList.toggle("menu-right", menuSide !== "left");
}

function applyLauncherPayload(nextState) {
  if (!nextState || typeof nextState !== "object") return;
  if (typeof nextState.state === "string") launcherState = nextState.state;
  if (nextState.bounds) launcherBounds = nextState.bounds;
  if (typeof nextState.menuOpen === "boolean") menuOpen = nextState.menuOpen;
  if (typeof nextState.menuSide === "string") menuSide = nextState.menuSide;
  if (launcherState !== LAUNCHER_STATE.FULL) {
    clearAutoResnapTimer();
    clearHoverOpenTimer();
    clearMenuCloseTimer();
    menuOpen = false;
  }
  applyLauncherStateClass();
}

function getCurrentIconBounds() {
  const bounds = launcherBounds || { x: 0, y: 0 };
  if (!menuOpen) return { x: bounds.x, y: bounds.y };
  const iconX = menuSide === "left" ? bounds.x + 184 : bounds.x;
  return { x: iconX, y: bounds.y + 6 };
}

function renderBackendState() {
  if (toggleBtn) toggleBtn.textContent = running ? "停止" : "开始";
  if (statusLabel) {
    statusLabel.textContent = running ? "运行中" : "未运行";
    statusLabel.classList.toggle("running", running);
    statusLabel.classList.remove("error");
  }
}

async function refreshStatus() {
  const status = await window.desktopApi.getBackendStatus();
  running = Boolean(status && status.running);
  renderBackendState();
}

async function openMenu() {
  if (dragging || launcherState !== LAUNCHER_STATE.FULL || menuOpen || menuTransitioning) return;
  clearAutoResnapTimer();
  clearHoverOpenTimer();
  clearMenuCloseTimer();
  markMenuTransition();
  const nextState = await window.desktopApi.setLauncherMenuOpen(true);
  applyLauncherPayload(nextState);
}

async function closeMenu() {
  clearHoverOpenTimer();
  clearMenuCloseTimer();
  if (!menuOpen || menuTransitioning) return;
  markMenuTransition();
  const nextState = await window.desktopApi.setLauncherMenuOpen(false);
  applyLauncherPayload(nextState);
  scheduleAutoResnapIfNearEdge();
}

async function toggleMenu() {
  if (dragging || menuTransitioning) return;
  if (launcherState !== LAUNCHER_STATE.FULL) {
    const expanded = await window.desktopApi.expandLauncherBall();
    applyLauncherPayload(expanded);
    scheduleAutoResnapIfNearEdge();
    return;
  }
  if (menuOpen) {
    await closeMenu();
  } else {
    await openMenu();
  }
}

function onPointerMove(event) {
  if (!dragStartMouse || !dragStartBounds || launcherState !== LAUNCHER_STATE.FULL) return;
  const offsetX = event.screenX - dragStartMouse.x;
  const offsetY = event.screenY - dragStartMouse.y;

  if (!dragging && Math.hypot(offsetX, offsetY) > DRAG_THRESHOLD_PX) {
    clearAutoResnapTimer();
    clearHoverOpenTimer();
    clearMenuCloseTimer();
    if (menuOpen) {
      window.desktopApi.setLauncherMenuOpen(false).then(applyLauncherPayload).catch(() => {});
    }
    dragging = true;
    app.classList.add("dragging");
    try {
      const maybePromise = window.desktopApi.setSelectionSuspended({ suspended: true, durationMs: 5000 });
      if (maybePromise && typeof maybePromise.catch === "function") maybePromise.catch(() => {});
    } catch (_error) {}
  }

  if (!dragging) return;
  const nextX = Math.round(dragStartBounds.x + offsetX);
  const nextY = Math.round(dragStartBounds.y + offsetY);
  scheduleLauncherPositionUpdate({ x: nextX, y: nextY });
}

async function onPointerUp(event) {
  app.classList.remove("dragging");
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
  try {
    if (event && launcherIcon.hasPointerCapture && launcherIcon.hasPointerCapture(event.pointerId)) {
      launcherIcon.releasePointerCapture(event.pointerId);
    }
  } catch (_error) {}

  const wasDragging = dragging;
  dragging = false;
  dragStartMouse = null;
  dragStartBounds = null;

  if (dragRafId) {
    window.cancelAnimationFrame(dragRafId);
    dragRafId = null;
  }
  if (latestDragPosition) await window.desktopApi.setLauncherBallPosition(latestDragPosition);

  if (wasDragging) {
    try {
      const nextState = await window.desktopApi.snapLauncherIfNearEdge();
      applyLauncherPayload(nextState);
    } finally {
      try {
        await window.desktopApi.setSelectionSuspended({ suspended: false });
      } catch (_error) {}
    }
  } else if (event.target === launcherIcon || (event.target && event.target.closest && event.target.closest(".launcher-icon"))) {
    await toggleMenu();
  }
  latestDragPosition = null;
}

async function triggerToggleAction() {
  if (busy) return;
  clearAutoResnapTimer();
  busy = true;
  actionError = "";
  toggleBtn.disabled = true;
  try {
    if (running) {
      const result = await window.desktopApi.stopBackend();
      if (result && result.error) actionError = describeBackendActionError(result);
    } else {
      const result = await window.desktopApi.startBackend();
      if (!result || result.error || result.running !== true) {
        actionError = describeBackendActionError(result);
      }
    }
    await refreshStatus();
  } catch (error) {
    actionError = describeBackendActionError(null, error);
  } finally {
    busy = false;
    toggleBtn.disabled = false;
    if (actionError) {
      statusLabel.textContent = actionError;
      statusLabel.classList.remove("running");
      statusLabel.classList.add("error");
    }
  }
}

async function triggerCloseAction() {
  if (busy) return;
  clearAutoResnapTimer();
  busy = true;
  await window.desktopApi.quitApp();
}

launcherIcon.addEventListener("pointerenter", scheduleMenuOpenFromHover);
launcherIcon.addEventListener("pointerleave", scheduleMenuClose);
launcherMenu.addEventListener("pointerenter", () => {
  clearHoverOpenTimer();
  clearMenuCloseTimer();
});
launcherMenu.addEventListener("pointerleave", scheduleMenuClose);

launcherIcon.addEventListener("pointerdown", async (event) => {
  if (event.button !== 0) return;
  clearHoverOpenTimer();
  if (launcherState !== LAUNCHER_STATE.FULL) {
    await toggleMenu();
    return;
  }
  if (!launcherBounds) return;
  try {
    if (launcherIcon.setPointerCapture) launcherIcon.setPointerCapture(event.pointerId);
  } catch (_error) {}
  dragStartMouse = { x: event.screenX, y: event.screenY };
  dragStartBounds = getCurrentIconBounds();
  dragging = false;
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
});

toggleBtn.addEventListener("click", async (event) => {
  event.stopPropagation();
  await triggerToggleAction();
});

quitBtn.addEventListener("click", async (event) => {
  event.stopPropagation();
  await triggerCloseAction();
});

window.desktopApi.onBackendStatus((payload) => {
  running = Boolean(payload && payload.running);
  renderBackendState();
});

window.desktopApi.onLauncherState((payload) => {
  applyLauncherPayload(payload);
});

async function init() {
  const [status, state] = await Promise.all([
    window.desktopApi.getBackendStatus(),
    window.desktopApi.getLauncherState(),
  ]);
  running = Boolean(status && status.running);
  launcherState = state && typeof state.state === "string" ? state.state : LAUNCHER_STATE.FULL;
  launcherBounds = state && state.bounds ? state.bounds : null;
  menuOpen = Boolean(state && state.menuOpen);
  menuSide = state && typeof state.menuSide === "string" ? state.menuSide : "right";
  renderBackendState();
  applyLauncherStateClass();
}

init();
