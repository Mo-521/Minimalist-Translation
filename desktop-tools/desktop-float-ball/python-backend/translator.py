from __future__ import annotations

import os
import re
import time
import json
import http.client
import threading
from pathlib import Path
from typing import Optional, Tuple
from urllib.parse import urlparse
from urllib.request import Request, urlopen

try:
    from openai import OpenAI
except Exception:
    OpenAI = None

try:
    import httpx
except Exception:
    httpx = None

_CLIENT: Optional[OpenAI] = None
_CLIENT_KEY: tuple[str, str, str] | None = None
_TRANSLATE_HTTP_CONN: http.client.HTTPConnection | None = None
_TRANSLATE_HTTP_CONN_KEY: tuple[str, str, int] | None = None
_TRANSLATE_HTTP_CONN_LOCK = threading.Lock()
_WARMUP_PROXY_DONE = False
_WARMUP_PROXY_LOCK = threading.Lock()
PARTIAL_FLUSH_INTERVAL_SEC = 0.06
PARTIAL_MIN_CHARS = 4
DEFAULT_PROXY_BASE_URL = ""
DEFAULT_BETA_TOKEN = ""
DEFAULT_TARGET_LANGUAGE = "en"
SUPPORTED_TARGET_LANGUAGES = {"en", "zh", "ja", "ko", "fr", "de", "es"}
_SHARED_CONFIG_CACHE: dict | None = None
_SHARED_CONFIG_MTIME: float | None = None
ENABLE_PROXY_WARMUP_REQUEST = (os.environ.get("LINGOFLOW_ENABLE_PROXY_WARMUP") or "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
WARMUP_PROXY_TIMEOUT_SEC = float(os.environ.get("LINGOFLOW_WARMUP_TIMEOUT_SEC") or "1.5")
ENABLE_PROXY_HEALTH_WARMUP = (os.environ.get("LINGOFLOW_ENABLE_HEALTH_WARMUP") or "true").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}


def _is_retryable_proxy_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    markers = (
        "timeout",
        "timed out",
        "503",
        "temporarily unavailable",
        "service temporarily unavailable",
        "nginx",
    )
    return any(marker in msg for marker in markers)


def _create_chat_completion_with_retry(client, **kwargs):
    provider = _get_provider_config()
    if str(provider.get("preset") or "").lower() == "deepseek" or "api.deepseek.com" in str(provider.get("baseUrl") or "").lower():
        extra_body = dict(kwargs.get("extra_body") or {})
        extra_body["thinking"] = {"type": "disabled"}
        kwargs["extra_body"] = extra_body
    last_exc: Optional[BaseException] = None
    for attempt in range(2):
        try:
            return client.chat.completions.create(**kwargs)
        except Exception as exc:
            last_exc = exc
            if attempt >= 1 or not _is_retryable_proxy_error(exc):
                raise
            print(f"[timing] translator retry attempt={attempt + 1} reason={exc!s}", flush=True)
            time.sleep(1.0)
    assert last_exc is not None
    raise last_exc


def translate(text: str) -> str:
    source_text = text.strip()
    if not source_text:
        return ""
    final_translation = source_text
    for event in translate_stream(source_text):
        if event.get("status") == "done":
            translated = event.get("translation")
            final_translation = translated if isinstance(translated, str) and translated else source_text
    return final_translation


def translate_stream(text: str):
    translate_start = time.perf_counter()
    source_text = text.strip()
    target_lang = _resolve_target_lang(source_text)
    use_non_stream = _should_use_non_stream_proxy()
    stream_mode_env = os.environ.get("LINGOFLOW_STREAM_MODE")
    force_stream_env = os.environ.get("LINGOFLOW_FORCE_STREAM")
    resolved_stream_mode = _resolved_stream_mode_label()
    base_url = _get_proxy_base_url()
    provider_config = _get_provider_config()
    legacy_enabled = (os.environ.get("LINGOFLOW_LEGACY_PROVIDER_MODE") or "").strip().lower() in {"1", "true", "yes", "on"}
    if not legacy_enabled and not (
        provider_config.get("baseUrl")
        and provider_config.get("apiKey")
        and provider_config.get("model")
    ):
        raise RuntimeError("unified_provider_not_configured")
    base_host = urlparse(base_url).hostname or ""
    print(
        f"[timing] translator enter text_len={len(source_text)} target={target_lang} "
        f"use_non_stream={use_non_stream} base_host={base_host} "
        f"stream_mode_env={stream_mode_env!r} force_stream_env={force_stream_env!r} "
        f"resolved_stream_mode={resolved_stream_mode}",
        flush=True,
    )
    if not source_text:
        yield {"status": "done", "translation": ""}
        return
    if _should_skip_translation(source_text, target_lang):
        print("[timing] translator skipped same_language", flush=True)
        yield {"status": "partial", "translation": source_text}
        yield {"status": "done", "translation": source_text}
        return

    if _should_use_proxy_translation_endpoint():
        try:
            translated = _translate_via_proxy_endpoint(source_text, target_lang)
            if translated:
                first_partial_elapsed_ms = (time.perf_counter() - translate_start) * 1000.0
                print(f"[timing] translator proxy_endpoint first_partial elapsed_ms={first_partial_elapsed_ms:.2f}", flush=True)
                yield {"status": "partial", "translation": translated}
                request_elapsed_ms = (time.perf_counter() - translate_start) * 1000.0
                print(f"[timing] translator proxy_endpoint done elapsed_ms={request_elapsed_ms:.2f}", flush=True)
                yield {"status": "done", "translation": translated}
                return
        except Exception as exc:
            print(f"[translator] proxy translation endpoint failed, fallback to chat: {exc}", flush=True)

    instance_start = time.perf_counter()
    client = _get_client()
    instance_elapsed_ms = (time.perf_counter() - instance_start) * 1000.0
    print(f"[timing] translator instance ready elapsed_ms={instance_elapsed_ms:.2f}", flush=True)
    if client is None:
        yield {"status": "done", "translation": source_text}
        return

    is_tiny_text = _is_tiny_text(source_text)
    target_name = _target_lang_name(target_lang)
    if is_tiny_text:
        system_prompt = (
            f"Translate into {target_name}. Return only the translated text. "
            "Do not explain. Do not include the original text. "
            "Do not add quotes, labels, markdown, or prefixes."
        )
    else:
        system_prompt = (
            f"You are a translation engine. Translate the user's text into {target_name}. "
            "Return only the translation. Do not explain. Do not include the original text. "
            "Do not add labels such as 'Translation:'. Do not use markdown or quotation marks. "
            "Preserve names and technical terms."
        )
    max_tokens = _estimate_max_tokens(source_text)
    if is_tiny_text:
        max_tokens = min(max_tokens, 64)
    temperature = 0 if is_tiny_text else 0.1
    print(f"[timing] translator max_tokens={max_tokens}", flush=True)
    request_start = time.perf_counter()
    model = _get_model()
    request_messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": source_text},
    ]
    print(f"[timing] translator request start model={model}", flush=True)
    try:
        if use_non_stream:
            print("[timing] translator non_stream request start", flush=True)
            try:
                response = _create_chat_completion_with_retry(
                    client,
                    model=model,
                    messages=request_messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    stream=False,
                    timeout=6.0,
                )
            except Exception as exc:
                print(f"[translator] non-stream proxy request failed: {exc}", flush=True)
                raise
            non_stream_elapsed_ms = (time.perf_counter() - request_start) * 1000.0
            print(
                f"[timing] translator non_stream response received elapsed_ms={non_stream_elapsed_ms:.2f}",
                flush=True,
            )

            full_content = (_extract_completion_text(response) or "").strip()
            if not full_content and _completion_needs_empty_content_retry(response):
                full_content = _retry_empty_completion(
                    client, model, request_messages, temperature, max_tokens
                )
            print(f"[timing] translator extracted_content length={len(full_content)}", flush=True)
            if not full_content:
                raise RuntimeError("non-stream proxy returned empty translation content")

            first_content_elapsed_ms = (time.perf_counter() - request_start) * 1000.0
            print(f"[timing] translator first_content elapsed_ms={first_content_elapsed_ms:.2f}", flush=True)

            first_partial_elapsed_ms = (time.perf_counter() - request_start) * 1000.0
            print(f"[timing] translator first_partial elapsed_ms={first_partial_elapsed_ms:.2f}", flush=True)
            yield {"status": "partial", "translation": full_content}

            request_elapsed_ms = (time.perf_counter() - request_start) * 1000.0
            print(f"[timing] translator request done elapsed_ms={request_elapsed_ms:.2f}", flush=True)
            yield {"status": "done", "translation": full_content}
        else:
            stream = _create_chat_completion_with_retry(
                client,
                model=model,
                messages=request_messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=True,
                timeout=6.0,
            )

            accumulated = ""
            last_partial_time = time.perf_counter()
            pending_chars = 0
            first_chunk_logged = False
            first_content_logged = False
            first_partial_logged = False

            for chunk in stream:
                if not first_chunk_logged:
                    first_chunk_elapsed_ms = (time.perf_counter() - request_start) * 1000.0
                    print(f"[timing] translator first_chunk elapsed_ms={first_chunk_elapsed_ms:.2f}", flush=True)
                    first_chunk_logged = True
                piece = _extract_stream_content(chunk)
                if not piece:
                    continue
                if not first_content_logged:
                    first_content_elapsed_ms = (time.perf_counter() - request_start) * 1000.0
                    print(f"[timing] translator first_content elapsed_ms={first_content_elapsed_ms:.2f}", flush=True)
                    first_content_logged = True
                accumulated += piece
                pending_chars += len(piece)

                now = time.perf_counter()
                if not first_partial_logged:
                    first_partial_elapsed_ms = (time.perf_counter() - request_start) * 1000.0
                    print(f"[timing] translator first_partial elapsed_ms={first_partial_elapsed_ms:.2f}", flush=True)
                    yield {"status": "partial", "translation": accumulated}
                    first_partial_logged = True
                    last_partial_time = now
                    pending_chars = 0
                    continue
                if (now - last_partial_time) >= PARTIAL_FLUSH_INTERVAL_SEC or pending_chars >= PARTIAL_MIN_CHARS:
                    yield {"status": "partial", "translation": accumulated}
                    last_partial_time = now
                    pending_chars = 0

            final_text = accumulated.strip() if accumulated else ""
            if not final_text:
                final_text = _retry_empty_completion(
                    client, model, request_messages, temperature, max_tokens
                )
            if final_text:
                if final_text != accumulated:
                    accumulated = final_text
                if not first_partial_logged:
                    first_partial_elapsed_ms = (time.perf_counter() - request_start) * 1000.0
                    print(f"[timing] translator first_partial elapsed_ms={first_partial_elapsed_ms:.2f}", flush=True)
                    first_partial_logged = True
                yield {"status": "partial", "translation": final_text}
            request_elapsed_ms = (time.perf_counter() - request_start) * 1000.0
            print(f"[timing] translator request done elapsed_ms={request_elapsed_ms:.2f}", flush=True)
            if not final_text:
                raise RuntimeError("provider returned empty translation content after expanded retry")
            yield {"status": "done", "translation": final_text}
    except Exception as exc:
        failed_elapsed_ms = (time.perf_counter() - translate_start) * 1000.0
        print(f"[translator] translate failed: {exc}", flush=True)
        print(f"[timing] translator failed elapsed_ms={failed_elapsed_ms:.2f}", flush=True)
        error_text = str(exc).lower()
        if _is_retryable_proxy_error(exc):
            yield {"status": "done", "translation": "服务正在唤醒，请稍后重试"}
        elif "timeout" in error_text or "timed out" in error_text:
            yield {"status": "done", "translation": "翻译请求超时，请稍后重试"}
        else:
            yield {"status": "done", "translation": "翻译失败，请稍后重试"}


