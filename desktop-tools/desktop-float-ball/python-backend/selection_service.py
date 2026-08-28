from __future__ import annotations

import os
import re
import sys
import time
import threading
from math import hypot
from typing import Callable, Optional, Tuple

import keyboard
import pyperclip
from pynput import mouse

DEBOUNCE_SECONDS = 0.3
MIN_TEXT_LEN = 2
MIN_DRAG_DISTANCE = 10.0
CLIPBOARD_WAIT_TIMEOUT = 0.35
CLIPBOARD_POLL_INTERVAL = 0.02
POST_MOUSEUP_DELAY = 0.08
DEBUG_SELECTION = False
CONTROL_CLOSE_ALL_BUBBLES = "__LFO_CLOSE_ALL_BUBBLES__"

MAX_TEXT_LEN = 800
MAX_LINE_COUNT = 8
DUPLICATE_TEXT_WINDOW_SECONDS = 2.0

# Win32 WM_NCHITTEST / HT* (only used on Windows)
WM_NCHITTEST = 0x0084
HTCAPTION = 2
HTSYSMENU = 3
HTMINBUTTON = 8
HTMAXBUTTON = 9
HTLEFT = 10
HTRIGHT = 11
HTTOP = 12
HTTOPLEFT = 13
HTTOPRIGHT = 14
HTBOTTOM = 15
HTBOTTOMLEFT = 16
HTBOTTOMRIGHT = 17
HTCLOSE = 20

GA_ROOT = 2
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

_TERMINAL_PROCESS_EXES = frozenset(
    {
        "windowsterminal.exe",
        "wt.exe",
        "powershell.exe",
        "pwsh.exe",
        "cmd.exe",
        "conhost.exe",
        "openconsole.exe",
    }
)

_WIN32_SETUP = False
_user32 = None


def _ensure_win32() -> bool:
    global _WIN32_SETUP, _user32
    if sys.platform != "win32":
        return False
    if _WIN32_SETUP:
        return _user32 is not None
    _WIN32_SETUP = True
    try:
        import ctypes

        _user32 = ctypes.windll.user32
        return True
    except Exception:
        _user32 = None
        return False


def _make_lparam(x: int, y: int) -> int:
    return ((int(y) & 0xFFFF) << 16) | (int(x) & 0xFFFF)


def _is_window_drag_area(x: int, y: int) -> bool:
    """
    True if (x,y) is on a non-client window drag/resize/caption area (Windows only).
    On failure or non-Windows, returns False.
    """
    if not _ensure_win32() or _user32 is None:
        return False
    try:
        import ctypes

        class POINT(ctypes.Structure):
            _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

        pt = POINT(int(x), int(y))
        hwnd = _user32.WindowFromPoint(ctypes.byref(pt))
        if not hwnd:
            return False
        lparam = _make_lparam(int(x), int(y))
        hit = int(_user32.SendMessageW(hwnd, WM_NCHITTEST, 0, lparam))
        return hit in {
            HTCAPTION,
            HTLEFT,
            HTRIGHT,
            HTTOP,
            HTBOTTOM,
            HTTOPLEFT,
            HTTOPRIGHT,
            HTBOTTOMLEFT,
            HTBOTTOMRIGHT,
            HTMINBUTTON,
            HTMAXBUTTON,
            HTCLOSE,
            HTSYSMENU,
        }
    except Exception:
        return False


def _get_root_window(hwnd: int) -> Optional[int]:
    if sys.platform != "win32" or not hwnd:
        return None
    if not _ensure_win32() or _user32 is None:
        return None
    try:
        root = _user32.GetAncestor(int(hwnd), GA_ROOT)
        if root:
            return int(root)
    except Exception:
        pass
    try:
        return int(hwnd)
    except Exception:
        return None


def _get_window_handle_at_point(x: int, y: int) -> Optional[int]:
    if sys.platform != "win32":
        return None
    if not _ensure_win32() or _user32 is None:
        return None
    try:
        import ctypes

        class POINT(ctypes.Structure):
            _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

        pt = POINT(int(x), int(y))
        hwnd = _user32.WindowFromPoint(ctypes.byref(pt))
        if not hwnd:
            return None
        hwnd_int = int(hwnd)
        root = _get_root_window(hwnd_int)
        return root if root is not None else hwnd_int
    except Exception:
        return None


