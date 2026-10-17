"use strict";

// Diagnostic PDF source boundary for the offline candidate producer. Reuse the
// application's current extraction implementation in a blocked VM; no Task
// artifact, reviewed hint, or canonical result is passed to the new producer.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");

const appDirectory = path.resolve(__dirname, "../../../../../..");
const mainFile = path.join(appDirectory, "main.js");
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

async function extractObservedPdf(pdfPath) {
  if (!pdfPath || !fs.statSync(pdfPath).isFile()) throw Error("Existing PDF required");
  const mainBytes = fs.readFileSync(mainFile);
  const mainHash = sha(mainBytes);
  const localRequire = createRequire(mainFile);
  const blocked = () => { throw Error("Offline PDF extraction blocked external action"); };
  const electron = {
    app: { isPackaged: false, getPath: () => appDirectory, setPath() {},
      commandLine: { appendSwitch() {} }, whenReady: () => ({ then() {} }), on() {} },
    ipcMain: { handle() {}, on() {} }, BrowserWindow: blocked,
    dialog: { showOpenDialog: blocked },
    shell: { openPath: blocked, openExternal: blocked }
  };
  const context = vm.createContext({
    require: name => name === "electron" ? electron :
      name === "child_process" ? { spawn: blocked, execFile: blocked } : localRequire(name),
    __dirname: appDirectory, __filename: mainFile,
    process: { platform: process.platform, env: {}, cwd: () => appDirectory },
    Buffer, Uint8Array, URL, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} }, fetch: blocked
  });
  vm.runInContext(mainBytes.toString("utf8"), context,
    { filename: mainFile, timeout: 20000 });
  context.offlinePdfJs = await import(pathToFileURL(
    localRequire.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
  vm.runInContext("pdfjsLib = offlinePdfJs;", context);
  context.offlinePdfBuffer = fs.readFileSync(pdfPath);
  const output = await vm.runInContext(
    "extractPdfTextWithPdfJs(offlinePdfBuffer, getPdfPipelineConfig('paper_pdf'))", context);
  if (sha(fs.readFileSync(mainFile)) !== mainHash ||
    output.semanticStructureArtifact?.frozen !== true ||
    !Object.isFrozen(output.semanticStructureArtifact))
    throw Error("Current PDF extraction boundary changed during offline replay");
  return { output, sourceSha: sha(context.offlinePdfBuffer),
    sourceBytes: context.offlinePdfBuffer.length, mainSha: mainHash };
}

module.exports = { extractObservedPdf };