def warmup_client() -> None:
    """
    后端启动时预热 OpenAI-compatible 客户端（指向 lingoflow-proxy）。
    先创建 client，再做一次轻量真实请求，降低首次真实翻译冷启动开销。
    """
    warmup_start = time.perf_counter()
    print("[timing] warmup client start", flush=True)
    try:
        _get_client()
        if ENABLE_PROXY_WARMUP_REQUEST:
            warmup_proxy_request()
        elif ENABLE_PROXY_HEALTH_WARMUP:
            warmup_proxy_health_check()
        else:
            print("[timing] warmup proxy request skipped", flush=True)
    except Exception as exc:
        print(f"[translator] warmup failed: {exc}", flush=True)
    warmup_elapsed_ms = (time.perf_counter() - warmup_start) * 1000.0
    print(f"[timing] warmup client done elapsed_ms={warmup_elapsed_ms:.2f}", flush=True)


def warmup_proxy_request() -> None:
    global _WARMUP_PROXY_DONE
    with _WARMUP_PROXY_LOCK:
        if _WARMUP_PROXY_DONE:
            return

    print("[timing] warmup proxy request start", flush=True)
    request_start = time.perf_counter()
    try:
        client = _get_client()
        if client is None:
            return
        client.chat.completions.create(
            model=_get_model(),
            messages=[
                {"role": "system", "content": "Reply with OK only."},
                {"role": "user", "content": "hello"},
            ],
            temperature=0,
            max_tokens=16,
            stream=False,
            timeout=WARMUP_PROXY_TIMEOUT_SEC,
        )
        elapsed_ms = (time.perf_counter() - request_start) * 1000.0
        print(f"[timing] warmup proxy request done elapsed_ms={elapsed_ms:.2f}", flush=True)
        with _WARMUP_PROXY_LOCK:
            _WARMUP_PROXY_DONE = True
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - request_start) * 1000.0
        print(f"[translator] warmup proxy failed: {exc}", flush=True)
        print(f"[timing] warmup proxy request failed elapsed_ms={elapsed_ms:.2f}", flush=True)


def warmup_proxy_health_check() -> None:
    provider = _get_provider_config()
    if provider.get("baseUrl") and provider.get("apiKey") and provider.get("model"):
        return
    health_url = _get_proxy_health_url()
    if not health_url:
        return
    request_start = time.perf_counter()
    print("[timing] warmup proxy health start", flush=True)
    try:
        with urlopen(health_url, timeout=WARMUP_PROXY_TIMEOUT_SEC) as response:
            response.read(128)
        elapsed_ms = (time.perf_counter() - request_start) * 1000.0
        print(f"[timing] warmup proxy health done elapsed_ms={elapsed_ms:.2f}", flush=True)
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - request_start) * 1000.0
        print(f"[translator] warmup proxy health failed: {exc}", flush=True)
        print(f"[timing] warmup proxy health failed elapsed_ms={elapsed_ms:.2f}", flush=True)


def lookup_word(word: str, context: str) -> dict:
    normalized_word = (word or "").strip()
    normalized_context = (context or "").strip()
    if not normalized_word:
        return {
            "word": "",
            "phonetic": "暂无",
            "definitions": [],
            "contextMeaning": "暂无",
        }

    client = _get_client()
    if client is None:
        return {
            "word": normalized_word,
            "phonetic": "暂无",
            "definitions": [],
            "contextMeaning": "",
            "error": "deepseek_client_unavailable",
        }

    prompt = (
        "Return compact JSON only: "
        "{\"word\":\"...\",\"phonetic\":\"...\",\"definitions\":[{\"pos\":\"n.\",\"meaning\":\"中文释义\"}],"
        "\"contextMeaning\":\"中文短句\"}. Max 2 definitions. No markdown."
    )
    user_content = f"word: {normalized_word}\ncontext: {normalized_context}"

    try:
        response = client.chat.completions.create(
            model=_get_model(),
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": user_content},
            ],
            temperature=0.1,
            max_tokens=120,
            stream=False,
        )
        text = _extract_completion_text(response)
        parsed = _parse_lookup_json(text)
        definitions = _normalize_definitions(parsed.get("definitions"))
        if not definitions and parsed.get("meaning"):
            fallback_meaning = str(parsed.get("meaning")).strip()
            if fallback_meaning:
                definitions = [{"pos": "n.", "meaning": fallback_meaning}]
        return {
            "word": parsed.get("word") or normalized_word,
            "phonetic": _normalize_phonetic(parsed.get("phonetic")),
            "definitions": definitions,
            "contextMeaning": _normalize_context_meaning(parsed.get("contextMeaning")),
        }
    except Exception as exc:
        print(f"[word_lookup] failed word={normalized_word!r} reason={exc}", flush=True)
        error_code = "lookup_failed"
        if "quota_insufficient" in str(exc):
            error_code = "quota_insufficient"
        return {
            "word": normalized_word,
            "phonetic": "",
            "definitions": [],
            "contextMeaning": "",
            "error": error_code,
        }


def analyze_english_grammar(text: str) -> dict:
    source_text = str(text or "")
    trimmed = source_text.strip()
    print(f"[timing] grammar enter text_len={len(source_text)}", flush=True)
    if len(trimmed) < 8:
        print("[timing] grammar failed reason=too_short_len", flush=True)
        return {"ok": False, "tokens": []}
    english_words = re.findall(r"\b[A-Za-z]+(?:'[A-Za-z]+)?\b", trimmed)
    if len(english_words) < 3:
        print("[timing] grammar failed reason=too_few_words", flush=True)
        return {"ok": False, "tokens": []}
    if not _looks_like_english_sentence(trimmed):
        print("[timing] grammar failed reason=not_english", flush=True)
        return {"ok": False, "tokens": []}

    client = _get_client()
    if client is None:
        print("[timing] grammar failed reason=no_client", flush=True)
        return {"ok": False, "tokens": []}

    prompt = (
        "Return JSON only. No explanation.\n"
        "Schema: {\"ok\": boolean, \"tokens\": [{\"role\":\"subject|verb|object\",\"text\":\"...\",\"start\":0,\"end\":0}]}\n"
        "Rules:\n"
        "1) Analyze English sentence SVO spans only.\n"
        "2) roles only subject|verb|object.\n"
        "3) max 8 tokens.\n"
        "4) start/end are character offsets on original text.\n"
        "5) output valid JSON only."
    )
    request_start = time.perf_counter()
    try:
        response = client.chat.completions.create(
            model=_get_model(),
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": source_text},
            ],
            temperature=0,
            max_tokens=160,
            stream=False,
        )
        elapsed_ms = (time.perf_counter() - request_start) * 1000.0
        print(f"[timing] grammar request done elapsed_ms={elapsed_ms:.2f}", flush=True)
        raw = _extract_completion_text(response)
        parsed = _safe_parse_json(raw)
        normalized = _normalize_grammar_result(source_text, parsed)
        print(
            f"[timing] grammar normalized ok={normalized.get('ok')} token_count={len(normalized.get('tokens') or [])} source=ai",
            flush=True,
        )
        return normalized
    except Exception as exc:
        print(f"[timing] grammar failed reason={exc}", flush=True)
        return {"ok": False, "tokens": []}


