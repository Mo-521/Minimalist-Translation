const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const appRoot = path.resolve(__dirname, "../../../electron-app");

function loadHelpContent() {
  const source = fs.readFileSync(path.join(appRoot, "provider-help-content.js"), "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: "provider-help-content.js" });
  return { source, content: sandbox.window.PROVIDER_HELP_CONTENT };
}

test("provider contextual help is data driven and covers required topics", () => {
  const { content } = loadHelpContent();
  assert.ok(content);
  assert.equal(content.defaultTopic, "openai-compatible");
  for (const topicId of ["base-url", "api-key", "model", "custom-provider", "openai-compatible"]) {
    const topic = content.topics[topicId];
    assert.ok(topic, `missing help topic: ${topicId}`);
    assert.deepEqual(
      Array.from(Object.keys(topic)).sort(),
      ["example", "howTo", "links", "note", "title", "what"],
      `${topicId} must use the shared help structure`
    );
    assert.ok(topic.title);
    assert.ok(topic.what);
    assert.ok(topic.example);
    assert.ok(Array.isArray(topic.howTo));
    assert.ok(topic.howTo.length >= 2, `${topicId} must explain how to obtain/configure the value`);
    assert.ok(Array.isArray(topic.links));
    assert.ok(topic.note);
    assert.match(topic.example, /DeepSeek/);
  }
  assert.deepEqual(
    Array.from(content.reservedSections),
    ["headers", "timeout", "capabilities", "faq", "officialLinks"]
  );
  assert.match(
    content.topics["openai-compatible"].what,
    /官方列表只是常用模板，不在列表里的平台，也可以通过“自定义”正常使用/
  );
});

test("help content has no Provider persistence or transport behavior", () => {
  const { source } = loadHelpContent();
  assert.doesNotMatch(source, /ipcRenderer|ipc\.invoke|fetch\s*\(|XMLHttpRequest|localStorage|writeFile/);
});

test("provider dialog binds fields to the contextual help panel and packages its data", () => {
  const html = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(appRoot, "renderer.js"), "utf8");
  const styles = fs.readFileSync(path.join(appRoot, "styles.css"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
  assert.match(html, /id="providerHelpPanel"/);
  assert.match(html, />服务商设置</);
  assert.match(html, /<span>服务商<\/span>/);
  assert.match(html, /<span>API 密钥<\/span>/);
  assert.match(html, /<span>接口地址<\/span>/);
  assert.match(html, /<span>模型<\/span>/);
  assert.match(html, /<option value="custom">自定义<\/option>/);
  assert.match(html, /id="providerProfileNameHint">仅用于在本机识别这项配置，不影响接口调用。<\/small>/);
  for (const sectionId of ["providerHelpWhat", "providerHelpExample", "providerHelpHow", "providerHelpNote"]) {
    assert.match(html, new RegExp(`id="${sectionId}"`));
  }
  assert.match(html, /id="btnOpenProviderHelp"[^>]+aria-expanded="false"/);
  assert.match(html, /id="providerHelpPanel"[^>]+aria-hidden="true"/);
  assert.match(html, /id="providerBaseUrl"[^>]+data-help-topic="base-url"/);
  assert.match(html, /id="providerApiKey"[^>]+data-help-topic="api-key"/);
  assert.match(html, /id="providerModel"[^>]+data-help-topic="model"/);
  assert.match(html, /<script src="provider-help-content\.js"><\/script>\s*<script src="renderer\.js"><\/script>/);
  assert.match(styles, /\.provider-config-dialog\s*\{[^}]*width:\s*min\(32rem/s);
  assert.match(styles, /\.provider-config-dialog\.provider-help-drawer-open\s*\{\s*width:\s*min\(58rem/s);
  assert.match(styles, /\.provider-help-panel\s*\{[^}]*display:\s*none/s);
  assert.match(renderer, /classList\.contains\("provider-help-drawer-open"\)/);
  assert.match(renderer, /setProviderHelpDrawer\(shouldOpen, shouldOpen\)/);
  assert.ok(packageJson.build.files.includes("provider-help-content.js"));
});
