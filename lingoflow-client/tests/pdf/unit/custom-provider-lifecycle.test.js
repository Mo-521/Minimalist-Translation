const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "../../../..");
const appRoot = path.join(projectRoot, "lingoflow-client", "electron-app");
const mainSource = fs.readFileSync(path.join(appRoot, "main.js"), "utf8");
const rendererSource = fs.readFileSync(path.join(appRoot, "renderer.js"), "utf8");

function extractFunction(source, name) {
  const regularStart = source.indexOf(`function ${name}(`);
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = regularStart === -1 ? asyncStart : asyncStart === -1 ? regularStart : Math.min(regularStart, asyncStart);
  assert.notEqual(start, -1, `missing function ${name}`);
  const nextRegular = source.indexOf("\nfunction ", start + 1);
  const nextAsync = source.indexOf("\nasync function ", start + 1);
  const candidates = [nextRegular, nextAsync].filter((index) => index !== -1);
  const next = candidates.length ? Math.min(...candidates) : -1;
  const block = source.slice(start, next === -1 ? source.length : next).trim();
  return block.endsWith("}") ? block : `${block}\n}`;
}

function createProviderHarness() {
  const presetStart = mainSource.indexOf("const OPENAI_COMPATIBLE_PROVIDER_PRESETS");
  const presetEnd = mainSource.indexOf("\n});", presetStart) + 4;
  assert.ok(presetStart >= 0 && presetEnd > presetStart, "missing Provider presets");
  const names = [
    "normalizeSharedConfig",
    "normalizeOpenAiCompatibleBaseUrl",
    "inferProviderPreset",
    "validateProviderConfig",
    "providerPublicEntry",
    "getProviderPublicConfig",
    "getProviderManagerPublicConfig",
    "providerConnectionFingerprint",
    "clearConnectedProviderSession",
    "requireConnectedProviderSession",
    "saveProviderConfig",
    "activateProviderConfig",
    "extractProviderContentValue",
    "extractOpenAiCompatibleText",
    "createProviderHttpError",
    "callOpenAiCompatibleProvider",
    "testProviderConnection",
    "getTargetLanguageName",
    "translateWithConfiguredProvider",
  ];
  const context = {
    URL,
    AbortController,
    clearTimeout,
    console,
    fetch,
    setTimeout,
    crypto: { randomUUID: () => "custom-lifecycle-id", createHash: require('node:crypto').createHash },
  };
  const harnessSource = `
    const DEFAULT_SHARED_CONFIG = {
      serverBaseUrl: "",
      betaToken: "",
      targetLanguage: "en",
      testUsers: [{}],
      provider: { type: "openai_compatible", preset: "custom", baseUrl: "", apiKey: "", model: "" }
    };
    ${mainSource.slice(presetStart, presetEnd)}
    const providerExpandedCompletionBudget = new Map();
    let connectedProviderSession = null;
    function providerRuntimeCapabilityKey(provider) {
      return normalizeOpenAiCompatibleBaseUrl(provider && provider.baseUrl).toLowerCase() + "::" + String(provider && provider.model || "").trim().toLowerCase();
    }
    function debugPdfLog() {}
    function debugPdfWarn() {}
    ${names.map((name) => extractFunction(mainSource, name)).join("\n")}
    let stored = normalizeSharedConfig({
      providerProfiles: [{ id: "existing", name: "Existing", preset: "deepseek", baseUrl: "https://api.deepseek.com/v1", apiKey: "existing-key", model: "deepseek-v4-flash" }],
      activeProviderId: "existing"
    });
    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function readSharedConfig() { return normalizeSharedConfig(clone(stored)); }
    function writeSharedConfig(next) { stored = normalizeSharedConfig(clone(next)); return readSharedConfig(); }
    globalThis.providerHarness = {
      saveProviderConfig,
      activateProviderConfig,
      testProviderConnection,
      translateWithConfiguredProvider,
      restart() { stored = normalizeSharedConfig(clone(stored)); return getProviderManagerPublicConfig(stored); },
      stored() { return clone(stored); }
    };
  `;
  try {
    vm.runInNewContext(harnessSource, context);
  } catch (error) {
    error.stack += `\nHarness lines 80-95:\n${harnessSource.split("\n").slice(79, 95).map((line, index) => `${index + 80}: ${line}`).join("\n")}`;
    throw error;
  }
  return context.providerHarness;
}