def _resolve_target_lang(text: str) -> str:
    configured = _get_configured_target_language()
    dominant = _detect_dominant_language(text)
    if configured:
        if dominant in {"zh", "en"} and configured == dominant:
            return "en" if dominant == "zh" else "zh"
        return configured
    return "en" if dominant == "zh" else "zh"


def _should_skip_translation(source_text: str, target_lang: str) -> bool:
    cleaned = source_text.strip()
    if not cleaned:
        return True
    dominant = _detect_dominant_language(cleaned)
    normalized_target = _target_lang_code(target_lang)
    if dominant in {"zh", "en"} and dominant == normalized_target:
        return True
    return False


def _detect_dominant_language(text: str) -> str:
    chinese_chars = len(re.findall(r"[\u4e00-\u9fff]", text))
    english_words = re.findall(r"\b[A-Za-z]+(?:'[A-Za-z]+)?\b", text)
    english_word_count = len(english_words)

    # quick path: pure chinese-ish / pure english-ish / neither
    if chinese_chars > 0 and english_word_count == 0:
        return "zh"
    if chinese_chars == 0 and english_word_count > 0:
        return "en"
    if chinese_chars == 0 and english_word_count == 0:
        return "en"

    zh_score = 0
    en_score = 0

    # base features
    has_zh_punct = bool(re.search(r"[，。！？；：、]", text))
    has_long_zh_segment = bool(re.search(r"[\u4e00-\u9fff]{3,}", text))
    zh_function_words = [
        "的",
        "了",
        "是",
        "在",
        "和",
        "与",
        "对",
        "将",
        "主要",
        "因为",
        "所以",
        "如果",
        "这个",
        "这种",
        "目前",
        "但是",
        "已经",
        "可以",
        "不是",
        "没有",
    ]
    has_zh_function_words = any(token in text for token in zh_function_words)
    starts_with_english_word = bool(re.match(r"^\s*[A-Za-z]+(?:'[A-Za-z]+)?\b", text))
    has_english_structure = bool(
        re.search(
            r"\b(this|that|these|those|the|a|an|it|we|they|he|she|paper|model|method|system)\b",
            text,
            flags=re.IGNORECASE,
        )
    )

    # first 20 non-space characters dominance
    compact = re.sub(r"\s+", "", text)
    prefix = compact[:20]
    prefix_zh = len(re.findall(r"[\u4e00-\u9fff]", prefix))
    prefix_en = len(re.findall(r"[A-Za-z]", prefix))

    # zh scoring
    if has_zh_punct:
        zh_score += 2
    if has_long_zh_segment:
        zh_score += 2
    if chinese_chars >= 6:
        zh_score += 1
    if prefix_zh > prefix_en:
        zh_score += 1
    if has_zh_function_words:
        zh_score += 2

    # en scoring
    if english_word_count >= 5:
        en_score += 2
    if starts_with_english_word:
        en_score += 1
    if not has_zh_punct:
        en_score += 1
    if chinese_chars <= 4 and english_word_count >= 4:
        en_score += 2
    if has_english_structure:
        en_score += 1

    if zh_score > en_score:
        return "zh"
    return "en"


def _default_shared_config_path() -> Path:
    try:
        return Path(__file__).resolve().parents[3] / "config" / "lingoflow.json"
    except Exception:
        return Path("lingoflow.json")


def _shared_config_path() -> Path:
    configured = (os.environ.get("LINGOFLOW_CONFIG_PATH") or "").strip()
    return Path(configured) if configured else _default_shared_config_path()


def _read_shared_config() -> dict:
    global _SHARED_CONFIG_CACHE, _SHARED_CONFIG_MTIME
    path = _shared_config_path()
    try:
        stat = path.stat()
    except OSError:
        return {}

    if _SHARED_CONFIG_CACHE is not None and _SHARED_CONFIG_MTIME == stat.st_mtime:
        return _SHARED_CONFIG_CACHE

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"[translator] shared config read failed: {exc}", flush=True)
        return {}

    if not isinstance(data, dict):
        return {}
    _SHARED_CONFIG_CACHE = data
    _SHARED_CONFIG_MTIME = stat.st_mtime
    return data


def _get_configured_target_language() -> str:
    env_target = (os.environ.get("LINGOFLOW_TARGET_LANGUAGE") or "").strip()
    config_target = str(_read_shared_config().get("targetLanguage") or "").strip()
    target = _target_lang_code(config_target or env_target)
    return target if target in SUPPORTED_TARGET_LANGUAGES else DEFAULT_TARGET_LANGUAGE


def _get_provider_config() -> dict:
    provider = _read_shared_config().get("provider")
    provider = provider if isinstance(provider, dict) else {}
    base_url = (
        os.environ.get("LINGOFLOW_PROVIDER_BASE_URL")
        or provider.get("baseUrl")
        or ""
    )
    api_key = (
        os.environ.get("LINGOFLOW_PROVIDER_API_KEY")
        or provider.get("apiKey")
        or ""
    )
    model = (
        os.environ.get("LINGOFLOW_PROVIDER_MODEL")
        or provider.get("model")
        or os.environ.get("LINGOFLOW_MODEL")
        or os.environ.get("DEEPSEEK_MODEL")
        or ""
    )
    normalized_base_url = str(base_url).strip().rstrip("/")
    if normalized_base_url.lower().endswith("/chat/completions"):
        normalized_base_url = normalized_base_url[: -len("/chat/completions")].rstrip("/")
    return {
        "type": "openai_compatible",
        "preset": str(provider.get("preset") or "custom").strip().lower(),
        "baseUrl": normalized_base_url,
        "apiKey": str(api_key).strip(),
        "model": str(model).strip(),
    }


def _get_model() -> str:
    provider_model = _get_provider_config().get("model") or ""
    return str(provider_model or "deepseek-chat")


def _get_beta_token() -> str:
    provider_key = str(_get_provider_config().get("apiKey") or "").strip()
    if provider_key:
        return provider_key
    if (os.environ.get("LINGOFLOW_LEGACY_PROVIDER_MODE") or "").strip().lower() not in {"1", "true", "yes", "on"}:
        return ""
    config_token = str(_read_shared_config().get("betaToken") or "").strip()
    return (config_token or os.environ.get("LINGOFLOW_BETA_TOKEN") or DEFAULT_BETA_TOKEN).strip()


def _get_client() -> Optional[OpenAI]:
    global _CLIENT, _CLIENT_KEY
    api_key = _get_beta_token()
    base_url = _get_proxy_base_url()
    model = _get_model()
    client_key = (base_url, api_key, model)
    if _CLIENT is not None and _CLIENT_KEY == client_key:
        return _CLIENT
    if OpenAI is None:
        print("[translator] openai sdk unavailable", flush=True)
        return None
    if not api_key:
        print("[translator] missing unified provider API key", flush=True)
        return None
    if not base_url:
        print("[translator] missing unified provider Base URL", flush=True)
        return None
    try:
        kwargs = {
            "api_key": api_key,
            "base_url": base_url,
            "timeout": 8.0,
            "max_retries": 0,
        }
        if httpx is not None:
            kwargs["http_client"] = httpx.Client(timeout=8.0, trust_env=False)
        _CLIENT = OpenAI(**kwargs)
        _CLIENT_KEY = client_key
        return _CLIENT
    except Exception:
        _CLIENT = None
        _CLIENT_KEY = None
        return None


def _estimate_max_tokens(text: str) -> int:
    length = len(text or "")
    if length <= 40:
        estimated = 96
    elif length <= 120:
        estimated = 160
    elif length <= 300:
        estimated = 260
    else:
        estimated = 420
    return min(420, estimated)


def _is_tiny_text(text: str) -> bool:
    normalized = text or ""
    if "\n" in normalized or "\r" in normalized:
        return False
    compact = re.sub(r"\s+", "", normalized)
    return len(compact) <= 18


def _extract_stream_content(chunk) -> str:
    try:
        choices = getattr(chunk, "choices", None)
        if not choices:
            return ""
        delta = getattr(choices[0], "delta", None)
        if delta is None:
            return ""
        if hasattr(delta, "content"):
            return delta.content or ""
        if isinstance(delta, dict):
            return delta.get("content") or ""
        return ""
    except Exception:
        return ""


def _get_proxy_base_url() -> str:
    provider_url = str(_get_provider_config().get("baseUrl") or "").strip()
    if provider_url:
        return provider_url.rstrip("/")
    if (os.environ.get("LINGOFLOW_LEGACY_PROVIDER_MODE") or "").strip().lower() not in {"1", "true", "yes", "on"}:
        return ""
    config_url = str(_read_shared_config().get("serverBaseUrl") or "").strip()
    raw_url = (os.environ.get("LINGOFLOW_PROXY_BASE_URL") or config_url or DEFAULT_PROXY_BASE_URL).rstrip("/")
    if not raw_url:
        return ""
    return raw_url if raw_url.endswith("/v1") else raw_url + "/v1"


