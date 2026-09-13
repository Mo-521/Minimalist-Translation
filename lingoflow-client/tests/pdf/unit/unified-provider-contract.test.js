const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '../../../..');
const appRoot = path.join(projectRoot, 'lingoflow-client');
const mainSource = fs.readFileSync(path.join(appRoot, 'electron-app/main.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(appRoot, 'electron-app/renderer.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(appRoot, 'electron-app/index.html'), 'utf8');
const desktopTranslator = fs.readFileSync(
  path.join(projectRoot, 'desktop-tools/desktop-float-ball/python-backend/translator.py'),
  'utf8',
);
const desktopBackend = fs.readFileSync(
  path.join(projectRoot, 'desktop-tools/desktop-float-ball/python-backend/main.py'),
  'utf8',
);
const desktopElectronMain = fs.readFileSync(
  path.join(projectRoot, 'desktop-tools/desktop-float-ball/electron-app/main.js'),
  'utf8',
);
const sharedConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, 'config/lingoflow.example.json'), 'utf8'));

test('shared config establishes one local-first OpenAI-compatible provider artifact', () => {
  assert.equal(sharedConfig.provider.type, 'openai_compatible');
  assert.match(sharedConfig.provider.preset, /^(deepseek|qwen|hunyuan|kimi|openai|custom)$/);
  assert.equal(typeof sharedConfig.provider.baseUrl, 'string');
  assert.equal(typeof sharedConfig.provider.apiKey, 'string');
  assert.equal(typeof sharedConfig.provider.model, 'string');
  assert.match(mainSource, /provider:\s*\{[\s\S]*type:\s*"openai_compatible"/);
  assert.match(mainSource, /function getProviderPublicConfig/);
  assert.match(mainSource, /apiKeyConfigured/);
  assert.doesNotMatch(mainSource, /getProviderPublicConfig[\s\S]{0,800}apiKey:\s*key/);
});

test('settings polishes the existing multi-provider flow without changing provider authority', () => {
  for (const id of ['page-settings', 'providerProfileList', 'btnNewProviderProfile', 'providerConfigDialog', 'providerPreset', 'providerApiKey', 'btnToggleProviderKey', 'btnSaveProvider', 'providerFeedback', 'providerDialogFeedback', 'providerAdvancedSettings', 'providerBaseUrl', 'providerModel']) {
    assert.match(htmlSource, new RegExp(`id="${id}"`));
  }
  for (const removedId of ['providerTemplateGrid', 'providerSaveFeedback', 'btnToggleProviderDiagnostics', 'providerDiagnosticDetails']) {
    assert.doesNotMatch(htmlSource, new RegExp(`id="${removedId}"`));
  }
  assert.match(htmlSource, /<dialog id="providerConfigDialog"/);
  assert.match(htmlSource, /<details id="providerAdvancedSettings"[^>]*>/);
  assert.doesNotMatch(htmlSource, /<details id="providerAdvancedSettings"[^>]*\sopen(?:\s|>)/);
  assert.match(htmlSource, /id="btnSaveProvider"[^>]*disabled/);
  for (const state of ['disconnected', 'connecting', 'connected', 'failed']) assert.match(rendererSource, new RegExp(`"${state}"`));
  assert.match(rendererSource, /lingoflow-provider:save/);
  assert.match(rendererSource, /lingoflow-provider:activate/);
  assert.match(rendererSource, /lingoflow-provider:test/);
  assert.match(rendererSource, /连接失败/);
  for (const preset of ['DeepSeek', '阿里百炼（Qwen）', '腾讯混元', 'Kimi', 'OpenAI', '自定义']) assert.match(htmlSource, new RegExp(`>${preset}<`));
  assert.doesNotMatch(htmlSource, />OpenRouter</);
  assert.doesNotMatch(htmlSource, />Ollama</);
  assert.match(mainSource, /deepseek-v4-flash/);
  assert.match(mainSource, /serializeProviderError/);
  assert.match(mainSource, /responseBody/);
  assert.match(mainSource, /acceptAnyResponseBody: true/);
  assert.match(mainSource, /Number\(result\.httpStatus\) !== 200 \|\| !hasChoices/);
  assert.match(mainSource, /Array\.isArray\(result\.responseData\.choices\)/);
  assert.match(mainSource, /PROVIDER TEST RESPONSE/);
  assert.match(mainSource, /data && data\.output_text/);
  assert.match(mainSource, /data && data\.output/);
  assert.match(mainSource, /PROVIDER EMPTY CONTENT RETRY/);
  assert.match(mainSource, /message\.reasoning_content/);
  assert.match(mainSource, /expandedMaxTokens/);
  assert.match(mainSource, /provider\.preset === "deepseek" \? \{ thinking: \{ type: "disabled" \} \}/);
  assert.match(rendererSource, /function connectProviderProfile/);
  assert.match(rendererSource, /updateProviderConnectionUi\(profile\.id, "connecting"\)/);
  assert.match(rendererSource, /provider-connect-action/);
  assert.match(rendererSource, /服务商已连接 ·/);
  assert.match(rendererSource, /result\.provider \|\| "自定义"/);
  assert.match(rendererSource, /function providerFormSignature/);
  assert.match(rendererSource, /saveButton\.disabled = providerFormSignature\(\) === state\.providerFormBaseline/);
  const settingsSetup = rendererSource.slice(
    rendererSource.indexOf('async function setupProviderSettingsPage'),
    rendererSource.indexOf('function formatFileSize'),
  );
  assert.match(settingsSetup, /form\.addEventListener\("submit"/);
  assert.match(settingsSetup, /form\.addEventListener\("input", updateProviderSaveState\)/);
  assert.match(settingsSetup, /lingoflow-provider:save/);
  assert.doesNotMatch(settingsSetup, /lingoflow-provider:test/);
});

test('open-source shell exposes independent desktop, PDF, and settings navigation', () => {
  assert.match(htmlSource, /data-page="desktop"[^>]*aria-label="桌面翻译"/);
  assert.match(htmlSource, /data-page="pdf"[^>]*aria-current="page"[^>]*aria-label="PDF 翻译"/);
  assert.match(htmlSource, /data-page="settings"/);
  assert.match(htmlSource, /id="page-desktop" class="app-page translation-page"/);
  assert.match(htmlSource, /id="page-pdf" class="app-page translation-page active"/);
  assert.match(htmlSource, /id="page-settings"/);
  for (const removedSurface of [
    'data-page="user"',
    'data-page="quota"',
    'id="page-user"',
    'id="page-quota"',
    'btnClaimTrialQuota',
    '立即升级',
  ]) assert.doesNotMatch(htmlSource, new RegExp(removedSurface));

  const navSetup = rendererSource.slice(
    rendererSource.indexOf('function setupAppNav'),
    rendererSource.indexOf('function setText'),
  );
  assert.doesNotMatch(navSetup, /user:|quota:|refreshUsageSurfaces/);
  assert.match(navSetup, /desktop: document\.getElementById\("page-desktop"\)/);
  assert.match(navSetup, /pdf: document\.getElementById\("page-pdf"\)/);

  const bootSetup = rendererSource.slice(
    rendererSource.indexOf('async function boot'),
    rendererSource.indexOf('boot();'),
  );
  assert.doesNotMatch(bootSetup, /setupQuotaActions|setupTestUserSwitch|renderTestUserSelect|refreshServerState|refreshUsageSurfaces/);
});

test('PDF UI separates mode entry from one progressive workspace without changing pipeline authority', () => {
  for (const id of [
    'pdfEntryView', 'pdfWorkView', 'pdfRecentList', 'btnBackPdfModes',
    'pdfFileInput', 'pdfSourceLangSelect', 'pdfTargetLangSelect',
    'btnPreparePdfTranslation', 'btnPausePdfTranslation', 'btnClearPdfFile',
    'btnExportPdfTranslation', 'btnOpenPdfOutput',
  ]) assert.match(htmlSource, new RegExp(`id="${id}"`));
  assert.match(htmlSource, /data-pdf-mode="simple_pdf"/);
  assert.match(htmlSource, /data-pdf-mode="paper_pdf"/);
  assert.doesNotMatch(htmlSource, /data-pdf-mode="scan_pdf"/);
  for (const step of ['select', 'extract', 'translate', 'complete', 'export']) {
    assert.match(htmlSource, new RegExp(`data-step="${step}"`));
  }
  assert.match(rendererSource, /localStorage\.getItem\("lingoflow\.pdfRecentJobs"\)/);
  assert.match(rendererSource, /jobs\.slice\(0, 3\)/);
  assert.match(rendererSource, /waitWhilePdfTranslationPaused/);
  assert.match(rendererSource, /state\.pdfTranslatePaused = !state\.pdfTranslatePaused/);
  assert.match(rendererSource, /state\.pdfTranslateAbortController\.abort\(\)/);
  assert.match(mainSource, /ipcMain\.handle\("shell:open-path"/);
  assert.match(rendererSource, /ipc\.invoke\("shell:open-path", state\.lastPdfOutputPath\)/);
});

test('PDF translation consumes the main-process unified provider instead of cloud translate endpoints', () => {
  assert.match(mainSource, /ipcMain\.handle\("lingoflow-provider:translate"/);
  assert.match(mainSource, /\/chat\/completions/);
  assert.match(rendererSource, /providerIpc\.invoke\("lingoflow-provider:translate", payload\)/);
  const translateFunction = rendererSource.slice(
    rendererSource.indexOf('async function translateSegmentSourceText'),
    rendererSource.indexOf('function isRetryablePdfTranslationError'),
  );
  assert.doesNotMatch(translateFunction, /requestFirstJson/);
  assert.doesNotMatch(translateFunction, /\/v1\/translate/);
});

test('desktop translation reads the same provider artifact and has no official-cloud default', () => {
  assert.match(desktopTranslator, /def _get_provider_config\(\)/);
  assert.match(desktopTranslator, /provider\.get\("baseUrl"\)/);
  assert.match(desktopTranslator, /provider\.get\("apiKey"\)/);
  assert.match(desktopTranslator, /provider\.get\("model"\)/);
  assert.match(desktopTranslator, /DEFAULT_PROXY_BASE_URL = ""/);
  assert.match(desktopTranslator, /DEFAULT_BETA_TOKEN = ""/);
  assert.match(desktopTranslator, /return False\s+mode = \(os\.environ\.get\("LINGOFLOW_TRANSLATION_ENDPOINT_MODE"/);
  assert.match(desktopBackend, /\{"status": "error", "error": str\(exc\)\}/);
  assert.doesNotMatch(desktopBackend, /\{"status": "done", "translation": task\["text"\]\}/);
  assert.match(desktopTranslator, /def _retry_empty_completion\(/);
  assert.match(desktopTranslator, /expanded_max_tokens = min\(8192, max\(2048/);
  assert.match(desktopTranslator, /extra_body\["thinking"\] = \{"type": "disabled"\}/);
  assert.doesNotMatch(desktopTranslator, /"translation": final_text or source_text/);
  assert.match(desktopElectronMain, /DEV_BUNDLED_BACKEND_ENTRY/);
  assert.match(desktopElectronMain, /mode: "development-bundled"/);
});
