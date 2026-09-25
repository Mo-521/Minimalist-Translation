"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const APP = path.resolve(__dirname, "../electron-app");

async function main() {
  const pdfPath = process.argv[2];
  const localRequire = createRequire(path.join(APP, "main.js"));
  const blocked = () => { throw new Error("blocked"); };
  const electron = {
    app: { isPackaged: false, getPath: () => APP, setPath() {}, commandLine: { appendSwitch() {} }, whenReady: () => ({ then() {} }), on() {} },
    ipcMain: { handle() {}, on() {} }, BrowserWindow: blocked, dialog: { showOpenDialog: blocked }, shell: { openPath: blocked, openExternal: blocked },
  };
  const context = vm.createContext({
    require: (name) => name === "electron" ? electron : name === "child_process" ? { spawn: blocked, execFile: blocked } : localRequire(name),
    __dirname: APP,
    __filename: path.join(APP, "main.js"),
    process: { platform: process.platform, env: {}, cwd: () => APP },
    Buffer, Uint8Array, URL, setTimeout, clearTimeout,
    console,
    fetch: blocked,
    COLUMN_LAYOUT_TRACE: true,
  });
  vm.runInContext(fs.readFileSync(path.join(APP, "main.js"), "utf8"), context, { filename: path.join(APP, "main.js"), timeout: 20000 });
  context.pilotPdfJs = await import(pathToFileURL(localRequire.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
  vm.runInContext("pdfjsLib = pilotPdfJs;", context);
  context.pilotBuffer = fs.readFileSync(pdfPath);
  await vm.runInContext("extractPdfTextWithPdfJs(pilotBuffer, getPdfPipelineConfig('paper_pdf'))", context);
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
