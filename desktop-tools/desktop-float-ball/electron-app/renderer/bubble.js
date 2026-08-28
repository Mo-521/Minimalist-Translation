const content = document.getElementById("content");
const closeBtn = document.getElementById("closeBtn");
const toggleViewBtn = document.getElementById("toggleViewBtn");
const wordBackBtn = document.getElementById("wordBackBtn");
let pendingPlaceholderTimer = null;
let pendingSymbolInterval = null;
let latestStatus = "";
let symbolStep = 0;
let latestPayload = null;
let latestGrammarByView = { source: null, translation: null };
let currentView = "translation";
let previousViewBeforeWord = "source";
let activeWordRequestId = "";
const wordLookupCache = new Map();
let cachedVoices = [];
let voicesReady = false;
let wordViewState = {
  word: "",
  loading: false,
  error: "",
  data: null,
};
const sourceIcon = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path>
  <path d="M14 3v5h5"></path>
  <path d="M9 13h6"></path>
  <path d="M9 17h4"></path>
</svg>
`;
const backIcon = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M15 18l-6-6 6-6"></path>
</svg>
`;
const speakIcon = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M11 5L6 9H3v6h3l5 4z"></path>
  <path d="M15.5 8.5a5 5 0 0 1 0 7"></path>
  <path d="M17.8 6a8.2 8.2 0 0 1 0 12"></path>
</svg>
`;
const WORD_TOKEN_REGEX = /[A-Za-z]+(?:'[A-Za-z]+)*/g;
const LEADING_TRAILING_PUNCTUATION_REGEX = /^[^A-Za-z]+|[^A-Za-z]+$/g;
const translationIcon = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M4 5h12"></path>
  <path d="M10 5c0 6-3 9-6 11"></path>
  <path d="M6 12c1.2 1.4 2.6 2.6 4.2 3.6"></path>
  <path d="M14 15h6"></path>
  <path d="M17 12v6"></path>
</svg>
`;

function clearPendingEffects() {
  if (pendingPlaceholderTimer) {
    window.clearTimeout(pendingPlaceholderTimer);
    pendingPlaceholderTimer = null;
  }

  if (pendingSymbolInterval) {
    window.clearInterval(pendingSymbolInterval);
    pendingSymbolInterval = null;
  }

  symbolStep = 0;
}

function startSymbolPlaceholder() {
  if (pendingSymbolInterval) return;

  const frames = ["·", "··", "···"];

  content.textContent = frames[0];
  symbolStep = 1;

  pendingSymbolInterval = window.setInterval(() => {
    content.textContent = frames[symbolStep % frames.length];
    symbolStep += 1;
  }, 220);
}

function updateToggleButton() {
  if (currentView === "translation" || currentView === "word") {
    toggleViewBtn.innerHTML = sourceIcon;
    toggleViewBtn.setAttribute("aria-label", "查看原文");
    toggleViewBtn.title = "查看原文";
    return;
  }

  toggleViewBtn.innerHTML = translationIcon;
  toggleViewBtn.setAttribute("aria-label", "查看译文");
  toggleViewBtn.title = "查看译文";
}

function updateTopBackButton() {
  wordBackBtn.innerHTML = backIcon;
  wordBackBtn.style.display = currentView === "word" ? "inline-flex" : "none";
}