def _get_foreground_window() -> Optional[int]:
    if sys.platform != "win32":
        return None
    if not _ensure_win32() or _user32 is None:
        return None
    try:
        fg = _user32.GetForegroundWindow()
        if not fg:
            return None
        return _get_root_window(int(fg))
    except Exception:
        return None


def _get_window_rect(hwnd: int) -> Optional[Tuple[int, int, int, int]]:
    if sys.platform != "win32":
        return None
    if not _ensure_win32() or _user32 is None or not hwnd:
        return None
    try:
        import ctypes

        class RECT(ctypes.Structure):
            _fields_ = [
                ("left", ctypes.c_long),
                ("top", ctypes.c_long),
                ("right", ctypes.c_long),
                ("bottom", ctypes.c_long),
            ]

        rect = RECT()
        if not _user32.GetWindowRect(int(hwnd), ctypes.byref(rect)):
            return None
        return (int(rect.left), int(rect.top), int(rect.right), int(rect.bottom))
    except Exception:
        return None


def _has_window_moved(
    rect_before: Optional[Tuple[int, int, int, int]],
    rect_after: Optional[Tuple[int, int, int, int]],
) -> bool:
    if rect_before is None or rect_after is None:
        return False
    left_b, top_b, _, _ = rect_before
    left_a, top_a, _, _ = rect_after
    if abs(left_b - left_a) >= 2 or abs(top_b - top_a) >= 2:
        return True
    return False


def _get_window_class_name(hwnd: int) -> str:
    if sys.platform != "win32" or not hwnd:
        return ""
    if not _ensure_win32() or _user32 is None:
        return ""
    try:
        import ctypes

        buf = ctypes.create_unicode_buffer(512)
        if _user32.GetClassNameW(int(hwnd), buf, 512):
            return buf.value or ""
    except Exception:
        pass
    return ""


def _get_window_title(hwnd: int) -> str:
    if sys.platform != "win32" or not hwnd:
        return ""
    if not _ensure_win32() or _user32 is None:
        return ""
    try:
        import ctypes

        n = int(_user32.GetWindowTextLengthW(int(hwnd)))
        if n <= 0:
            return ""
        buf = ctypes.create_unicode_buffer(n + 1)
        if _user32.GetWindowTextW(int(hwnd), buf, n + 1):
            return buf.value or ""
    except Exception:
        pass
    return ""


def _get_window_process_name(hwnd: int) -> str:
    if sys.platform != "win32" or not hwnd:
        return ""
    if not _ensure_win32() or _user32 is None:
        return ""
    try:
        import ctypes

        kernel32 = ctypes.windll.kernel32
        pid = ctypes.c_ulong(0)
        _user32.GetWindowThreadProcessId(int(hwnd), ctypes.byref(pid))
        if not pid.value:
            return ""
        hproc = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
        if not hproc:
            return ""
        try:
            buf_size = ctypes.c_ulong(32767)
            buf = ctypes.create_unicode_buffer(buf_size.value)
            if kernel32.QueryFullProcessImageNameW(hproc, 0, buf, ctypes.byref(buf_size)):
                path = buf.value or ""
                base = os.path.basename(path)
                return base.lower()
        finally:
            kernel32.CloseHandle(hproc)
    except Exception:
        pass
    return ""


def _is_terminal_like_window(hwnd: Optional[int]) -> bool:
    if not hwnd:
        return False
    proc_lower = _get_window_process_name(int(hwnd))
    if proc_lower in _TERMINAL_PROCESS_EXES:
        return True
    cls_lower = _get_window_class_name(int(hwnd)).lower()
    class_markers = (
        "consolewindowclass",
        "cascadia_hosting_window_class",
        "windows.ui.core.corewindow",
    )
    if any(m in cls_lower for m in class_markers):
        return True
    title_lower = _get_window_title(int(hwnd)).lower()
    title_markers = (
        "powershell",
        "pwsh",
        "command prompt",
        "cmd.exe",
        "cmd",
        "c:\\windows\\system32\\cmd",
        "windows powershell",
        "windows terminal",
        "npm.cmd start",
        "electron",
        "python",
        "node",
        "终止批处理操作",
    )
    return any(m in title_lower for m in title_markers)


