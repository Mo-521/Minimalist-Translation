const path = require("path");
const net = require("net");
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require("electron");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");
const WebSocket = require("ws");

const PY_BACKEND_PORT = 8765;
const PY_BACKEND_URL = `ws://127.0.0.1:${PY_BACKEND_PORT}`;
const BUBBLE_SIZE_SMALL = { width: 240, height: 136 };
const BUBBLE_SIZE_LARGE = { width: 360, height: 252 };
const DEBUG_RECT_FALLBACK_HIDE_MS = 420;
const SMALL_CONTENT_HORIZONTAL_PADDING = 16 * 2;
const SMALL_CONTENT_VERTICAL_PADDING = 14 * 2;
const TITLE_BAR_HEIGHT = 32;
const CONTENT_FONT_SIZE = 14;
const CONTENT_LINE_HEIGHT_FACTOR = 1.62;
const SMALL_BUBBLE_COMFORTABLE_LINES = 4;
const CONTROL_CLOSE_ALL_BUBBLES = "__LFO_CLOSE_ALL_BUBBLES__";
const LAUNCHER_ICON_SIZE = { width: 100, height: 100 };
const LAUNCHER_MENU_SIZE = { width: 284, height: 112 };
const LAUNCHER_FULL_SIZE = LAUNCHER_ICON_SIZE;
const LAUNCHER_HALF_SIZE = LAUNCHER_ICON_SIZE;
const LAUNCHER_EDGE_THRESHOLD = 20;
const LAUNCHER_EDGE_MARGIN = 18;

const LAUNCHER_STATE = {
  FULL: "full",
  SNAP_LEFT: "snap-left",
  SNAP_RIGHT: "snap-right",
};

let launcherWindow = null;
let backendProcess = null;
let backendSocket = null;
let socketRetryTimer = null;
let backendStarting = false;
let backendStopping = false;
let backendStopPromise = null;
let backendStopForceTimer = null;
const cleanedBackendProcesses = new WeakSet();
const bubbleWindowsById = new Map();
const debugRectWindowsById = new Map();
const userDismissedBubbleMessageIds = new Set();
const wordLookupTargetsByRequestId = new Map();
let launcherState = LAUNCHER_STATE.FULL;
let launcherMenuOpen = false;
let launcherMenuSide = "right";
let bubbleMoveSuspendSentAt = 0;
let tray = null;
let launcherGuardTimer = null;
let isQuitting = false;
let launcherSuppressedByStop = false;