def _get_proxy_health_url() -> str:
    base_url = _get_proxy_base_url()
    if not base_url:
        return ""
    root_url = base_url[:-3] if base_url.endswith("/v1") else base_url
    return root_url.rstrip("/") + "/health"


def _get_proxy_translate_url() -> str:
    base_url = _get_proxy_base_url()
    if not base_url:
        return ""
    root_url = base_url[:-3] if base_url.endswith("/v1") else base_url
    return root_url.rstrip("/") + "/v1/translate"


def _should_use_proxy_translation_endpoint() -> bool:
    provider = _get_provider_config()
    if provider.get("baseUrl") and provider.get("apiKey") and provider.get("model"):
        return False
    mode = (os.environ.get("LINGOFLOW_TRANSLATION_ENDPOINT_MODE") or "proxy").strip().lower()
    return mode not in {"0", "false", "no", "off", "legacy", "chat"}


def _target_lang_code(target_lang: str) -> str:
    normalized = (target_lang or "").strip().lower().replace("_", "-")
    aliases = {
        "english": "en",
        "eng": "en",
        "en-us": "en",
        "en-gb": "en",
        "英语": "en",
        "英文": "en",
        "simplified chinese": "zh",
        "chinese": "zh",
        "zh-cn": "zh",
        "cn": "zh",
        "中文": "zh",
        "汉语": "zh",
        "简体中文": "zh",
        "japanese": "ja",
        "jp": "ja",
        "ja-jp": "ja",
        "日语": "ja",
        "日文": "ja",
        "korean": "ko",
        "kr": "ko",
        "ko-kr": "ko",
        "韩语": "ko",
        "韩文": "ko",
        "french": "fr",
        "fr-fr": "fr",
        "法语": "fr",
        "german": "de",
        "de-de": "de",
        "德语": "de",
        "spanish": "es",
        "es-es": "es",
        "西班牙语": "es",
    }
    return aliases.get(normalized, normalized if normalized in SUPPORTED_TARGET_LANGUAGES else DEFAULT_TARGET_LANGUAGE)


def _target_lang_name(target_lang: str) -> str:
    names = {
        "en": "English",
        "zh": "Simplified Chinese",
        "ja": "Japanese",
        "ko": "Korean",
        "fr": "French",
        "de": "German",
        "es": "Spanish",
    }
    return names.get(_target_lang_code(target_lang), "English")


def _translate_via_proxy_endpoint(source_text: str, target_lang: str) -> str:
    url = _get_proxy_translate_url()
    token = _get_beta_token()
    provider = (os.environ.get("LINGOFLOW_TRANSLATION_PROVIDER") or "auto").strip() or "auto"
    payload = {
        "text": source_text,
        "sourceLanguage": "auto",
        "targetLanguage": _target_lang_code(target_lang),
        "provider": provider,
    }
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    timeout = float(os.environ.get("LINGOFLOW_TRANSLATION_TIMEOUT_SEC") or "6.0")
    try:
        parsed = _post_proxy_translate_keepalive(url, token, data, timeout)
    except Exception as exc:
        print(f"[timing] translator proxy_endpoint keepalive_failed reason={exc}", flush=True)
        parsed = _post_proxy_translate_urlopen(url, token, data, timeout)
    translated = str(parsed.get("translation") or "").strip()
    if not translated:
        raise RuntimeError("proxy_endpoint_empty_translation")
    provider_name = parsed.get("provider") or provider
    print(f"[timing] translator proxy_endpoint provider={provider_name}", flush=True)
    return translated


def _post_proxy_translate_urlopen(url: str, token: str, data: bytes, timeout: float) -> dict:
    request = Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8")
    return json.loads(body)


def _post_proxy_translate_keepalive(url: str, token: str, data: bytes, timeout: float) -> dict:
    parsed_url = urlparse(url)
    scheme = (parsed_url.scheme or "https").lower()
    host = parsed_url.hostname or ""
    if not host:
        raise RuntimeError("proxy_endpoint_missing_host")
    port = parsed_url.port or (443 if scheme == "https" else 80)
    path = parsed_url.path or "/v1/translate"
    if parsed_url.query:
        path += "?" + parsed_url.query
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Content-Length": str(len(data)),
        "Connection": "keep-alive",
    }
    conn = _get_translate_http_connection(scheme, host, port, timeout)
    with _TRANSLATE_HTTP_CONN_LOCK:
        request_start = time.perf_counter()
        try:
            conn.request("POST", path, body=data, headers=headers)
            response = conn.getresponse()
            raw = response.read()
        except Exception:
            _close_translate_http_connection_locked()
            raise
        elapsed_ms = (time.perf_counter() - request_start) * 1000.0
    print(f"[timing] translator proxy_endpoint http_elapsed_ms={elapsed_ms:.2f}", flush=True)
    if response.status < 200 or response.status >= 300:
        _close_translate_http_connection()
        raise RuntimeError(f"proxy_endpoint_status_{response.status}")
    return json.loads(raw.decode("utf-8"))


def _get_translate_http_connection(scheme: str, host: str, port: int, timeout: float) -> http.client.HTTPConnection:
    global _TRANSLATE_HTTP_CONN, _TRANSLATE_HTTP_CONN_KEY
    key = (scheme, host, port)
    with _TRANSLATE_HTTP_CONN_LOCK:
        if _TRANSLATE_HTTP_CONN is not None and _TRANSLATE_HTTP_CONN_KEY == key:
            _TRANSLATE_HTTP_CONN.timeout = timeout
            return _TRANSLATE_HTTP_CONN
        _close_translate_http_connection_locked()
        if scheme == "https":
            _TRANSLATE_HTTP_CONN = http.client.HTTPSConnection(host, port, timeout=timeout)
        else:
            _TRANSLATE_HTTP_CONN = http.client.HTTPConnection(host, port, timeout=timeout)
        _TRANSLATE_HTTP_CONN_KEY = key
        return _TRANSLATE_HTTP_CONN


def _close_translate_http_connection() -> None:
    with _TRANSLATE_HTTP_CONN_LOCK:
        _close_translate_http_connection_locked()


def _close_translate_http_connection_locked() -> None:
    global _TRANSLATE_HTTP_CONN, _TRANSLATE_HTTP_CONN_KEY
    if _TRANSLATE_HTTP_CONN is not None:
        try:
            _TRANSLATE_HTTP_CONN.close()
        except Exception:
            pass
    _TRANSLATE_HTTP_CONN = None
    _TRANSLATE_HTTP_CONN_KEY = None


def _resolved_stream_mode_label() -> str:
    """
    Effective stream mode for logging: auto | stream | non_stream.
    LINGOFLOW_STREAM_MODE takes priority; if unset, LINGOFLOW_FORCE_STREAM; else auto.
    """
    raw_mode = os.environ.get("LINGOFLOW_STREAM_MODE")
    if raw_mode is not None:
        n = raw_mode.strip().lower()
        if n == "stream":
            return "stream"
        if n == "non_stream":
            return "non_stream"
        return "auto"
    force_stream_env = os.environ.get("LINGOFLOW_FORCE_STREAM")
    if force_stream_env is not None:
        normalized = force_stream_env.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return "stream"
        if normalized in {"0", "false", "no", "off"}:
            return "non_stream"
    return "auto"


def _should_use_non_stream_proxy() -> bool:
    """
    True => use stream=False translation path.
    Priority: LINGOFLOW_STREAM_MODE, then LINGOFLOW_FORCE_STREAM, else auto (stream=True).
    """
    raw_mode = os.environ.get("LINGOFLOW_STREAM_MODE")
    if raw_mode is not None:
        n = raw_mode.strip().lower()
        if n == "stream":
            return False
        if n == "non_stream":
            return True
        return False

    force_stream_env = os.environ.get("LINGOFLOW_FORCE_STREAM")
    if force_stream_env is not None:
        normalized = force_stream_env.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return False
        if normalized in {"0", "false", "no", "off"}:
            return True
    return False


def _extract_completion_text(response) -> str:
    try:
        choices = getattr(response, "choices", None)
        if not choices:
            return ""
        message = getattr(choices[0], "message", None)
        if message is None:
            return ""
        if hasattr(message, "content"):
            return message.content or ""
        if isinstance(message, dict):
            return message.get("content") or ""
        return ""
    except Exception:
        return ""


def _completion_needs_empty_content_retry(response) -> bool:
    try:
        choices = getattr(response, "choices", None)
        if not choices:
            return False
        choice = choices[0]
        message = getattr(choice, "message", None)
        reasoning = getattr(message, "reasoning_content", None) if message is not None else None
        if isinstance(message, dict):
            reasoning = message.get("reasoning_content")
        finish_reason = getattr(choice, "finish_reason", None)
        if isinstance(choice, dict):
            finish_reason = choice.get("finish_reason")
        return bool(reasoning) or str(finish_reason or "").lower() == "length"
    except Exception:
        return False


def _retry_empty_completion(client, model: str, messages: list[dict], temperature: float, previous_max_tokens: int) -> str:
    expanded_max_tokens = min(8192, max(2048, int(previous_max_tokens or 0) * 4))
    print(
        f"[translator] empty content retry previous_max_tokens={previous_max_tokens} "
        f"expanded_max_tokens={expanded_max_tokens}",
        flush=True,
    )
    response = _create_chat_completion_with_retry(
        client,
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=expanded_max_tokens,
        stream=False,
        timeout=30.0,
    )
    return (_extract_completion_text(response) or "").strip()