def _is_valid_selection_text(text: str) -> bool:
    cleaned = text.strip()
    if len(cleaned) < MIN_TEXT_LEN:
        return False
    if len(cleaned) > MAX_TEXT_LEN:
        return False
    if cleaned.count("\n") + 1 > MAX_LINE_COUNT:
        return False

    has_zh = bool(re.search(r"[\u4e00-\u9fff]", cleaned))
    has_en = bool(re.search(r"[A-Za-z]", cleaned))
    if not has_zh and not has_en:
        return False

    lower = cleaned.lower()
    if lower.startswith("http://") or lower.startswith("https://"):
        return False
    if "www." in lower and re.search(r"\bwww\.[^\s]+", lower):
        return False

    if re.match(r"^[a-zA-Z]:\\", cleaned) or re.search(r"\\[^\s\\]+\\", cleaned):
        return False

    if cleaned.startswith("$env:"):
        return False
    if "npm.cmd start" in cleaned:
        return False
    first_line = cleaned.split("\n", 1)[0].strip()
    first_tokens = first_line.split()
    if first_tokens:
        ft = first_tokens[0].lower().rstrip(":")
        if ft in {
            "powershell",
            "powershell.exe",
            "cmd",
            "cmd.exe",
            "python",
            "python.exe",
            "node",
            "node.exe",
            "npm",
            "npm.exe",
            "git",
            "git.exe",
        }:
            return False

    lt = cleaned.lower().lstrip()
    if lt.startswith("<html") or lt.startswith("<body") or lt.startswith("<!doctype") or lt.startswith("<?xml"):
        return False
    if "</html>" in cleaned.lower():
        return False

    stripped = cleaned.strip()
    if len(stripped) > 80:
        if stripped.startswith("{") and stripped.endswith("}"):
            return False
        if stripped.startswith("[") and stripped.endswith("]"):
            return False

    return True


def _restore_clipboard_text(text: str) -> bool:
    for _attempt in range(3):
        try:
            pyperclip.copy(text)
            return True
        except Exception:
            time.sleep(0.03)
    return False