const DEV_BACKEND_DIR = path.join(__dirname, "..", "python-backend");
const DEV_BUNDLED_BACKEND_ENTRY = path.join(__dirname, "backend", "python-backend.exe");
const DEV_BACKEND_ENTRY = path.join(DEV_BACKEND_DIR, "main.py");
const PACKAGED_BACKEND_ENTRY = path.join(process.resourcesPath, "backend", "python-backend.exe");

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function createLauncherWindow() {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    return launcherWindow;
  }
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;
  const initialX = Math.round(workArea.x + (workArea.width - LAUNCHER_FULL_SIZE.width) / 2);
  const initialY = Math.round(workArea.y + (workArea.height - LAUNCHER_FULL_SIZE.height) / 2);

  console.log("[launcher] create floating window");
  launcherWindow = new BrowserWindow({
    width: LAUNCHER_FULL_SIZE.width,
    height: LAUNCHER_FULL_SIZE.height,
    x: initialX,
    y: initialY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    autoHideMenuBar: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  launcherWindow.setMenuBarVisibility(false);
  launcherWindow.loadFile(path.join(__dirname, "renderer", "launcher.html"));
  launcherWindow.on("hide", () => {
    console.log("[launcher] hide floating window");
  });
  launcherWindow.on("show", () => {
    console.log("[launcher] show floating window");
  });
  launcherWindow.on("closed", () => {
    console.log("[launcher] destroy floating window");
    launcherWindow = null;
  });
  return launcherWindow;
}

function showLauncherWindow() {
  launcherSuppressedByStop = false;
  const win = createLauncherWindow();
  if (!win || win.isDestroyed()) return null;
  console.log("[launcher] show floating window");
  win.showInactive();
  win.setAlwaysOnTop(true, "screen-saver");
  notifyLauncherState();
  broadcastBackendStatus();
  return {
    ok: true,
    visible: win.isVisible(),
    bounds: win.getBounds(),
  };
}

function hideLauncherWindow() {
  if (!launcherWindow || launcherWindow.isDestroyed()) return { ok: true, visible: false };
  console.log("[launcher] hide floating window");
  launcherWindow.hide();
  return { ok: true, visible: false };
}

function getLauncherVisibility() {
  return {
    exists: Boolean(launcherWindow && !launcherWindow.isDestroyed()),
    visible: Boolean(launcherWindow && !launcherWindow.isDestroyed() && launcherWindow.isVisible()),
  };
}

function getWorkAreaForBounds(bounds) {
  const centerPoint = {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  };
  const display = screen.getDisplayNearestPoint(centerPoint);
  return display.workArea;
}

function clampLauncherPositionToWorkArea(x, y, width, height, workArea) {
  const minX = workArea.x;
  const maxX = workArea.x + workArea.width - width;
  const minY = workArea.y;
  const maxY = workArea.y + workArea.height - height;
  return {
    x: clampToWorkArea(Math.round(x), minX, maxX),
    y: clampToWorkArea(Math.round(y), minY, maxY),
  };
}

function notifyLauncherState() {
  if (!launcherWindow || launcherWindow.isDestroyed()) return;
  launcherWindow.webContents.send("launcher-state", {
    state: launcherState,
    bounds: launcherWindow.getBounds(),
    menuOpen: launcherMenuOpen,
    menuSide: launcherMenuSide,
  });
}

function setLauncherFullAt(targetX, targetY) {
  if (!launcherWindow || launcherWindow.isDestroyed()) return null;
  const currentBounds = launcherWindow.getBounds();
  const nextX = Number.isFinite(targetX) ? targetX : currentBounds.x;
  const nextY = Number.isFinite(targetY) ? targetY : currentBounds.y;
  const workArea = getWorkAreaForBounds(currentBounds);
  const clamped = clampLauncherPositionToWorkArea(
    nextX,
    nextY,
    LAUNCHER_FULL_SIZE.width,
    LAUNCHER_FULL_SIZE.height,
    workArea,
  );
  launcherWindow.setBounds({
    x: clamped.x,
    y: clamped.y,
    width: LAUNCHER_FULL_SIZE.width,
    height: LAUNCHER_FULL_SIZE.height,
  });
  launcherMenuOpen = false;
  launcherMenuSide = "right";
  launcherState = LAUNCHER_STATE.FULL;
  notifyLauncherState();
  return {
    state: launcherState,
    bounds: launcherWindow.getBounds(),
    menuOpen: launcherMenuOpen,
    menuSide: launcherMenuSide,
  };
}

function snapLauncherIfNearEdge() {
  if (!launcherWindow || launcherWindow.isDestroyed()) return null;

  const bounds = launcherWindow.getBounds();
  const workArea = getWorkAreaForBounds(bounds);
  const leftDistance = Math.abs(bounds.x - workArea.x);
  const rightDistance = Math.abs((bounds.x + bounds.width) - (workArea.x + workArea.width));

  if (leftDistance <= LAUNCHER_EDGE_THRESHOLD) {
    launcherWindow.setBounds({
      x: workArea.x,
      y: bounds.y,
      width: LAUNCHER_HALF_SIZE.width,
      height: LAUNCHER_HALF_SIZE.height,
    });
    launcherMenuOpen = false;
    launcherMenuSide = "right";
    launcherState = LAUNCHER_STATE.SNAP_LEFT;
    notifyLauncherState();
    return {
      state: launcherState,
      snapped: true,
      bounds: launcherWindow.getBounds(),
      menuOpen: launcherMenuOpen,
      menuSide: launcherMenuSide,
    };
  }

  if (rightDistance <= LAUNCHER_EDGE_THRESHOLD) {
    launcherWindow.setBounds({
      x: workArea.x + workArea.width - LAUNCHER_FULL_SIZE.width,
      y: bounds.y,
      width: LAUNCHER_HALF_SIZE.width,
      height: LAUNCHER_HALF_SIZE.height,
    });
    launcherMenuOpen = false;
    launcherMenuSide = "left";
    launcherState = LAUNCHER_STATE.SNAP_RIGHT;
    notifyLauncherState();
    return {
      state: launcherState,
      snapped: true,
      bounds: launcherWindow.getBounds(),
      menuOpen: launcherMenuOpen,
      menuSide: launcherMenuSide,
    };
  }

  launcherState = LAUNCHER_STATE.FULL;
  notifyLauncherState();
  return {
    state: launcherState,
    snapped: false,
    bounds,
    menuOpen: launcherMenuOpen,
    menuSide: launcherMenuSide,
  };
}

function expandLauncherBall() {
  if (!launcherWindow || launcherWindow.isDestroyed()) return null;
  const bounds = launcherWindow.getBounds();
  const workArea = getWorkAreaForBounds(bounds);

  let nextX = bounds.x;
  if (launcherState === LAUNCHER_STATE.SNAP_LEFT) {
    nextX = workArea.x;
  } else if (launcherState === LAUNCHER_STATE.SNAP_RIGHT) {
    nextX = workArea.x + workArea.width - LAUNCHER_FULL_SIZE.width;
  }

  return setLauncherFullAt(nextX, bounds.y);
}

function getLauncherIconAnchor(bounds) {
  if (!launcherMenuOpen) {
    return { x: bounds.x, y: bounds.y };
  }
  const iconX = launcherMenuSide === "left"
    ? bounds.x + LAUNCHER_MENU_SIZE.width - LAUNCHER_ICON_SIZE.width
    : bounds.x;
  const iconY = bounds.y + Math.round((LAUNCHER_MENU_SIZE.height - LAUNCHER_ICON_SIZE.height) / 2);
  return { x: iconX, y: iconY };
}

function setLauncherMenuOpen(open) {
  if (!launcherWindow || launcherWindow.isDestroyed()) return null;
  const bounds = launcherWindow.getBounds();
  const workArea = getWorkAreaForBounds(bounds);
  const anchor = getLauncherIconAnchor(bounds);

  if (!open) {
    const clamped = clampLauncherPositionToWorkArea(
      anchor.x,
      anchor.y,
      LAUNCHER_ICON_SIZE.width,
      LAUNCHER_ICON_SIZE.height,
      workArea,
    );
    launcherWindow.setBounds({
      x: clamped.x,
      y: clamped.y,
      width: LAUNCHER_ICON_SIZE.width,
      height: LAUNCHER_ICON_SIZE.height,
    });
    launcherMenuOpen = false;
    notifyLauncherState();
    return {
      state: launcherState,
      bounds: launcherWindow.getBounds(),
      menuOpen: launcherMenuOpen,
      menuSide: launcherMenuSide,
    };
  }

  if (launcherState !== LAUNCHER_STATE.FULL) {
    launcherState = LAUNCHER_STATE.FULL;
  }

  const rightSpace = workArea.x + workArea.width - anchor.x;
  const side = rightSpace >= LAUNCHER_MENU_SIZE.width ? "right" : "left";
  const nextX = side === "right" ? anchor.x : anchor.x - (LAUNCHER_MENU_SIZE.width - LAUNCHER_ICON_SIZE.width);
  const nextY = anchor.y - Math.round((LAUNCHER_MENU_SIZE.height - LAUNCHER_ICON_SIZE.height) / 2);
  const clamped = clampLauncherPositionToWorkArea(
    nextX,
    nextY,
    LAUNCHER_MENU_SIZE.width,
    LAUNCHER_MENU_SIZE.height,
    workArea,
  );
  launcherMenuOpen = true;
  launcherMenuSide = side;
  launcherWindow.setBounds({
    x: clamped.x,
    y: clamped.y,
    width: LAUNCHER_MENU_SIZE.width,
    height: LAUNCHER_MENU_SIZE.height,
  });
  notifyLauncherState();
  return {
    state: launcherState,
    bounds: launcherWindow.getBounds(),
    menuOpen: launcherMenuOpen,
    menuSide: launcherMenuSide,
  };
}

function broadcastBackendStatus() {
  if (!launcherWindow || launcherWindow.isDestroyed()) return;
  launcherWindow.webContents.send("backend-status", {
    running: Boolean(backendProcess),
    starting: backendStarting,
    stopping: backendStopping,
  });
}

function sendSelectionControl(suspended, durationMs = 0) {
  if (!backendSocket || backendSocket.readyState !== WebSocket.OPEN) {
    return false;
  }
  try {
    backendSocket.send(
      JSON.stringify({
        type: "selection_control",
        suspended: Boolean(suspended),
        durationMs: Number(durationMs) || 0,
      }),
    );
    return true;
  } catch (_error) {
    return false;
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveSizingText(payload) {
  const source = normalizeText(payload && payload.source);
  const translation = normalizeText(payload && payload.translation);
  const status = payload && typeof payload.status === "string" ? payload.status : "";

  if (status === "done") {
    return translation || source;
  }
  if (status === "pending") {
    return source || "";
  }
  return translation || source;
}

function pickBubbleSizeTier(payload) {
  const text = resolveSizingText(payload);
  if (!text) return "small";

  const normalized = text.replace(/\r\n/g, "\n");
  const smallContentWidth = Math.max(1, BUBBLE_SIZE_SMALL.width - SMALL_CONTENT_HORIZONTAL_PADDING);
  const smallContentHeight = Math.max(
    1,
    BUBBLE_SIZE_SMALL.height - TITLE_BAR_HEIGHT - SMALL_CONTENT_VERTICAL_PADDING,
  );
  const lineHeightPx = CONTENT_FONT_SIZE * CONTENT_LINE_HEIGHT_FACTOR;
  const maxVisibleLinesByHeight = Math.max(1, Math.floor(smallContentHeight / lineHeightPx));
  const comfortableLineLimit = Math.max(1, Math.min(SMALL_BUBBLE_COMFORTABLE_LINES, maxVisibleLinesByHeight));

  const approxLatinWidth = CONTENT_FONT_SIZE * 0.55;
  const approxCjkWidth = CONTENT_FONT_SIZE * 0.98;
  const explicitLines = normalized.split("\n");

  let estimatedLines = 0;
  for (const line of explicitLines) {
    if (!line) {
      estimatedLines += 1;
      continue;
    }

    let visualWidth = 0;
    for (const char of line) {
      if (/\s/.test(char)) {
        visualWidth += approxLatinWidth * 0.45;
      } else if (/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/.test(char)) {
        visualWidth += approxCjkWidth;
      } else {
        visualWidth += approxLatinWidth;
      }
    }

    estimatedLines += Math.max(1, Math.ceil(visualWidth / smallContentWidth));
    if (estimatedLines > comfortableLineLimit) {
      return "large";
    }
  }

  return estimatedLines > comfortableLineLimit ? "large" : "small";
}

function getBubbleSizeConfig(sizeTier) {
  return sizeTier === "large" ? BUBBLE_SIZE_LARGE : BUBBLE_SIZE_SMALL;
}

function getNumeric(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

/**
 * Python 侧鼠标钩子通常返回 Win32「物理像素」坐标；Electron 的 BrowserWindow / screen
 * 使用 DIP。在 Windows 上用 screen.screenToDipPoint 按点转换（多显示器由 Electron 按最近屏处理）。
 * 转换后用与后端相同的 min/max 规则重写 selection_*，保证红框与 bubble 共用一套 DIP 坐标。
 */
function normalizeTranslationPayloadForElectronDip(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object") return rawPayload;
  if (rawPayload.type !== "translation") return rawPayload;
  if (process.platform !== "win32") return rawPayload;
  if (rawPayload.coordinate_space && rawPayload.coordinate_space !== "win32_physical") {
    return rawPayload;
  }
  if (typeof screen.screenToDipPoint !== "function") return rawPayload;

  const toDipPoint = (x, y) => {
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
      return { x: nx, y: ny };
    }
    try {
      return screen.screenToDipPoint({ x: nx, y: ny });
    } catch (_e) {
      return { x: nx, y: ny };
    }
  };

  const rawReleaseX = Number.isFinite(Number(rawPayload.release_x))
    ? Number(rawPayload.release_x)
    : Number(rawPayload.x);
  const rawReleaseY = Number.isFinite(Number(rawPayload.release_y))
    ? Number(rawPayload.release_y)
    : Number(rawPayload.y);
  const rawPressX = Number.isFinite(Number(rawPayload.press_x)) ? Number(rawPayload.press_x) : rawReleaseX;
  const rawPressY = Number.isFinite(Number(rawPayload.press_y)) ? Number(rawPayload.press_y) : rawReleaseY;

  const releaseDip = toDipPoint(rawReleaseX, rawReleaseY);
  const pressDip = toDipPoint(rawPressX, rawPressY);

  if (!Number.isFinite(releaseDip.x) || !Number.isFinite(releaseDip.y)) {
    return rawPayload;
  }
  if (!Number.isFinite(pressDip.x) || !Number.isFinite(pressDip.y)) {
    return rawPayload;
  }

  const left = Math.min(pressDip.x, releaseDip.x);
  const right = Math.max(pressDip.x, releaseDip.x);
  const top = Math.min(pressDip.y, releaseDip.y);
  const bottom = Math.max(pressDip.y, releaseDip.y);

  const legacyDip = toDipPoint(
    Number.isFinite(Number(rawPayload.x)) ? Number(rawPayload.x) : rawReleaseX,
    Number.isFinite(Number(rawPayload.y)) ? Number(rawPayload.y) : rawReleaseY,
  );

  return {
    ...rawPayload,
    press_x: Math.round(pressDip.x),
    press_y: Math.round(pressDip.y),
    release_x: Math.round(releaseDip.x),
    release_y: Math.round(releaseDip.y),
    x: Number.isFinite(legacyDip.x) ? Math.round(legacyDip.x) : Math.round(releaseDip.x),
    y: Number.isFinite(legacyDip.y) ? Math.round(legacyDip.y) : Math.round(releaseDip.y),
    selection_left: Math.round(left),
    selection_right: Math.round(right),
    selection_top: Math.round(top),
    selection_bottom: Math.round(bottom),
  };
}

function resolveSelectionAnchor(payload) {
  const releaseX = getNumeric(payload && payload.release_x);
  const releaseY = getNumeric(payload && payload.release_y);
  const pressX = getNumeric(payload && payload.press_x);
  const pressY = getNumeric(payload && payload.press_y);
  const selectionLeft = getNumeric(payload && payload.selection_left);
  const selectionRight = getNumeric(payload && payload.selection_right);
  const selectionTop = getNumeric(payload && payload.selection_top);
  const selectionBottom = getNumeric(payload && payload.selection_bottom);
  const legacyX = getNumeric(payload && payload.x);
  const legacyY = getNumeric(payload && payload.y);

  const resolvedReleaseX = releaseX !== null ? releaseX : legacyX;
  const resolvedReleaseY = releaseY !== null ? releaseY : legacyY;
  const derivedLeft = pressX !== null && resolvedReleaseX !== null ? Math.min(pressX, resolvedReleaseX) : null;
  const derivedRight = pressX !== null && resolvedReleaseX !== null ? Math.max(pressX, resolvedReleaseX) : null;
  const derivedTop = pressY !== null && resolvedReleaseY !== null ? Math.min(pressY, resolvedReleaseY) : null;
  const derivedBottom = pressY !== null && resolvedReleaseY !== null ? Math.max(pressY, resolvedReleaseY) : null;

  return {
    pressX: pressX !== null ? pressX : resolvedReleaseX,
    pressY: pressY !== null ? pressY : resolvedReleaseY,
    releaseX: resolvedReleaseX,
    releaseY: resolvedReleaseY,
    selectionLeft: selectionLeft !== null ? selectionLeft : derivedLeft,
    selectionRight: selectionRight !== null ? selectionRight : derivedRight,
    selectionTop: selectionTop !== null ? selectionTop : derivedTop,
    selectionBottom: selectionBottom !== null ? selectionBottom : derivedBottom,
  };
}

function resolveSelectionRect(payload) {
  const anchor = resolveSelectionAnchor(payload);
  const fallbackX =
    anchor.releaseX !== null
      ? anchor.releaseX
      : anchor.pressX !== null
        ? anchor.pressX
        : getNumeric(payload && payload.x);
  const fallbackY =
    anchor.releaseY !== null
      ? anchor.releaseY
      : anchor.pressY !== null
        ? anchor.pressY
        : getNumeric(payload && payload.y);

  const leftSource = anchor.selectionLeft !== null ? anchor.selectionLeft : fallbackX;
  const rightSource = anchor.selectionRight !== null ? anchor.selectionRight : fallbackX;
  const topSource = anchor.selectionTop !== null ? anchor.selectionTop : fallbackY;
  const bottomSource = anchor.selectionBottom !== null ? anchor.selectionBottom : fallbackY;

  const safeLeft = Number.isFinite(leftSource) ? leftSource : 0;
  const safeRight = Number.isFinite(rightSource) ? rightSource : safeLeft;
  const safeTop = Number.isFinite(topSource) ? topSource : 0;
  const safeBottom = Number.isFinite(bottomSource) ? bottomSource : safeTop;

  const left = Math.min(safeLeft, safeRight);
  const right = Math.max(safeLeft, safeRight);
  const top = Math.min(safeTop, safeBottom);
  const bottom = Math.max(safeTop, safeBottom);

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(1, Math.round(right - left)),
    height: Math.max(1, Math.round(bottom - top)),
  };
}

function clampToWorkArea(value, minValue, maxValue) {
  if (maxValue < minValue) return minValue;
  return Math.max(minValue, Math.min(value, maxValue));
}

function chooseBubblePosition(anchor, sizeConfig, bounds, sizeTier) {
  const cursorPoint = screen.getCursorScreenPoint();
  const fallbackX = Number.isFinite(cursorPoint.x) ? cursorPoint.x : bounds.x + 120;
  const fallbackY = Number.isFinite(cursorPoint.y) ? cursorPoint.y : bounds.y + 120;

  const releaseX = anchor.releaseX !== null ? anchor.releaseX : fallbackX;
  const releaseY = anchor.releaseY !== null ? anchor.releaseY : fallbackY;
  const rectLeft = anchor.selectionLeft !== null ? anchor.selectionLeft : releaseX;
  const rectRight = anchor.selectionRight !== null ? anchor.selectionRight : releaseX;
  const rectTop = anchor.selectionTop !== null ? anchor.selectionTop : releaseY;
  const rectBottom = anchor.selectionBottom !== null ? anchor.selectionBottom : releaseY;

  const minX = bounds.x;
  const maxX = bounds.x + bounds.width - sizeConfig.width;
  const minY = bounds.y;
  const maxY = bounds.y + bounds.height - sizeConfig.height;

  const leftIdealX = rectLeft - sizeConfig.width; // right edge sticks to selection_left
  const rightIdealX = rectRight; // left edge sticks to selection_right

  const bubbleWidth = sizeConfig.width;
  const fullVisible = (x) => x >= minX && (x + bubbleWidth) <= (bounds.x + bounds.width);
  const outsideLeft = (x) => (x + bubbleWidth) <= rectLeft;
  const outsideRight = (x) => x >= rectRight;
  const outsideAny = (x) => outsideLeft(x) || outsideRight(x);

  let targetX;
  // Layer 1: left outside + fully visible
  if (fullVisible(leftIdealX) && outsideLeft(leftIdealX)) {
    targetX = leftIdealX;
  // Layer 2: right outside + fully visible
  } else if (fullVisible(rightIdealX) && outsideRight(rightIdealX)) {
    targetX = rightIdealX;
  } else {
    // Layer 3: keep outside rectangle even if partially off-screen.
    if (outsideLeft(leftIdealX)) {
      targetX = leftIdealX; // left remains higher priority
    } else if (outsideRight(rightIdealX)) {
      targetX = rightIdealX;
    } else {
      // Layer 4 (last resort): both outside paths impossible, choose minimal intrusion.
      const leftFallbackX = clampToWorkArea(leftIdealX, minX, maxX);
      const rightFallbackX = clampToWorkArea(rightIdealX, minX, maxX);
      const leftIntrusion = Math.max(0, leftFallbackX + sizeConfig.width - rectLeft);
      const rightIntrusion = Math.max(0, rectRight - rightFallbackX);
      targetX = leftIntrusion <= rightIntrusion ? leftFallbackX : rightFallbackX;
    }
  }

  // Final X convergence:
  // if outside placement exists, keep it outside (allowing partial off-screen).
  if (!outsideAny(targetX)) {
    const leftOutsideBoundaryX = rectLeft - bubbleWidth;
    const rightOutsideBoundaryX = rectRight;
    const canStayOutsideLeft = leftOutsideBoundaryX <= maxX;
    const canStayOutsideRight = rightOutsideBoundaryX >= minX;

    if (canStayOutsideLeft) {
      targetX = Math.min(leftOutsideBoundaryX, maxX);
    } else if (canStayOutsideRight) {
      targetX = Math.max(rightOutsideBoundaryX, minX);
    } else {
      targetX = clampToWorkArea(targetX, minX, maxX);
    }
  }

  // Y axis: keep bubble tightly attached to selection rectangle.
  // Prefer above the rectangle; fallback to below when top space is insufficient.
  const edgeGap = 4;
  const aboveY = rectTop - sizeConfig.height - edgeGap;
  const belowY = rectBottom + edgeGap;
  let targetY;
  if (aboveY >= minY) {
    targetY = aboveY;
  } else if (belowY <= maxY) {
    targetY = belowY;
  } else {
    const clampedAbove = clampToWorkArea(aboveY, minY, maxY);
    const clampedBelow = clampToWorkArea(belowY, minY, maxY);
    const aboveGap = Math.abs((clampedAbove + sizeConfig.height) - rectTop);
    const belowGap = Math.abs(clampedBelow - rectBottom);
    targetY = aboveGap <= belowGap ? clampedAbove : clampedBelow;
  }

  return { x: Math.round(targetX), y: Math.round(targetY) };
}

function createBubbleWindow(payload, sizeConfig) {
  const bubbleWindow = new BrowserWindow({
    width: sizeConfig.width,
    height: sizeConfig.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    autoHideMenuBar: true,
    resizable: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const anchor = resolveSelectionAnchor(payload);
  const anchorPoint = {
    x: anchor.releaseX !== null ? anchor.releaseX : (Number.isFinite(payload.x) ? payload.x : 120),
    y: anchor.releaseY !== null ? anchor.releaseY : (Number.isFinite(payload.y) ? payload.y : 120),
  };
  const cursorPoint = screen.getCursorScreenPoint();
  if (!Number.isFinite(anchorPoint.x) || !Number.isFinite(anchorPoint.y)) {
    anchorPoint.x = Number.isFinite(cursorPoint.x) ? cursorPoint.x : 120;
    anchorPoint.y = Number.isFinite(cursorPoint.y) ? cursorPoint.y : 120;
  }

  const display = screen.getDisplayNearestPoint(anchorPoint);
  const bounds = display.workArea;
  const target = chooseBubblePosition(anchor, sizeConfig, bounds, sizeConfig.width >= BUBBLE_SIZE_LARGE.width ? "large" : "small");
  bubbleWindow.setPosition(target.x, target.y);

  let latestPayload = payload;
  bubbleWindow.loadFile(path.join(__dirname, "renderer", "bubble.html"));
  bubbleWindow.webContents.once("did-finish-load", () => {
    bubbleWindow.webContents.send("bubble-data", latestPayload);
  });
  bubbleWindow.on("move", () => {
    const now = Date.now();
    if (now - bubbleMoveSuspendSentAt < 300) return;
    bubbleMoveSuspendSentAt = now;
    sendSelectionControl(true, 1500);
  });

  return {
    window: bubbleWindow,
    sendPayload(nextPayload) {
      latestPayload = nextPayload;
      if (!bubbleWindow.isDestroyed()) {
        bubbleWindow.webContents.send("bubble-data", nextPayload);
      }
    },
  };
}

function createDebugRectWindow(rect) {
  const debugWindow = new BrowserWindow({
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
    x: rect.x,
    y: rect.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    autoHideMenuBar: true,
    resizable: false,
    focusable: false,
    movable: false,
    fullscreenable: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  debugWindow.setIgnoreMouseEvents(true, { forward: true });
  debugWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  debugWindow.setAlwaysOnTop(true, "screen-saver");
  debugWindow.setBounds({
    x: rect.x,
    y: rect.y,
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
  });

  debugWindow.loadFile(path.join(__dirname, "renderer", "bubble.html"), {
    query: { debug_rect: "1" },
  });
  debugWindow.once("ready-to-show", () => {
    if (!debugWindow.isDestroyed()) {
      debugWindow.showInactive();
    }
  });

  return debugWindow;
}

function closeDebugRectWindowById(messageId) {
  if (!messageId) return;
  const existing = debugRectWindowsById.get(messageId);
  if (!existing) return;
  if (existing.hideTimer) clearTimeout(existing.hideTimer);
  if (existing.window && !existing.window.isDestroyed()) {
    existing.window.close();
  }
  debugRectWindowsById.delete(messageId);
}

function showDebugRectForBubble(messageId, payload, bubbleWindow) {
  const rect = resolveSelectionRect(payload);
  let existing = messageId ? debugRectWindowsById.get(messageId) : null;

  if (existing && existing.window && !existing.window.isDestroyed()) {
    existing.window.setBounds({
      x: rect.x,
      y: rect.y,
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
    });
    if (existing.hideTimer) {
      clearTimeout(existing.hideTimer);
    }
    existing.hideTimer = setTimeout(() => {
      if (!existing.window.isDestroyed()) {
        existing.window.close();
      }
    }, DEBUG_RECT_FALLBACK_HIDE_MS);
    return;
  }

  const debugWindow = createDebugRectWindow(rect);
  const entry = {
    window: debugWindow,
    hideTimer: null,
  };

  if (messageId) {
    debugRectWindowsById.set(messageId, entry);
  }

  debugWindow.on("closed", () => {
    if (!messageId) return;
    const current = debugRectWindowsById.get(messageId);
    if (current && current.window === debugWindow) {
      if (current.hideTimer) clearTimeout(current.hideTimer);
      debugRectWindowsById.delete(messageId);
    }
  });

  entry.hideTimer = setTimeout(() => {
    if (!debugWindow.isDestroyed()) {
      debugWindow.close();
    }
  }, DEBUG_RECT_FALLBACK_HIDE_MS);

  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.once("closed", () => {
      if (!debugWindow.isDestroyed()) {
        debugWindow.close();
      }
    });
  }
}

function closeAllOverlaysAndMarkDismissed() {
  for (const [messageId, entry] of bubbleWindowsById.entries()) {
    userDismissedBubbleMessageIds.add(messageId);
    if (entry && entry.window && !entry.window.isDestroyed()) {
      entry.window.close();
    }
  }
  bubbleWindowsById.clear();

  debugRectWindowsById.forEach((entry) => {
    if (entry && entry.hideTimer) clearTimeout(entry.hideTimer);
    if (entry && entry.window && !entry.window.isDestroyed()) {
      entry.window.close();
    }
  });
  debugRectWindowsById.clear();
}

function bindBubbleWindowLifecycle(id, bubbleEntry) {
  bubbleEntry.window.on("closed", () => {
    closeDebugRectWindowById(id);
    const current = bubbleWindowsById.get(id);
    if (current && current.window === bubbleEntry.window) {
      bubbleWindowsById.delete(id);
    }
  });
}

function handleTranslationPayload(rawPayload) {
  const payload = normalizeTranslationPayloadForElectronDip(rawPayload);
  if (payload && payload.source === CONTROL_CLOSE_ALL_BUBBLES) {
    closeAllOverlaysAndMarkDismissed();
    return;
  }
  const messageId = payload && typeof payload.id === "string" ? payload.id : "";
  const status = payload && typeof payload.status === "string" ? payload.status : "";
  const fallbackTier = pickBubbleSizeTier(payload);

  if (!messageId) {
    const bubbleEntry = createBubbleWindow(payload, getBubbleSizeConfig(fallbackTier));
    showDebugRectForBubble("", payload, bubbleEntry.window);
    return;
  }

  if (status === "pending") {
    const existing = bubbleWindowsById.get(messageId);
    if (existing && !existing.window.isDestroyed()) {
      existing.sendPayload(payload);
      return;
    }

    userDismissedBubbleMessageIds.delete(messageId);
    const sizeTier = pickBubbleSizeTier(payload);
    const bubbleEntry = createBubbleWindow(payload, getBubbleSizeConfig(sizeTier));
    bubbleWindowsById.set(messageId, { ...bubbleEntry, sizeTier });
    showDebugRectForBubble(messageId, payload, bubbleEntry.window);
    bindBubbleWindowLifecycle(messageId, bubbleEntry);
    return;
  }

  if (status === "done") {
    if (userDismissedBubbleMessageIds.has(messageId)) {
      userDismissedBubbleMessageIds.delete(messageId);
      return;
    }

    const existing = bubbleWindowsById.get(messageId);
    if (existing && !existing.window.isDestroyed()) {
      existing.sendPayload(payload);
      return;
    }

    const sizeTier = pickBubbleSizeTier(payload);
    const bubbleEntry = createBubbleWindow(payload, getBubbleSizeConfig(sizeTier));
    bubbleWindowsById.set(messageId, { ...bubbleEntry, sizeTier });
    bindBubbleWindowLifecycle(messageId, bubbleEntry);
    return;
  }

  if (status === "partial") {
    if (userDismissedBubbleMessageIds.has(messageId)) {
      return;
    }

    const existing = bubbleWindowsById.get(messageId);
    if (existing && !existing.window.isDestroyed()) {
      existing.sendPayload(payload);
    }
    return;
  }

  const bubbleEntry = createBubbleWindow(payload, getBubbleSizeConfig(fallbackTier));
  showDebugRectForBubble("", payload, bubbleEntry.window);
}

function connectBackendSocketWithRetry() {
  if (!backendProcess) return;
  if (backendSocket) return;

  const ws = new WebSocket(PY_BACKEND_URL);
  backendSocket = ws;

  ws.on("open", () => {
    if (socketRetryTimer) {
      clearTimeout(socketRetryTimer);
      socketRetryTimer = null;
    }
    if (backendStarting) {
      backendStarting = false;
      broadcastBackendStatus();
    }
  });

  ws.on("message", (data) => {
    try {
      const payload = JSON.parse(data.toString("utf-8"));
      if (payload.type === "translation") {
        handleTranslationPayload(payload);
      } else if (payload.type === "grammar_result") {
        const messageId = payload && typeof payload.id === "string" ? payload.id : "";
        if (!messageId) return;
        const entry = bubbleWindowsById.get(messageId);
        if (!entry || !entry.window || entry.window.isDestroyed()) return;
        entry.window.webContents.send("grammar-data", payload);
      } else if (payload.type === "word_lookup_result") {
        const requestId = payload && typeof payload.requestId === "string" ? payload.requestId : "";
        if (!requestId) return;
        const target = wordLookupTargetsByRequestId.get(requestId);
        wordLookupTargetsByRequestId.delete(requestId);
        if (!target) return;
        if (!target.isDestroyed()) {
          target.send("word-lookup-result", payload);
        }
      }
    } catch (error) {
      console.error("Invalid backend message:", error);
    }
  });

  ws.on("close", () => {
    backendSocket = null;
    if (backendProcess && !backendStopping) {
      socketRetryTimer = setTimeout(connectBackendSocketWithRetry, 500);
    }
  });

  ws.on("error", () => {
    ws.close();
  });
}

function resolveBackendLaunchTarget() {
  if (app.isPackaged) {
    return {
      mode: "packaged",
      command: PACKAGED_BACKEND_ENTRY,
      args: [],
      cwd: path.dirname(PACKAGED_BACKEND_ENTRY),
    };
  }

  if (!process.env.PYTHON_EXECUTABLE && fs.existsSync(DEV_BUNDLED_BACKEND_ENTRY)) {
    return {
      mode: "development-bundled",
      command: DEV_BUNDLED_BACKEND_ENTRY,
      args: [],
      cwd: path.dirname(DEV_BUNDLED_BACKEND_ENTRY),
    };
  }

  return {
    mode: "development",
    command: process.env.PYTHON_EXECUTABLE || "python",
    args: [DEV_BACKEND_ENTRY],
    cwd: DEV_BACKEND_DIR,
  };
}

function cleanupBackendProcess(processRef) {
  if (!processRef) return;
  if (cleanedBackendProcesses.has(processRef)) return;
  cleanedBackendProcesses.add(processRef);

  if (backendProcess === processRef) {
    backendProcess = null;
  }

  if (backendStopForceTimer) {
    clearTimeout(backendStopForceTimer);
    backendStopForceTimer = null;
  }
  if (socketRetryTimer) {
    clearTimeout(socketRetryTimer);
    socketRetryTimer = null;
  }
  if (backendSocket) {
    try {
      backendSocket.close();
    } catch (_e) {}
    backendSocket = null;
  }

  for (const entry of bubbleWindowsById.values()) {
    if (entry && entry.window && !entry.window.isDestroyed()) {
      entry.window.close();
    }
  }
  bubbleWindowsById.clear();
  debugRectWindowsById.forEach((entry) => {
    if (entry && entry.hideTimer) clearTimeout(entry.hideTimer);
    if (entry && entry.window && !entry.window.isDestroyed()) {
      entry.window.close();
    }
  });
  debugRectWindowsById.clear();
  wordLookupTargetsByRequestId.clear();

  backendStarting = false;
  backendStopping = false;
  backendStopPromise = null;
  console.log("[desktop-translation] stopped");
  broadcastBackendStatus();
}

function probeBackendPortOccupied(timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (occupied) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch (_e) {}
      resolve(occupied);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    try {
      socket.connect(PY_BACKEND_PORT, "127.0.0.1");
    } catch (_e) {
      finish(false);
    }
  });
}

async function maybeReleaseStaleBackendPort() {
  const occupied = await probeBackendPortOccupied();
  if (!occupied) return;
  console.warn(
    `[backend] port ${PY_BACKEND_PORT} appears occupied while no managed backend exists.`,
  );
  console.warn("[backend] will not kill by image name; refusing to risk stopping an unrelated process.");
}

async function startBackend() {
  if (backendStarting) {
    return { running: Boolean(backendProcess), starting: true };
  }
  if (backendStopping) return { running: false, stopping: true };
  if (backendProcess) return { running: true };

  backendStarting = true;
  broadcastBackendStatus();

  await maybeReleaseStaleBackendPort();

  const stillOccupied = await probeBackendPortOccupied();
  if (stillOccupied) {
    console.error(
      `[backend] refuse to spawn: port ${PY_BACKEND_PORT} is still occupied. ` +
        "An external process is holding the port; not starting a new backend to avoid duplicates.",
    );
    backendStarting = false;
    broadcastBackendStatus();
    return { running: false, error: "backend-port-occupied" };
  }

  const target = resolveBackendLaunchTarget();
  if (target.mode !== "development" && !fs.existsSync(target.command)) {
    console.error(`[backend] launch target is missing: ${target.command}`);
    backendStarting = false;
    broadcastBackendStatus();
    return { running: false, error: "backend-entry-missing" };
  }
  console.log(`[backend] launch mode=${target.mode} command=${target.command}`);

  let spawnedProcess;
  try {
    spawnedProcess = spawn(target.command, target.args, {
      cwd: target.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    console.error("[backend] spawn failed:", error.message || error);
    backendProcess = null;
    backendStarting = false;
    broadcastBackendStatus();
    return { running: false, error: "backend spawn failed" };
  }

  backendProcess = spawnedProcess;
  const localProcess = spawnedProcess;

  spawnedProcess.stdout.on("data", (chunk) => {
    const text = chunk.toString("utf-8").trim();
    if (text) console.log("[python]", text);
  });

  spawnedProcess.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf-8").trim();
    if (text) console.error("[python-error]", text);
  });

  spawnedProcess.on("exit", () => {
    cleanupBackendProcess(localProcess);
  });

  spawnedProcess.on("error", (error) => {
    console.error("[backend] process error:", error.message || error);
    cleanupBackendProcess(localProcess);
  });

  connectBackendSocketWithRetry();
  launcherSuppressedByStop = false;
  showLauncherWindow();
  console.log("[desktop-translation] started");
  broadcastBackendStatus();
  return { running: true, starting: true };
}

function stopBackend() {
  if (!backendProcess) {
    backendStarting = false;
    backendStopping = false;
    return Promise.resolve({ running: false });
  }
  if (backendStopPromise) {
    return backendStopPromise;
  }

  backendStarting = false;
  backendStopping = true;
  broadcastBackendStatus();
  const processRef = backendProcess;
  const pid = processRef.pid;

  if (socketRetryTimer) {
    clearTimeout(socketRetryTimer);
    socketRetryTimer = null;
  }

  backendStopPromise = new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanupBackendProcess(processRef);
      backendStopPromise = null;
      resolve({ running: false });
    };

    processRef.once("exit", finish);
    processRef.once("close", finish);

    const fallbackKill = () => {
      try {
        processRef.kill();
      } catch (error) {
        console.error("[backend] fallback kill failed:", error.message || error);
      }
    };

    if (process.platform === "win32" && pid) {
      console.warn(`[backend] stopping pid=${pid} via taskkill /T /F`);
      let taskkillProcess = null;
      try {
        taskkillProcess = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } catch (error) {
        console.error("[backend] taskkill spawn failed:", error.message || error);
        fallbackKill();
      }

      if (taskkillProcess) {
        const tkTimer = setTimeout(() => {
          if (settled) return;
          console.warn("[backend] taskkill timed out, fallback to processRef.kill()");
          fallbackKill();
        }, 1500);

        taskkillProcess.once("exit", (code) => {
          clearTimeout(tkTimer);
          if (settled) return;
          if (code !== 0) {
            console.warn(`[backend] taskkill exit code=${code}, fallback to processRef.kill()`);
            fallbackKill();
          }
        });
        taskkillProcess.once("error", (error) => {
          clearTimeout(tkTimer);
          if (settled) return;
          console.warn("[backend] taskkill errored, fallback to processRef.kill():", error.message || error);
          fallbackKill();
        });
      }
    } else {
      try {
        processRef.kill();
      } catch (error) {
        console.error("[backend] kill failed:", error.message || error);
      }
    }

    if (backendStopForceTimer) {
      clearTimeout(backendStopForceTimer);
    }
    backendStopForceTimer = setTimeout(() => {
      backendStopForceTimer = null;
      if (settled) return;
      try {
        processRef.kill("SIGKILL");
      } catch (_e) {}
      setTimeout(() => {
        if (!settled) finish();
      }, 1500);
    }, 3000);
  });

  return backendStopPromise;
}