test("Custom Provider survives free entry, save, restart, reopen, and blank-key edit", () => {
  const harness = createProviderHarness();
  const saved = harness.saveProviderConfig({
    name: "我的自定义服务",
    preset: "custom",
    baseUrl: "https://models.example.test/v1/chat/completions",
    apiKey: "secret-custom-key",
    model: "translation-model-v1",
  });
  assert.equal(saved.active.preset, "custom");
  assert.equal(saved.active.name, "我的自定义服务");
  assert.equal(saved.active.baseUrl, "https://models.example.test/v1");
  assert.equal(saved.active.model, "translation-model-v1");
  assert.equal(saved.active.apiKeyConfigured, true);
  assert.equal(Object.hasOwn(saved.active, "apiKey"), false);

  const restarted = harness.restart();
  assert.equal(restarted.active.name, "我的自定义服务");
  assert.equal(restarted.active.preset, "custom");
  assert.equal(restarted.active.baseUrl, "https://models.example.test/v1");
  assert.equal(restarted.active.model, "translation-model-v1");
  assert.equal(restarted.active.apiKeyConfigured, true);

  const reopened = harness.saveProviderConfig({
    id: restarted.active.id,
    name: restarted.active.name,
    preset: restarted.active.preset,
    baseUrl: restarted.active.baseUrl,
    apiKey: "",
    model: "translation-model-v2",
  });
  assert.equal(reopened.active.model, "translation-model-v2");
  assert.equal(reopened.active.apiKeyConfigured, true);
  assert.equal(harness.stored().provider.apiKey, "secret-custom-key");
});

test("saved Custom Provider actively connects with restored credentials", async (t) => {
  let request = null;
  const server = http.createServer((incoming, response) => {
    let body = "";
    incoming.setEncoding("utf8");
    incoming.on("data", (chunk) => { body += chunk; });
    incoming.on("end", () => {
      request = { url: incoming.url, authorization: incoming.headers.authorization, body: JSON.parse(body) };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const harness = createProviderHarness();
  const saved = harness.saveProviderConfig({
    name: "本地兼容服务",
    preset: "custom",
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    apiKey: "restored-test-key",
    model: "local-test-model",
  });
  const result = await harness.testProviderConnection(saved.active);
  assert.equal(result.ok, true);
  assert.equal(result.provider, "自定义");
  assert.equal(result.model, "local-test-model");
  assert.equal(request.url, "/v1/chat/completions");
  assert.equal(request.authorization, "Bearer restored-test-key");
  assert.equal(request.body.model, "local-test-model");
});

test("Custom selection clears template values and connection remains user initiated", () => {
  const applyPreset = rendererSource.slice(
    rendererSource.indexOf("function applyProviderPreset"),
    rendererSource.indexOf("function populateProviderForm"),
  );
  assert.match(applyPreset, /preset\.id === "custom"/);
  assert.match(applyPreset, /baseUrl\.value = ""/);
  assert.match(applyPreset, /model\.value = ""/);

  const setup = rendererSource.slice(
    rendererSource.indexOf("async function setupProviderSettingsPage"),
    rendererSource.indexOf("function formatFileSize"),
  );
  assert.match(setup, /lingoflow-provider:save/);
  assert.doesNotMatch(setup, /lingoflow-provider:test/);
  assert.match(rendererSource, /connectButton\.addEventListener\("click", function \(\) \{ connectProviderProfile\(profile\); \}\)/);
  assert.match(rendererSource, /updateProviderConnectionUi\(profile\.id, "connecting"\)/);
  assert.match(rendererSource, /await ipc\.invoke\("lingoflow-provider:test", profile\)/);
});

test("translation is blocked until the active Provider is explicitly connected", async (t) => {
  const server = http.createServer((incoming, response) => {
    incoming.resume();
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const harness = createProviderHarness();
  const saved = harness.saveProviderConfig({
    name: "连接门测试",
    preset: "custom",
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    apiKey: "gate-test-key",
    model: "gate-test-model",
  });
  await assert.rejects(
    harness.translateWithConfiguredProvider({ text: "hello", targetLanguage: "zh-CN" }),
    (error) => error && error.code === "PROVIDER_NOT_CONNECTED",
  );
  await harness.testProviderConnection(saved.active);
  const translated = await harness.translateWithConfiguredProvider({ text: "hello", targetLanguage: "zh-CN" });
  assert.equal(translated.status, "ok");
  assert.equal(translated.providerConnection.providerId, saved.active.id);
  assert.ok(translated.providerConnection.connectedAt);
});

test("PDF.js is warmed at startup and first extraction has one bounded retry", () => {
  assert.match(mainSource, /app\.whenReady\(\)\.then\([\s\S]*loadPdfJs\(\)\.catch/);
  const loaderSource = extractFunction(mainSource, "loadPdfJs");
  assert.doesNotMatch(loaderSource, /workerSrc\s*=\s*null/);
  const selectSource = extractFunction(mainSource, "selectAndExtractPdf");
  assert.match(selectSource, /initial pdf\.js extraction failed; retrying once/);
  assert.equal((selectSource.match(/extractPdfTextWithPdfJs\(buffer, pipelineConfig\)/g) || []).length, 2);
});