function getSourceText(payload) {
  if (!payload || typeof payload.source !== "string") return "无原文";
  return payload.source ? payload.source : "无原文";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeGrammarForText(text, grammar) {
  if (!grammar || !grammar.ok || !Array.isArray(grammar.tokens)) return null;
  const tokens = [];
  let lastEnd = -1;
  for (const item of grammar.tokens.slice(0, 24)) {
    if (!item || typeof item !== "object") continue;
    const role = String(item.role || "");
    if (role !== "subject" && role !== "verb" && role !== "object") continue;
    if (!Number.isInteger(item.start) || !Number.isInteger(item.end)) continue;
    if (!(item.start >= 0 && item.start < item.end && item.end <= text.length)) continue;
    if (item.start < lastEnd) continue;
    const spanText = text.slice(item.start, item.end);
    const tokenText = typeof item.text === "string" ? item.text : "";
    if (tokenText.trim() && spanText.trim() && tokenText.trim().toLowerCase() !== spanText.trim().toLowerCase()) {
      continue;
    }
    tokens.push({ role, start: item.start, end: item.end, text: spanText });
    lastEnd = item.end;
  }
  return tokens.length > 0 ? tokens : null;
}

function renderPlainClickableEnglish(text) {
  WORD_TOKEN_REGEX.lastIndex = 0;
  let html = "";
  let lastIndex = 0;
  let match = WORD_TOKEN_REGEX.exec(text);
  while (match) {
    const matchedWord = match[0];
    const matchIndex = match.index;
    html += escapeHtml(text.slice(lastIndex, matchIndex));
    html += `<span class="source-word" data-word="${escapeHtml(matchedWord)}">${escapeHtml(matchedWord)}</span>`;
    lastIndex = matchIndex + matchedWord.length;
    match = WORD_TOKEN_REGEX.exec(text);
  }
  html += escapeHtml(text.slice(lastIndex));
  return html;
}

function renderTextWithClickableWordsAndGrammar(text, grammar) {
  if (!text) return "";
  const normalizedTokens = normalizeGrammarForText(text, grammar);
  if (!normalizedTokens || normalizedTokens.length === 0) {
    return renderPlainClickableEnglish(text);
  }
  let html = "";
  let cursor = 0;
  for (const token of normalizedTokens) {
    if (token.start > cursor) {
      html += renderPlainClickableEnglish(text.slice(cursor, token.start));
    }
    const className = `grammar-${token.role}`;
    html += `<span class="${className}">${renderPlainClickableEnglish(token.text)}</span>`;
    cursor = token.end;
  }
  if (cursor < text.length) {
    html += renderPlainClickableEnglish(text.slice(cursor));
  }
  return html;
}

function renderSourceContent(sourceText) {
  if (!sourceText || sourceText === "无原文") {
    content.textContent = "无原文";
    return;
  }
  content.innerHTML = renderTextWithClickableWordsAndGrammar(sourceText, latestGrammarByView.source);
}

function renderPendingTranslation() {
  clearPendingEffects();
  content.textContent = "翻译中...";

  pendingPlaceholderTimer = window.setTimeout(() => {
    pendingPlaceholderTimer = null;

    if (latestStatus !== "pending" || currentView !== "translation") return;

    startSymbolPlaceholder();
  }, 500);
}

function renderTranslation(payload) {
  if (latestStatus === "pending") {
    renderPendingTranslation();
    return;
  }

  const hasTranslation = payload && typeof payload.translation === "string";
  if (hasTranslation && payload.translation) {
    clearPendingEffects();
    content.innerHTML = renderTextWithClickableWordsAndGrammar(payload.translation, latestGrammarByView.translation);
    return;
  }

  clearPendingEffects();
  content.textContent = "无结果";
}

function renderWordView() {
  clearPendingEffects();
  const safeWord = escapeHtml(wordViewState.word || "");

  if (wordViewState.loading) {
    content.innerHTML = `
      <div class="word-panel">
        <div class="word-content">
          <div class="word-main-row">
            <div class="word-head-text">${safeWord}</div>
          </div>
          <div class="word-loading">查询中...</div>
        </div>
      </div>
    `;
    return;
  }

  if (wordViewState.error) {
    const errorMessage = wordViewState.error === "quota_insufficient"
      ? "DeepSeek 额度不足，暂时无法单词检索"
      : "查询失败，请稍后重试";
    content.innerHTML = `
      <div class="word-panel">
        <div class="word-content">
          <div class="word-main-row">
            <div class="word-head-text">${safeWord}</div>
          </div>
          <div class="word-loading">${escapeHtml(errorMessage)}</div>
        </div>
      </div>
    `;
    return;
  }

  const phoneticRaw = wordViewState.data && wordViewState.data.phonetic ? wordViewState.data.phonetic : "";
  const hasPhonetic = Boolean(phoneticRaw && phoneticRaw !== "暂无");
  const definitions =
    wordViewState.data && Array.isArray(wordViewState.data.definitions) ? wordViewState.data.definitions : [];
  const contextMeaning =
    wordViewState.data && wordViewState.data.contextMeaning ? wordViewState.data.contextMeaning : "";
  const phoneticHtml = hasPhonetic ? `<div class="word-phonetic">${escapeHtml(phoneticRaw)}</div>` : "";
  const hasData = Boolean(wordViewState.data);
  const speakButtonsHtml = hasData
    ? `
    <div class="word-pronunciation-actions">
      <button class="word-accent-btn" type="button" data-action="speak-word" data-word="${safeWord}" data-accent="us" aria-label="美音发音" title="美音发音"><span class="word-accent-label">US</span>${speakIcon}</button>
      <button class="word-accent-btn" type="button" data-action="speak-word" data-word="${safeWord}" data-accent="uk" aria-label="英音发音" title="英音发音"><span class="word-accent-label">UK</span>${speakIcon}</button>
    </div>
  `
    : "";

  const subRowHtml = hasData ? `<div class="word-sub-row">${phoneticHtml}${speakButtonsHtml}</div>` : "";

  const definitionHtml =
    definitions.length > 0
      ? definitions
          .map((item) => {
            const pos = escapeHtml(item && item.pos ? item.pos : "n.");
            const meaning = escapeHtml(item && item.meaning ? item.meaning : "暂无");
            return `<div class="word-definition"><span class="word-pos">${pos}</span><span>${meaning}</span></div>`;
          })
          .join("")
      : `<div class="word-definition"><span>暂无释义</span></div>`;

  content.innerHTML = `
    <div class="word-panel">
      <div class="word-content">
        <div class="word-main-row">
          <div class="word-head-text">${safeWord}</div>
          ${subRowHtml}
        </div>
        <div class="word-definitions">${definitionHtml}</div>
        <div class="word-context">${escapeHtml(contextMeaning ? `语境：${contextMeaning}` : "语境：暂无")}</div>
      </div>
    </div>
  `;
}

function renderCurrentView() {
  updateToggleButton();
  updateTopBackButton();
  if (currentView === "word") {
    renderWordView();
    return;
  }

  if (currentView === "source") {
    clearPendingEffects();
    renderSourceContent(getSourceText(latestPayload));
    return;
  }

  renderTranslation(latestPayload);
}

function handlePending(payload) {
  clearPendingEffects();
  latestStatus = "pending";
  latestPayload = payload;
  latestGrammarByView = { source: null, translation: null };
  currentView = "translation";
  renderCurrentView();
}

function handlePayload(payload) {
  latestPayload = payload;
  latestStatus = payload && typeof payload.status === "string" ? payload.status : "";
  renderCurrentView();
}

function getWordContextText() {
  const source = getSourceText(latestPayload);
  return source === "无原文" ? "" : source;
}

function getWordCacheKey(word, context) {
  return `${word.toLowerCase()}|||${context}`;
}

function resetWordState(word) {
  wordViewState = {
    word,
    loading: true,
    error: "",
    data: null,
  };
}

function applyWordResult(result) {
  wordViewState = {
    word: result.word || wordViewState.word,
    loading: false,
    error: "",
    data: {
      word: result.word || wordViewState.word,
      phonetic: result.phonetic || "暂无",
      definitions: Array.isArray(result.definitions) ? result.definitions : [],
      contextMeaning: result.contextMeaning || "暂无",
    },
  };
}

function normalizeLookupWord(rawWord) {
  let value = typeof rawWord === "string" ? rawWord.trim() : "";
  if (!value) return "";
  value = value.replace(LEADING_TRAILING_PUNCTUATION_REGEX, "");
  value = value.replace(/['’]s$/i, "");
  value = value.replace(/['’]$/i, "");
  value = value.replace(LEADING_TRAILING_PUNCTUATION_REGEX, "");
  return value;
}

async function openWordView(word) {
  const normalizedWord = normalizeLookupWord(word);
  if (!normalizedWord) return;
  if (currentView !== "word") {
    previousViewBeforeWord = currentView;
  }
  currentView = "word";
  const context = getWordContextText();
  const cacheKey = getWordCacheKey(normalizedWord, context);
  if (wordLookupCache.has(cacheKey)) {
    wordViewState = {
      word: normalizedWord,
      loading: false,
      error: "",
      data: wordLookupCache.get(cacheKey),
    };
    renderCurrentView();
    return;
  }

  resetWordState(normalizedWord);
  renderCurrentView();

  try {
    const result = await window.desktopApi.lookupWord({
      word: normalizedWord,
      context,
    });
    if (!result || !result.requestId) {
      wordViewState.loading = false;
      wordViewState.error = "lookup-request-failed";
      renderCurrentView();
      return;
    }
    activeWordRequestId = result.requestId;
  } catch (_error) {
    wordViewState.loading = false;
    wordViewState.error = "lookup-request-failed";
    renderCurrentView();
  }
}

function updateVoicesCache() {
  if (!window.speechSynthesis) return;
  const voices = window.speechSynthesis.getVoices();
  if (Array.isArray(voices) && voices.length > 0) {
    cachedVoices = voices;
    voicesReady = true;
  }
}

function isEnglishVoice(voice) {
  const lang = String((voice && voice.lang) || "").toLowerCase();
  return lang.startsWith("en");
}

function pickBestEnglishVoiceByAccent(voices, accent = "us") {
  if (!Array.isArray(voices) || voices.length === 0) return null;
  const englishVoices = voices.filter(isEnglishVoice);
  if (englishVoices.length === 0) return null;

  const normalizedAccent = accent === "uk" ? "uk" : "us";
  const targetPrefix = normalizedAccent === "uk" ? "en-gb" : "en-us";
  const targetVoices = englishVoices.filter((voice) => {
    const lang = String((voice && voice.lang) || "").toLowerCase();
    return lang.startsWith(targetPrefix);
  });
  const keywordRegex = /(Natural|Online|Google|Microsoft|Aria|Jenny|Guy|Samantha|Ryan|Libby|Sonia)/i;
  const withKeyword = targetVoices.find((voice) => keywordRegex.test(String((voice && voice.name) || "")));
  if (withKeyword) return withKeyword;
  if (targetVoices.length > 0) return targetVoices[0];
  const anyEnglishKeyword = englishVoices.find((voice) => keywordRegex.test(String((voice && voice.name) || "")));
  if (anyEnglishKeyword) return anyEnglishKeyword;
  return englishVoices[0];
}

function waitForVoices(timeoutMs = 500) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) {
      resolve([]);
      return;
    }
    updateVoicesCache();
    if (voicesReady) {
      resolve(cachedVoices);
      return;
    }

    let settled = false;
    const onVoicesChanged = () => {
      if (settled) return;
      updateVoicesCache();
      if (!voicesReady) return;
      settled = true;
      window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
      resolve(cachedVoices);
    };

    window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
    window.setTimeout(() => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
      updateVoicesCache();
      resolve(cachedVoices);
    }, timeoutMs);
  });
}