ipcMain.handle("backend:start", async () => startBackend());
ipcMain.handle("backend:stop", async () => stopBackend());
ipcMain.handle("backend:status", () => ({
  running: Boolean(backendProcess),
  starting: backendStarting,
  stopping: backendStopping,
}));
ipcMain.handle("selection:set-suspended", (_event, payload) => {
  const ok = sendSelectionControl(
    Boolean(payload && payload.suspended),
    Number(payload && payload.durationMs) || 0,
  );
  return ok ? { ok: true } : { ok: false, error: "backend-offline" };
});
ipcMain.handle("launcher:get-state", () => {
  if (!launcherWindow || launcherWindow.isDestroyed()) {
    return {
      state: launcherState,
      bounds: null,
      menuOpen: launcherMenuOpen,
      menuSide: launcherMenuSide,
    };
  }
  return {
    state: launcherState,
    bounds: launcherWindow.getBounds(),
    menuOpen: launcherMenuOpen,
    menuSide: launcherMenuSide,
  };
});
ipcMain.handle("launcher:set-ball-position", (_event, payload) => {
  if (!payload || typeof payload !== "object") return null;
  return setLauncherFullAt(payload.x, payload.y);
});
ipcMain.handle("launcher:snap-if-near-edge", () => snapLauncherIfNearEdge());
ipcMain.handle("launcher:expand-ball", () => expandLauncherBall());
ipcMain.handle("launcher:set-menu-open", (_event, open) => setLauncherMenuOpen(Boolean(open)));
ipcMain.handle("launcher:show", () => showLauncherWindow());
ipcMain.handle("launcher:hide", () => hideLauncherWindow());
ipcMain.handle("app:quit", async () => {
  isQuitting = true;
  await stopBackend();
  app.quit();
  return { ok: true };
});
ipcMain.handle("bubble:close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  for (const [messageId, entry] of bubbleWindowsById.entries()) {
    if (entry && entry.window === win) {
      userDismissedBubbleMessageIds.add(messageId);
      break;
    }
  }
  win.close();
});
ipcMain.handle("word:lookup", (event, payload) => {
  const word = payload && typeof payload.word === "string" ? payload.word.trim() : "";
  const context = payload && typeof payload.context === "string" ? payload.context : "";
  if (!word) {
    return { ok: false, error: "word-required" };
  }
  if (!backendSocket || backendSocket.readyState !== WebSocket.OPEN) {
    return { ok: false, error: "backend-offline" };
  }

  const requestId = randomUUID();
  wordLookupTargetsByRequestId.set(requestId, event.sender);

  try {
    backendSocket.send(
      JSON.stringify({
        type: "word_lookup_request",
        requestId,
        word,
        context,
      }),
    );
    return { ok: true, requestId };
  } catch (_error) {
    wordLookupTargetsByRequestId.delete(requestId);
    return { ok: false, error: "send-failed" };
  }
});

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: "显示主窗口",
      click: () => showLauncherWindow(),
    },
    {
      label: "显示悬浮球",
      click: () => showLauncherWindow(),
    },
    {
      label: "隐藏悬浮球",
      click: () => hideLauncherWindow(),
    },
    { type: "separator" },
    {
      label: "停止桌面翻译",
      click: async () => {
        await stopBackend();
        launcherSuppressedByStop = true;
        hideLauncherWindow();
      },
    },
    {
      label: "退出",
      click: async () => {
        isQuitting = true;
        await stopBackend();
        app.quit();
      },
    },
  ]));
}