def _parse_lookup_json(raw_text: str) -> dict:
    text = (raw_text or "").strip()
    if not text:
        return {}
    try:
        return json.loads(text)
    except Exception:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            return {}
        try:
            return json.loads(match.group(0))
        except Exception:
            return {}


def _normalize_definitions(value) -> list[dict]:
    if not isinstance(value, list):
        return []
    merged_by_pos: dict[str, list[str]] = {}
    ordered_pos: list[str] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        pos = str(item.get("pos") or "").strip().lower()
        meaning = str(item.get("meaning") or "").strip()
        if not meaning:
            continue
        if pos not in {"n.", "v.", "adj.", "adv.", "prep.", "phr."}:
            pos = "释义"
        if pos not in merged_by_pos:
            merged_by_pos[pos] = []
            ordered_pos.append(pos)
        terms = _split_meaning_terms(meaning)
        for term in terms:
            if term not in merged_by_pos[pos]:
                merged_by_pos[pos].append(term)
        if len(ordered_pos) >= 3:
            break
    normalized: list[dict] = []
    for pos in ordered_pos[:3]:
        merged = "；".join(merged_by_pos.get(pos) or [])
        if not merged:
            continue
        normalized.append({"pos": pos, "meaning": merged})
    return normalized


def _normalize_context_meaning(value) -> str:
    text = str(value or "").strip()
    if not text:
        return "暂无"
    sentence = re.split(r"[。！？!?]", text)[0].strip()
    if not sentence:
        sentence = text
    max_chars = 30
    if len(sentence) > max_chars:
        sentence = sentence[:max_chars].rstrip() + "…"
    return sentence


def _normalize_phonetic(value) -> str:
    text = str(value or "").strip()
    if not text or text == "暂无":
        return ""
    return text


def _split_meaning_terms(meaning: str) -> list[str]:
    parts = re.split(r"[；;、,，/]+", meaning)
    terms: list[str] = []
    for part in parts:
        term = part.strip()
        if not term:
            continue
        if term not in terms:
            terms.append(term)
    return terms


def _looks_like_english_sentence(text: str) -> bool:
    chinese_chars = len(re.findall(r"[\u4e00-\u9fff]", text))
    english_words = re.findall(r"\b[A-Za-z]+(?:'[A-Za-z]+)?\b", text)
    english_letters = len(re.findall(r"[A-Za-z]", text))
    return bool(english_words) and english_letters > chinese_chars * 2


_FAST_WORD_RE = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
_FAST_MAX_TOKENS = 24

_FAST_PRONOUNS = frozenset(
    {
        "i",
        "you",
        "he",
        "she",
        "it",
        "we",
        "they",
        "this",
        "that",
        "these",
        "those",
    }
)
_FAST_DET_ART = frozenset({"a", "an", "the"})
_FAST_DET_POSS = frozenset({"my", "your", "his", "her", "our", "their"})
_FAST_PREPS_START = frozenset({"in", "on", "at", "with", "for", "from", "to", "of", "by", "about"})

_FAST_BE = frozenset({"am", "is", "are", "was", "were", "be", "been", "being", "it's"})
_FAST_AUX = frozenset({"have", "has", "had", "haven't", "hasn't", "hadn't", "do", "does", "did"})
_FAST_MODALS = frozenset({"can", "could", "will", "would", "should", "must", "may", "might"})
# Adverbs allowed between modal/aux and main verb (modal chain & do_negative); union with legacy pre-verb set.
_FAST_EXPANDED_ADVERBS = frozenset(
    {
        "significantly",
        "clearly",
        "directly",
        "quickly",
        "slowly",
        "really",
        "actually",
        "still",
        "also",
        "probably",
        "possibly",
        "simply",
        "just",
        "only",
        "mainly",
        "mostly",
        "easily",
        "automatically",
        "normally",
        "usually",
        "often",
        "always",
        "never",
    }
)
_FAST_ADV_BEFORE_VERB = _FAST_EXPANDED_ADVERBS
_FAST_BE_COMP_ADV = frozenset({"not", "very", "still", "also", "really", "quite", "so", "too", "more", "most"})
_FAST_BAD_START_ADV = frozenset({"very", "really", "quite", "too", "so"})
_FAST_LEX_VERBS = frozenset(
    """
    like likes liked love loves loved use uses used make makes made need needs needed want wants wanted
    show shows showed create creates created return returns returned translate translates translated
    work works worked run runs ran go goes went get gets got see sees saw write writes wrote read reads
    think thinks thought know knows knew learn learns learned help helps helped become becomes became
    look looks looked feel feels felt kick kicks kicked
    allow allows allowed support supports supported fix fixes fixed solve solves solved detect detects detected
    analyze analyzes analyzed analyse analyses analysed parse parses parsed render renders rendered
    display displays displayed open opens opened close closes closed click clicks clicked drag drags dragged
    select selects selected copy copies copied paste pastes pasted move moves moved change changes changed
    improve improves improved reduce reduces reduced increase increases increased fail fails failed
    break breaks broke start starts started stop stops stopped load loads loaded save saves saved
    update updates updated replace replaces replaced match matches matched
    """.split()
)

_FAST_ALL_VERBS = _FAST_BE | _FAST_AUX | _FAST_LEX_VERBS

_FAST_BANNED_SENTENCES = frozenset(
    {
        "hello",
        "very good",
        "in the room",
        "good morning",
        "the model",
        "very useful",
        "local rules",
        "the current rule",
        "adding local rules",
        "i",
        "this way",
    }
)

# Determiner-like starts for shrinking subject suffix (nearest-to-verb determiner slice).
_FAST_SUBJ_SHRINK_STARTS = _FAST_DET_ART | _FAST_DET_POSS | frozenset({"this", "that", "these", "those"})


def _fast_is_negative_modal(word: str) -> bool:
    wl = (word or "").lower()
    return wl in {
        "won't",
        "can't",
        "cannot",
        "couldn't",
        "wouldn't",
        "shouldn't",
        "mustn't",
        "mightn't",
        "mayn't",
    }


def _fast_negative_modal_base(word: str) -> str:
    wl = (word or "").lower()
    return {
        "won't": "will",
        "can't": "can",
        "cannot": "can",
        "couldn't": "could",
        "wouldn't": "would",
        "shouldn't": "should",
        "mustn't": "must",
        "mightn't": "might",
        "mayn't": "may",
    }.get(wl, wl)


def _fast_is_negative_be(word: str) -> bool:
    return (word or "").lower() in {"isn't", "aren't", "wasn't", "weren't"}


def _fast_is_negative_do(word: str) -> bool:
    return (word or "").lower() in {"don't", "doesn't", "didn't"}


def _fast_is_modal_like_token(word: str) -> bool:
    wl = (word or "").lower()
    return wl in _FAST_MODALS or _fast_is_negative_modal(word)


def _fast_shrink_subject_before_verb(
    sub_toks: list[tuple[str, int, int]],
    validator,
) -> list[tuple[str, int, int]]:
    """
    When subject is invalid or too long, shrink from the left by preferring a suffix
    starting at the determiner nearest to the verb, else last 1–3 words if valid.
    """
    if not sub_toks:
        return []
    if validator(sub_toks):
        return sub_toks

    n = len(sub_toks)
    # Prefer suffix starting at rightmost determiner-like token (nearest to verb).
    for k in range(n - 1, -1, -1):
        head = sub_toks[k][0].lower()
        if head in _FAST_SUBJ_SHRINK_STARTS:
            cand = sub_toks[k:]
            if validator(cand):
                return cand

    for width in (3, 2, 1):
        if n < width:
            continue
        cand = sub_toks[-width:]
        fl = cand[0][0].lower()
        if fl in _FAST_PREPS_START or fl in _FAST_BAD_START_ADV:
            continue
        phrase = " ".join(t[0].lower() for t in cand)
        if phrase in _FAST_BANNED_SENTENCES:
            continue
        if validator(cand):
            return cand
    return []


def _fast_maybe_shorten_modal_subject(
    sub_toks: list[tuple[str, int, int]],
) -> list[tuple[str, int, int]]:
    """Prefer a shorter valid suffix starting at the determiner nearest the verb (fronted adjuncts)."""
    if len(sub_toks) <= 1:
        return sub_toks
    n = len(sub_toks)
    for k in range(n - 1, -1, -1):
        head = sub_toks[k][0].lower()
        if head in _FAST_SUBJ_SHRINK_STARTS:
            cand = sub_toks[k:]
            if len(cand) < len(sub_toks) and _fast_valid_modal_subject(cand):
                return cand
    return sub_toks


# Conservative -ing noun-ish / quantifier stems (reject as gerund subjects).
_FAST_GERUND_BLOCKLIST = frozenset(
    {
        "something",
        "anything",
        "nothing",
        "everything",
        "thing",
        "morning",
        "evening",
        "building",
        "ceiling",
        "lighting",
        "king",
        "ring",
        "string",
        "bring",
        "cling",
        "sting",
        "swing",
        "during",
    }
)

_FAST_GERUND_WHITELIST = frozenset(
    {
        "adding",
        "using",
        "expanding",
        "improving",
        "reducing",
        "changing",
        "translating",
        "learning",
    }
)