async function speakWord(word, accent = "us") {
  if (!window.speechSynthesis || !word) return;
  const voices = voicesReady ? cachedVoices : await waitForVoices();
  const normalizedAccent = accent === "uk" ? "uk" : "us";
  const selectedVoice = pickBestEnglishVoiceByAccent(voices, normalizedAccent);
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = normalizedAccent === "uk" ? "en-GB" : "en-US";
  utterance.rate = 0.85;
  utterance.pitch = 1;
  utterance.volume = 1;
  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }
  window.speechSynthesis.speak(utterance);
}

window.desktopApi.onBubbleData((payload) => {
  const status = payload && typeof payload.status === "string" ? payload.status : "";

  if (status === "pending") {
    handlePending(payload);
    return;
  }

  handlePayload(payload);
});

window.desktopApi.onGrammarData((payload) => {
  console.log("[bubble] grammar-data received", {
    targetView: payload && payload.targetView,
    ok: Boolean(payload && payload.grammar && payload.grammar.ok),
    tokenCount:
      payload && payload.grammar && Array.isArray(payload.grammar.tokens)
        ? payload.grammar.tokens.length
        : 0,
    currentView,
  });
  if (!payload || !payload.grammar || !payload.grammar.ok) return;
  const targetView = payload.targetView;
  if (targetView !== "source" && targetView !== "translation") return;
  latestGrammarByView[targetView] = payload.grammar;
  if (currentView === targetView) {
    renderCurrentView();
  }
});

