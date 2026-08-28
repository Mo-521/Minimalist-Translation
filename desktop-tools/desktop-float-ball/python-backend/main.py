from __future__ import annotations

import asyncio
import collections
import json
import os
import re
import signal
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import websockets
from selection_service import SelectionService
from translator import (
    analyze_english_grammar,
    analyze_english_grammar_fast,
    lookup_word,
    translate_stream,
    warmup_client,
)

clients: set[websockets.ServerConnection] = set()
MAX_CONCURRENT_TRANSLATIONS = 3
MAX_WAITING_TRANSLATIONS = 6
ENABLE_AI_GRAMMAR = os.environ.get("LINGOFLOW_ENABLE_AI_GRAMMAR", "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
lookup_executor: ThreadPoolExecutor | None = None
grammar_executor: ThreadPoolExecutor | None = None
selection_service_instance: SelectionService | None = None

# Win32 鼠标钩子坐标与 Electron DIP 对齐：由 Electron main.js 用 screen.screenToDipPoint 换算。
COORDINATE_SPACE = "win32_physical" if sys.platform == "win32" else "logical"


async def ws_handler(ws: websockets.ServerConnection) -> None:
    clients.add(ws)
    try:
        async for message in ws:
            try:
                payload = json.loads(message)
            except Exception:
                continue

            message_type = payload.get("type")
            if message_type == "selection_control":
                try:
                    suspended = bool(payload.get("suspended"))
                    duration_ms = int(payload.get("durationMs") or 0)
                    service = selection_service_instance
                    if service is not None:
                        service.set_suspended(suspended, duration_ms)
                except Exception:
                    pass
                continue

            if message_type != "word_lookup_request":
                continue

            request_id = str(payload.get("requestId") or "")
            word = str(payload.get("word") or "").strip()
            context = str(payload.get("context") or "")
            if not request_id or not word:
                continue

            loop = asyncio.get_running_loop()
            current_lookup_executor = lookup_executor
            if current_lookup_executor is None:
                continue
            try:
                result = await loop.run_in_executor(current_lookup_executor, lookup_word, word, context)
                response = {
                    "type": "word_lookup_result",
                    "requestId": request_id,
                    "word": result.get("word") or word,
                    "phonetic": result.get("phonetic") or "",
                    "definitions": result.get("definitions") or [],
                    "contextMeaning": result.get("contextMeaning") or "暂无",
                }
                if result.get("error"):
                    response["error"] = result.get("error")
            except Exception:
                response = {
                    "type": "word_lookup_result",
                    "requestId": request_id,
                    "word": word,
                    "phonetic": "",
                    "definitions": [],
                    "contextMeaning": "",
                    "error": "lookup_failed",
                }

            await ws.send(json.dumps(response, ensure_ascii=False))
    finally:
        clients.discard(ws)


async def broadcast(payload: dict) -> None:
    if not clients:
        return
    message = json.dumps(payload, ensure_ascii=False)
    dead: list[websockets.ServerConnection] = []
    for client in clients:
        try:
            await client.send(message)
        except Exception:
            dead.append(client)
    for client in dead:
        clients.discard(client)


def detect_simple_lang(text: str) -> str:
    value = str(text or "").strip()
    if not value:
        return "other"
    chinese_chars = len(re.findall(r"[\u4e00-\u9fff]", value))
    english_words = len(re.findall(r"\b[A-Za-z]+(?:'[A-Za-z]+)?\b", value))
    if chinese_chars > english_words * 2 and chinese_chars >= 2:
        return "zh"
    if english_words >= 3 and chinese_chars <= 1:
        return "en"
    return "other"


def main() -> None:
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    translate_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="translator")
    global lookup_executor
    lookup_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="word_lookup")
    global grammar_executor
    grammar_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="grammar")

    stop_event = threading.Event()

    async def start_server() -> websockets.Server:
        return await websockets.serve(ws_handler, "127.0.0.1", 8765)

    server = loop.run_until_complete(start_server())
    threading.Thread(target=warmup_client, daemon=True).start()
    waiting_queue = collections.deque()
    running_count = 0

    async def maybe_start_next_translation() -> None:
        nonlocal running_count
        while running_count < MAX_CONCURRENT_TRANSLATIONS and waiting_queue:
            task = waiting_queue.popleft()
            running_count += 1
            print(
                f"[timing] queue start id={task['id']} waiting={len(waiting_queue)} running={running_count}",
                flush=True,
            )
            asyncio.create_task(run_streaming_translation_task(task))

    def run_stream_worker(task: dict, event_queue: asyncio.Queue) -> None:
        try:
            for event in translate_stream(task["text"]):
                loop.call_soon_threadsafe(event_queue.put_nowait, event)
        except Exception as exc:
            loop.call_soon_threadsafe(
                event_queue.put_nowait,
                {"status": "error", "error": str(exc)},
            )
        finally:
            loop.call_soon_threadsafe(event_queue.put_nowait, None)

    async def run_streaming_translation_task(task: dict) -> None:
        nonlocal running_count
        stream_start = time.perf_counter()
        event_queue: asyncio.Queue = asyncio.Queue()
        print(f"[timing] stream start id={task['id']}", flush=True)
        loop.run_in_executor(translate_executor, run_stream_worker, task, event_queue)

        final_translation = ""
        translation_error = ""
        try:
            while True:
                event = await event_queue.get()
                if event is None:
                    break
                status = event.get("status")
                translation = event.get("translation")
                if not isinstance(translation, str) or not translation:
                    translation = final_translation
                if status == "partial":
                    partial_payload = {
                        **task["base_payload"],
                        "translation": translation,
                        "status": "partial",
                    }
                    await broadcast(partial_payload)
                    print(
                        f"[timing] stream partial id={task['id']} chars={len(translation)}",
                        flush=True,
                    )
                elif status == "done":
                    final_translation = translation
                elif status == "error":
                    translation_error = str(event.get("error") or "翻译服务调用失败")
        finally:
            if translation_error:
                final_translation = f"翻译失败：{translation_error}"
            done_payload = {
                **task["base_payload"],
                "translation": final_translation,
                "status": "done",
            }
            if translation_error:
                done_payload["error"] = translation_error
            await broadcast(done_payload)
            if not translation_error:
                asyncio.create_task(
                    run_grammar_analysis_task(
                        task["id"],
                        task["text"],
                        final_translation,
                    )
                )
            stream_elapsed_ms = (time.perf_counter() - stream_start) * 1000.0
            print(f"[timing] stream done id={task['id']} elapsed_ms={stream_elapsed_ms:.2f}", flush=True)
            running_count = max(0, running_count - 1)
            await maybe_start_next_translation()

    async def broadcast_fast_grammar_result(selection_id: str, target_view: str, target_text: str) -> bool:
        fast_start = time.perf_counter()
        fast_result: dict = {"ok": False, "tokens": [], "source": "local_fast"}
        try:
            fast_result = analyze_english_grammar_fast(target_text)
        except Exception:
            pass
        fast_elapsed_ms = (time.perf_counter() - fast_start) * 1000.0
        ok_fast = bool(fast_result.get("ok"))
        token_count_fast = len((fast_result or {}).get("tokens") or [])
        print(
            f"[timing] grammar fast done id={selection_id} ok={ok_fast} "
            f"token_count={token_count_fast} elapsed_ms={fast_elapsed_ms:.2f}",
            flush=True,
        )
        if not ok_fast:
            return False
        await broadcast(
            {
                "type": "grammar_result",
                "id": selection_id,
                "targetView": target_view,
                "grammar": fast_result,
            }
        )
        print(
            f"[timing] grammar fast broadcast id={selection_id} targetView={target_view} "
            f"token_count={token_count_fast}",
            flush=True,
        )
        return True

    async def run_grammar_analysis_task(selection_id: str, source_text: str, translation_text: str) -> None:
        source_lang = detect_simple_lang(source_text)
        target_lang = detect_simple_lang(translation_text)
        target_view = ""
        target_text = ""
        if source_lang == "en":
            target_view = "source"
            target_text = source_text
        elif source_lang == "zh" and target_lang == "en":
            target_view = "translation"
            target_text = translation_text
        else:
            print(
                f"[timing] grammar skipped reason=lang_mismatch id={selection_id} source_lang={source_lang} target_lang={target_lang}",
                flush=True,
            )
            return

        current_grammar_executor = grammar_executor
        if current_grammar_executor is None:
            print(f"[timing] grammar skipped reason=no_executor id={selection_id}", flush=True)
            return
        print(
            f"[timing] grammar analysis start id={selection_id} targetView={target_view} text_len={len(target_text)}",
            flush=True,
        )
        await broadcast_fast_grammar_result(selection_id, target_view, target_text)

        if not ENABLE_AI_GRAMMAR:
            print(f"[timing] grammar ai skipped reason=disabled id={selection_id}", flush=True)
            return

        try:
            loop_local = asyncio.get_running_loop()
            result = await loop_local.run_in_executor(
                current_grammar_executor,
                analyze_english_grammar,
                target_text,
            )
            ok = bool(result and result.get("ok"))
            token_count = len((result or {}).get("tokens") or [])
            print(
                f"[timing] grammar analysis done id={selection_id} ok={ok} token_count={token_count}",
                flush=True,
            )
            if not ok:
                return
            payload = {
                "type": "grammar_result",
                "id": selection_id,
                "targetView": target_view,
                "grammar": result,
            }
            await broadcast(payload)
            print(
                f"[timing] grammar broadcast id={selection_id} targetView={target_view} token_count={token_count}",
                flush=True,
            )
        except Exception as exc:
            print(f"[timing] grammar skipped reason=exception id={selection_id} detail={exc}", flush=True)

    async def enqueue_translation_task(task: dict) -> None:
        nonlocal running_count
        if running_count < MAX_CONCURRENT_TRANSLATIONS:
            waiting_queue.appendleft(task)
            await maybe_start_next_translation()
            return

        if len(waiting_queue) >= MAX_WAITING_TRANSLATIONS:
            overloaded_payload = {
                **task["base_payload"],
                "translation": "任务过多，请稍后再试",
                "status": "done",
            }
            await broadcast(overloaded_payload)
            return

        waiting_queue.append(task)
        print(
            f"[timing] queue pending id={task['id']} waiting={len(waiting_queue)} running={running_count}",
            flush=True,
        )

    async def process_selection(
        selection_id: str,
        text: str,
        x: int,
        y: int,
        press_x: int,
        press_y: int,
        release_x: int,
        release_y: int,
    ) -> None:
        print(f"[timing] process_selection received id={selection_id} text_len={len(text)}", flush=True)
        print("[selection] received", flush=True)
        selection_left = min(press_x, release_x)
        selection_right = max(press_x, release_x)
        selection_top = min(press_y, release_y)
        selection_bottom = max(press_y, release_y)
        base_payload = {
            "type": "translation",
            "id": selection_id,
            "source": text,
            "coordinate_space": COORDINATE_SPACE,
            "x": x,
            "y": y,
            "press_x": press_x,
            "press_y": press_y,
            "release_x": release_x,
            "release_y": release_y,
            "selection_left": selection_left,
            "selection_right": selection_right,
            "selection_top": selection_top,
            "selection_bottom": selection_bottom,
        }
        pending_payload = {
            **base_payload,
            "translation": "翻译中...",
            "status": "pending",
        }
        pending_start = time.perf_counter()
        print(f"[timing] pending broadcast start id={selection_id}", flush=True)
        await broadcast(pending_payload)
        pending_elapsed_ms = (time.perf_counter() - pending_start) * 1000.0
        print(
            f"[timing] pending broadcast done id={selection_id} elapsed_ms={pending_elapsed_ms:.2f}",
            flush=True,
        )
        if detect_simple_lang(text) == "en":
            asyncio.create_task(broadcast_fast_grammar_result(selection_id, "source", text))
        await enqueue_translation_task(
            {
                "id": selection_id,
                "text": text,
                "base_payload": base_payload,
            }
        )

    def on_selection(
        text: str,
        x: int,
        y: int,
        press_x: int | None = None,
        press_y: int | None = None,
        release_x: int | None = None,
        release_y: int | None = None,
    ) -> None:
        selection_id = str(uuid4())
        resolved_release_x = int(release_x) if release_x is not None else int(x)
        resolved_release_y = int(release_y) if release_y is not None else int(y)
        resolved_press_x = int(press_x) if press_x is not None else resolved_release_x
        resolved_press_y = int(press_y) if press_y is not None else resolved_release_y
        loop.call_soon_threadsafe(
            asyncio.create_task,
            process_selection(
                selection_id,
                text,
                int(x),
                int(y),
                resolved_press_x,
                resolved_press_y,
                resolved_release_x,
                resolved_release_y,
            ),
        )

    global selection_service_instance
    service = SelectionService(on_selection=on_selection)
    selection_service_instance = service
    listener_thread = threading.Thread(target=service.run_forever, daemon=True)
    listener_thread.start()

    async def graceful_shutdown() -> None:
        try:
            server.close()
            await server.wait_closed()
        except Exception:
            pass
        current = asyncio.current_task()
        for task in asyncio.all_tasks(loop):
            if task is current:
                continue
            task.cancel()
        await asyncio.sleep(0)
        loop.stop()

    def handle_stop(_signum, _frame) -> None:
        if stop_event.is_set():
            return
        stop_event.set()
        try:
            asyncio.run_coroutine_threadsafe(graceful_shutdown(), loop)
        except Exception:
            loop.call_soon_threadsafe(loop.stop)

    signal.signal(signal.SIGINT, handle_stop)
    try:
        signal.signal(signal.SIGTERM, handle_stop)
    except (AttributeError, ValueError):
        pass

    try:
        loop.run_forever()
    finally:
        try:
            if server.sockets is not None:
                server.close()
                loop.run_until_complete(server.wait_closed())
        except Exception:
            pass
        pending = [t for t in asyncio.all_tasks(loop) if not t.done()]
        for task in pending:
            task.cancel()
        if pending:
            try:
                loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
            except Exception:
                pass
        try:
            translate_executor.shutdown(wait=False, cancel_futures=True)
        except TypeError:
            translate_executor.shutdown(wait=False)
        try:
            lookup_executor.shutdown(wait=False, cancel_futures=True)
        except TypeError:
            lookup_executor.shutdown(wait=False)
        try:
            grammar_executor.shutdown(wait=False, cancel_futures=True)
        except TypeError:
            grammar_executor.shutdown(wait=False)
        try:
            loop.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