class SelectionService:
    def __init__(self, on_selection: Callable[..., None]) -> None:
        self._on_selection = on_selection
        self._last_trigger_time = 0.0
        self._left_pressed = False
        self._press_x = 0
        self._press_y = 0
        self._ignore_current_drag = False
        self._press_hwnd: Optional[int] = None
        self._press_window_rect: Optional[Tuple[int, int, int, int]] = None
        self._press_terminal_like = False
        self._last_text = ""
        self._last_text_time = 0.0
        self._selection_suspended = False
        self._suspend_until = 0.0
        self._state_lock = threading.Lock()
        self._clipboard_worker_running = False
        self._clipboard_worker_lock = threading.Lock()

    def _clear_press_window_state(self) -> None:
        self._press_hwnd = None
        self._press_window_rect = None
        self._ignore_current_drag = False
        self._press_terminal_like = False

    def set_suspended(self, suspended: bool, duration_ms: int = 0) -> None:
        with self._state_lock:
            if suspended:
                self._selection_suspended = True
                if duration_ms > 0:
                    self._suspend_until = time.monotonic() + (duration_ms / 1000.0)
                else:
                    self._suspend_until = 0.0
                return
            self._selection_suspended = False
            self._suspend_until = 0.0

    def is_suspended(self) -> bool:
        with self._state_lock:
            if not self._selection_suspended:
                return False
            if self._suspend_until > 0.0 and time.monotonic() >= self._suspend_until:
                self._selection_suspended = False
                self._suspend_until = 0.0
                return False
            return True

    def _read_selected_text(self) -> tuple[str, bool]:
        time.sleep(POST_MOUSEUP_DELAY)

        old_text = ""
        try:
            old_value = pyperclip.paste()
            old_text = old_value if isinstance(old_value, str) else ""
        except Exception:
            old_text = ""

        marker = f"__LINGOFLOW_CLIPBOARD_MARKER_{time.time_ns()}__"
        try:
            pyperclip.copy(marker)
        except Exception:
            return "", False

        if sys.platform == "win32":
            fg = _get_foreground_window()
            if fg is not None and _is_terminal_like_window(fg):
                if DEBUG_SELECTION:
                    print("[timing] clipboard skipped reason=foreground_terminal", flush=True)
                _restore_clipboard_text(old_text)
                return "", False

        try:
            keyboard.press_and_release("ctrl+c")
        except Exception:
            _restore_clipboard_text(old_text)
            return "", False

        if DEBUG_SELECTION:
            print("[timing] clipboard ctrl+c start", flush=True)

        start = time.monotonic()
        deadline = start + CLIPBOARD_WAIT_TIMEOUT
        selected_text = ""
        success = False

        while time.monotonic() < deadline:
            time.sleep(CLIPBOARD_POLL_INTERVAL)
            try:
                current = pyperclip.paste()
            except Exception:
                continue

            new_text = current if isinstance(current, str) else ""
            if new_text == marker:
                continue
            if new_text.strip():
                selected_text = new_text
                success = True
                break

        elapsed_ms = (time.monotonic() - start) * 1000.0
        if success:
            if DEBUG_SELECTION:
                print(
                    f"[timing] clipboard_read success elapsed_ms={elapsed_ms:.2f} text_len={len(selected_text)}",
                    flush=True,
                )
        else:
            if DEBUG_SELECTION:
                print(f"[timing] clipboard_read failed elapsed_ms={elapsed_ms:.2f}", flush=True)

        try:
            restored = _restore_clipboard_text(old_text)
            if DEBUG_SELECTION:
                print(
                    f"[timing] clipboard_restore {'success' if restored else 'failed'}",
                    flush=True,
                )
        except Exception as exc:
            if DEBUG_SELECTION:
                print(f"[timing] clipboard_restore failed err={exc}", flush=True)

        return selected_text, success

    def _start_clipboard_worker(
        self,
        press_x: int,
        press_y: int,
        release_x: int,
        release_y: int,
        source_hwnd: Optional[int] = None,
    ) -> None:
        with self._clipboard_worker_lock:
            if self._clipboard_worker_running:
                if DEBUG_SELECTION:
                    print("[timing] worker skipped reason=busy", flush=True)
                return
            self._clipboard_worker_running = True

        def runner() -> None:
            try:
                self._clipboard_worker_main(
                    press_x,
                    press_y,
                    release_x,
                    release_y,
                    source_hwnd=source_hwnd,
                )
            except Exception:
                if DEBUG_SELECTION:
                    print("[timing] worker exception", flush=True)

        threading.Thread(target=runner, daemon=True, name="selection-clipboard-worker").start()

    def _clipboard_worker_main(
        self,
        press_x: int,
        press_y: int,
        release_x: int,
        release_y: int,
        source_hwnd: Optional[int] = None,
    ) -> None:
        try:
            if DEBUG_SELECTION:
                print("[timing] worker start", flush=True)
            if source_hwnd is not None and _is_terminal_like_window(source_hwnd):
                if DEBUG_SELECTION:
                    print("[timing] worker skipped reason=terminal", flush=True)
                return
            clipboard_start = time.perf_counter()
            if DEBUG_SELECTION:
                print("[timing] clipboard_read start", flush=True)
            try:
                text, changed = self._read_selected_text()
            except Exception:
                return
            clipboard_elapsed_ms = (time.perf_counter() - clipboard_start) * 1000.0
            text_len = len(text) if text else 0
            if DEBUG_SELECTION:
                print(
                    f"[timing] clipboard_read done elapsed_ms={clipboard_elapsed_ms:.2f} "
                    f"changed={'true' if changed else 'false'} text_len={text_len}",
                    flush=True,
                )
            if not changed:
                return
            cleaned = text.strip() if text else ""
            if len(cleaned) < MIN_TEXT_LEN:
                return

            if not _is_valid_selection_text(cleaned):
                if DEBUG_SELECTION:
                    print("[timing] selection filtered invalid text", flush=True)
                return

            with self._clipboard_worker_lock:
                mono_now = time.monotonic()
                if (
                    cleaned == self._last_text
                    and mono_now - self._last_text_time < DUPLICATE_TEXT_WINDOW_SECONDS
                ):
                    if DEBUG_SELECTION:
                        print("[timing] selection duplicate skipped", flush=True)
                    return
                self._last_text = cleaned
                self._last_text_time = mono_now

            try:
                self._on_selection(
                    cleaned,
                    release_x,
                    release_y,
                    press_x=press_x,
                    press_y=press_y,
                    release_x=release_x,
                    release_y=release_y,
                )
            except TypeError:
                self._on_selection(cleaned, release_x, release_y)
            except Exception:
                pass
        finally:
            with self._clipboard_worker_lock:
                self._clipboard_worker_running = False
            if DEBUG_SELECTION:
                print("[timing] worker done", flush=True)

    def _on_click(self, x: int, y: int, button: mouse.Button, pressed: bool) -> None:
        if self.is_suspended():
            self._left_pressed = False
            self._clear_press_window_state()
            return

        if button == mouse.Button.right and pressed:
            try:
                self._on_selection(
                    CONTROL_CLOSE_ALL_BUBBLES,
                    int(x),
                    int(y),
                    press_x=int(x),
                    press_y=int(y),
                    release_x=int(x),
                    release_y=int(y),
                )
            except TypeError:
                self._on_selection(CONTROL_CLOSE_ALL_BUBBLES, int(x), int(y))
            return

        if button != mouse.Button.left:
            return

        if pressed:
            self._ignore_current_drag = False
            self._press_hwnd = None
            self._press_window_rect = None
            self._press_terminal_like = False
            if sys.platform == "win32":
                try:
                    hwnd = _get_window_handle_at_point(int(x), int(y))
                    self._press_hwnd = hwnd
                    if hwnd is not None:
                        self._press_window_rect = _get_window_rect(hwnd)
                        self._press_terminal_like = _is_terminal_like_window(hwnd)
                        if self._press_terminal_like:
                            self._ignore_current_drag = True
                    if _is_window_drag_area(int(x), int(y)):
                        self._ignore_current_drag = True
                except Exception:
                    pass
            self._left_pressed = True
            self._press_x = int(x)
            self._press_y = int(y)
            return

        if not self._left_pressed:
            return
        self._left_pressed = False

        if self._ignore_current_drag:
            self._clear_press_window_state()
            return

        if self._press_terminal_like:
            self._clear_press_window_state()
            return

        source_hwnd = self._press_hwnd

        if sys.platform == "win32" and self._press_hwnd is not None:
            rect_after = _get_window_rect(self._press_hwnd)
            if _has_window_moved(self._press_window_rect, rect_after):
                if DEBUG_SELECTION:
                    print("[timing] window moved skipped", flush=True)
                self._press_hwnd = None
                self._press_window_rect = None
                return
        self._press_hwnd = None
        self._press_window_rect = None

        drag_distance = hypot(float(int(x) - self._press_x), float(int(y) - self._press_y))
        if drag_distance < MIN_DRAG_DISTANCE:
            return
        if DEBUG_SELECTION:
            print(f"[timing] selection drag_valid distance={drag_distance:.2f}", flush=True)

        now = time.time()
        if now - self._last_trigger_time < DEBOUNCE_SECONDS:
            return
        self._last_trigger_time = now

        press_x = self._press_x
        press_y = self._press_y
        release_x = int(x)
        release_y = int(y)
        self._start_clipboard_worker(
            press_x,
            press_y,
            release_x,
            release_y,
            source_hwnd=source_hwnd,
        )

    def run_forever(self) -> None:
        while True:
            try:
                with mouse.Listener(on_click=self._on_click) as listener:
                    listener.join()
            except Exception:
                time.sleep(0.2)