window.desktopApi.onWordLookupResult((payload) => {
  if (!payload || payload.requestId !== activeWordRequestId) return;
  const currentWord = wordViewState.word;
  const context = getWordContextText();
  const cacheKey = getWordCacheKey(currentWord, context);
  activeWordRequestId = "";

  if (payload.error) {
    wordViewState.loading = false;
    wordViewState.error = payload.error === "quota_insufficient" ? "quota_insufficient" : "lookup-failed";
    renderCurrentView();
    return;
  }

  const result = {
    word: payload.word || currentWord,
    phonetic: payload.phonetic || "",
    definitions: Array.isArray(payload.definitions) ? payload.definitions : [],
    contextMeaning: payload.contextMeaning || "暂无",
  };
  wordLookupCache.set(cacheKey, result);
  applyWordResult(result);
  renderCurrentView();
});

toggleViewBtn.addEventListener("click", () => {
  if (currentView === "translation") {
    currentView = "source";
  } else {
    currentView = "translation";
  }
  renderCurrentView();
});

function suspendSelectionWhileInteractingWithBubble() {
  try {
    const p = window.desktopApi.setSelectionSuspended({
      suspended: true,
      durationMs: 2500,
    });
    if (p && typeof p.catch === "function") {
      p.catch(() => {});
    }
  } catch (_error) {
    /* ignore */
  }
}