function createTray() {
  if (tray) return tray;
  const icon = nativeImage.createFromDataURL(
    "data:image/svg+xml;base64," +
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#6b6ff0"/><text x="16" y="21" font-size="14" text-anchor="middle" fill="white" font-family="Arial">MT</text></svg>',
      ).toString("base64"),
  );
  tray = new Tray(icon);
  tray.setToolTip("Minimalist Translation");
  tray.on("click", () => showLauncherWindow());
  updateTrayMenu();
  return tray;
}

function startLauncherGuard() {
  if (launcherGuardTimer) return;
  launcherGuardTimer = setInterval(() => {
    if (isQuitting) return;
    if (launcherSuppressedByStop) return;
    if (!launcherWindow || launcherWindow.isDestroyed()) {
      console.log("[launcher] guard recreating floating window");
      createLauncherWindow();
      return;
    }
    if (!launcherWindow.isVisible()) {
      console.log("[launcher] guard detected hidden floating window");
    }
  }, 2000);
}

app.on("second-instance", () => {
  console.log("[launcher] second instance requested show");
  showLauncherWindow();
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.whenReady().then(() => {
  createLauncherWindow();
  createTray();
  startLauncherGuard();

  app.on("activate", () => {
    showLauncherWindow();
  });
});

app.on("window-all-closed", async () => {
  if (isQuitting) {
    await stopBackend();
    if (process.platform !== "darwin") app.quit();
    return;
  }
  if (backendProcess || backendStarting) {
    createLauncherWindow();
  }
});