def _fast_is_explicit_lexicon_verb(word: str) -> bool:
    """True only if verb is in lexicon sets (not -ed/-s heuristic in _fast_is_verb_candidate)."""
    return word.lower() in _FAST_ALL_VERBS


def _fast_is_gerund_subject_start(word: str) -> bool:
    """
    Conservative gerund-like subject head: -ing, length rules, blocklist, optional whitelist.
    """
    if not word:
        return False
    wl = word.lower()
    if len(wl) < 5 or not wl.endswith("ing"):
        return False
    if wl in _FAST_GERUND_BLOCKLIST:
        return False
    if wl in _FAST_GERUND_WHITELIST:
        return True
    stem = wl[:-3]
    if not stem.isalpha() or len(stem) < 2:
        return False
    # Generic -ing verbs: reject obvious non-verb stems (very short or common noun-ish)
    if len(stem) <= 2:
        return False
    return True


def _fast_valid_modal_subject(sub_toks: list[tuple[str, int, int]]) -> bool:
    """Subject rules for modal constructions: length 1–8, allowed head, banned starts."""
    if not sub_toks or len(sub_toks) > 8:
        return False
    first_w = sub_toks[0][0]
    fl = first_w.lower()
    if fl in _FAST_PREPS_START:
        return False
    if fl in _FAST_BAD_START_ADV:
        return False
    if len(sub_toks) == 1:
        if fl in _FAST_PRONOUNS:
            return True
        if fl in _FAST_DET_ART | _FAST_DET_POSS:
            return True
        if _fast_is_gerund_subject_start(first_w):
            return True
        if (
            len(first_w) >= 2
            and first_w[0].isupper()
            and fl not in _FAST_BANNED_SENTENCES
            and fl not in _FAST_BAD_START_ADV
        ):
            return True
        return False
    if fl in _FAST_PRONOUNS | _FAST_DET_ART | _FAST_DET_POSS:
        return True
    if len(first_w) >= 2 and first_w[0].isupper():
        return True
    if _fast_is_gerund_subject_start(first_w):
        return True
    return False


def _fast_log_clause_failed(reason: str, inner: str) -> None:
    words = re.findall(r"\b[A-Za-z]+(?:'[A-Za-z]+)?\b", inner or "")
    preview = " ".join(words[:8])
    print(
        f"[timing] grammar fast clause failed reason={reason} words={preview}",
        flush=True,
    )


def _fast_sentence_spans(text: str) -> list[tuple[int, str]]:
    spans: list[tuple[int, str]] = []
    i = 0
    n = len(text)
    while i < n:
        while i < n and text[i].isspace():
            i += 1
        if i >= n:
            break
        seg_start = i
        while i < n and text[i] not in ".!?\n;":
            i += 1
        if i < n and text[i] in ".!?;":
            i += 1
        elif i < n and text[i] == "\n":
            while i < n and text[i] == "\n":
                i += 1
        seg_end = i
        chunk = text[seg_start:seg_end]
        ls = len(chunk) - len(chunk.lstrip())
        rs = len(chunk) - len(chunk.rstrip())
        if rs >= len(chunk):
            continue
        inner_raw = chunk[ls : len(chunk) - rs]
        if not inner_raw.strip():
            continue
        abs_start = seg_start + ls
        spans.append((abs_start, inner_raw))
    return spans


def _fast_candidate_clauses(inner: str, base: int) -> list[tuple[int, str]]:
    """Prefer likely main clauses, then fall back to the whole sentence."""
    out: list[tuple[int, str]] = []
    m = re.search(r"\bthen\b", inner, re.I)
    if m:
        p = m.end()
        while p < len(inner) and inner[p] in " \t\r\n,":
            p += 1
        wm = _FAST_WORD_RE.search(inner, p)
        if wm:
            clause_inner = inner[wm.start() :]
            out.append((base + wm.start(), clause_inner))
    leading_adjunct = re.match(
        r"^\s*(?:in|on|at|with|for|from|to|by|about)\b[^,]{1,48},\s*",
        inner,
        re.I,
    )
    if leading_adjunct:
        wm = _FAST_WORD_RE.search(inner, leading_adjunct.end())
        if wm:
            clause_inner = inner[wm.start() :]
            out.append((base + wm.start(), clause_inner))
    out.append((base, inner))
    return out


def _fast_word_tokens(sentence: str, base: int) -> list[tuple[str, int, int]]:
    out: list[tuple[str, int, int]] = []
    for m in _FAST_WORD_RE.finditer(sentence):
        out.append((m.group(0), base + m.start(), base + m.end()))
    return out


def _fast_is_verb_candidate(word: str) -> bool:
    wl = word.lower()
    if wl in _FAST_ADV_BEFORE_VERB | _FAST_BE_COMP_ADV | _FAST_BAD_START_ADV:
        return False
    if wl in _FAST_ALL_VERBS:
        return True
    if len(word) >= 4 and wl.endswith("ed") and wl[:-2].isalpha():
        return True
    if len(word) >= 4 and wl.endswith("s") and wl[:-1].isalpha():
        if wl.endswith("ss"):
            return False
        return True
    return False


def _fast_clause_banned_start(tokens: list[tuple[str, int, int]]) -> bool:
    if not tokens:
        return True
    f = tokens[0][0].lower()
    if f in _FAST_PREPS_START:
        return True
    if f in _FAST_BAD_START_ADV:
        return True
    return False


def _fast_valid_subject_extended(sub_toks: list[tuple[str, int, int]], max_words: int = 4) -> bool:
    if not sub_toks or len(sub_toks) > max_words:
        return False
    first_w = sub_toks[0][0]
    fl = first_w.lower()
    if fl in _FAST_PREPS_START or fl in _FAST_BAD_START_ADV:
        return False
    if len(sub_toks) == 1:
        if fl in _FAST_PRONOUNS:
            return True
        if _fast_is_gerund_subject_start(first_w):
            return True
        if (
            len(first_w) >= 2
            and first_w[0].isupper()
            and fl not in _FAST_BANNED_SENTENCES
            and fl not in _FAST_BAD_START_ADV
        ):
            return True
        return False
    # Multi-word: gerund head only for shorter subjects (conservative).
    if len(sub_toks) <= 4 and _fast_is_gerund_subject_start(first_w):
        return True
    if fl in _FAST_PRONOUNS | _FAST_DET_ART | _FAST_DET_POSS:
        return True
    if len(first_w) >= 2 and first_w[0].isupper():
        return True
    return False


def _fast_find_main_verb_index_right(tokens: list[tuple[str, int, int]]) -> Optional[int]:
    for i in range(len(tokens) - 1, 0, -1):
        w = tokens[i][0]
        wl = w.lower()
        if wl in _FAST_MODALS or _fast_is_negative_modal(w):
            continue
        if _fast_is_verb_candidate(w):
            return i
    return None


def _fast_try_there_be(full_text: str, tokens: list[tuple[str, int, int]]) -> tuple[list[dict], Optional[str]]:
    if len(tokens) < 3:
        return [], None
    if tokens[0][0].lower() != "there":
        return [], None
    if tokens[1][0].lower() not in _FAST_BE:
        return [], None
    obj_slice = tokens[2 : min(len(tokens), 6)]
    out: list[dict] = []
    out.append(
        {
            "role": "subject",
            "text": full_text[tokens[0][1] : tokens[0][2]],
            "start": tokens[0][1],
            "end": tokens[0][2],
        }
    )
    out.append(
        {
            "role": "verb",
            "text": full_text[tokens[1][1] : tokens[1][2]],
            "start": tokens[1][1],
            "end": tokens[1][2],
        }
    )
    out.append(
        {
            "role": "object",
            "text": full_text[obj_slice[0][1] : obj_slice[-1][2]],
            "start": obj_slice[0][1],
            "end": obj_slice[-1][2],
        }
    )
    return out, "there_be"


def _fast_trim_object_trailing_adverbs(
    obj_slice: list[tuple[str, int, int]],
) -> list[tuple[str, int, int]]:
    while obj_slice and obj_slice[-1][0].lower() in _FAST_ADV_BEFORE_VERB:
        obj_slice = obj_slice[:-1]
    return obj_slice


def _fast_try_modal(full_text: str, tokens: list[tuple[str, int, int]]) -> tuple[list[dict], Optional[str]]:
    for im in range(1, len(tokens)):
        mw = tokens[im][0]
        if not _fast_is_modal_like_token(mw):
            continue

        subj = tokens[:im]
        if not _fast_valid_modal_subject(subj):
            shrunk = _fast_shrink_subject_before_verb(subj, _fast_valid_modal_subject)
            if not shrunk:
                continue
            subj = shrunk
        else:
            subj = _fast_maybe_shorten_modal_subject(subj)

        neg_modal = _fast_is_negative_modal(mw)
        j = im + 1
        if not neg_modal and j < len(tokens) and tokens[j][0].lower() == "not":
            j += 1

        while j < len(tokens) and tokens[j][0].lower() in _FAST_EXPANDED_ADVERBS:
            j += 1

        if j >= len(tokens):
            continue

        mw_tok = tokens[j]
        mwl = mw_tok[0].lower()

        if mwl in _FAST_BE or _fast_is_negative_be(mw_tok[0]):
            if j + 1 >= len(tokens):
                continue
            v_start = tokens[im][1]
            v_end = mw_tok[2]
            obj_slice = _fast_trim_object_trailing_adverbs(
                tokens[j + 1 : min(len(tokens), im + 8)]
            )
        else:
            if not _fast_is_verb_candidate(mw_tok[0]):
                continue
            v_start = tokens[im][1]
            v_end = mw_tok[2]
            obj_slice = _fast_trim_object_trailing_adverbs(
                tokens[j + 1 : min(len(tokens), im + 8)]
            )

        out: list[dict] = []
        out.append(
            {
                "role": "subject",
                "text": full_text[subj[0][1] : subj[-1][2]],
                "start": subj[0][1],
                "end": subj[-1][2],
            }
        )
        out.append({"role": "verb", "text": full_text[v_start:v_end], "start": v_start, "end": v_end})
        if obj_slice:
            out.append(
                {
                    "role": "object",
                    "text": full_text[obj_slice[0][1] : obj_slice[-1][2]],
                    "start": obj_slice[0][1],
                    "end": obj_slice[-1][2],
                }
            )
        return out, "modal"
    return [], None