function resumeSelectionAfterBubbleInteraction() {
  try {
    const p = window.desktopApi.setSelectionSuspended({ suspended: false });
    if (p && typeof p.catch === "function") {
      p.catch(() => {});
    }
  } catch (_error) {
    /* ignore */
  }
}

content.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  suspendSelectionWhileInteractingWithBubble();
});

window.addEventListener("pointerup", () => {
  resumeSelectionAfterBubbleInteraction();
});
window.addEventListener("mouseup", () => {
  resumeSelectionAfterBubbleInteraction();
});
window.addEventListener("blur", () => {
  resumeSelectionAfterBubbleInteraction();
});

content.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const wordElement = target.closest(".source-word");
  if (wordElement) {
    const word = wordElement.getAttribute("data-word") || "";
    openWordView(word);
    return;
  }

  const speakBtn = target.closest("[data-action='speak-word']");
  if (speakBtn) {
    const word = speakBtn.getAttribute("data-word") || wordViewState.word;
    const accent = speakBtn.getAttribute("data-accent") || "us";
    speakWord(word, accent);
  }
});

closeBtn.addEventListener("click", () => {
  clearPendingEffects();
  window.desktopApi.closeBubble();
});

wordBackBtn.addEventListener("click", () => {
  currentView = previousViewBeforeWord || "source";
  renderCurrentView();
});

if (window.speechSynthesis) {
  updateVoicesCache();
  window.speechSynthesis.addEventListener("voiceschanged", updateVoicesCache);
}