def _fast_try_do_negative(full_text: str, tokens: list[tuple[str, int, int]]) -> tuple[list[dict], Optional[str]]:
    """don't/doesn't/didn't or explicit do not + verb; verb span includes aux through main verb."""
    for i in range(1, len(tokens)):
        wl = tokens[i][0].lower()
        aux_left = tokens[i][1]
        j_main = i + 1

        if _fast_is_negative_do(tokens[i][0]):
            pass
        elif wl == "do" and i + 1 < len(tokens) and tokens[i + 1][0].lower() == "not":
            j_main = i + 2
        else:
            continue

        subj = tokens[:i]

        def _subj_ok(st: list[tuple[str, int, int]]) -> bool:
            return _fast_valid_subject_extended(st, max_words=6)

        if not _subj_ok(subj):
            shrunk = _fast_shrink_subject_before_verb(subj, _subj_ok)
            if not shrunk:
                continue
            subj = shrunk

        adv_used = 0
        while (
            j_main < len(tokens)
            and tokens[j_main][0].lower() in _FAST_EXPANDED_ADVERBS
            and adv_used < 2
        ):
            j_main += 1
            adv_used += 1

        if j_main >= len(tokens):
            continue

        if not _fast_is_verb_candidate(tokens[j_main][0]):
            continue

        v_start = aux_left
        v_end = tokens[j_main][2]
        obj_slice = _fast_trim_object_trailing_adverbs(tokens[j_main + 1 : j_main + 1 + 4])

        out: list[dict] = [
            {
                "role": "subject",
                "text": full_text[subj[0][1] : subj[-1][2]],
                "start": subj[0][1],
                "end": subj[-1][2],
            },
            {"role": "verb", "text": full_text[v_start:v_end], "start": v_start, "end": v_end},
        ]
        if obj_slice:
            out.append(
                {
                    "role": "object",
                    "text": full_text[obj_slice[0][1] : obj_slice[-1][2]],
                    "start": obj_slice[0][1],
                    "end": obj_slice[-1][2],
                }
            )
        return out, "do_negative"
    return [], None


def _fast_try_have_been_passive(full_text: str, tokens: list[tuple[str, int, int]]) -> tuple[list[dict], Optional[str]]:
    for i in range(1, len(tokens) - 1):
        aux = tokens[i][0].lower()
        if aux not in {"have", "has", "had", "haven't", "hasn't", "hadn't"}:
            continue
        j = i + 1
        if j < len(tokens) and tokens[j][0].lower() == "not":
            j += 1
        if j >= len(tokens) or tokens[j][0].lower() != "been":
            continue
        if j + 1 >= len(tokens) or not _fast_is_verb_candidate(tokens[j + 1][0]):
            continue

        subj = tokens[:i]
        if not _fast_valid_subject_extended(subj, max_words=6):
            shrunk = _fast_shrink_subject_before_verb(
                subj,
                lambda st: _fast_valid_subject_extended(st, max_words=6),
            )
            if not shrunk:
                continue
            subj = shrunk

        return [
            {
                "role": "subject",
                "text": full_text[subj[0][1] : subj[-1][2]],
                "start": subj[0][1],
                "end": subj[-1][2],
            },
            {
                "role": "verb",
                "text": full_text[tokens[i][1] : tokens[j][2]],
                "start": tokens[i][1],
                "end": tokens[j][2],
            },
            {
                "role": "object",
                "text": full_text[tokens[j + 1][1] : tokens[j + 1][2]],
                "start": tokens[j + 1][1],
                "end": tokens[j + 1][2],
            },
        ], "have_been_passive"
    return [], None


def _fast_try_be_complement(full_text: str, tokens: list[tuple[str, int, int]]) -> tuple[list[dict], Optional[str]]:
    for i in range(1, len(tokens)):
        wi = tokens[i][0]
        if wi.lower() not in _FAST_BE and not _fast_is_negative_be(wi):
            continue
        subj = tokens[:i]
        if not _fast_valid_subject_extended(subj):
            shrunk = _fast_shrink_subject_before_verb(
                subj, lambda st: _fast_valid_subject_extended(st, max_words=4)
            )
            if not shrunk:
                continue
            subj = shrunk
        if i + 1 >= len(tokens):
            continue
        comp_slice = tokens[i + 1 : min(len(tokens), i + 5)]
        out: list[dict] = []
        out.append(
            {
                "role": "subject",
                "text": full_text[subj[0][1] : subj[-1][2]],
                "start": subj[0][1],
                "end": subj[-1][2],
            }
        )
        out.append(
            {
                "role": "verb",
                "text": full_text[tokens[i][1] : tokens[i][2]],
                "start": tokens[i][1],
                "end": tokens[i][2],
            }
        )
        out.append(
            {
                "role": "object",
                "text": full_text[comp_slice[0][1] : comp_slice[-1][2]],
                "start": comp_slice[0][1],
                "end": comp_slice[-1][2],
            }
        )
        return out, "simple"
    return [], None


def _fast_try_simple_svo(full_text: str, tokens: list[tuple[str, int, int]]) -> tuple[list[dict], Optional[str]]:
    vi = _fast_find_main_verb_index_right(tokens)
    if vi is None or vi <= 0:
        return [], None
    left = vi - 1
    while left >= 1 and tokens[left][0].lower() in _FAST_ADV_BEFORE_VERB:
        left -= 1
    subj_toks = tokens[: left + 1]
    explicit_lex = _fast_is_explicit_lexicon_verb(tokens[vi][0])
    max_subj = 6 if explicit_lex else 4
    if not _fast_valid_subject_extended(subj_toks, max_words=max_subj):
        shrunk = _fast_shrink_subject_before_verb(
            subj_toks,
            lambda st: _fast_valid_subject_extended(st, max_words=max_subj),
        )
        if not shrunk:
            return [], None
        subj_toks = shrunk
    rest = tokens[vi + 1 :]
    obj_toks: list[tuple[str, int, int]] = []
    if rest:
        if rest[0][0].lower() not in _FAST_PREPS_START:
            obj_toks = _fast_trim_object_trailing_adverbs(rest[:4])
    out: list[dict] = []
    out.append(
        {
            "role": "subject",
            "text": full_text[subj_toks[0][1] : subj_toks[-1][2]],
            "start": subj_toks[0][1],
            "end": subj_toks[-1][2],
        }
    )
    out.append(
        {
            "role": "verb",
            "text": full_text[tokens[vi][1] : tokens[vi][2]],
            "start": tokens[vi][1],
            "end": tokens[vi][2],
        }
    )
    if obj_toks:
        out.append(
            {
                "role": "object",
                "text": full_text[obj_toks[0][1] : obj_toks[-1][2]],
                "start": obj_toks[0][1],
                "end": obj_toks[-1][2],
            }
        )
    return out, "simple"


def _fast_clause_norm_key(inner: str) -> str:
    t = inner.strip().lower()
    t = re.sub(r"[\s.!?;:,]+$", "", t)
    return t


def _fast_diagnose_clause_failure(tokens: list[tuple[str, int, int]]) -> str:
    """Best-effort reason when no fast pattern matches (for single failure log per clause)."""
    if len(tokens) < 2:
        return "empty_tokens"

    for im in range(1, len(tokens)):
        if not _fast_is_modal_like_token(tokens[im][0]):
            continue
        neg_modal = _fast_is_negative_modal(tokens[im][0])
        subj = tokens[:im]
        subj_ok = _fast_valid_modal_subject(subj) or bool(
            _fast_shrink_subject_before_verb(subj, _fast_valid_modal_subject)
        )
        if not subj_ok:
            return "modal_invalid_subject"
        j = im + 1
        if not neg_modal and j < len(tokens) and tokens[j][0].lower() == "not":
            j += 1
        while j < len(tokens) and tokens[j][0].lower() in _FAST_EXPANDED_ADVERBS:
            j += 1
        if j >= len(tokens):
            return "modal_no_main_verb"
        mwl = tokens[j][0].lower()
        if (mwl in _FAST_BE or _fast_is_negative_be(tokens[j][0])) and j + 1 >= len(tokens):
            return "modal_no_main_verb"
        if (
            mwl not in _FAST_BE
            and not _fast_is_negative_be(tokens[j][0])
            and not _fast_is_verb_candidate(tokens[j][0])
        ):
            continue

    for i in range(1, len(tokens)):
        wl = tokens[i][0].lower()
        if not (_fast_is_negative_do(tokens[i][0]) or (wl == "do" and i + 1 < len(tokens) and tokens[i + 1][0].lower() == "not")):
            continue

        def _dn_subj_ok(st: list[tuple[str, int, int]]) -> bool:
            return _fast_valid_subject_extended(st, max_words=6)

        subj = tokens[:i]
        if not _dn_subj_ok(subj) and not _fast_shrink_subject_before_verb(subj, _dn_subj_ok):
            return "do_neg_invalid_subject"
        j = i + 2 if (wl == "do" and i + 1 < len(tokens) and tokens[i + 1][0].lower() == "not") else i + 1
        adv_used = 0
        while (
            j < len(tokens)
            and tokens[j][0].lower() in _FAST_EXPANDED_ADVERBS
            and adv_used < 2
        ):
            j += 1
            adv_used += 1
        if j >= len(tokens):
            return "do_neg_no_main_verb"
        if not _fast_is_verb_candidate(tokens[j][0]):
            return "do_neg_bad_main_verb"

    vi = _fast_find_main_verb_index_right(tokens)
    if vi is None or vi <= 0:
        return "no_verb"

    for i in range(1, len(tokens)):
        wi = tokens[i][0]
        if wi.lower() not in _FAST_BE and not _fast_is_negative_be(wi):
            continue
        subj = tokens[:i]
        if not _fast_valid_subject_extended(subj) and not _fast_shrink_subject_before_verb(
            subj, lambda st: _fast_valid_subject_extended(st, max_words=4)
        ):
            return "be_invalid_subject"

    left = vi - 1
    while left >= 1 and tokens[left][0].lower() in _FAST_ADV_BEFORE_VERB:
        left -= 1
    subj_toks = tokens[: left + 1]
    explicit_lex = _fast_is_explicit_lexicon_verb(tokens[vi][0])
    max_subj = 6 if explicit_lex else 4
    if not _fast_valid_subject_extended(subj_toks, max_words=max_subj):
        if not _fast_shrink_subject_before_verb(
            subj_toks,
            lambda st: _fast_valid_subject_extended(st, max_words=max_subj),
        ):
            return "simple_invalid_subject"

    return "no_pattern_matched"


def _fast_try_parse_clause(full_text: str, inner: str, base: int) -> tuple[list[dict], Optional[str]]:
    sl_key = _fast_clause_norm_key(inner)
    if sl_key in _FAST_BANNED_SENTENCES:
        _fast_log_clause_failed("banned_sentence", inner)
        return [], None
    tokens = _fast_word_tokens(inner, base)
    if len(tokens) < 2:
        _fast_log_clause_failed("empty_tokens", inner)
        return [], None
    if _fast_clause_banned_start(tokens):
        _fast_log_clause_failed("bad_start", inner)
        return [], None

    r, p = _fast_try_there_be(full_text, tokens)
    if r:
        return r, p
    r, p = _fast_try_modal(full_text, tokens)
    if r:
        return r, p
    r, p = _fast_try_do_negative(full_text, tokens)
    if r:
        return r, p
    r, p = _fast_try_have_been_passive(full_text, tokens)
    if r:
        return r, p
    r, p = _fast_try_be_complement(full_text, tokens)
    if r:
        return r, p
    r, p = _fast_try_simple_svo(full_text, tokens)
    if r:
        return r, p

    reason = _fast_diagnose_clause_failure(tokens)
    _fast_log_clause_failed(reason, inner)
    return [], None


def _fast_parse_one_sentence(full_text: str, inner: str, base: int) -> tuple[list[dict], Optional[str]]:
    for cbase, cinner in _fast_candidate_clauses(inner, base):
        items, pat = _fast_try_parse_clause(full_text, cinner, cbase)
        if items:
            return items, pat
    return [], None


def _fast_tokens_have_min_roles(tokens: list[dict]) -> bool:
    roles = {str(t.get("role") or "") for t in tokens}
    return "subject" in roles and "verb" in roles


def analyze_english_grammar_fast(text: str) -> dict:
    source_text = str(text or "")
    print(f"[timing] grammar fast enter text_len={len(source_text)}", flush=True)
    try:
        if len(source_text.strip()) < 8:
            print("[timing] grammar fast normalized ok=False token_count=0", flush=True)
            return {"ok": False, "tokens": [], "source": "local_fast"}
        english_words = re.findall(r"\b[A-Za-z]+(?:'[A-Za-z]+)?\b", source_text)
        if len(english_words) < 2:
            print("[timing] grammar fast normalized ok=False token_count=0", flush=True)
            return {"ok": False, "tokens": [], "source": "local_fast"}
        if not _looks_like_english_sentence(source_text.strip()):
            print("[timing] grammar fast normalized ok=False token_count=0", flush=True)
            return {"ok": False, "tokens": [], "source": "local_fast"}

        all_tokens: list[dict] = []
        for abs_base, inner in _fast_sentence_spans(source_text):
            chunk_tokens, pattern_name = _fast_parse_one_sentence(source_text, inner, abs_base)
            if pattern_name:
                print(
                    f"[timing] grammar fast matched pattern={pattern_name} tokens={len(chunk_tokens)}",
                    flush=True,
                )
            if chunk_tokens and not _fast_tokens_have_min_roles(chunk_tokens):
                print(
                    f"[timing] grammar fast sentence skipped reason=missing_min_roles tokens={len(chunk_tokens)}",
                    flush=True,
                )
                continue
            if len(all_tokens) + len(chunk_tokens) > _FAST_MAX_TOKENS:
                break
            all_tokens.extend(chunk_tokens)

        deduped: list[dict] = []
        last_end = -1
        for tok in sorted(all_tokens, key=lambda t: t["start"]):
            if tok["start"] < last_end:
                continue
            deduped.append(tok)
            last_end = tok["end"]

        ok = bool(deduped)
        result = {
            "ok": ok,
            "tokens": deduped if ok else [],
            "source": "local_fast",
        }
        print(
            f"[timing] grammar fast normalized ok={ok} token_count={len(result['tokens'])}",
            flush=True,
        )
        return result
    except Exception:
        print("[timing] grammar fast normalized ok=False token_count=0", flush=True)
        return {"ok": False, "tokens": [], "source": "local_fast"}


def _find_span_insensitive(haystack: str, needle: str, min_index: int) -> Optional[Tuple[int, int]]:
    if min_index < 0:
        min_index = 0
    needle = needle.strip()
    if not needle:
        return None
    low_h = haystack.lower()
    low_n = needle.lower()
    pos = low_h.find(low_n, min_index)
    if pos < 0:
        return None
    return pos, pos + len(needle)


def _safe_parse_json(raw_text: str):
    text = (raw_text or "").strip()
    if not text:
        print("[timing] grammar failed reason=empty_json", flush=True)
        return {}
    try:
        return json.loads(text)
    except Exception:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            print("[timing] grammar failed reason=bad_json", flush=True)
            return {}
        try:
            return json.loads(match.group(0))
        except Exception:
            print("[timing] grammar failed reason=bad_json_extract", flush=True)
            return {}


def _normalize_grammar_result(source_text: str, parsed) -> dict:
    empty = {"ok": False, "tokens": [], "source": "ai"}
    if not isinstance(parsed, dict):
        return empty
    raw_tokens = parsed.get("tokens")
    if not isinstance(raw_tokens, list):
        return empty

    source_len = len(source_text)
    allowed_roles = {"subject", "verb", "object"}
    normalized_tokens: list[dict] = []

    raw_items = [it for it in raw_tokens[:8] if isinstance(it, dict)]
    raw_items.sort(key=lambda it: int(it["start"]) if isinstance(it.get("start"), int) else 10**9)

    search_anchor = 0
    for item in raw_items:
        role = str(item.get("role") or "").strip().lower()
        if role not in allowed_roles:
            continue
        start = item.get("start")
        end = item.get("end")
        model_text = str(item.get("text") or "").strip()

        ms: Optional[int] = None
        me: Optional[int] = None
        if isinstance(start, int) and isinstance(end, int) and 0 <= start < end <= source_len:
            expected = source_text[start:end]
            if model_text and expected.strip():
                if model_text.lower() == expected.strip().lower():
                    ms, me = start, end
            elif not model_text:
                ms, me = start, end

        if ms is None and model_text:
            span = _find_span_insensitive(source_text, model_text, search_anchor)
            if span:
                ms, me = span

        if ms is None or me is None:
            if model_text:
                snippet = model_text.replace("\n", " ")[:40]
                print(
                    f"[timing] grammar normalize drop role={role} text={snippet!r} reason=span_not_found",
                    flush=True,
                )
            continue

        normalized_tokens.append(
            {
                "role": role,
                "text": source_text[ms:me],
                "start": ms,
                "end": me,
            }
        )
        search_anchor = me

    normalized_tokens.sort(key=lambda token: token["start"])
    deduped: list[dict] = []
    last_end = -1
    seen = set()
    for token in normalized_tokens:
        signature = (token["role"], token["start"], token["end"])
        if signature in seen:
            continue
        if token["start"] < last_end:
            continue
        seen.add(signature)
        deduped.append(token)
        last_end = token["end"]

    roles = {token["role"] for token in deduped}
    ok = "subject" in roles and "verb" in roles
    return {"ok": ok, "tokens": deduped if ok else [], "source": "ai"}
